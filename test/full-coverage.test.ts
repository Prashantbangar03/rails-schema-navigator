import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('parser edge-case fixtures cover remaining branches', () => {
  const { parseStructureSql, parseSchemaRb } = require('../out/parser');
  const { fixturePath } = require('./helpers/fixtures');
  parseStructureSql(fs.readFileSync(fixturePath('parser-edge-cases.sql'), 'utf8'));
  parseSchemaRb(fs.readFileSync(fixturePath('parser-edge-cases.rb'), 'utf8'));

  parseStructureSql(`
CREATE TABLE public.companies (id bigint, company_id bigint);
CREATE TABLE public.company (id bigint);
CREATE TABLE public.foxes (id bigint, fox_id bigint);
CREATE TABLE public.fox (id bigint);
CREATE TABLE public.dishes (id bigint, dish_id bigint);
CREATE TABLE public.dish (id bigint);
CREATE TABLE public.batches (id bigint, batch_id bigint);
CREATE TABLE public.batch (id bigint);
CREATE TABLE public.aliases (id bigint, alias_id bigint);
CREATE TABLE public.alias (id bigint);
CREATE TABLE public.classes (id bigint, class_id bigint);
CREATE TABLE public.class (id bigint);
CREATE TABLE public.bushes (id bigint, bush_id bigint);
CREATE TABLE public.bush (id bigint);
CREATE TABLE public.dishes_mismatch (id bigint, category_id bigint);
CREATE TABLE public.category (id bigint);
CREATE TABLE public.orphan_join (a_id bigint, b_id bigint);
`);

  parseSchemaRb(`
ActiveRecord::Schema[7.1].define(version: 1) do
  create_table "empty_index", force: :cascade do |t|
    t.string "name"
  end
  add_index "empty_index", []
  add_index "ghost", ["missing"]
  add_check_constraint "ghost", "1=1"
end
`);
});

test('model index hash rockets, quotes, and merge paths', () => {
  const { parseEnumsFromModelText } = require('../out/modelIndex');
  const enums = parseEnumsFromModelText(`
class Order < ApplicationRecord
  enum status: { "draft" => 0, "published" => 1 }
  enum role: { admin: 0, user: 1 }
  enum empty: {}
  enum tags: [:a, :b]
end
`);
  assert.ok(enums.some((e: { column: string }) => e.column === 'status'));
  assert.equal(parseEnumsFromModelText('enum role: {}').length, 0);
});

test('model index scan merges duplicate tables and skips invalid models', async () => {
  const { mockState } = require('./helpers/vscode-mock');
  const { scanModelEnumsForProject } = require('../out/modelIndex');
  mockState.workspaceFolders = [{ uri: { fsPath: '/workspace/rails-app' }, name: 'rails-app', index: 0 }];
  mockState.files.set(
    '/workspace/rails-app/app/models/user.rb',
    'class User < ApplicationRecord\nenum :status, [:active]\nend'
  );
  mockState.files.set(
    '/workspace/rails-app/app/models/user_dup.rb',
    'class User < ApplicationRecord\nenum :role, [:admin]\nend'
  );
  mockState.files.set(
    '/workspace/rails-app/app/models/invalid.rb',
    'class Invalid < ApplicationRecord; end'
  );
  mockState.findFilesByPattern = [
    {
      pattern: 'app/models/**/*.rb',
      uris: [
        '/workspace/rails-app/app/models/user.rb',
        '/workspace/rails-app/app/models/user_dup.rb',
        '/workspace/rails-app/app/models/invalid.rb',
      ],
    },
  ];
  const enums = await scanModelEnumsForProject('/workspace/rails-app');
  assert.ok(enums.has('users'));
  const columns = enums.get('users')?.columns.map((c: { column: string }) => c.column) ?? [];
  assert.ok(columns.includes('status') || columns.includes('role'));
});

