import * as path from 'path';
import * as vscode from 'vscode';
import { scoreSchemaPath } from './modelResolver';

export interface SchemaProject {
  id: string;
  name: string;
  rootPath: string;
  schemaUri: vscode.Uri;
  schemaKind: 'structure.sql' | 'schema.rb';
}

const STRUCTURE_GLOB = '**/db/structure.sql';
const SCHEMA_RB_GLOB = '**/db/schema.rb';
const FIND_FILES_LIMIT = 500;
const EXCLUDE = '**/node_modules/**';

export function projectRootFromSchemaUri(schemaUri: vscode.Uri): string {
  return path.dirname(path.dirname(schemaUri.fsPath));
}

export function projectNameFromRoot(rootPath: string): string {
  return path.basename(rootPath);
}

export function projectIdFromRoot(rootPath: string): string {
  return rootPath.replace(/\\/g, '/');
}

export function buildProjectsFromSchemaUris(
  structureFiles: vscode.Uri[],
  schemaRbFiles: vscode.Uri[]
): SchemaProject[] {
  const byRoot = new Map<string, SchemaProject>();

  for (const uri of schemaRbFiles) {
    const rootPath = projectRootFromSchemaUri(uri);
    const id = projectIdFromRoot(rootPath);
    byRoot.set(id, {
      id,
      name: projectNameFromRoot(rootPath),
      rootPath,
      schemaUri: uri,
      schemaKind: 'schema.rb',
    });
  }

  for (const uri of structureFiles) {
    const rootPath = projectRootFromSchemaUri(uri);
    const id = projectIdFromRoot(rootPath);
    byRoot.set(id, {
      id,
      name: projectNameFromRoot(rootPath),
      rootPath,
      schemaUri: uri,
      schemaKind: 'structure.sql',
    });
  }

  return Array.from(byRoot.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function discoverSchemaProjects(): Promise<SchemaProject[]> {
  const [structureFiles, schemaRbFiles] = await Promise.all([
    vscode.workspace.findFiles(STRUCTURE_GLOB, EXCLUDE, FIND_FILES_LIMIT),
    vscode.workspace.findFiles(SCHEMA_RB_GLOB, EXCLUDE, FIND_FILES_LIMIT),
  ]);

  return buildProjectsFromSchemaUris(structureFiles, schemaRbFiles);
}

export function resolveProjectForFile(
  filePath: string | undefined,
  projects: SchemaProject[]
): SchemaProject | undefined {
  if (!filePath || projects.length === 0) {
    return undefined;
  }

  const normalized = filePath.replace(/\\/g, '/');
  for (const project of projects) {
    const root = project.rootPath.replace(/\\/g, '/');
    if (normalized === root || normalized.startsWith(root + '/')) {
      return project;
    }
  }

  return undefined;
}

export function resolveProjectById(
  projectId: string | undefined,
  projects: SchemaProject[]
): SchemaProject | undefined {
  if (!projectId) {
    return undefined;
  }
  return projects.find((p) => p.id === projectId);
}

export function pickBestProject(
  projects: SchemaProject[],
  nearPath?: string
): SchemaProject | undefined {
  if (projects.length === 0) {
    return undefined;
  }
  if (projects.length === 1) {
    return projects[0];
  }

  if (nearPath) {
    const fromFile = resolveProjectForFile(nearPath, projects);
    if (fromFile) {
      return fromFile;
    }
  }

  const sorted = [...projects].sort(
    (a, b) =>
      scoreSchemaPath(a.schemaUri.fsPath, nearPath) -
      scoreSchemaPath(b.schemaUri.fsPath, nearPath)
  );
  return sorted[0];
}

export function projectLabel(project: SchemaProject): string {
  const folder = vscode.workspace.getWorkspaceFolder(project.schemaUri);
  if (!folder) {
    return project.name;
  }
  const rel = path.relative(folder.uri.fsPath, project.rootPath);
  if (rel && rel !== project.name) {
    return rel.replace(/\\/g, '/');
  }
  return project.name;
}

export interface ProjectSummary {
  id: string;
  name: string;
  label: string;
  schemaKind: SchemaProject['schemaKind'];
}

export function summarizeProjects(projects: SchemaProject[]): ProjectSummary[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    label: projectLabel(project),
    schemaKind: project.schemaKind,
  }));
}
