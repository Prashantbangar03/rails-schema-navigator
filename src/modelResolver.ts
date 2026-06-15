import * as path from 'path';
import * as vscode from 'vscode';

const MODEL_PATH_RE = /\/app\/models\/(.+)\.rb$/;
const CONCERNS_SEGMENT = '/concerns/';
const RUBY_KEYWORDS = new Set([
  'class', 'def', 'end', 'self', 'true', 'false', 'nil', 'return', 'if', 'unless',
  'else', 'elsif', 'when', 'case', 'while', 'until', 'for', 'in', 'do', 'begin',
  'rescue', 'ensure', 'module', 'include', 'extend', 'private', 'protected', 'public',
  'and', 'or', 'not', 'super', 'yield', 'break', 'next', 'redo', 'retry', 'alias',
  'defined', 'then', 'ApplicationRecord', 'ActiveRecord', 'Base',
]);

export interface ModelInfo {
  modelName: string;
  tableName: string;
  filePath: string;
}

export function isRailsModelDocument(document: vscode.TextDocument): boolean {
  const normalized = document.uri.fsPath.replace(/\\/g, '/');
  if (!MODEL_PATH_RE.test(normalized)) {
    return false;
  }
  return !normalized.includes(CONCERNS_SEGMENT);
}

function snakeCase(value: string): string {
  return value
    .replace(/::/g, '/')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\//g, '_')
    .toLowerCase();
}

