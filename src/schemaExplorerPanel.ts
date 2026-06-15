import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getFollowEditor } from './config';
import { getSchemaIndex } from './schemaIndex';
import { projectLabel, summarizeProjects } from './schemaProject';
import { serializeSchema, workspaceRelativePath } from './schemaSerializer';
import { getStaleSchemaInfo } from './staleSchema';

export interface ExplorerOpenOptions {
  table?: string;
  column?: string;
}

export class SchemaExplorerPanel {
  public static currentPanel: SchemaExplorerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private lastOptions: ExplorerOpenOptions | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getWebviewContent();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.postMessage({ type: 'setTheme', theme: this.currentTheme() });
      })
    );
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    extensionUri: vscode.Uri,
    options?: ExplorerOpenOptions
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (SchemaExplorerPanel.currentPanel) {
      SchemaExplorerPanel.currentPanel.panel.reveal(column);
      void SchemaExplorerPanel.currentPanel.pushSchema(options);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'schemaExplorerPanel',
      'Rails Schema Explorer',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      }
    );

    SchemaExplorerPanel.currentPanel = new SchemaExplorerPanel(
      panel,
      extensionUri,
      context
    );
    void SchemaExplorerPanel.currentPanel.pushSchema(options);
  }

  public static revive(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    extensionUri: vscode.Uri
  ): void {
    SchemaExplorerPanel.currentPanel = new SchemaExplorerPanel(
      panel,
      extensionUri,
      context
    );
    void SchemaExplorerPanel.currentPanel.pushSchema();
  }

  public async refresh(options?: ExplorerOpenOptions): Promise<void> {
    await this.pushSchema(options);
  }

  private async pushSchema(options?: ExplorerOpenOptions): Promise<void> {
    if (options) {
      this.lastOptions = options;
    }

    const index = getSchemaIndex(this.context);
    const projects = await index.listProjects(true);
    const projectPayload = summarizeProjects(projects);
    const editor = vscode.window.activeTextEditor;
    const loaded = index.isPinned()
      ? await index.loadWithProject()
      : editor
        ? await index.loadForEditor(editor)
        : await index.loadWithProject();

    this.panel.title = index.activeProjectLabel();

    if (!loaded) {
      this.postMessage({
        type: 'loadSchema',
        payload: null,
        projects: projectPayload,
        activeProjectId: index.getActiveProject()?.id,
        followEditor: getFollowEditor() && !index.isPinned(),
        theme: this.currentTheme(),
      });
      return;
    }

    const { project, schema } = loaded;
    const staleInfo = await getStaleSchemaInfo(schema.uri);
    const payload = serializeSchema(
      schema,
      loaded.modelEnums,
      staleInfo.stale && staleInfo.message && staleInfo.dumpCommand && staleInfo.schemaPath
        ? {
            message: staleInfo.message,
            dumpCommand: staleInfo.dumpCommand,
            schemaPath: staleInfo.schemaPath,
          }
        : undefined,
      project.rootPath
    );

    this.postMessage({
      type: 'loadSchema',
      payload,
      sourceLabel: workspaceRelativePath(schema.uri),
      projectLabel: projectLabel(project),
      projects: projectPayload,
      activeProjectId: project.id,
      followEditor: getFollowEditor() && !index.isPinned(),
      theme: this.currentTheme(),
      table: this.lastOptions?.table,
      column: this.lastOptions?.column,
    });
  }

  private currentTheme(): 'light' | 'dark' {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light ||
      kind === vscode.ColorThemeKind.HighContrastLight
      ? 'light'
      : 'dark';
  }

  private postMessage(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(msg: {
    type: string;
    projectId?: string | null;
    command?: string;
    path?: string;
  }): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.pushSchema(this.lastOptions);
        break;
      case 'selectProject': {
        const index = getSchemaIndex(this.context);
        this.lastOptions = undefined;
        if (msg.projectId) {
          await index.pinProject(msg.projectId);
        } else {
          await index.followActiveEditor();
        }
        await this.pushSchema(this.lastOptions);
        break;
      }
      case 'copyStaleCommand':
        if (msg.command) {
          await vscode.env.clipboard.writeText(msg.command);
          void vscode.window.setStatusBarMessage('Copied dump command', 2000);
        }
        break;
      case 'openSchemaFile':
        if (msg.path) {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
          await vscode.window.showTextDocument(doc);
        }
        break;
      case 'runStaleCommand':
        if (msg.command) {
          const term = vscode.window.createTerminal('Schema dump');
          term.show();
          term.sendText(msg.command);
        }
        break;
      case 'refreshSchema':
        await this.refresh(this.lastOptions);
        break;
      case 'openModel':
        if (msg.path) {
          if (!fs.existsSync(msg.path)) {
            void vscode.window.showWarningMessage(
              `Model file not found: ${workspaceRelativePath(vscode.Uri.file(msg.path))}`
            );
            break;
          }
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
          await vscode.window.showTextDocument(doc);
        }
        break;
    }
  }

  private getWebviewContent(): string {
    const htmlPath = path.join(this.extensionUri.fsPath, 'media', 'schema-explorer.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const csp = [
      "default-src 'none'",
      `img-src ${this.panel.webview.cspSource} data:`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      "script-src 'unsafe-inline'",
      `font-src ${this.panel.webview.cspSource}`,
    ].join('; ');

    const theme = this.currentTheme();
    html = html.replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
    );
    html = html.replace(
      '<html lang="en">',
      `<html lang="en" data-theme="${theme}" style="color-scheme: ${theme}">`
    );

    return html;
  }

  private dispose(): void {
    SchemaExplorerPanel.currentPanel = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

export function registerWebviewSerializer(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('schemaExplorerPanel', {
      async deserializeWebviewPanel(panel) {
        SchemaExplorerPanel.revive(panel, context, context.extensionUri);
      },
    })
  );
}

export async function notifyPanelSchemaChanged(): Promise<void> {
  if (SchemaExplorerPanel.currentPanel) {
    await SchemaExplorerPanel.currentPanel.refresh();
  }
}
