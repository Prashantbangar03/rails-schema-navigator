import * as vscode from 'vscode';
import { getFollowEditor } from './config';
import { columnAtCursor, resolveModelFromDocument } from './modelResolver';
import { getSchemaIndex } from './schemaIndex';
import { SchemaExplorerPanel } from './schemaExplorerPanel';
import { pickBestProject } from './schemaProject';
import { switchProject } from './switchProject';

export async function ensureProjectLoaded(
  context: vscode.ExtensionContext,
  editor?: vscode.TextEditor
): Promise<boolean> {
  const index = getSchemaIndex(context);

  if (!getFollowEditor() && !index.isPinned()) {
    const projects = await index.listProjects();
    if (projects.length > 0) {
      const best = pickBestProject(projects, editor?.document.uri.fsPath);
      if (best) {
        await index.pinProject(best.id);
        return !!index.getActiveProject();
      }
    }
  }

  if (index.isPinned()) {
    await index.loadWithProject();
    return !!index.getActiveProject();
  }

  if (editor) {
    await index.loadForEditor(editor);
    return !!index.getActiveProject();
  }

  const loaded = await index.loadWithProject();
  if (loaded) {
    return true;
  }

  const projects = await index.listProjects(true);
  if (projects.length === 0) {
    vscode.window.showWarningMessage('No db/structure.sql or db/schema.rb found in workspace.');
    return false;
  }

  if (projects.length === 1) {
    await index.loadWithProject({ projectId: projects[0].id, force: true });
    return true;
  }

  await switchProject(context);
  return !!index.getActiveProject();
}

export async function openExplorerFromModel(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a Rails model file first.');
    return;
  }

  const model = resolveModelFromDocument(editor.document);
  if (!model) {
    vscode.window.showWarningMessage('This command only works on app/models/**/*.rb files.');
    return;
  }

  const index = getSchemaIndex(context);
  const loaded = await index.loadForEditor(editor);
  if (!loaded) {
    vscode.window.showWarningMessage('No schema found for this project.');
    return;
  }

  const table = loaded.schema.tables.get(model.tableName);
  const columnNames = new Set(table?.columns.map((c) => c.name) ?? []);
  const column = columnAtCursor(editor.document, editor.selection.active, columnNames);

  SchemaExplorerPanel.createOrShow(context, context.extensionUri, {
    table: model.tableName,
    column,
  });
}

export async function openExplorerWithContext(
  context: vscode.ExtensionContext,
  options?: { table?: string; column?: string }
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!options?.table && editor) {
    const model = resolveModelFromDocument(editor.document);
    if (model) {
      const index = getSchemaIndex(context);
      const loaded = await index.loadForEditor(editor);
      if (!loaded) {
        vscode.window.showWarningMessage('No schema found for this project.');
        return;
      }

      const table = loaded.schema.tables.get(model.tableName);
      const columnNames = new Set(table?.columns.map((c) => c.name) ?? []);
      const column = columnAtCursor(editor.document, editor.selection.active, columnNames);
      SchemaExplorerPanel.createOrShow(context, context.extensionUri, {
        table: model.tableName,
        column,
      });
      return;
    }
  }

  const ready = await ensureProjectLoaded(context, editor);
  if (!ready) {
    return;
  }

  SchemaExplorerPanel.createOrShow(context, context.extensionUri, options);
}
