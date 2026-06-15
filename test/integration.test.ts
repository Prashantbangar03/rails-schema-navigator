import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('extension activates commands and updates status bar', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { activate, deactivate } = require('../out/extension');
  activate(context);
  assert.ok(mockState.registeredCommands.has('schemaExplorer.open'));
  deactivate();

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(context.subscriptions.length > 0);
});

test('open explorer commands handle model and schema contexts', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { openExplorerWithContext, openExplorerFromModel, ensureProjectLoaded } =
    require('../out/openExplorer');
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');

  mockState.activeEditor = {
    document: createTextDocument(
      '/workspace/rails-app/app/models/user.rb',
      'class User < ApplicationRecord; end'
    ),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await openExplorerWithContext(context);
  assert.ok(SchemaExplorerPanel.currentPanel);

  SchemaExplorerPanel.currentPanel = undefined;
  mockState.activeEditor = {
    document: createTextDocument(
      '/workspace/rails-app/app/models/user.rb',
      'class User < ApplicationRecord; end'
    ),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await openExplorerFromModel(context);

  mockState.files.clear();
  mockState.fileStats.clear();
  mockState.findFilesByPattern = [];
  const { resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  mockState.activeEditor = {
    document: createTextDocument(
      '/workspace/other/app/models/user.rb',
      'class User < ApplicationRecord; end'
    ),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await openExplorerFromModel(context);
  assert.ok(mockState.warningMessages.length > 0);

  mockState.findFilesByPattern = [];
  mockState.activeEditor = null;
  const ready = await ensureProjectLoaded(context);
  assert.equal(ready, false);
});

test('find table, switch project, and refresh commands', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { findTable } = require('../out/findTable');
  const { switchProject } = require('../out/switchProject');
  const { refreshSchemaExplorer } = require('../out/refresh');
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');

  mockState.quickPickResult = { label: 'users' };
  await findTable(context);
  assert.ok(SchemaExplorerPanel.currentPanel);

  mockState.quickPickResult = { followEditor: true };
  await switchProject(context);

  mockState.quickPickResult = undefined;
  mockState.files.clear();
  mockState.fileStats.clear();
  mockState.findFilesByPattern = [];
  const { resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  await switchProject(context);
  assert.match(mockState.warningMessages.at(-1) ?? '', /No db\/structure.sql/i);

  seedRailsProject();
  await refreshSchemaExplorer(context);
});

test('schema explorer panel handles webview messages and themes', async () => {
  const { seedRailsProject, createMockContext, extensionRoot } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const vscode = require('./helpers/vscode-mock').vscode;
  const {
    SchemaExplorerPanel,
    notifyPanelSchemaChanged,
    registerWebviewSerializer,
  } = require('../out/schemaExplorerPanel');

  registerWebviewSerializer(context);
  SchemaExplorerPanel.createOrShow(context, vscode.Uri.file(extensionRoot()), { table: 'users' });
  const panel = mockState.webviewPanels.at(-1) as {
    _receiveMessage?: (msg: unknown) => void;
    webview: { html: string };
  };
  assert.ok(panel.webview.html.includes('Rails Schema Navigator'));

  await panel._receiveMessage?.({ type: 'ready' });
  await panel._receiveMessage?.({ type: 'selectProject', projectId: null });
  await panel._receiveMessage?.({
    type: 'selectProject',
    projectId: '/workspace/rails-app',
  });
  await panel._receiveMessage?.({
    type: 'copyStaleCommand',
    command: 'rails db:structure:dump',
  });
  assert.equal(mockState.clipboardText, 'rails db:structure:dump');
  await panel._receiveMessage?.({ type: 'copyStaleCommand', command: 'evil' });

  const schemaPath = '/workspace/rails-app/db/structure.sql';
  await panel._receiveMessage?.({ type: 'openSchemaFile', path: schemaPath });
  await panel._receiveMessage?.({ type: 'openSchemaFile', path: '/etc/passwd' });

  await panel._receiveMessage?.({
    type: 'runStaleCommand',
    command: 'rails db:structure:dump',
  });
  assert.deepEqual(mockState.terminalCommands, ['rails db:structure:dump']);

  const missingModel = '/workspace/rails-app/app/models/missing.rb';
  mockState.files.delete(missingModel);
  await panel._receiveMessage?.({ type: 'openModel', path: missingModel });
  await panel._receiveMessage?.({ type: 'openModel', path: '/etc/passwd' });

  const modelPath = '/workspace/rails-app/app/models/user.rb';
  mockState.files.set(modelPath, 'class User < ApplicationRecord; end');
  await panel._receiveMessage?.({ type: 'openModel', path: modelPath });

  await panel._receiveMessage?.({ type: 'refreshSchema' });

  mockState.colorThemeKind = vscode.ColorThemeKind.Light;
  mockState.themeChangeListeners[0]?.();
  mockState.colorThemeKind = vscode.ColorThemeKind.HighContrastLight;
  mockState.themeChangeListeners[0]?.();

  SchemaExplorerPanel.createOrShow(context, vscode.Uri.file(extensionRoot()), {
    table: 'users',
  });

  await notifyPanelSchemaChanged();
  SchemaExplorerPanel.currentPanel?.panel.dispose();
  SchemaExplorerPanel.currentPanel = undefined;
  await notifyPanelSchemaChanged();

  const revivedPanel = mockState.webviewPanels[0];
  SchemaExplorerPanel.revive(revivedPanel as never, context, vscode.Uri.file(extensionRoot()));
  assert.ok(SchemaExplorerPanel.currentPanel);
});

test('schema explorer panel posts empty payload when schema missing', async () => {
  const { createMockContext, extensionRoot } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  mockState.findFilesByPattern = [];
  const context = createMockContext();
  const vscode = require('./helpers/vscode-mock').vscode;
  const { SchemaExplorerPanel } = require('../out/schemaExplorerPanel');
  SchemaExplorerPanel.createOrShow(context, vscode.Uri.file(extensionRoot()));
  assert.ok(mockState.postedMessages.some((msg: { type?: string }) => msg.type === 'loadSchema'));
});

test('parseSchemaDocument chooses parser by filename', () => {
  const { parseSchemaDocument } = require('../out/parser');
  const { fixturePath } = require('./helpers/fixtures');
  const { createTextDocument } = require('./helpers/vscode-mock');
  const rbDoc = createTextDocument(
    '/workspace/rails-app/db/schema.rb',
    fs.readFileSync(fixturePath('comprehensive-schema.rb'), 'utf8')
  );
  const sqlDoc = createTextDocument(
    '/workspace/rails-app/db/structure.sql',
    fs.readFileSync(fixturePath('comprehensive-structure.sql'), 'utf8')
  );
  assert.ok(parseSchemaDocument(rbDoc).tables.has('posts'));
  assert.ok(parseSchemaDocument(sqlDoc).tables.has('users'));
});
