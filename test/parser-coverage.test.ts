import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as fs from 'node:fs';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('parseStructureSql covers alter constraints, joins, and edge columns', () => {
  const { parseStructureSql } = require('../out/parser');
  const { fixturePath } = require('./helpers/fixtures');
  const parsed = parseStructureSql(fs.readFileSync(fixturePath('comprehensive-structure.sql'), 'utf8'));

  assert.ok(parsed.tables.get('users')?.uniqueColumnSets.length);
  assert.ok(parsed.tables.get('users')?.constraints.some((c: { type: string }) => c.type === 'CHECK'));
  assert.ok(parsed.tables.get('companies')?.constraints.some((c: { type: string }) => c.type === 'EXCLUDE'));
  assert.ok(parsed.tables.get('categories')?.outgoingFks.some((fk: { toTable: string }) => fk.toTable === 'stories'));
  assert.ok(parsed.tables.get('boxes')?.columns.some((c: { name: string }) => c.name === 'weird'));

  const extra = parseStructureSql(`
CREATE TABLE public.missing_idx (id bigint);
CREATE UNIQUE INDEX index_missing ON public.ghost USING btree (id);
ALTER TABLE ONLY public.missing_idx ADD CONSTRAINT ghost_unique UNIQUE (id);
ALTER TABLE ONLY public.ghost ADD CONSTRAINT ghost_check CHECK (id > 0);
ALTER TABLE ONLY public.ghost ADD CONSTRAINT ghost_ex EXCLUDE USING btree (id WITH =);
CREATE TABLE public.empty_cols (
  id bigint,
  ,
  not_a_column
);
CREATE TABLE public.check_escape (
  id bigint,
  CONSTRAINT check_escape_val CHECK (name <> 'it\\'s fine')
);
`);
  assert.ok(extra.tables.has('missing_idx'));
  assert.ok(extra.tables.has('check_escape'));
});

test('parseSchemaRb covers indexes, enums, foreign keys, and table options', () => {
  const { parseSchemaRb } = require('../out/parser');
  const { fixturePath } = require('./helpers/fixtures');
  const parsed = parseSchemaRb(fs.readFileSync(fixturePath('comprehensive-schema.rb'), 'utf8'));

  assert.ok(parsed.types.has('order_status'));
  assert.ok(parsed.tables.get('posts')?.indexes.length);
  assert.ok(parsed.tables.get('posts')?.constraints.length);

  const extra = parseSchemaRb(`
ActiveRecord::Schema[7.1].define(version: 1) do
  create_table "widgets", id: :uuid, default: -> { "gen_random_uuid()" } do |t|
    t.string "name"
  end
  create_table "no_ids", id: false do |t|
    t.string "code"
  end
  create_table "indexed", force: :cascade do |t|
    t.string "body"
    t.index "lower(body)", name: "index_indexed_on_body", unique: true, where: "body IS NOT NULL"
    t.index :slug
    t.check_constraint "length(body) > 0", name: "indexed_body_check", expression: "length(body) > 0"
  end
  add_index "missing", ["body"]
  add_check_constraint "missing", "1=1"
  add_foreign_key "widgets", "authors", column: "author_id", primary_key: "uuid", on_delete: :restrict
  add_foreign_key "widgets", "categories", on_delete: :nullify
  add_foreign_key "widgets", "tags", on_delete: "set default"
  add_foreign_key "widgets", "labels", on_delete: "set null"
  add_foreign_key "widgets", "boxes", on_delete: :cascade
end
`);
  assert.ok(extra.tables.get('widgets')?.columns[0]?.type.includes('uuid'));
  assert.ok(extra.tables.get('no_ids')?.columns.every((c: { name: string }) => c.name !== 'id'));
  assert.ok(extra.tables.get('indexed')?.indexes.length >= 2);
  assert.ok(extra.tables.get('widgets')?.outgoingFks.length >= 1);
});

test('parseSchemaRb handles primary key inference and standalone add_index', () => {
  const { parseSchemaRb } = require('../out/parser');
  const parsed = parseSchemaRb(`
ActiveRecord::Schema[7.1].define(version: 1) do
  create_table "legacy", force: :cascade do |t|
    t.string "name"
  end
  add_index "legacy", ["name"], unique: true
  add_check_constraint "legacy", "length(name) > 0", name: "legacy_name_check"
end
`);
  assert.deepEqual(parsed.tables.get('legacy')?.primaryKey, ['id']);
  assert.ok(parsed.tables.get('legacy')?.indexes.length);
});
