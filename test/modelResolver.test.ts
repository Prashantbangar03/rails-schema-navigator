import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

const modelResolver = () => require('../out/modelResolver');
const { createTextDocument } = require('./helpers/vscode-mock');

test('model resolver maps documents, tables, and cursor columns', () => {
  const {
    isRailsModelDocument,
    resolveModelFromDocument,
    columnAtCursor,
    nearestDbRoot,
    scoreSchemaPath,
    guessModelForTable,
    isImplicitJoinTable,
    isJoinStyleTable,
  } = modelResolver();

  const modelPath = '/workspace/rails-app/app/models/user.rb';
  const doc = createTextDocument(
    modelPath,
    `class User < ApplicationRecord
  self.table_name = 'accounts'
end`
  );

  assert.equal(isRailsModelDocument(doc), true);
  assert.equal(
    isRailsModelDocument(createTextDocument('/workspace/app/models/concerns/x.rb', '')),
    false
  );

  const model = resolveModelFromDocument(doc);
  assert.equal(model?.tableName, 'accounts');
  assert.equal(model?.modelName, 'User');

  const tableColumns = new Set(['email', 'status']);
  const editorDoc = createTextDocument(
    modelPath,
    `class User < ApplicationRecord
  validates :email
end`
  );
  const column = columnAtCursor(editorDoc, { line: 1, character: 12 }, tableColumns);
  assert.equal(column, 'email');

  assert.equal(nearestDbRoot('/workspace/rails-app/db/migrate/001.rb'), '/workspace/rails-app/db');
  assert.ok(scoreSchemaPath('/workspace/rails-app/db/structure.sql', '/workspace/rails-app/app/models/user.rb') <
    scoreSchemaPath('/other/db/structure.sql', '/workspace/rails-app/app/models/user.rb'));

  const joinGuess = guessModelForTable('apis_channels', '/workspace/rails-app', true);
  assert.match(joinGuess.modelPath, /apis_channel\.rb$/);

  const userGuess = guessModelForTable('users', '/workspace/rails-app');
  assert.match(userGuess.modelPath, /user\.rb$/);

  const emptyGuess = guessModelForTable('', '/workspace/rails-app');
  assert.equal(emptyGuess.modelName, 'ApplicationRecord');

  const joinTable = {
    isJoinTable: true,
    outgoingFks: [{ fromCol: 'a_id' }, { fromCol: 'b_id' }],
    columns: [{ name: 'a_id' }, { name: 'b_id' }],
  };
  assert.equal(isImplicitJoinTable(joinTable), true);
  assert.equal(isJoinStyleTable({ isJoinTable: true, outgoingFks: [] }), true);
});

test('model resolver handles pluralization and class name from filename', () => {
  const { resolveModelFromDocument } = modelResolver();
  const doc = createTextDocument(
    '/workspace/rails-app/app/models/admin/user_profile.rb',
    '# no explicit class'
  );
  const model = resolveModelFromDocument(doc);
  assert.ok(model?.modelName.includes('UserProfile'));
  assert.ok(model?.tableName.includes('user_profiles'));
});
