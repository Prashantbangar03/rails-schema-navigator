import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('comprehensive structure.sql fixture covers enums, domains, views, joins, and constraints', () => {
  const { parseStructureSql } = require('../out/parser');
  const { fixturePath } = require('./helpers/fixtures');
  const sql = fs.readFileSync(fixturePath('comprehensive-structure.sql'), 'utf8');
  const parsed = parseStructureSql(sql);
  assert.ok(parsed.types.has('email_domain'));
  assert.equal(parsed.types.get('email_domain')?.kind, 'domain');
  assert.ok(parsed.views.has('active_users'));
  assert.ok(parsed.views.get('company_counts')?.materialized);
  assert.equal(parsed.tables.get('apis_channels')?.isJoinTable, true);
  assert.ok(parsed.tables.get('users')?.constraints.length > 0);
  assert.ok(parsed.tables.get('companies')?.constraints.some((c: { type: string }) => c.type === 'EXCLUDE'));
  assert.ok(parsed.tables.get('users')?.indexes.some((i: { predicate: string | null }) => i.predicate));
});

test('comprehensive schema.rb fixture covers references, enums, indexes, and foreign keys', () => {
  const { parseSchemaRb } = require('../out/parser');
  const { fixturePath } = require('./helpers/fixtures');
  const ruby = fs.readFileSync(fixturePath('comprehensive-schema.rb'), 'utf8');
  const parsed = parseSchemaRb(ruby);

  assert.ok(parsed.tables.has('posts'));
  assert.ok(parsed.tables.get('posts')?.columns.some((c: { name: string }) => c.name === 'author_id'));
  assert.ok(parsed.tables.get('posts')?.columns.some((c: { name: string }) => c.name === 'created_at'));
  assert.equal(parsed.tables.get('apis_channels')?.isJoinTable, true);
  assert.ok(parsed.tables.get('posts')?.constraints.length > 0);
});

test('parser edge cases for implicit keys, duplicate types, and ruby literals', () => {
  const { parseStructureSql, parseSchemaRb, normalizeTypeName } = require('../out/parser');

  const implicitFkSql = `
CREATE TABLE public.users (id bigint NOT NULL);
CREATE TABLE public.orders (
  id bigint NOT NULL,
  user_id bigint
);
`;
  const implicit = parseStructureSql(implicitFkSql);
  assert.ok(implicit.tables.get('orders')?.outgoingFks.some((fk: { toTable: string }) => fk.toTable === 'users'));

  const duplicateEnum = `
CREATE TYPE public.status AS ENUM ('a');
CREATE TYPE public.status AS ENUM ('b');
CREATE TABLE public.things (id bigint, status public.status);
`;
  const dup = parseStructureSql(duplicateEnum);
  assert.equal(dup.typeOrder.filter((name: string) => name === 'status').length, 1);

  const ruby = `
ActiveRecord::Schema[7.0].define(version: 1) do
  create_table "widgets", id: :uuid do |t|
    t.string "name", null: true, default: nil
    t.boolean "active", default: true
    t.decimal "price", precision: 10, scale: 2
    t.index ["name"], unique: true
  end
  add_foreign_key "widgets", "authors", column: "author_id"
end
`;
  const rb = parseSchemaRb(ruby);
  assert.ok(rb.tables.has('widgets'));
  assert.equal(normalizeTypeName('public.status'), 'status');
});

test('optional real structure.sql fixture parses without error', () => {
  const { parseStructureSql } = require('../out/parser');
  const { repoStructurePath } = require('./helpers/fixtures');
  const realPath = repoStructurePath();
  if (!fs.existsSync(realPath)) {
    return;
  }
  const parsed = parseStructureSql(fs.readFileSync(realPath, 'utf8'));
  assert.ok(parsed.order.length > 0);
});
