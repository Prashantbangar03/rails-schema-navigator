import * as vscode from 'vscode';
import { getShowStatusBar } from './config';

export class SchemaStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'schemaExplorer.open';
    this.item.tooltip = 'Open Rails Schema Navigator';
  }

  update(label: string | null): void {
    if (!getShowStatusBar() || !label) {
      this.item.hide();
      return;
    }
    this.item.text = `$(database) ${label}`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

let statusBar: SchemaStatusBar | null = null;

export function getSchemaStatusBar(): SchemaStatusBar {
  if (!statusBar) {
    statusBar = new SchemaStatusBar();
  }
  return statusBar;
}

export function resetSchemaStatusBarForTests(): void {
  statusBar = null;
}
