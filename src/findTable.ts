import * as vscode from 'vscode';
import { getSchemaIndex } from './schemaIndex';
import { projectLabel } from './schemaProject';
import { ensureProjectLoaded } from './openExplorer';
import { SchemaExplorerPanel } from './schemaExplorerPanel';

export async function findTable(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const ready = await ensureProjectLoaded(context, editor);
  if (!ready) {
    return;
  }

  const index = getSchemaIndex(context);
  const schema = await index.load();
  const project = index.getActiveProject();
  if (!schema || !project) {
    return;
  }

  const projectName = projectLabel(project);
  const items = schema.order.map((name) => {
    const table = schema.tables.get(name)!;
    return {
      label: name,
      description: `${table.columns.length} columns`,
      detail: `${projectName} · ${table.outgoingFks.length} outgoing · ${table.incomingFks.length} incoming FKs`,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Find table in ${projectName}…`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  SchemaExplorerPanel.createOrShow(context, context.extensionUri, {
    table: picked.label,
  });
}
