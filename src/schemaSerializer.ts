import * as path from 'path';
import * as vscode from 'vscode';
import { ModelTableEnums } from './modelIndex';
import { guessModelForTable, isImplicitJoinTable, isJoinStyleTable } from './modelResolver';
import { normalizeTypeName, ParsedSchema, SchemaTable } from './parser';

export interface SerializedEnumValue {
  label: string;
  value: string;
}

export interface SerializedColumnEnum {
  name: string;
  source: 'database' | 'model';
  values: SerializedEnumValue[];
  modelPath?: string;
  modelName?: string;
}

export interface SerializedColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  isFk: boolean;
  enumType?: string | null;
}

export interface SerializedSchemaPayload {
  sourcePath: string;
  sourceKind: 'structure.sql' | 'schema.rb';
  order: string[];
  tables: Record<string, SerializedTable>;
  typeOrder: string[];
  types: Record<string, SerializedCustomType>;
  viewOrder: string[];
  views: Record<string, SerializedView>;
  stale?: { message: string; dumpCommand: string; schemaPath: string };
}

export interface SerializedCustomType {
  name: string;
  schema: string;
  kind: 'enum' | 'domain';
  values: string[];
  definition: string;
}

export interface SerializedView {
  name: string;
  schema: string;
  materialized: boolean;
  definition: string;
}

export interface SerializedTable {
  name: string;
  schema: string;
  columns: SerializedColumn[];
  primaryKey: string[] | null;
  outgoingFks: SchemaTable['outgoingFks'];
  incomingFks: SchemaTable['incomingFks'];
  uniqueColumns: string[];
  uniqueColumnSets: string[][];
  indexes: SchemaTable['indexes'];
  indexedColumns: string[];
  constraints: SchemaTable['constraints'];
  manyToMany: SchemaTable['manyToMany'];
  isJoinTable: boolean;
  columnEnums: Record<string, SerializedColumnEnum>;
  modelPath?: string;
  modelName?: string;
}

function buildColumnEnums(
  table: SchemaTable,
  schema: ParsedSchema,
  modelInfo?: ModelTableEnums
): Record<string, SerializedColumnEnum> {
  const out: Record<string, SerializedColumnEnum> = {};

  for (const col of table.columns) {
    const typeCandidates = [
      col.enumType,
      col.type,
      normalizeTypeName(col.type),
    ].filter((value): value is string => Boolean(value));

    for (const candidate of typeCandidates) {
      const customType = schema.types.get(normalizeTypeName(candidate));
      if (customType?.kind === 'enum' && customType.values.length > 0) {
        out[col.name] = {
          name: customType.name,
          source: 'database',
          values: customType.values.map((value) => ({ label: value, value })),
        };
        break;
      }
    }
  }

  if (modelInfo) {
    for (const modelEnum of modelInfo.columns) {
      if (out[modelEnum.column]) {
        continue;
      }
      out[modelEnum.column] = {
        name: modelEnum.name,
        source: 'model',
        values: modelEnum.values,
        modelPath: modelInfo.modelPath,
        modelName: modelInfo.modelName,
      };
    }
  }

  return out;
}

function resolveTableModel(
  table: SchemaTable,
  modelEnums: Map<string, ModelTableEnums> | undefined,
  projectRoot?: string
): { modelPath: string; modelName: string } | undefined {
  const found = modelEnums?.get(table.name);
  if (found?.modelPath) {
    return { modelPath: found.modelPath, modelName: found.modelName };
  }
  // Implicit join table with no model file (id + two FKs only).
  if (isImplicitJoinTable(table)) {
    return undefined;
  }
  if (projectRoot) {
    return guessModelForTable(table.name, projectRoot, isJoinStyleTable(table));
  }
  return undefined;
}

export function serializeSchema(
  schema: ParsedSchema,
  modelEnums?: Map<string, ModelTableEnums>,
  stale?: { message: string; dumpCommand: string; schemaPath: string },
  projectRoot?: string
): SerializedSchemaPayload {
  const sourceKind = schema.uri.fsPath.endsWith('schema.rb') ? 'schema.rb' : 'structure.sql';
  const tables: Record<string, SerializedTable> = {};
  const types: Record<string, SerializedCustomType> = {};
  const views: Record<string, SerializedView> = {};

  for (const name of schema.typeOrder) {
    const type = schema.types.get(name);
    if (type) {
      types[name] = { ...type };
    }
  }

  for (const name of schema.viewOrder) {
    const view = schema.views.get(name);
    if (view) {
      views[name] = { ...view };
    }
  }

  for (const name of schema.order) {
    const table = schema.tables.get(name)!;
    const modelInfo = modelEnums?.get(name);
    const modelRef = resolveTableModel(table, modelEnums, projectRoot);
    tables[name] = {
      name: table.name,
      schema: table.schema,
      columns: table.columns.map((col) => ({
        name: col.name,
        type: col.type,
        notNull: col.notNull,
        default: col.defaultValue,
        isFk: col.isFk,
        enumType: col.enumType ?? null,
      })),
      primaryKey: table.primaryKey,
      outgoingFks: table.outgoingFks,
      incomingFks: table.incomingFks,
      uniqueColumns: Array.from(table.uniqueColumns),
      uniqueColumnSets: table.uniqueColumnSets,
      indexes: table.indexes,
      indexedColumns: Array.from(table.indexedColumns),
      constraints: table.constraints,
      manyToMany: table.manyToMany,
      isJoinTable: table.isJoinTable,
      columnEnums: buildColumnEnums(table, schema, modelInfo),
      modelPath: modelRef?.modelPath,
      modelName: modelRef?.modelName,
    };
  }

  return {
    sourcePath: schema.uri.fsPath,
    sourceKind,
    order: schema.order,
    tables,
    typeOrder: schema.typeOrder,
    types,
    viewOrder: schema.viewOrder,
    views,
    stale,
  };
}

export function workspaceRelativePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return path.basename(uri.fsPath);
  }
  return path.relative(folder.uri.fsPath, uri.fsPath) || path.basename(uri.fsPath);
}
