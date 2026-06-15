import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('getStaleSchemaInfo detects stale and fresh schemas', async () => {
  const { getStaleSchemaInfo } = require('../out/staleSchema');
  const vscode = require('./helpers/vscode-mock').vscode;
  const { mockState } = require('./helpers/vscode-mock');
  const schemaUri = vscode.Uri.file('/workspace/rails-app/db/structure.sql');

  mockState.fileStats.set(schemaUri.fsPath, { mtime: 1000 });
  mockState.findFilesByPattern = [
    { pattern: 'migrate/**/*.rb', uris: [`/workspace/rails-app/db/migrate/001.rb`] },
  ];
  mockState.fileStats.set('/workspace/rails-app/db/migrate/001.rb', { mtime: 2000 });

  const stale = await getStaleSchemaInfo(schemaUri);
  assert.equal(stale.stale, true);
  assert.equal(stale.dumpCommand, 'rails db:structure:dump');

  mockState.fileStats.set('/workspace/rails-app/db/migrate/001.rb', { mtime: 500 });
  const fresh = await getStaleSchemaInfo(schemaUri);
  assert.equal(fresh.stale, false);

  mockState.findFilesByPattern = [];
  const noMigrations = await getStaleSchemaInfo(schemaUri);
  assert.equal(noMigrations.stale, false);

  const rbUri = vscode.Uri.file('/workspace/rails-app/db/schema.rb');
  mockState.fileStats.set(rbUri.fsPath, { mtime: 1000 });
  mockState.findFilesByPattern = [
    { pattern: 'migrate/**/*.rb', uris: [`/workspace/rails-app/db/migrate/001.rb`] },
  ];
  mockState.fileStats.set('/workspace/rails-app/db/migrate/001.rb', { mtime: 2000 });
  const staleRb = await getStaleSchemaInfo(rbUri);
  assert.equal(staleRb.dumpCommand, 'rails db:schema:dump');

  mockState.fileStats.delete(schemaUri.fsPath);
  const error = await getStaleSchemaInfo(schemaUri);
  assert.equal(error.stale, false);
});
