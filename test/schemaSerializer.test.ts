import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('serializeSchema builds payload with enums, models, and stale info', () => {
  const { parseStructureSql } = require('../out/parser');
  const { serializeSchema, workspaceRelativePath } = require('../out/schemaSerializer');
  const vscode = require('./helpers/vscode-mock').vscode;
  const { fixturePath } = require('./helpers/fixtures');
  const sql = fs.readFileSync(fixturePath('comprehensive-structure.sql'), 'utf8');
  const parsed = parseStructureSql(sql);
  const schemaUri = vscode.Uri.file('/workspace/rails-app/db/structure.sql');
  const schema = { uri: schemaUri, ...parsed };
  const modelEnums = new Map([
    [
      'users',
      {
        tableName: 'users',
        modelName: 'User',
        modelPath: '/workspace/rails-app/app/models/user.rb',
        columns: [{ column: 'legacy_status', name: 'legacy_status', values: [{ label: 'a', value: '0' }] }],
      },
    ],
  ]);

  const payload = serializeSchema(schema, modelEnums, {
    message: 'stale',
    dumpCommand: 'rails db:structure:dump',
    schemaPath: schemaUri.fsPath,
  }, '/workspace/rails-app');

  assert.equal(payload.sourceKind, 'structure.sql');
  assert.ok(payload.tables.users);
  assert.ok(payload.types.order_status);
  assert.ok(payload.views.active_users);
  assert.equal(payload.stale?.dumpCommand, 'rails db:structure:dump');
  assert.equal(payload.tables.users.columnEnums.status.source, 'database');
  assert.equal(payload.tables.users.columnEnums.legacy_status.source, 'model');
  assert.ok(payload.tables.apis_channels.modelPath);

  const { mockState } = require('./helpers/vscode-mock');
  assert.equal(workspaceRelativePath(schemaUri), 'db/structure.sql');
  mockState.workspaceFolders = [];
  assert.equal(workspaceRelativePath(schemaUri), 'structure.sql');
});

test('serializeSchema uses schema.rb kind and skips implicit join model', () => {
  const { parseSchemaRb } = require('../out/parser');
  const { serializeSchema } = require('../out/schemaSerializer');
  const { fixturePath } = require('./helpers/fixtures');
  const ruby = fs.readFileSync(fixturePath('comprehensive-schema.rb'), 'utf8');
  const parsed = parseSchemaRb(ruby);
  const vscode = require('./helpers/vscode-mock').vscode;
  const schema = { uri: vscode.Uri.file('/workspace/rails-app/db/schema.rb'), ...parsed };
  const payload = serializeSchema(schema, undefined, undefined, '/workspace/rails-app');
  assert.equal(payload.sourceKind, 'schema.rb');
  assert.equal(payload.tables.apis_channels.modelPath, undefined);
});
