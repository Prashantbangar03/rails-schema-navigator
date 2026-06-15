import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('extension command handlers and refresh explorer', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { activate } = require('../out/extension');
  const { refreshSchemaExplorer } = require('../out/refresh');
  const { resetSchemaIndexForTests } = require('../out/schemaIndex');

  activate(context);
  await new Promise((resolve) => setTimeout(resolve, 5));

  mockState.registeredCommands.get('schemaExplorer.open')?.('users');
  mockState.registeredCommands.get('schemaExplorer.openFromModel')?.();
  mockState.registeredCommands.get('schemaExplorer.findTable')?.();
  mockState.registeredCommands.get('schemaExplorer.switchProject')?.();
  mockState.registeredCommands.get('schemaExplorer.refresh')?.();

  resetSchemaIndexForTests();
  seedRailsProject();
  await refreshSchemaExplorer(context);
});

test('open explorer branches for pinned, editor, and multi-project flows', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  const context = createMockContext();
  const { ensureProjectLoaded, openExplorerWithContext, openExplorerFromModel } =
    require('../out/openExplorer');
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');

  mockState.config.followEditor = false;
  seedRailsProject('/workspace/one');
  mockState.findFilesByPattern = [
    { pattern: '**/db/structure.sql', uris: ['/workspace/one/db/structure.sql'] },
    { pattern: '**/db/schema.rb', uris: ['/workspace/two/db/schema.rb'] },
  ];
  mockState.files.set('/workspace/two/db/schema.rb', 'ActiveRecord::Schema[7.1].define(version: 1) do; end');
  mockState.fileStats.set('/workspace/two/db/schema.rb', { mtime: 1000 });
  resetSchemaIndexForTests();
  await ensureProjectLoaded(context);

  mockState.config.followEditor = true;
  resetSchemaIndexForTests();
  seedRailsProject();
  mockState.activeEditor = {
    document: createTextDocument('/workspace/rails-app/app/models/user.rb', 'class User < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await openExplorerWithContext(context, { table: 'users', column: 'email' });

  mockState.files.clear();
  mockState.fileStats.clear();
  mockState.findFilesByPattern = [];
  resetSchemaIndexForTests();
  mockState.activeEditor = null;
  await openExplorerFromModel(context);
  assert.match(mockState.warningMessages.at(-1) ?? '', /model file first/i);
});

test('findTable returns early without schema or quick pick', async () => {
  const { createMockContext } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  const { findTable } = require('../out/findTable');
  const context = createMockContext();

  await findTable(context);

  const { seedRailsProject } = require('./helpers/reset');
  seedRailsProject();
  mockState.quickPickResult = undefined;
  await findTable(context);
});

test('switchProject pins a specific project', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { switchProject } = require('../out/switchProject');

  mockState.quickPickResult = {
    label: 'rails-app',
    projectId: '/workspace/rails-app',
  };
  await switchProject(context);
});