function pluralize(word: string): string {
  if (/person$/i.test(word)) {
    return word.replace(/person$/i, 'people');
  }
  if (/[^aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  if (/(s|x|z|ch|sh)$/i.test(word)) {
    return word + 'es';
  }
  if (/fe?$/i.test(word)) {
    return word.replace(/fe?$/i, 'ves');
  }
  if (word.endsWith('s')) {
    return word + 'es';
  }
  return word + 's';
}

function classNameToTable(className: string): string {
  const parts = className.split('::').filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  const base = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).map((p) => snakeCase(p));
  const tableBase = pluralize(snakeCase(base));
  return prefix.length ? `${prefix.join('_')}_${tableBase}` : tableBase;
}

function classNameFromFilename(filePath: string): string {
  const rel = filePath.replace(/\\/g, '/').match(MODEL_PATH_RE)?.[1];
  if (!rel) {
    return '';
  }
  return rel
    .split('/')
    .map((segment) =>
      segment
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
    )
    .join('::');
}

function parseClassName(text: string): string | null {
  const match = text.match(/^\s*class\s+([A-Z][\w:]*)\s+</m);
  return match ? match[1] : null;
}

function parseTableNameOverride(text: string): string | null {
  const match = text.match(/self\.table_name\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

function capitalizeSegment(segment: string): string {
  return segment
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function singularize(word: string): string {
  if (/people$/i.test(word)) {
    return word.replace(/people$/i, 'person');
  }
  if (/ves$/i.test(word)) {
    return word.replace(/ves$/i, 'f');
  }
  if (/ies$/i.test(word)) {
    return word.slice(0, -3) + 'y';
  }
  if (/(ses|xes|zes|ches|shes|oes)$/i.test(word) && word.length > 3) {
    return word.replace(/es$/i, '');
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Join table with only FK columns (+ id/timestamps) — typically no dedicated model. */
export function isImplicitJoinTable(table: {
  isJoinTable: boolean;
  outgoingFks: { fromCol: string }[];
  columns: { name: string }[];
}): boolean {
  if (!table.isJoinTable || table.outgoingFks.length !== 2) {
    return false;
  }
  const skipCols = new Set(['id', 'created_at', 'updated_at']);
  const fkCols = new Set(table.outgoingFks.map((fk) => fk.fromCol));
  const content = table.columns.filter(
    (c) => !fkCols.has(c.name) && !skipCols.has(c.name)
  );
  return content.length === 0;
}

/** Two FKs to different parents — join / HABTM-style table (may have pivot columns). */
export function isJoinStyleTable(table: {
  isJoinTable: boolean;
  outgoingFks: { toTable: string }[];
}): boolean {
  return table.isJoinTable;
}

/** Best-effort Rails model path when no scanned model file exists for the table. */
export function guessModelForTable(
  tableName: string,
  projectRoot: string,
  joinStyle = false
): { modelPath: string; modelName: string } {
  const segments = tableName.split('_').filter(Boolean);
  if (segments.length === 0) {
    return {
      modelPath: path.join(projectRoot, 'app', 'models', 'application_record.rb'),
      modelName: 'ApplicationRecord',
    };
  }

  if (joinStyle && segments.length >= 2) {
    const fileSegments = [...segments];
    fileSegments[fileSegments.length - 1] = singularize(fileSegments[fileSegments.length - 1]!);
    const fileBase = fileSegments.join('_');
    return {
      modelPath: path.join(projectRoot, 'app', 'models', `${fileBase}.rb`),
      modelName: capitalizeSegment(fileBase),
    };
  }

  const baseSeg = segments[segments.length - 1]!;
  const singularBase = singularize(baseSeg);
  const namespaceSegs = segments.slice(0, -1);
  const modelNameParts = namespaceSegs.map((seg) => capitalizeSegment(singularize(seg)));
  modelNameParts.push(capitalizeSegment(singularBase));
  const modelName = modelNameParts.join('::');
  const relParts = namespaceSegs.map((seg) => singularize(seg));
  relParts.push(singularBase);
  const modelPath = path.join(projectRoot, 'app', 'models', ...relParts) + '.rb';
  return { modelPath, modelName };
}

export function resolveModelFromDocument(
  document: vscode.TextDocument
): ModelInfo | null {
  if (!isRailsModelDocument(document)) {
    return null;
  }

  const text = document.getText();
  const className =
    parseClassName(text) ?? classNameFromFilename(document.uri.fsPath);
  if (!className) {
    return null;
  }

  const tableName = parseTableNameOverride(text) ?? classNameToTable(className);
  return {
    modelName: className,
    tableName,
    filePath: document.uri.fsPath,
  };
}

export function columnAtCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
  tableColumns: Set<string>
): string | undefined {
  const line = document.lineAt(position.line).text;

  const wordRange =
    document.getWordRangeAtPosition(position, /[a-z_][a-z0-9_]*/i) ??
    document.getWordRangeAtPosition(position);
  if (wordRange) {
    const word = document.getText(wordRange);
    if (!RUBY_KEYWORDS.has(word) && tableColumns.has(word)) {
      return word;
    }
  }

  const symbolMatch = line.match(/:([a-z_][a-z0-9_]*)/gi) ?? [];
  for (const sym of symbolMatch) {
    const name = sym.slice(1);
    if (tableColumns.has(name)) {
      const idx = line.indexOf(sym);
      if (position.character >= idx && position.character <= idx + sym.length) {
        return name;
      }
    }
  }

  return undefined;
}

export function nearestDbRoot(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/^(.*\/db)\//);
  return match?.[1];
}

export function scoreSchemaPath(candidate: string, nearPath?: string): number {
  const normalized = candidate.replace(/\\/g, '/');
  let score = normalized.endsWith('structure.sql') ? 0 : 10;

  if (!nearPath) {
    return score + normalized.split('/').length;
  }

  const near = nearPath.replace(/\\/g, '/');
  const nearDb = nearestDbRoot(near);
  if (nearDb && normalized.startsWith(nearDb + '/')) {
    score -= 100;
  }

  const nearParts = near.split('/');
  const candParts = normalized.split('/');
  let common = 0;
  for (let i = 0; i < Math.min(nearParts.length, candParts.length); i++) {
    if (nearParts[i] !== candParts[i]) {
      break;
    }
    common++;
  }
  score -= common * 5;
  score += candParts.length;

  return score;
}