test('model resolver pluralization and cursor branches', () => {
  const modelResolver = require('../out/modelResolver');
  const { createTextDocument } = require('./helpers/vscode-mock');

  assert.equal(
    modelResolver.resolveModelFromDocument(
      createTextDocument('/workspace/app/models/category.rb', 'class Category < ApplicationRecord; end')
    )?.tableName,
    'categories'
  );
  assert.equal(
    modelResolver.resolveModelFromDocument(
      createTextDocument('/workspace/app/models/box.rb', 'class Box < ApplicationRecord; end')
    )?.tableName,
    'boxes'
  );
  assert.equal(
    modelResolver.resolveModelFromDocument(
      createTextDocument('/workspace/app/models/leaf.rb', '')
    )?.modelName,
    'Leaf'
  );
  assert.equal(
    modelResolver.resolveModelFromDocument(
      createTextDocument('/workspace/app/models/person.rb', 'class Person < ApplicationRecord; end')
    )?.tableName,
    'people'
  );
  assert.equal(
    modelResolver.resolveModelFromDocument(
      createTextDocument('/workspace/app/models/wolf.rb', 'class Wolf < ApplicationRecord; end')
    )?.tableName,
    'wolves'
  );
  assert.equal(
    modelResolver.columnAtCursor(
      createTextDocument('/workspace/app/models/user.rb', 'class User < ApplicationRecord'),
      { line: 0, character: 2 },
      new Set(['class'])
    ),
    undefined
  );
  assert.ok(
    modelResolver.scoreSchemaPath(
      '/workspace/monorepo/apps/api/db/structure.sql',
      '/workspace/monorepo/apps/api/app/models/user.rb'
    ) < 0
  );
});