test('schema index follows editor changes and watcher refresh', async () => {
  const { createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  const context = createMockContext();
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');

  mockState.workspaceFolders = [{ uri: { fsPath: '/workspace' }, name: 'workspace', index: 0 }];
  mockState.files.set('/workspace/rails-app/db/structure.sql', 'CREATE TABLE public.users (id bigint);');
  mockState.fileStats.set('/workspace/rails-app/db/structure.sql', { mtime: 1000 });
  mockState.files.set('/workspace/other-app/db/structure.sql', 'CREATE TABLE public.posts (id bigint);');
  mockState.fileStats.set('/workspace/other-app/db/structure.sql', { mtime: 1000 });
  mockState.findFilesByPattern = [
    {
      pattern: '**/db/structure.sql',
      uris: ['/workspace/rails-app/db/structure.sql', '/workspace/other-app/db/structure.sql'],
    },
    { pattern: '**/db/schema.rb', uris: [] },
    { pattern: 'app/models/**/*.rb', uris: [] },
    { pattern: 'migrate/**/*.rb', uris: [] },
  ];

  resetSchemaIndexForTests();
  const index = getSchemaIndex(context);
  await index.loadWithProject({ projectId: '/workspace/rails-app', force: true });

  mockState.activeEditor = {
    document: createTextDocument('/workspace/other-app/app/models/post.rb', 'class Post < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  const changed = await index.handleActiveEditorChange(mockState.activeEditor);
  assert.equal(changed, true);
});

test('schema explorer panel includes stale schema payload', async () => {
  const { seedRailsProject, createMockContext, extensionRoot } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  mockState.fileStats.set('/workspace/rails-app/db/migrate/001_init.rb', { mtime: 5000 });
  mockState.fileStats.set('/workspace/rails-app/db/structure.sql', { mtime: 1000 });
  const context = createMockContext();
  const vscode = require('./helpers/vscode-mock').vscode;
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');

  SchemaExplorerPanel.createOrShow(context, vscode.Uri.file(extensionRoot()), { table: 'users' });
  const panel = mockState.webviewPanels.at(-1) as { _receiveMessage?: (msg: unknown) => void };
  await panel._receiveMessage?.({ type: 'ready' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const payload = mockState.postedMessages.find(
    (msg: { payload?: { stale?: unknown } }) => msg.payload?.stale
  );
  assert.ok(payload);
  SchemaExplorerPanel.currentPanel?.panel.dispose();
  SchemaExplorerPanel.currentPanel = undefined;
});

test('schema explorer deserializes saved panel', async () => {
  const { createMockContext, extensionRoot } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  const context = createMockContext();
  const { registerWebviewSerializer, SchemaExplorerPanel } = require('../out/schemaExplorerPanel');
  registerWebviewSerializer(context);
  const vscode = require('./helpers/vscode-mock').vscode;
  const panel = vscode.window.createWebviewPanel();
  await mockState.webviewSerializer?.deserializeWebviewPanel(panel);
  assert.ok(SchemaExplorerPanel.currentPanel);
});

test('model index skips broken documents and merges duplicate tables', async () => {
  const { mockState } = require('./helpers/vscode-mock');
  const { scanModelEnumsForProject } = require('../out/modelIndex');
  mockState.findFilesByPattern = [
    {
      pattern: 'app/models/**/*.rb',
      uris: ['/workspace/rails-app/app/models/user.rb', '/workspace/rails-app/app/models/user_dup.rb'],
    },
  ];
  mockState.files.set(
    '/workspace/rails-app/app/models/user.rb',
    'class User < ApplicationRecord\nenum status: [:active]\nend'
  );
  mockState.files.set(
    '/workspace/rails-app/app/models/user_dup.rb',
    'class User < ApplicationRecord\nenum role: [:admin]\nend'
  );
  const enums = await scanModelEnumsForProject('/workspace/rails-app');
  assert.ok(enums.has('users'));

  mockState.files.delete('/workspace/rails-app/app/models/user_dup.rb');
  mockState.findFilesByPattern = [
    { pattern: 'app/models/**/*.rb', uris: ['/workspace/rails-app/app/models/broken.rb'] },
  ];
  delete require.cache[require.resolve('../out/modelIndex')];
  const { scanModelEnumsForProject: scanAgain } = require('../out/modelIndex');
  const originalOpen = require('./helpers/vscode-mock').vscode.workspace.openTextDocument;
  require('./helpers/vscode-mock').vscode.workspace.openTextDocument = async () => {
    throw new Error('broken');
  };
  await scanAgain('/workspace/rails-app');
  require('./helpers/vscode-mock').vscode.workspace.openTextDocument = originalOpen;
});

test('model resolver and project helpers cover remaining branches', () => {
  const modelResolver = require('../out/modelResolver');
  const schemaProject = require('../out/schemaProject');
  const vscode = require('./helpers/vscode-mock').vscode;

  assert.equal(modelResolver.resolveModelFromDocument({ uri: { fsPath: '/tmp/x.rb' }, getText: () => '' }), null);
  assert.equal(
    modelResolver.columnAtCursor(
      {
        lineAt: () => ({ text: 'validates :if' }),
        getWordRangeAtPosition: () => ({ start: { character: 10 }, end: { character: 12 } }),
        getText: () => 'if',
      },
      { line: 0, character: 11 },
      new Set(['email'])
    ),
    undefined
  );

  const projects = [
    {
      id: '/a',
      name: 'a',
      rootPath: '/a',
      schemaUri: vscode.Uri.file('/a/db/structure.sql'),
      schemaKind: 'structure.sql',
    },
    {
      id: '/b',
      name: 'b',
      rootPath: '/b',
      schemaUri: vscode.Uri.file('/b/db/schema.rb'),
      schemaKind: 'schema.rb',
    },
  ];
  assert.ok(schemaProject.pickBestProject(projects));
  assert.equal(schemaProject.resolveProjectById(undefined, projects), undefined);

  const { mockState } = require('./helpers/vscode-mock');
  mockState.workspaceFolders = [{ uri: { fsPath: '/a' }, name: 'a', index: 0 }];
  assert.notEqual(schemaProject.projectLabel(projects[0]), '');

  const workspacePath = require('../out/workspacePath');
  assert.equal(workspacePath.isPathWithinRoots('/a/db/structure.sql', ['/a']), true);
});

test('parser covers remaining schema.rb and sql branches', () => {
  const { parseStructureSql, parseSchemaRb } = require('../out/parser');
  const { repoStructurePath } = require('./helpers/fixtures');

  const sql = `
CREATE TABLE public.boxes (
  id bigint,
  CONSTRAINT boxes_pkey PRIMARY KEY (id),
  UNIQUE (id),
  CHECK (id > 0),
  CONSTRAINT boxes_fk FOREIGN KEY (id) REFERENCES public.users(id) ON DELETE CASCADE,
  EXCLUDE USING gist (id WITH =)
);
CREATE UNIQUE INDEX index_boxes_on_id ON public.boxes USING btree (id) WHERE (id IS NOT NULL);
`;
  parseStructureSql(sql);

  const rb = `
ActiveRecord::Schema[7.1].define(version: 1) do
  create_table "comments", force: :cascade do |t|
    t.string "body"
    t.check_constraint "length(body) > 0", name: "comments_body_check"
  end
  add_index "comments", ["body"], unique: true, where: "body IS NOT NULL"
  add_check_constraint "comments", "length(body) > 1", name: "comments_len"
  add_foreign_key "comments", "posts", on_delete: :restrict
end
`;
  parseSchemaRb(rb);

  const realPath = repoStructurePath();
  if (fs.existsSync(realPath)) {
    parseStructureSql(fs.readFileSync(realPath, 'utf8'));
  }
});

test('serializeSchema skips model enum when database enum exists', () => {
  const { parseStructureSql } = require('../out/parser');
  const { serializeSchema } = require('../out/schemaSerializer');
  const { fixturePath } = require('./helpers/fixtures');
  const vscode = require('./helpers/vscode-mock').vscode;
  const parsed = parseStructureSql(fs.readFileSync(fixturePath('comprehensive-structure.sql'), 'utf8'));
  const schema = { uri: vscode.Uri.file('/workspace/db/structure.sql'), ...parsed };
  const modelEnums = new Map([
    [
      'users',
      {
        tableName: 'users',
        modelName: 'User',
        modelPath: '/workspace/app/models/user.rb',
        columns: [{ column: 'status', name: 'status', values: [{ label: 'x', value: '0' }] }],
      },
    ],
  ]);
  const payload = serializeSchema(schema, modelEnums, undefined, '/workspace');
  assert.equal(payload.tables.users.columnEnums.status.source, 'database');
});

test('extension status bar, config, and editor listeners', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  const context = createMockContext();
  const { activate } = require('../out/extension');
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');

  mockState.findFilesByPattern = [];
  activate(context);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(mockState.statusBarText, null);

  seedRailsProject();
  resetSchemaIndexForTests();
  activate(createMockContext());
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(mockState.statusBarText);

  mockState.configChangeListeners[0]?.({
    affectsConfiguration: (section: string) => section === 'schemaExplorer',
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  mockState.config.followEditor = true;
  mockState.files.set('/workspace/other-app/db/structure.sql', 'CREATE TABLE public.posts (id bigint);');
  mockState.fileStats.set('/workspace/other-app/db/structure.sql', { mtime: 1000 });
  mockState.findFilesByPattern.push({
    pattern: '**/db/structure.sql',
    uris: ['/workspace/rails-app/db/structure.sql', '/workspace/other-app/db/structure.sql'],
  });
  mockState.activeEditor = {
    document: createTextDocument('/workspace/other-app/app/models/post.rb', 'class Post < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  mockState.editorChangeListeners[0]?.(mockState.activeEditor);
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('findTable returns when schema load is empty', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  seedRailsProject();
  const context = createMockContext();
  const { findTable } = require('../out/findTable');
  const { getSchemaIndex } = require('../out/schemaIndex');
  const index = getSchemaIndex(context);
  await index.loadWithProject({ force: true });
  index.load = async () => null;
  await findTable(context);
});

test('openExplorer covers editor warnings and single-project load', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  const context = createMockContext();
  const { openExplorerWithContext, openExplorerFromModel, ensureProjectLoaded } =
    require('../out/openExplorer');
  const { resetSchemaIndexForTests } = require('../out/schemaIndex');

  mockState.config.followEditor = true;
  seedRailsProject();
  mockState.activeEditor = {
    document: createTextDocument('/workspace/rails-app/app/models/user.rb', 'class User < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  mockState.files.delete('/workspace/rails-app/db/structure.sql');
  mockState.fileStats.delete('/workspace/rails-app/db/structure.sql');
  mockState.findFilesByPattern = [{ pattern: '**/db/structure.sql', uris: [] }];
  resetSchemaIndexForTests();
  await openExplorerWithContext(context);
  assert.match(mockState.warningMessages.at(-1) ?? '', /No schema found/i);

  mockState.files.clear();
  mockState.fileStats.clear();
  mockState.findFilesByPattern = [
    { pattern: '**/db/structure.sql', uris: ['/workspace/solo/db/structure.sql'] },
    { pattern: '**/db/schema.rb', uris: [] },
  ];
  mockState.files.set('/workspace/solo/db/structure.sql', 'CREATE TABLE public.items (id bigint);');
  mockState.fileStats.set('/workspace/solo/db/structure.sql', { mtime: 1 });
  resetSchemaIndexForTests();
  mockState.config.followEditor = false;
  const ready = await ensureProjectLoaded(context);
  assert.equal(ready, true);

  mockState.activeEditor = null;
  mockState.findFilesByPattern = [];
  resetSchemaIndexForTests();
  await openExplorerFromModel(context);
  assert.match(mockState.warningMessages.at(-1) ?? '', /model file first/i);

  mockState.activeEditor = {
    document: createTextDocument('/workspace/solo/app/models/item.rb', 'class Item < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await openExplorerFromModel(context);
  assert.match(mockState.warningMessages.at(-1) ?? '', /No schema found/i);
});

test('model index and resolver cover remaining branches', () => {
  const { parseEnumsFromModelText, scanModelEnumsForProject } = require('../out/modelIndex');
  const modelResolver = require('../out/modelResolver');
  const { createTextDocument } = require('./helpers/vscode-mock');

  const enums = parseEnumsFromModelText(`
class User < ApplicationRecord
  enum status: { "draft" => 0, active: 1 }
  enum role: { admin: 0, user: 1 }
  enum empty: {}
  enum dup: [:a]
  enum dup: [:b]
end
`);
  assert.ok(enums.some((e: { column: string }) => e.column === 'status'));

  const doc = createTextDocument(
    '/workspace/app/models/admin/leaf.rb',
    'class Admin::Leaf < ApplicationRecord; end'
  );
  assert.equal(modelResolver.isRailsModelDocument(createTextDocument('/tmp/x.rb', '')), false);
  const model = modelResolver.resolveModelFromDocument(doc);
  assert.ok(model?.tableName.includes('leaves') || model?.tableName.includes('leaf'));

  const peopleModel = modelResolver.resolveModelFromDocument(
    createTextDocument('/workspace/app/models/person.rb', 'class Person < ApplicationRecord; end')
  );
  assert.equal(peopleModel?.tableName, 'people');

  const column = modelResolver.columnAtCursor(
    createTextDocument('/workspace/app/models/user.rb', 'validates :status'),
    { line: 0, character: 12 },
    new Set(['status'])
  );
  assert.equal(column, 'status');

  assert.ok(modelResolver.scoreSchemaPath('/workspace/db/structure.sql') >= 0);
});

test('schema project label and serializer without project root', () => {
  const { parseStructureSql } = require('../out/parser');
  const { serializeSchema } = require('../out/schemaSerializer');
  const { projectLabel } = require('../out/schemaProject');
  const { mockState } = require('./helpers/vscode-mock');
  const vscode = require('./helpers/vscode-mock').vscode;

  mockState.workspaceFolders = [{ uri: { fsPath: '/workspace/monorepo' }, name: 'monorepo', index: 0 }];
  const project = {
    id: '/workspace/monorepo/apps/api',
    name: 'api',
    rootPath: '/workspace/monorepo/apps/api',
    schemaUri: vscode.Uri.file('/workspace/monorepo/apps/api/db/structure.sql'),
    schemaKind: 'structure.sql' as const,
  };
  assert.equal(projectLabel(project), 'apps/api');

  const parsed = parseStructureSql('CREATE TABLE public.users (id bigint NOT NULL, email varchar);');
  const payload = serializeSchema({ uri: project.schemaUri, ...parsed });
  assert.equal(payload.tables.users.modelPath, undefined);
});

test('schema index watcher and inactive editor branches', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  const index = getSchemaIndex(context);
  await index.loadWithProject({ force: true });

  mockState.fileWatcherCallbacks[0]?.change[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 5));

  mockState.config.followEditor = false;
  assert.equal(await index.handleActiveEditorChange(undefined), false);

  mockState.config.followEditor = true;
  await index.pinProject('/workspace/rails-app');
  assert.equal(await index.handleActiveEditorChange(mockState.activeEditor ?? undefined), false);

  await index.followActiveEditor();
  assert.equal(
    await index.handleActiveEditorChange({
      document: { uri: { fsPath: '/outside/app/models/x.rb' } },
      viewColumn: 1,
      selection: { active: { line: 0, character: 0 } },
    }),
    false
  );
});

test('switchProject follow-editor pick and panel dispose', async () => {
  const { seedRailsProject, createMockContext, extensionRoot } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { switchProject } = require('../out/switchProject');
  const { getSchemaIndex } = require('../out/schemaIndex');
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');
  const vscode = require('./helpers/vscode-mock').vscode;

  await getSchemaIndex(context).pinProject('/workspace/rails-app');
  mockState.quickPickResult = { followEditor: true };
  await switchProject(context);

  SchemaExplorerPanel.createOrShow(context, vscode.Uri.file(extensionRoot()));
  SchemaExplorerPanel.currentPanel?.panel.dispose();
});

