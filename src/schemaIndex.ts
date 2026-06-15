import * as vscode from 'vscode';
import { getFollowEditor } from './config';
import { ModelTableEnums, scanModelEnumsForProject } from './modelIndex';
import { ParsedSchema, parseSchemaDocument } from './parser';
import {
  discoverSchemaProjects,
  pickBestProject,
  resolveProjectById,
  resolveProjectForFile,
  SchemaProject,
} from './schemaProject';

const PINNED_PROJECT_KEY = 'schemaExplorer.pinnedProjectId';

export interface LoadedSchema {
  project: SchemaProject;
  schema: ParsedSchema;
  modelEnums: Map<string, ModelTableEnums>;
}

export interface LoadOptions {
  nearUri?: vscode.Uri;
  projectId?: string;
  force?: boolean;
}

export class SchemaIndex {
  private projects: SchemaProject[] = [];
  private cache = new Map<string, ParsedSchema>();
  private modelEnumCache = new Map<string, Map<string, ModelTableEnums>>();
  private activeProject: SchemaProject | null = null;
  private loading: Promise<LoadedSchema | null> | null = null;
  private readonly onDidChangeSchema = new vscode.EventEmitter<LoadedSchema | null>();
  readonly onDidChange = this.onDidChangeSchema.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(this.onDidChangeSchema);
    this.watchSchemaFiles();
  }

  private watchSchemaFiles(): void {
    const refresh = () => {
      this.invalidate();
      void this.load({ force: true });
    };
    const structureWatcher = vscode.workspace.createFileSystemWatcher('**/db/structure.sql');
    structureWatcher.onDidChange(refresh);
    structureWatcher.onDidCreate(refresh);
    structureWatcher.onDidDelete(refresh);

    const schemaWatcher = vscode.workspace.createFileSystemWatcher('**/db/schema.rb');
    schemaWatcher.onDidChange(refresh);
    schemaWatcher.onDidCreate(refresh);
    schemaWatcher.onDidDelete(refresh);

    this.context.subscriptions.push(structureWatcher, schemaWatcher);
  }

  invalidate(): void {
    this.cache.clear();
    this.modelEnumCache.clear();
    this.projects = [];
    this.activeProject = null;
    this.loading = null;
  }

  getActiveProject(): SchemaProject | null {
    return this.activeProject;
  }

  isPinned(): boolean {
    return !!this.context.workspaceState.get<string>(PINNED_PROJECT_KEY);
  }

  async listProjects(force = false): Promise<SchemaProject[]> {
    if (this.projects.length > 0 && !force) {
      return this.projects;
    }
    this.projects = await discoverSchemaProjects();
    return this.projects;
  }

  async pinProject(projectId: string | null): Promise<void> {
    if (projectId) {
      await this.context.workspaceState.update(PINNED_PROJECT_KEY, projectId);
    } else {
      await this.context.workspaceState.update(PINNED_PROJECT_KEY, undefined);
    }
    await this.load({ projectId: projectId ?? undefined, force: true });
  }

  async followActiveEditor(): Promise<void> {
    await this.pinProject(null);
  }

  private getPinnedProjectId(): string | undefined {
    return this.context.workspaceState.get<string>(PINNED_PROJECT_KEY);
  }

  async resolveTargetProject(options: LoadOptions = {}): Promise<SchemaProject | undefined> {
    const projects = await this.listProjects(options.force);
    if (projects.length === 0) {
      return undefined;
    }

    if (options.projectId) {
      return resolveProjectById(options.projectId, projects);
    }

    const pinnedId = this.getPinnedProjectId();
    if (pinnedId) {
      const pinned = resolveProjectById(pinnedId, projects);
      if (pinned) {
        return pinned;
      }
    }

    const nearPath = options.nearUri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    return pickBestProject(projects, nearPath);
  }

  async load(options: LoadOptions = {}): Promise<ParsedSchema | null> {
    const loaded = await this.loadWithProject(options);
    return loaded?.schema ?? null;
  }

  async loadWithProject(options: LoadOptions = {}): Promise<LoadedSchema | null> {
    if (
      !options.force &&
      this.activeProject &&
      !options.projectId &&
      !options.nearUri &&
      this.cache.has(this.activeProject.schemaUri.fsPath)
    ) {
      const schema = this.cache.get(this.activeProject.schemaUri.fsPath)!;
      const modelEnums =
        this.modelEnumCache.get(this.activeProject.rootPath) ??
        (await this.getModelEnums(this.activeProject.rootPath));
      return { project: this.activeProject, schema, modelEnums };
    }

    if (this.loading && !options.force) {
      return this.loading;
    }

    this.loading = this.doLoad(options);
    const result = await this.loading;
    this.loading = null;
    return result;
  }

  private async doLoad(options: LoadOptions): Promise<LoadedSchema | null> {
    const project = await this.resolveTargetProject(options);
    if (!project) {
      this.activeProject = null;
      this.onDidChangeSchema.fire(null);
      return null;
    }

    const cached = this.cache.get(project.schemaUri.fsPath);
    const modelEnums = await this.getModelEnums(project.rootPath);
    if (cached) {
      this.activeProject = project;
      const loaded = { project, schema: cached, modelEnums };
      this.onDidChangeSchema.fire(loaded);
      return loaded;
    }

    const doc = await vscode.workspace.openTextDocument(project.schemaUri);
    const parsed = parseSchemaDocument(doc);
    const schema: ParsedSchema = { uri: project.schemaUri, ...parsed };
    this.cache.set(project.schemaUri.fsPath, schema);
    this.activeProject = project;

    const loaded = { project, schema, modelEnums };
    this.onDidChangeSchema.fire(loaded);
    return loaded;
  }

  private async getModelEnums(
    projectRoot: string
  ): Promise<Map<string, ModelTableEnums>> {
    const cached = this.modelEnumCache.get(projectRoot);
    if (cached) {
      return cached;
    }
    const scanned = await scanModelEnumsForProject(projectRoot);
    this.modelEnumCache.set(projectRoot, scanned);
    return scanned;
  }

  async loadForEditor(editor: vscode.TextEditor): Promise<LoadedSchema | null> {
    const project = resolveProjectForFile(editor.document.uri.fsPath, await this.listProjects());
    if (project) {
      return this.loadWithProject({ nearUri: editor.document.uri, projectId: project.id });
    }
    return this.loadWithProject({ nearUri: editor.document.uri });
  }

  async handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<boolean> {
    if (!getFollowEditor() || this.isPinned() || !editor) {
      return false;
    }

    const projects = await this.listProjects();
    const nextProject = resolveProjectForFile(editor.document.uri.fsPath, projects);
    if (!nextProject) {
      return false;
    }

    if (this.activeProject?.id === nextProject.id) {
      return false;
    }

    await this.loadWithProject({ projectId: nextProject.id });
    return true;
  }

  activeProjectLabel(): string {
    if (!this.activeProject) {
      return 'Rails Schema Navigator';
    }
    return `Rails Schema Navigator — ${this.activeProject.name}`;
  }
}

let indexInstance: SchemaIndex | null = null;

export function getSchemaIndex(context: vscode.ExtensionContext): SchemaIndex {
  if (!indexInstance) {
    indexInstance = new SchemaIndex(context);
  }
  return indexInstance;
}

export function resetSchemaIndexForTests(): void {
  indexInstance = null;
}
