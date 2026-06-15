ActiveRecord::Schema[7.1].define(version: 1) do
  create_enum :priority, ["low", "high"]

  create_table "nested", force: :cascade do |t|
    t.string "name"
    t.index ["name"], unique: true
    some_helper do
    end
  end

  create_table "typed", force: :cascade do |t|
    t.integer "count", limit: 100
    t.decimal "amount", precision: 10, scale: 2
    t.boolean "active", default: true
    t.enum "status", enum_type: "priority", default: "low"
    t.index "lower(name)", name: "index_typed_on_name"
    t.index :slug
    t.check_constraint "length(name) > 0", name: "typed_name_check", expression: "length(name) > 0"
  end

  create_table "no_ids", id: false do |t|
    t.string "code"
  end

  create_table "uuid_table", id: :uuid, default: -> { "gen_random_uuid()" } do |t|
    t.string "title"
  end

  add_index "missing_table", ["body"]
  add_check_constraint "missing_table", "1 = 1"
  add_foreign_key "typed", "authors", column: "author_id", primary_key: "uuid", on_delete: :restrict
  add_foreign_key "typed", "categories", on_delete: :nullify
  add_foreign_key "typed", "tags", on_delete: "set default"
  add_foreign_key "typed", "labels", on_delete: "set null"
  add_foreign_key "typed", "boxes", on_delete: :cascade
  add_index "typed", ["body"], unique: true, where: "body IS NOT NULL"
  add_check_constraint "typed", "length(body) > 0", name: "typed_body_check"
end
