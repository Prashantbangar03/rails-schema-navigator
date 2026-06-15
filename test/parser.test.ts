import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const {
  normalizeTypeName,
  parseSchemaRb,
  parseStructureSql,
} = require('../out/parser');

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

const STRUCTURE_SQL = `
CREATE TYPE public.order_status AS ENUM (
  'pending',
  'shipped'
);

CREATE TABLE public.users (
  id bigint NOT NULL,
  email character varying NOT NULL,
  status public.order_status DEFAULT 'pending'::public.order_status NOT NULL
);

CREATE TABLE public.apis (
  id bigint NOT NULL
);

CREATE TABLE public.channels (
  id bigint NOT NULL
);

CREATE TABLE public.apis_channels (
  api_id bigint NOT NULL,
  channel_id bigint NOT NULL
);

ALTER TABLE ONLY public.apis_channels
  ADD CONSTRAINT apis_channels_api_id_fkey FOREIGN KEY (api_id) REFERENCES public.apis(id);

ALTER TABLE ONLY public.apis_channels
  ADD CONSTRAINT apis_channels_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);

CREATE VIEW public.active_users AS
 SELECT id, email FROM public.users;
`;

const SCHEMA_RB = `
ActiveRecord::Schema[7.1].define(version: 2024_01_01_000000) do
  create_enum :order_status, ["pending", "shipped"]

  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.enum "status", enum_type: "order_status", default: "pending", null: false
  end

  create_table "apis", force: :cascade do |t|
  end

  create_table "channels", force: :cascade do |t|
  end

  create_table "apis_channels", id: false, force: :cascade do |t|
    t.bigint "api_id", null: false
    t.bigint "channel_id", null: false
    t.index ["api_id", "channel_id"], name: "index_apis_channels_on_api_id_and_channel_id", unique: true
  end

  add_foreign_key "apis_channels", "apis"
  add_foreign_key "apis_channels", "channels"
end
`;

test('parseStructureSql extracts tables, enums, views, and join tables', () => {
  const parsed = parseStructureSql(STRUCTURE_SQL);

  assert.ok(parsed.tables.has('users'));
  assert.ok(parsed.tables.has('apis_channels'));
  assert.equal(parsed.typeOrder.includes('order_status'), true);
  assert.equal(parsed.viewOrder.includes('active_users'), true);

  const users = parsed.tables.get('users')!;
  assert.equal(users.columns.some((c: { name: string }) => c.name === 'email'), true);
  assert.equal(
    users.columns.some((c: { type: string }) => c.type.includes('order_status')),
    true
  );
  assert.equal(parsed.types.has('order_status'), true);

  const join = parsed.tables.get('apis_channels')!;
  assert.equal(join.isJoinTable, true);
  assert.equal(join.outgoingFks.length, 2);
});

test('parseSchemaRb extracts tables, enums, and join-style tables', () => {
  const parsed = parseSchemaRb(SCHEMA_RB);

  assert.ok(parsed.tables.has('users'));
  assert.ok(parsed.tables.has('apis_channels'));
  assert.equal(parsed.typeOrder.includes('order_status'), true);

  const users = parsed.tables.get('users')!;
  assert.equal(users.columns.find((c: { name: string; notNull: boolean }) => c.name === 'email')?.notNull, true);

  const join = parsed.tables.get('apis_channels')!;
  assert.equal(join.isJoinTable, true);
});

test('normalizeTypeName strips schema qualifiers', () => {
  assert.equal(normalizeTypeName('public.order_status'), 'order_status');
  assert.equal(normalizeTypeName('character varying'), 'character varying');
});
