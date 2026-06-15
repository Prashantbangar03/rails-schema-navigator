import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('config reads settings and listens for changes', () => {
  const { mockState } = require('./helpers/vscode-mock');
  const { getFollowEditor, getShowStatusBar, onConfigChange, CONFIG_SECTION } =
    require('../out/config');

  assert.equal(CONFIG_SECTION, 'schemaExplorer');
  assert.equal(getFollowEditor(), true);
  assert.equal(getShowStatusBar(), true);

  mockState.config.followEditor = false;
  assert.equal(getFollowEditor(), false);

  let changed = false;
  const disposable = onConfigChange({ subscriptions: [] } as never, () => {
    changed = true;
  });
  mockState.configChangeListeners[0]?.({
    affectsConfiguration: (section: string) => section === 'schemaExplorer',
  });
  assert.equal(changed, true);
  disposable.dispose();
});
