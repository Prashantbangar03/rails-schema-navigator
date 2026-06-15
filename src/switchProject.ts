import * as vscode from 'vscode';
import { getSchemaIndex } from './schemaIndex';
import { projectLabel, SchemaProject } from './schemaProject';
import { SchemaExplorerPanel } from './schemaExplorerPanel';

interface ProjectPickItem extends vscode.QuickPickItem {
  projectId?: string;
  followEditor?: boolean;
}

export async function switchProject(context: vscode.ExtensionContext): Promise<void> {
  const index = getSchemaIndex(context);
  const projects = await index.listProjects(true);

  if (projects.length === 0) {
    vscode.window.showWarningMessage('No db/structure.sql or db/schema.rb found in workspace.');
    return;
  }

  const active = index.getActiveProject();
  const pinned = index.isPinned();

  const items: ProjectPickItem[] = [
    {
      label: '$(sync) Follow active editor',
      description: pinned ? 'currently pinned to a project' : 'current mode',
      detail: 'Auto-switch schema when you change files across repos',
      picked: !pinned,
      followEditor: true,
    },
    { kind: vscode.QuickPickItemKind.Separator, label: 'projects' },
    ...projects.map((project) => projectPickItem(project, pinned, active)),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Switch schema project…',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return;
  }

  if (picked.followEditor) {
    await index.followActiveEditor();
  } else if (picked.projectId) {
    await index.pinProject(picked.projectId);
  }

  SchemaExplorerPanel.createOrShow(context, context.extensionUri);
}

function projectPickItem(
  project: SchemaProject,
  pinned: boolean,
  active: SchemaProject | null
): ProjectPickItem {
  return {
    label: project.name,
    description: project.schemaKind,
    detail: projectLabel(project),
    picked: pinned && active?.id === project.id,
    projectId: project.id,
  };
}
