ActiveRecord::Schema[7.1].define(version: 2024_01_01_000000) do
  create_enum :order_status, ["pending", "shipped"]

  create_table "posts", force: :cascade do |t|
    t.string "title", null: false, default: "draft"
    t.references :author, null: false, foreign_key: true
    t.enum "status", enum_type: "order_status", default: "pending", null: false
    t.timestamps null: false
    t.index ["title"], unique: true, where: "title IS NOT NULL", name: "index_posts_on_title"
    t.check_constraint "length(title) > 0", name: "posts_title_check"
  end

  create_table "authors", force: :cascade do |t|
    t.string "name"
  end

  create_table "apis", force: :cascade do |t|
  end

  create_table "channels", force: :cascade do |t|
  end

  create_table "apis_channels", id: false, force: :cascade do |t|
    t.bigint "api_id", null: false
    t.bigint "channel_id", null: false
  end

  add_foreign_key "apis_channels", "apis", on_delete: :cascade
  add_foreign_key "apis_channels", "channels", on_delete: :nullify
  add_index "posts", ["title"], unique: true
  add_check_constraint "posts", "length(title) > 1", name: "posts_title_len"
end
