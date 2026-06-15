import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('status bar shows and hides based on settings', () => {
  const { mockState } = require('./helpers/vscode-mock');
  const { getSchemaStatusBar, resetSchemaStatusBarForTests } = require('../out/statusBar');

  resetSchemaStatusBarForTests();
  const bar = getSchemaStatusBar();
  bar.update('users');
  assert.match(mockState.statusBarText ?? '', /users/);

  mockState.config.showStatusBar = false;
  resetSchemaStatusBarForTests();
  getSchemaStatusBar().update('hidden');
  assert.equal(mockState.statusBarText, null);

  getSchemaStatusBar().update(null);
  assert.equal(mockState.statusBarText, null);
  getSchemaStatusBar().dispose();
});
