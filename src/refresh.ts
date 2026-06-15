import * as vscode from 'vscode';
import { notifyPanelSchemaChanged } from './schemaExplorerPanel';
import { getSchemaIndex } from './schemaIndex';

export async function refreshSchemaExplorer(
  context: vscode.ExtensionContext
): Promise<void> {
  const index = getSchemaIndex(context);
  index.invalidate();
  await index.load({ force: true });
  await notifyPanelSchemaChanged();
  void vscode.window.setStatusBarMessage('Schema refreshed', 2000);
}
