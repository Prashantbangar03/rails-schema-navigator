# Changelog

All notable changes to **Rails Schema Navigator** are documented in this file.

## [1.0.0] - 2026-06-15

### Added

- Published as **Rails Schema Navigator** (`rails-schema-navigator`) on the VS Code Marketplace

- Interactive explorer for Rails `db/structure.sql` and `db/schema.rb`
- Searchable sidebar for tables and views with join-table **⇄** badges
- Table detail: columns, constraints, indexes, incoming/outgoing FK navigation
- PostgreSQL enums, domains, and views (from `structure.sql`)
- Rails enum scanning from `app/models`
- Compare mode for side-by-side table column diff
- Open model from table; open explorer from model file
- Multi-project workspace support with project picker
- Stale schema banner with dump command and terminal action
- Light/dark theme support aligned with VS Code
- Keyboard shortcuts: open explorer, find table, refresh
- Settings: `schemaExplorer.followEditor`, `schemaExplorer.showStatusBar`

### Security

- Webview file open actions validate workspace paths
- Stale dump commands restricted to `rails db:structure:dump` and `rails db:schema:dump`

[1.0.0]: https://github.com/Prashantbangar03/rails-schema-navigator/releases/tag/v1.0.0
