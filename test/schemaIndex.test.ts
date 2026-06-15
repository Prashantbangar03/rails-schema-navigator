import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('schema index loads, caches, pins, and follows editor', async () => {
  const { seedRailsProject, createMockContext } = require('./helpers/reset');
  const { mockState, createTextDocument } = require('./helpers/vscode-mock');
  seedRailsProject();
  const context = createMockContext();
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  const index = getSchemaIndex(context);

  const projects = await index.listProjects(true);
  assert.equal(projects.length, 1);

  const loaded = await index.loadWithProject({ force: true });
  assert.ok(loaded?.schema.tables.has('users'));
  assert.equal(index.activeProjectLabel(), 'Rails Schema Navigator — rails-app');

  const cached = await index.loadWithProject();
  assert.ok(cached?.schema);

  await index.pinProject(projects[0].id);
  assert.equal(index.isPinned(), true);
  await index.followActiveEditor();
  assert.equal(index.isPinned(), false);

  mockState.activeEditor = {
    document: createTextDocument('/workspace/rails-app/app/models/user.rb'),
    viewColumn: 1,
    selection: { active: { line: 0, character: 0 } },
  };
  await index.loadForEditor(mockState.activeEditor);
  assert.ok(index.getActiveProject());

  mockState.config.followEditor = true;
  const changed = await index.handleActiveEditorChange(mockState.activeEditor);
  assert.equal(changed, false);

  index.invalidate();
  assert.equal(index.getActiveProject(), null);

  let eventCount = 0;
  index.onDidChange(() => {
    eventCount++;
  });
  await index.load({ force: true });
  assert.ok(eventCount >= 1);
});

test('schema index returns null when no schema exists', async () => {
  const { createMockContext } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  mockState.findFilesByPattern = [];
  const context = createMockContext();
  const { getSchemaIndex, resetSchemaIndexForTests } = require('../out/schemaIndex');
  resetSchemaIndexForTests();
  const index = getSchemaIndex(context);
  const loaded = await index.loadWithProject({ force: true });
  assert.equal(loaded, null);
  assert.equal(index.activeProjectLabel(), 'Rails Schema Navigator');
});

test('schema index file watchers trigger reload', async () => {
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
  assert.ok(index.getActiveProject());
});
