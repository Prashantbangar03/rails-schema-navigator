import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('workspace path helpers use vscode workspace folders', () => {
  const { mockState } = require('./helpers/vscode-mock');
  const workspacePath = require('../out/workspacePath');

  mockState.workspaceFolders = [{ uri: { fsPath: '/workspace/app' }, name: 'app', index: 0 }];
  const modelPath = '/workspace/app/app/models/user.rb';
  const schemaPath = '/workspace/app/db/structure.sql';

  assert.equal(workspacePath.isPathInWorkspace(modelPath), true);
  assert.equal(workspacePath.isModelFilePath(modelPath), true);
  assert.equal(workspacePath.isSchemaFilePath(schemaPath), true);
  assert.equal(workspacePath.isSchemaFilePath('/etc/passwd'), false);
});
