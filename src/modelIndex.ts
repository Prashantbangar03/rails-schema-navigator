import * as vscode from 'vscode';
import { resolveModelFromDocument } from './modelResolver';

export interface EnumValue {
  label: string;
  value: string;
}

export interface ModelColumnEnum {
  column: string;
  name: string;
  values: EnumValue[];
}

export interface ModelTableEnums {
  tableName: string;
  modelName: string;
  modelPath: string;
  columns: ModelColumnEnum[];
}

const MODEL_SCAN_LIMIT = 500;

function splitTopLevelCommaOutsideParens(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      cur += ch;
      if (ch === inQuote && s[i - 1] !== '\\') {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) {
    out.push(cur.trim());
  }
  return out;
}

function stripRubyToken(token: string): string {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith(':')) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function parseEnumHashBody(body: string): EnumValue[] {
  const values: EnumValue[] = [];
  for (const part of splitTopLevelCommaOutsideParens(body)) {
    const trimmed = part.trim();
    const hashRocket = trimmed.match(/^:?([\w"][^=]*?)\s*=>\s*(.+)$/);
    if (hashRocket) {
      values.push({
        label: stripRubyToken(hashRocket[1]),
        value: stripRubyToken(hashRocket[2]),
      });
      continue;
    }
    const colon = trimmed.match(/^:?([\w"]+)\s*:\s*(.+)$/);
    if (colon) {
      values.push({
        label: stripRubyToken(colon[1]),
        value: stripRubyToken(colon[2]),
      });
    }
  }
  return values;
}

function parseEnumArrayBody(body: string): EnumValue[] {
  const labels = body
    .split(',')
    .map((part) => stripRubyToken(part))
    .filter(Boolean);
  return labels.map((label, index) => ({ label, value: String(index) }));
}

export function parseEnumsFromModelText(text: string): ModelColumnEnum[] {
  const results: ModelColumnEnum[] = [];
  const seen = new Set<string>();

  function add(column: string, values: EnumValue[]): void {
    if (!column || values.length === 0 || seen.has(column)) {
      return;
    }
    seen.add(column);
    results.push({ column, name: column, values });
  }

  for (const m of text.matchAll(/\benum\s+:?([a-z_]\w*)\s*,\s*\{([^}]+)\}/gi)) {
    add(m[1], parseEnumHashBody(m[2]));
  }

  for (const m of text.matchAll(/\benum\s+([a-z_]\w*):\s*\{([^}]+)\}/gi)) {
    add(m[1], parseEnumHashBody(m[2]));
  }

  for (const m of text.matchAll(/\benum\s+:?([a-z_]\w*)\s*,\s*\[([^\]]+)\]/gi)) {
    add(m[1], parseEnumArrayBody(m[2]));
  }

  for (const m of text.matchAll(/\benum\s+:?([a-z_]\w*)\s*,\s*%i?\[([^\]]+)\]/gi)) {
    add(m[1], parseEnumArrayBody(m[2]));
  }

  return results;
}

export async function scanModelEnumsForProject(
  projectRoot: string
): Promise<Map<string, ModelTableEnums>> {
  const rootUri = vscode.Uri.file(projectRoot);
  const pattern = new vscode.RelativePattern(rootUri, 'app/models/**/*.rb');
  const files = await vscode.workspace.findFiles(
    pattern,
    '**/app/models/**/concerns/**',
    MODEL_SCAN_LIMIT
  );

  const byTable = new Map<string, ModelTableEnums>();

  for (const uri of files) {
    if (uri.fsPath.replace(/\\/g, '/').includes('/concerns/')) {
      continue;
    }
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      continue;
    }

    const model = resolveModelFromDocument(doc);
    if (!model) {
      continue;
    }

    const columns = parseEnumsFromModelText(doc.getText());
    const existing = byTable.get(model.tableName);
    if (existing) {
      if (columns.length > 0) {
        existing.columns = columns;
      }
      continue;
    }

    byTable.set(model.tableName, {
      tableName: model.tableName,
      modelName: model.modelName,
      modelPath: model.filePath,
      columns,
    });
  }

  return byTable;
}
