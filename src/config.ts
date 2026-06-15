import * as vscode from 'vscode';

export const CONFIG_SECTION = 'schemaExplorer';

export function getFollowEditor(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get('followEditor', true);
}

export function getShowStatusBar(): boolean {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get('showStatusBar', true);
}

export function onConfigChange(
  context: vscode.ExtensionContext,
  listener: () => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      listener();
    }
  });
}
