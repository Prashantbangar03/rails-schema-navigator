import * as path from 'node:path';

const OUT = path.join(__dirname, '../../out');

export function clearModuleCache(): void {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}out${path.sep}`) && !key.includes(`${path.sep}out-test${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

export function resetTestEnvironment(): void {
  const { resetMockState } = require('./vscode-mock') as typeof import('./vscode-mock');
  resetMockState();
  clearModuleCache();
  try {
    require(`${OUT}/schemaIndex`).resetSchemaIndexForTests();
  } catch {
    // module not loaded yet
  }
  try {
    require(`${OUT}/schemaExplorerPanel`).SchemaExplorerPanel.currentPanel = undefined;
  } catch {
    // module not loaded yet
  }
  try {
    require(`${OUT}/statusBar`).resetSchemaStatusBarForTests();
  } catch {
    // module not loaded yet
  }
}

export function extensionRoot(): string {
  return path.resolve(__dirname, '../..');
}

export function createMockContext() {
  const subscriptions: Array<{ dispose: () => void }> = [];
  const workspaceState = new Map<string, unknown>();
  return {
    subscriptions,
    extensionUri: { fsPath: extensionRoot() },
    workspaceState: {
      get: <T>(key: string): T | undefined => workspaceState.get(key) as T | undefined,
      update: async (key: string, value: unknown) => {
        if (value === undefined) {
          workspaceState.delete(key);
        } else {
          workspaceState.set(key, value);
        }
      },
    },
  };
}

export function seedRailsProject(root = '/workspace/rails-app'): void {
  const { mockState } = require('./vscode-mock') as typeof import('./vscode-mock');
  mockState.workspaceFolders = [{ uri: { fsPath: root }, name: 'rails-app', index: 0 }];
  const structurePath = `${root}/db/structure.sql`;
  const schemaPath = `${root}/db/schema.rb`;
  const modelPath = `${root}/app/models/user.rb`;
  mockState.files.set(
    structurePath,
    `
CREATE TABLE public.users (
  id bigint NOT NULL,
  email character varying NOT NULL
);
`
  );
  mockState.fileStats.set(structurePath, { mtime: 1000 });
  mockState.files.set(
    schemaPath,
    `ActiveRecord::Schema[7.1].define(version: 1) do
  create_table "posts", force: :cascade do |t|
    t.string "title"
  end
end`
  );
  mockState.fileStats.set(schemaPath, { mtime: 1000 });
  mockState.files.set(
    modelPath,
    `class User < ApplicationRecord
  enum :status, { active: 0, inactive: 1 }
end`
  );
  mockState.findFilesByPattern = [
    { pattern: '**/db/structure.sql', uris: [structurePath] },
    { pattern: '**/db/schema.rb', uris: [schemaPath] },
    { pattern: 'app/models/**/*.rb', uris: [modelPath] },
    { pattern: 'migrate/**/*.rb', uris: [`${root}/db/migrate/001_init.rb`] },
  ];
  mockState.fileStats.set(`${root}/db/migrate/001_init.rb`, { mtime: 500 });
}
