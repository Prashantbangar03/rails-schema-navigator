import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  isAllowedStaleCommand,
  isModelFilePathNormalized,
  isPathWithinRoots,
  isSchemaFilePathNormalized,
} from '../out/pathGuards';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('isPathWithinRoots validates absolute paths within roots', () => {
  const root = '/Users/dev/my-rails-app';
  assert.equal(isPathWithinRoots(`${root}/app/models/user.rb`, [root]), true);
  assert.equal(isPathWithinRoots(root, [root]), true);
  assert.equal(isPathWithinRoots('/etc/passwd', [root]), false);
  assert.equal(isPathWithinRoots('relative/path', [root]), false);
  assert.equal(isPathWithinRoots(`${root}/db/structure.sql`, []), false);
});

test('isModelFilePathNormalized and isSchemaFilePathNormalized', () => {
  assert.equal(
    isModelFilePathNormalized('/workspace/app/models/user.rb', true),
    true
  );
  assert.equal(
    isModelFilePathNormalized('/workspace/app/models/concerns/foo.rb', true),
    false
  );
  assert.equal(
    isSchemaFilePathNormalized('/workspace/db/structure.sql', true),
    true
  );
  assert.equal(
    isSchemaFilePathNormalized('/workspace/db/schema.rb', true),
    true
  );
  assert.equal(isSchemaFilePathNormalized('/workspace/Gemfile', true), false);
  assert.equal(isModelFilePathNormalized('/workspace/app/models/user.rb', false), false);
});

test('isAllowedStaleCommand accepts only Rails dump commands', () => {
  assert.equal(isAllowedStaleCommand('rails db:structure:dump'), true);
  assert.equal(isAllowedStaleCommand('rails db:schema:dump'), true);
  assert.equal(isAllowedStaleCommand(' rm -rf / '), false);
});
