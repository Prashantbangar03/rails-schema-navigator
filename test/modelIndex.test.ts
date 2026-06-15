import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('parseEnumsFromModelText handles hash, array, and symbol enums', () => {
  const { parseEnumsFromModelText } = require('../out/modelIndex');
  const text = `
    enum status: { active: 0, inactive: 1 }
    enum :role, { admin: 1, user: 2 }
    enum priority, [:low, :high]
    enum :kind, %i[a b]
  `;
  const enums = parseEnumsFromModelText(text);
  assert.equal(enums.length, 4);
  assert.deepEqual(enums.find((e: { column: string }) => e.column === 'status')?.values[0], {
    label: 'active',
    value: '0',
  });
});

test('scanModelEnumsForProject scans workspace model files', async () => {
  const { seedRailsProject } = require('./helpers/reset');
  const { mockState } = require('./helpers/vscode-mock');
  seedRailsProject();
  const { scanModelEnumsForProject } = require('../out/modelIndex');

  const enums = await scanModelEnumsForProject('/workspace/rails-app');
  assert.ok(enums.has('users'));
  assert.equal(enums.get('users')?.columns.length, 1);

  mockState.files.set('/workspace/rails-app/app/models/post.rb', 'class Post < ApplicationRecord; end');
  mockState.findFilesByPattern.push({
    pattern: 'app/models/**/*.rb',
    uris: [
      '/workspace/rails-app/app/models/user.rb',
      '/workspace/rails-app/app/models/post.rb',
    ],
  });
  mockState.files.set(
    '/workspace/rails-app/app/models/bad.rb',
    'not a model'
  );
  mockState.findFilesByPattern[mockState.findFilesByPattern.length - 1].uris.push(
    '/workspace/rails-app/app/models/bad.rb'
  );
  mockState.files.delete('/workspace/rails-app/app/models/bad.rb');

  const withSkip = await scanModelEnumsForProject('/workspace/rails-app');
  assert.ok(withSkip.size >= 1);
});

test('scanModelEnumsForProject skips unreadable and concern models', async () => {
  const { mockState } = require('./helpers/vscode-mock');
  const { scanModelEnumsForProject } = require('../out/modelIndex');
  mockState.findFilesByPattern = [
    {
      pattern: 'app/models/**/*.rb',
      uris: ['/workspace/rails-app/app/models/concerns/trackable.rb'],
    },
  ];
  mockState.files.set(
    '/workspace/rails-app/app/models/concerns/trackable.rb',
    'module Trackable; end'
  );
  const enums = await scanModelEnumsForProject('/workspace/rails-app');
  assert.equal(enums.size, 0);
});
