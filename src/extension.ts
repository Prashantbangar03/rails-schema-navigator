import * as vscode from 'vscode';
import { onConfigChange } from './config';
import { findTable } from './findTable';
import { openExplorerFromModel, openExplorerWithContext } from './openExplorer';
import {
  notifyPanelSchemaChanged,
  registerWebviewSerializer,
} from './schemaExplorerPanel';
import { refreshSchemaExplorer } from './refresh';
import { getSchemaIndex } from './schemaIndex';
import { getSchemaStatusBar } from './statusBar';
import { switchProject } from './switchProject';

async function updateStatusBar(context: vscode.ExtensionContext): Promise<void> {
  const index = getSchemaIndex(context);
  const project = index.getActiveProject();
  if (!project) {
    const projects = await index.listProjects();
    if (projects.length === 0) {
      getSchemaStatusBar().update(null);
      return;
    }
    getSchemaStatusBar().update(projects.length === 1 ? projects[0].name : 'Schema');
    return;
  }
  getSchemaStatusBar().update(project.name);
}

export function activate(context: vscode.ExtensionContext): void {
  const index = getSchemaIndex(context);
  const statusBar = getSchemaStatusBar();

  registerWebviewSerializer(context);
  context.subscriptions.push(statusBar);

  const refreshStatusBar = () => {
    void updateStatusBar(context);
  };

  index.onDidChange(() => {
    void notifyPanelSchemaChanged();
    refreshStatusBar();
  });

  context.subscriptions.push(
    onConfigChange(context, () => {
      refreshStatusBar();
      void notifyPanelSchemaChanged();
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void index.handleActiveEditorChange(editor).then((changed) => {
        if (changed) {
          void notifyPanelSchemaChanged();
        }
      });
    }),

    vscode.commands.registerCommand('schemaExplorer.open', (table?: string, column?: string) => {
      void openExplorerWithContext(context, { table, column });
    }),

    vscode.commands.registerCommand('schemaExplorer.openFromModel', () => {
      void openExplorerFromModel(context);
    }),

    vscode.commands.registerCommand('schemaExplorer.findTable', () => {
      void findTable(context);
    }),

    vscode.commands.registerCommand('schemaExplorer.switchProject', () => {
      void switchProject(context);
    }),

    vscode.commands.registerCommand('schemaExplorer.refresh', () => {
      void refreshSchemaExplorer(context).then(refreshStatusBar);
    })
  );

  void index.listProjects().then(refreshStatusBar);
}

export function deactivate(): void {}