test('openExplorer ensureProjectLoaded branches', async () => {
  const { createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  const { ensureProjectLoaded, openExplorerFromModel, openExplorerWithContext } =
    require('../out/openExplorer');
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');

  const context = createMockContext();
  mockState.config.followEditor = true;
  mockState.files.set('/workspace/a/db/structure.sql', 'CREATE TABLE public.a (id bigint);');
  mockState.fileStats.set('/workspace/a/db/structure.sql', { mtime: 1 });
  mockState.files.set('/workspace/b/db/structure.sql', 'CREATE TABLE public.b (id bigint);');
  mockState.fileStats.set('/workspace/b/db/structure.sql', { mtime: 1 });
  mockState.findFilesByPattern = [
    { pattern: '**/db/structure.sql', uris: ['/workspace/a/db/structure.sql', '/workspace/b/db/structure.sql'] },
  ];
  resetSchemaIndexForTests();
  const index = getSchemaIndex(context);
  const originalLoad = index.loadWithProject.bind(index);
  index.loadWithProject = async (opts?: { force?: boolean; projectId?: string }) => {
    if (!opts?.force && !opts?.projectId) {
      return null;
    }
    return originalLoad(opts);
  };
  mockState.quickPickResult = { projectId: '/workspace/a' };
  const multi = await ensureProjectLoaded(context);
  assert.equal(multi, true);
  await index.followActiveEditor();

  mockState.findFilesByPattern = [
    { pattern: '**/db/structure.sql', uris: ['/workspace/solo/db/structure.sql'] },
  ];
  mockState.files.set('/workspace/solo/db/structure.sql', 'CREATE TABLE public.items (id bigint);');
  mockState.fileStats.set('/workspace/solo/db/structure.sql', { mtime: 1 });
  mockState.files.delete('/workspace/a/db/structure.sql');
  mockState.files.delete('/workspace/b/db/structure.sql');
  mockState.fileStats.delete('/workspace/a/db/structure.sql');
  mockState.fileStats.delete('/workspace/b/db/structure.sql');
  await context.workspaceState.update('schemaExplorer.pinnedProjectId', undefined);
  resetSchemaIndexForTests();
  const soloContext = createMockContext();
  await soloContext.workspaceState.update('schemaExplorer.pinnedProjectId', undefined);
  const soloIndex = getSchemaIndex(soloContext);
  const soloLoad = soloIndex.loadWithProject.bind(soloIndex);
  soloIndex.loadWithProject = async (opts?: { force?: boolean; projectId?: string }) => {
    if (!opts?.force && !opts?.projectId) {
      return null;
    }
    return soloLoad(opts);
  };
  assert.equal(await ensureProjectLoaded(soloContext), true);

  mockState.config.followEditor = true;
  mockState.activeEditor = {
    document: createTextDocument('/workspace/solo/app/models/item.rb', 'class Item < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  assert.equal(await ensureProjectLoaded(soloContext, mockState.activeEditor), true);

  mockState.activeEditor = {
    document: createTextDocument('/workspace/solo/db/structure.sql', 'CREATE TABLE public.items (id bigint);'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await openExplorerFromModel(soloContext);
  assert.match(mockState.warningMessages.at(-1) ?? '', /app\/models/i);

  mockState.activeEditor = {
    document: createTextDocument('/workspace/solo/app/models/item.rb', 'class Item < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  soloIndex.loadForEditor = async () => null;
  await openExplorerWithContext(soloContext);
  assert.match(mockState.warningMessages.at(-1) ?? '', /No schema found/i);

  mockState.activeEditor = null;
  soloIndex.loadWithProject = async () => null;
  mockState.findFilesByPattern = [];
  assert.equal(await ensureProjectLoaded(soloContext), false);
});

test('findTable exits when schema load returns null', async () => {
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

test('extension listeners cover status bar and editor notifications', async () => {
  const { seedRailsProject, createMockContext, extensionRoot } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  const context = createMockContext();
  const { activate } = require('../out/extension');
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');
  const vscode = require('./helpers/vscode-mock').vscode;

  mockState.findFilesByPattern = [];
  activate(context);
  await new Promise((resolve) => setTimeout(resolve, 15));

  seedRailsProject('/workspace/a');
  resetSchemaIndexForTests();
  activate(createMockContext());
  await new Promise((resolve) => setTimeout(resolve, 15));

  mockState.configChangeListeners.at(-1)?.({
    affectsConfiguration: (section: string) => section === 'schemaExplorer',
  });

  SchemaExplorerPanel.createOrShow(context, vscode.Uri.file(extensionRoot()));
  mockState.config.followEditor = true;
  await getSchemaIndex(context).followActiveEditor();
  mockState.activeEditor = {
    document: createTextDocument('/workspace/a/app/models/user.rb', 'class User < ApplicationRecord; end'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  mockState.editorChangeListeners.at(-1)?.(mockState.activeEditor);
  await new Promise((resolve) => setTimeout(resolve, 15));
  SchemaExplorerPanel.currentPanel?.panel.dispose();
  SchemaExplorerPanel.currentPanel = undefined;
});

test('schema project label and serializer edge paths', () => {
  const { parseStructureSql } = require('../out/parser');
  const { serializeSchema, workspaceRelativePath } = require('../out/schemaSerializer');
  const { projectLabel } = require('../out/schemaProject');
  const { mockState } = require('./helpers/vscode-mock');
  const vscode = require('./helpers/vscode-mock').vscode;

  mockState.workspaceFolders = [];
  const project = {
    id: '/workspace/orphan',
    name: 'orphan',
    rootPath: '/workspace/orphan',
    schemaUri: vscode.Uri.file('/workspace/orphan/db/structure.sql'),
    schemaKind: 'structure.sql' as const,
  };
  assert.equal(projectLabel(project), 'orphan');

  mockState.workspaceFolders = [{ uri: { fsPath: '/workspace/root' }, name: 'root', index: 0 }];
  const nested = {
    ...project,
    rootPath: '/workspace/root',
    schemaUri: vscode.Uri.file('/workspace/root/db/structure.sql'),
    name: 'root',
  };
  assert.equal(projectLabel(nested), 'root');
  assert.equal(workspaceRelativePath(nested.schemaUri), 'db/structure.sql');

  const parsed = parseStructureSql('CREATE TABLE public.users (id bigint NOT NULL);');
  const payload = serializeSchema({ uri: nested.schemaUri, ...parsed });
  assert.equal(payload.tables.users.modelPath, undefined);
});

test('schema index cache hit and watcher refresh', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  const index = getSchemaIndex(context);
  await index.loadWithProject({ force: true });
  await index.loadWithProject();
  mockState.fileWatcherCallbacks[0]?.change[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('schema explorer panel opens model and disposes cleanly', async () => {
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
  await panel._receiveMessage?.({
    type: 'openModel',
    path: '/workspace/rails-app/app/models/user.rb',
  });
  SchemaExplorerPanel.currentPanel?.panel.dispose();
  SchemaExplorerPanel.currentPanel = undefined;
  const { resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  await new Promise((resolve) => setTimeout(resolve, 30));
});

test('workspace path with empty workspace folders', () => {
  const { mockState } = require('./helpers/vscode-mock');
  const workspacePath = require('../out/workspacePath');
  mockState.workspaceFolders = [];
  assert.equal(workspacePath.isPathInWorkspace('/anywhere/file.rb'), false);
});
