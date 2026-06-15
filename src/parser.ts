import * as vscode from 'vscode';

export interface SchemaColumn {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  isFk: boolean;
  enumType?: string | null;
}

export interface SchemaCustomType {
  name: string;
  schema: string;
  kind: 'enum' | 'domain';
  values: string[];
  definition: string;
}

export interface SchemaView {
  name: string;
  schema: string;
  materialized: boolean;
  definition: string;
}

export interface SchemaForeignKey {
  fromTable: string;
  fromCol: string;
  toTable: string;
  toCol: string;
  explicit: boolean;
  onDelete: string | null;
  cardinality?: string;
}

export interface SchemaIndex {
  name: string;
  columns: string[];
  columnNames: string[];
  unique: boolean;
  method: string;
  predicate: string | null;
}

export interface SchemaConstraint {
  name: string;
  type: string;
  columns: string[];
  definition: string;
}

export interface SchemaManyToMany {
  via: string;
  otherTable: string;
  viaOwnCol: string;
  viaOtherCol: string;
}

export interface SchemaTable {
  name: string;
  schema: string;
  columns: SchemaColumn[];
  primaryKey: string[] | null;
  outgoingFks: SchemaForeignKey[];
  incomingFks: SchemaForeignKey[];
  uniqueColumns: Set<string>;
  uniqueColumnSets: string[][];
  indexes: SchemaIndex[];
  indexedColumns: Set<string>;
  constraints: SchemaConstraint[];
  manyToMany: SchemaManyToMany[];
  isJoinTable: boolean;
}

export interface ParsedSchema {
  uri: vscode.Uri;
  tables: Map<string, SchemaTable>;
  order: string[];
  types: Map<string, SchemaCustomType>;
  typeOrder: string[];
  views: Map<string, SchemaView>;
  viewOrder: string[];
}

const TABLE_HEADER = /CREATE TABLE (?:(\w+)\.)?"?(\w+)"?\s*\(/g;
const PK_RE =
  /ALTER TABLE (?:ONLY )?(?:\w+\.)?(\w+)\s+ADD CONSTRAINT \w+ PRIMARY KEY \(([^)]+)\)/gi;
const INDEX_HEADER_RE =
  /CREATE (UNIQUE )?INDEX (\w+) ON (?:ONLY )?(?:\w+\.)?(\w+)\s+USING (\w+)\s*\(/gi;
const UNIQ_CONSTR_RE =
  /ALTER TABLE (?:ONLY )?(?:\w+\.)?(\w+)\s+ADD CONSTRAINT (\w+) UNIQUE \(([^)]+)\)/gi;
const CHECK_HEADER_RE =
  /ALTER TABLE (?:ONLY )?(?:\w+\.)?(\w+)\s+ADD CONSTRAINT (\w+) CHECK\s*\(/gi;
const EXCL_RE =
  /ALTER TABLE (?:ONLY )?(?:\w+\.)?(\w+)\s+ADD CONSTRAINT (\w+) EXCLUDE\s+([\s\S]+?);/gi;
const FK_RE =
  /ALTER TABLE (?:ONLY )?(?:\w+\.)?(\w+)\s+ADD CONSTRAINT (\w+) FOREIGN KEY \(([^)]+)\) REFERENCES (?:\w+\.)?(\w+)\(([^)]+)\)(?:\s+ON\s+DELETE\s+(\w+(?:\s+\w+)?))?/gi;

function balanceParens(sql: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < sql.length && depth > 0) {
    const c = sql[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === "'") {
      i++;
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === '\\') {
          i++;
        }
        i++;
      }
    }
    i++;
  }
  return i;
}

function splitTopLevelComma(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) {
    out.push(cur.trim());
  }
  return out;
}

function colNameFromExpr(expr: string): string | null {
  const m = expr.match(/^"?(\w+)"?(?:\s|$)/);
  return m ? m[1] : null;
}

function pluralizeCandidates(base: string): string[] {
  const out = new Set<string>();
  out.add(base);
  out.add(base + 's');
  if (/[^aeiou]y$/i.test(base)) {
    out.add(base.slice(0, -1) + 'ies');
  }
  if (/(s|x|z|ch|sh)$/i.test(base)) {
    out.add(base + 'es');
  }
  if (/fe?$/i.test(base)) {
    out.add(base.replace(/fe?$/i, 'ves'));
  }
  if (base.endsWith('s')) {
    out.add(base + 'es');
  }
  return Array.from(out);
}

function parseColList(str: string): string[] {
  return str
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function readIndexPredicate(sql: string, colsEnd: number): string | null {
  const tail = sql.slice(colsEnd);
  const whereMatch = tail.match(/^\s*WHERE\s+([\s\S]+?)\s*;/i);
  return whereMatch ? whereMatch[1].trim() : null;
}

function applyTableUnique(table: SchemaTable, cname: string, cols: string[]): void {
  table.indexes.push({
    name: cname,
    columns: cols,
    columnNames: cols,
    unique: true,
    method: 'constraint',
    predicate: null,
  });
  table.constraints.push({
    name: cname,
    type: 'UNIQUE',
    columns: cols,
    definition: `(${cols.join(', ')})`,
  });
  for (const c of cols) {
    table.indexedColumns.add(c);
  }
  if (cols.length === 1) {
    table.uniqueColumns.add(cols[0]);
  }
  if (cols.length) {
    table.uniqueColumnSets.push(cols);
  }
}

function addInlineForeignKey(
  table: SchemaTable,
  tables: Map<string, SchemaTable>,
  fromCol: string,
  toTable: string,
  toCol: string,
  onDeleteRaw?: string
): void {
  const onDelete = onDeleteRaw ? onDeleteRaw.trim().toUpperCase() : null;
  const fk: SchemaForeignKey = {
    fromTable: table.name,
    fromCol,
    toTable,
    toCol,
    explicit: true,
    onDelete,
  };
  table.outgoingFks.push(fk);
  if (tables.has(toTable)) {
    tables.get(toTable)!.incomingFks.push({ ...fk });
  }
}

function parseInlineTableConstraints(
  body: string,
  table: SchemaTable,
  tables: Map<string, SchemaTable>
): void {
  for (const part of splitTopLevelComma(body)) {
    const trimmed = part.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      continue;
    }
    if (!/^(CONSTRAINT|CHECK|PRIMARY KEY|FOREIGN KEY|UNIQUE|EXCLUDE)\b/i.test(trimmed)) {
      continue;
    }

    let m = trimmed.match(/^CONSTRAINT\s+"?(\w+)"?\s+PRIMARY KEY\s*\(([^)]+)\)/i);
    if (m) {
      const cols = parseColList(m[2]);
      if (!table.primaryKey) {
        table.primaryKey = cols;
      }
      table.constraints.push({
        name: m[1],
        type: 'PRIMARY KEY',
        columns: cols,
        definition: `(${m[2]})`,
      });
      continue;
    }
    m = trimmed.match(/^PRIMARY KEY\s*\(([^)]+)\)/i);
    if (m) {
      const cols = parseColList(m[1]);
      if (!table.primaryKey) {
        table.primaryKey = cols;
      }
      table.constraints.push({
        name: `${table.name}_pkey`,
        type: 'PRIMARY KEY',
        columns: cols,
        definition: `(${m[1]})`,
      });
      continue;
    }

    m = trimmed.match(/^CONSTRAINT\s+"?(\w+)"?\s+UNIQUE\s*\(([^)]+)\)/i);
    if (m) {
      applyTableUnique(table, m[1], parseColList(m[2]));
      continue;
    }
    m = trimmed.match(/^UNIQUE\s*\(([^)]+)\)/i);
    if (m) {
      applyTableUnique(table, `${table.name}_unique`, parseColList(m[1]));
      continue;
    }

    m = trimmed.match(/^CONSTRAINT\s+"?(\w+)"?\s+CHECK\s*\(/i);
    if (m) {
      const start = trimmed.indexOf('(', trimmed.search(/CHECK/i));
      const end = balanceParens(trimmed, start + 1);
      table.constraints.push({
        name: m[1],
        type: 'CHECK',
        columns: [],
        definition: trimmed.slice(start, end),
      });
      continue;
    }
    if (/^CHECK\s*\(/i.test(trimmed)) {
      const start = trimmed.indexOf('(');
      const end = balanceParens(trimmed, start + 1);
      table.constraints.push({
        name: `${table.name}_check`,
        type: 'CHECK',
        columns: [],
        definition: trimmed.slice(start, end),
      });
      continue;
    }

    m = trimmed.match(
      /^CONSTRAINT\s+"?(\w+)"?\s+FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:(\w+)\.)?"?(\w+)"?\s*\(([^)]+)\)(?:\s+ON DELETE\s+(\w+(?:\s+\w+)?))?/i
    );
    if (m) {
      addInlineForeignKey(
        table,
        tables,
        parseColList(m[2])[0],
        m[4],
        parseColList(m[5])[0],
        m[6]
      );
      continue;
    }
    m = trimmed.match(
      /^FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:(\w+)\.)?"?(\w+)"?\s*\(([^)]+)\)(?:\s+ON DELETE\s+(\w+(?:\s+\w+)?))?/i
    );
    if (m) {
      addInlineForeignKey(
        table,
        tables,
        parseColList(m[1])[0],
        m[3],
        parseColList(m[4])[0],
        m[5]
      );
      continue;
    }

    m = trimmed.match(/^CONSTRAINT\s+"?(\w+)"?\s+EXCLUDE\s+/i);
    if (m) {
      const rest = trimmed.slice(trimmed.search(/EXCLUDE/i) + 7).trim();
      table.constraints.push({
        name: m[1],
        type: 'EXCLUDE',
        columns: [],
        definition: rest.replace(/,\s*$/, ''),
      });
    }
  }
}

function emptyTable(name: string): SchemaTable {
  return {
    name,
    schema: 'public',
    columns: [],
    primaryKey: null,
    outgoingFks: [],
    incomingFks: [],
    uniqueColumns: new Set(),
    uniqueColumnSets: [],
    indexes: [],
    indexedColumns: new Set(),
    constraints: [],
    manyToMany: [],
    isJoinTable: false,
  };
}

function parseSqlColumnType(rest: string): string {
  const trimmed = rest.trim();
  const tzMatch = trimmed.match(/^(.+?)\s+(without time zone|with time zone)\b/i);
  const basePart = tzMatch ? tzMatch[1].trim() : trimmed;
  const tzSuffix = tzMatch ? ` ${tzMatch[2]}` : '';
  const typeMatch = basePart.match(/^((?:\w+\.)?\w+(?:\([^)]*\))?(?:\[\])?)/);
  if (typeMatch) {
    return `${typeMatch[1]}${tzSuffix}`.trim();
  }
  return basePart.split(/\s+/)[0];
}

function parseColumns(body: string): SchemaColumn[] {
  const cols: SchemaColumn[] = [];

  for (const part of splitTopLevelComma(body)) {
    const trimmed = part.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      continue;
    }
    if (/^(CONSTRAINT|CHECK|PRIMARY KEY|FOREIGN KEY|UNIQUE|EXCLUDE)\b/i.test(trimmed)) {
      continue;
    }
    const tokens = trimmed.match(/^"?([\w]+)"?\s+(.+)$/);
    if (!tokens) {
      continue;
    }
    const name = tokens[1];
    const rest = tokens[2];
    const type = parseSqlColumnType(rest);
    const notNull = /\bNOT NULL\b/i.test(rest);
    const defaultMatch = rest.match(/\bDEFAULT\s+(.+?)(?:\s+NOT NULL\b|\s+CHECK\b|$)/i);
    const defaultValue = defaultMatch ? defaultMatch[1].trim() : null;
    cols.push({
      name,
      type,
      notNull,
      defaultValue,
      isFk: false,
    });
  }

  return cols;
}

const JOIN_SKIP_COLS = new Set(['id', 'created_at', 'updated_at']);
/** Max non-FK columns still treated as pivot attrs on a named join table. */
const JOIN_PIVOT_COL_MAX = 4;

function singularTableToken(word: string): string {
  if (/people$/i.test(word)) {
    return word.replace(/people$/i, 'person');
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

function tableTokenMatchesParent(segment: string, parentTable: string): boolean {
  const seg = segment.toLowerCase();
  const parent = parentTable.toLowerCase();
  if (!seg || !parent) {
    return false;
  }
  if (seg === parent) {
    return true;
  }
  if (parent.startsWith(`${seg}_`) || seg.startsWith(`${parent}_`)) {
    return true;
  }
  if (parent === `${seg}s` || parent === `${seg}es`) {
    return true;
  }
  if (singularTableToken(parent) === seg || singularTableToken(seg) === parent) {
    return true;
  }
  return false;
}

/** True when table name looks like `{parentA}_{parentB}` (Rails HABTM / join naming). */
function tableNameJoinsParents(
  tableName: string,
  parentA: string,
  parentB: string
): boolean {
  const parts = tableName.toLowerCase().split('_').filter(Boolean);
  if (parts.length < 2) {
    return false;
  }
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join('_');
    const right = parts.slice(i).join('_');
    if (
      tableTokenMatchesParent(left, parentA) &&
      tableTokenMatchesParent(right, parentB)
    ) {
      return true;
    }
    if (
      tableTokenMatchesParent(left, parentB) &&
      tableTokenMatchesParent(right, parentA)
    ) {
      return true;
    }
  }
  return false;
}

function joinContentColumns(t: SchemaTable): SchemaColumn[] {
  const fkCols = new Set(t.outgoingFks.map((fk) => fk.fromCol));
  return t.columns.filter((c) => !fkCols.has(c.name) && !JOIN_SKIP_COLS.has(c.name));
}

function isJoinTableCandidate(t: SchemaTable): boolean {
  if (t.outgoingFks.length !== 2) {
    return false;
  }
  const [fkA, fkB] = t.outgoingFks;
  if (fkA.toTable === fkB.toTable) {
    return false;
  }

  const content = joinContentColumns(t);
  if (content.length === 0) {
    return true;
  }

  if (
    content.length <= JOIN_PIVOT_COL_MAX &&
    tableNameJoinsParents(t.name, fkA.toTable, fkB.toTable)
  ) {
    return true;
  }

  return false;
}

function postProcessTables(tables: Map<string, SchemaTable>): void {
  for (const t of tables.values()) {
    const explicitCols = new Set(t.outgoingFks.map((fk) => fk.fromCol));
    for (const col of t.columns) {
      if (!col.name.endsWith('_id') || col.name === 'id') {
        continue;
      }
      if (explicitCols.has(col.name)) {
        continue;
      }
      const base = col.name.slice(0, -3);
      for (const cand of pluralizeCandidates(base)) {
        if (tables.has(cand)) {
          t.outgoingFks.push({
            fromTable: t.name,
            fromCol: col.name,
            toTable: cand,
            toCol: 'id',
            explicit: false,
            onDelete: null,
          });
          tables.get(cand)!.incomingFks.push({
            fromTable: t.name,
            fromCol: col.name,
            toTable: cand,
            toCol: 'id',
            explicit: false,
            onDelete: null,
          });
          break;
        }
      }
    }
  }

  for (const t of tables.values()) {
    const fkCols = new Set(t.outgoingFks.map((fk) => fk.fromCol));
    for (const col of t.columns) {
      col.isFk = fkCols.has(col.name);
    }
  }

  for (const t of tables.values()) {
    for (const fk of t.outgoingFks) {
      fk.cardinality = t.uniqueColumns.has(fk.fromCol) ? '1:1' : 'n:1';
    }
    for (const fk of t.incomingFks) {
      const src = tables.get(fk.fromTable);
      const srcUnique = src?.uniqueColumns.has(fk.fromCol);
      fk.cardinality = srcUnique ? '1:1' : '1:n';
    }
  }

  for (const t of tables.values()) {
    if (!isJoinTableCandidate(t)) {
      continue;
    }
    const [fkA, fkB] = t.outgoingFks;
    const a = tables.get(fkA.toTable);
    const b = tables.get(fkB.toTable);
    if (!a || !b) {
      continue;
    }
    t.isJoinTable = true;
    a.manyToMany.push({
      via: t.name,
      otherTable: b.name,
      viaOwnCol: fkA.fromCol,
      viaOtherCol: fkB.fromCol,
    });
    b.manyToMany.push({
      via: t.name,
      otherTable: a.name,
      viaOwnCol: fkB.fromCol,
      viaOtherCol: fkA.fromCol,
    });
  }
}

function emptySchemaExtras(): {
  types: Map<string, SchemaCustomType>;
  typeOrder: string[];
  views: Map<string, SchemaView>;
  viewOrder: string[];
} {
  return {
    types: new Map(),
    typeOrder: [],
    views: new Map(),
    viewOrder: [],
  };
}

function findStatementEnd(sql: string, start: number): number {
  let depth = 0;
  let inQuote: "'" | '"' | null = null;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (inQuote) {
      if (ch === inQuote && sql[i - 1] !== '\\') {
        inQuote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ';' && depth === 0) {
      return i;
    }
  }
  return sql.length;
}

function parseQuotedEnumValues(body: string): string[] {
  return splitTopLevelComma(body)
    .map((part) => part.trim().replace(/^'|'/g, '').replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function addCustomType(
  types: Map<string, SchemaCustomType>,
  typeOrder: string[],
  type: SchemaCustomType
): void {
  if (types.has(type.name)) {
    return;
  }
  types.set(type.name, type);
  typeOrder.push(type.name);
}

function parseSqlTypesAndViews(
  sql: string,
  types: Map<string, SchemaCustomType>,
  typeOrder: string[],
  views: Map<string, SchemaView>,
  viewOrder: string[]
): void {
  const enumRe = /CREATE TYPE (?:(\w+)\.)?"?(\w+)"?\s+AS\s+ENUM\s*\(/gi;
  for (const m of sql.matchAll(enumRe)) {
    const schema = m[1] || 'public';
    const name = m[2];
    const start = m.index! + m[0].length;
    const end = balanceParens(sql, start);
    const values = parseQuotedEnumValues(sql.slice(start, end - 1));
    addCustomType(types, typeOrder, {
      name,
      schema,
      kind: 'enum',
      values,
      definition: `ENUM (${values.map((v) => `'${v}'`).join(', ')})`,
    });
  }

  const domainRe = /CREATE DOMAIN (?:(\w+)\.)?"?(\w+)"?\s+AS\s+/gi;
  for (const m of sql.matchAll(domainRe)) {
    const schema = m[1] || 'public';
    const name = m[2];
    const defStart = m.index! + m[0].length;
    const defEnd = findStatementEnd(sql, defStart);
    const definition = sql.slice(defStart, defEnd).trim();
    addCustomType(types, typeOrder, {
      name,
      schema,
      kind: 'domain',
      values: [],
      definition,
    });
  }

  const viewRe =
    /CREATE (?:OR REPLACE )?(MATERIALIZED )?VIEW (?:(\w+)\.)?"?(\w+)"?\s+AS\s+/gi;
  for (const m of sql.matchAll(viewRe)) {
    const materialized = !!m[1];
    const schema = m[2] || 'public';
    const name = m[3];
    const defStart = m.index! + m[0].length;
    const defEnd = findStatementEnd(sql, defStart);
    const definition = sql.slice(defStart, defEnd).trim();
    views.set(name, { name, schema, materialized, definition });
    if (!viewOrder.includes(name)) {
      viewOrder.push(name);
    }
  }
}

function parseRubyEnumTypes(ruby: string, types: Map<string, SchemaCustomType>, typeOrder: string[]): void {
  for (const m of ruby.matchAll(
    /^\s*create_enum\s+:?["']?(\w+)["']?\s*,\s*\[([^\]]+)\]/gm
  )) {
    const name = m[1];
    const values = splitRubyArray(`[${m[2]}]`);
    addCustomType(types, typeOrder, {
      name,
      schema: 'public',
      kind: 'enum',
      values,
      definition: `ENUM (${values.map((v) => `'${v}'`).join(', ')})`,
    });
  }
}

export function normalizeTypeName(type: string): string {
  return type
    .trim()
    .replace(/^public\./, '')
    .replace(/\[\]$/, '')
    .replace(/\([^)]*\)$/, '')
    .trim();
}

export function parseStructureSql(sql: string): Omit<ParsedSchema, 'uri'> {
  const tables = new Map<string, SchemaTable>();
  const order: string[] = [];
  const { types, typeOrder, views, viewOrder } = emptySchemaExtras();

  for (const m of sql.matchAll(TABLE_HEADER)) {
    const schema = m[1] || 'public';
    const name = m[2];
    const bodyStart = m.index! + m[0].length;
    const bodyEnd = balanceParens(sql, bodyStart);
    const body = sql.slice(bodyStart, bodyEnd - 1);
    const cols = parseColumns(body);
    const table = {
      ...emptyTable(name),
      schema,
      columns: cols,
    };
    parseInlineTableConstraints(body, table, tables);
    tables.set(name, table);
    order.push(name);
  }

  for (const m of sql.matchAll(PK_RE)) {
    const t = tables.get(m[1]);
    if (t) {
      t.primaryKey = m[2].split(',').map((s) => s.trim().replace(/"/g, ''));
    }
  }

  for (const t of tables.values()) {
    if (!t.primaryKey && t.columns.some((c) => c.name === 'id')) {
      t.primaryKey = ['id'];
    }
  }

  for (const m of sql.matchAll(INDEX_HEADER_RE)) {
    const isUnique = !!m[1];
    const ixName = m[2];
    const tName = m[3];
    const method = m[4];
    const t = tables.get(tName);
    if (!t) {
      continue;
    }
    const colsStart = m.index! + m[0].length;
    const colsEnd = balanceParens(sql, colsStart);
    const colsStr = sql.slice(colsStart, colsEnd - 1);
    const parts = splitTopLevelComma(colsStr);
    const colNames = parts.map(colNameFromExpr).filter((c): c is string => Boolean(c));
    const predicate = readIndexPredicate(sql, colsEnd);
    t.indexes.push({
      name: ixName,
      columns: parts,
      columnNames: colNames,
      unique: isUnique,
      method,
      predicate,
    });
    for (const c of colNames) {
      t.indexedColumns.add(c);
    }
    if (isUnique) {
      if (colNames.length === 1) {
        t.uniqueColumns.add(colNames[0]);
      }
      if (colNames.length) {
        t.uniqueColumnSets.push(colNames);
      }
    }
  }

  for (const m of sql.matchAll(UNIQ_CONSTR_RE)) {
    const t = tables.get(m[1]);
    if (!t) {
      continue;
    }
    const cname = m[2];
    const cols = m[3]
      .split(',')
      .map((s) => s.trim().replace(/"/g, ''))
      .filter(Boolean);
    t.indexes.push({
      name: cname,
      columns: cols,
      columnNames: cols,
      unique: true,
      method: 'constraint',
      predicate: null,
    });
    t.constraints.push({
      name: cname,
      type: 'UNIQUE',
      columns: cols,
      definition: `(${cols.join(', ')})`,
    });
    for (const c of cols) {
      t.indexedColumns.add(c);
    }
    if (cols.length === 1) {
      t.uniqueColumns.add(cols[0]);
    }
    if (cols.length) {
      t.uniqueColumnSets.push(cols);
    }
  }

  for (const m of sql.matchAll(CHECK_HEADER_RE)) {
    const t = tables.get(m[1]);
    if (!t) {
      continue;
    }
    const cname = m[2];
    const start = m.index! + m[0].length;
    const end = balanceParens(sql, start);
    const def = sql.slice(start, end - 1).trim();
    t.constraints.push({
      name: cname,
      type: 'CHECK',
      columns: [],
      definition: `(${def})`,
    });
  }

  for (const m of sql.matchAll(EXCL_RE)) {
    const t = tables.get(m[1]);
    if (!t) {
      continue;
    }
    t.constraints.push({
      name: m[2],
      type: 'EXCLUDE',
      columns: [],
      definition: m[3].replace(/\s+/g, ' ').trim(),
    });
  }

  for (const m of sql.matchAll(FK_RE)) {
    const fromTable = m[1];
    const fromCol = m[3].trim().replace(/"/g, '');
    const toTable = m[4];
    const toCol = m[5].trim().replace(/"/g, '');
    const onDelete = m[6] ? m[6].trim().toUpperCase() : null;
    const fk: SchemaForeignKey = {
      fromTable,
      fromCol,
      toTable,
      toCol,
      explicit: true,
      onDelete,
    };
    if (tables.has(fromTable)) {
      tables.get(fromTable)!.outgoingFks.push(fk);
    }
    if (tables.has(toTable)) {
      tables.get(toTable)!.incomingFks.push({ ...fk });
    }
  }

  postProcessTables(tables);
  parseSqlTypesAndViews(sql, types, typeOrder, views, viewOrder);
  return { tables, order, types, typeOrder, views, viewOrder };
}

function stripRubyQuotes(value: string): string {
  const trimmed = value.trim();
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

function parseRubyHashOptions(rest: string): Record<string, string> {
  const opts: Record<string, string> = {};
  for (const m of rest.matchAll(
    /(\w+):\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|:[\w]+|-?\d+(?:\.\d+)?|true|false|nil)/g
  )) {
    opts[m[1]] = stripRubyQuotes(m[2]);
  }
  return opts;
}

function formatRubyLiteral(raw: string): string {
  if (raw === 'nil') {
    return 'NULL';
  }
  if (raw === 'true' || raw === 'false') {
    return raw;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return raw;
  }
  return raw;
}

function parseRubyColumnOptions(rest: string): {
  notNull: boolean;
  defaultValue: string | null;
  typeSuffix: string;
} {
  const opts = parseRubyHashOptions(rest);
  let typeSuffix = '';
  if (opts.limit) {
    typeSuffix = `(${opts.limit})`;
  } else if (opts.precision) {
    typeSuffix = opts.scale ? `(${opts.precision},${opts.scale})` : `(${opts.precision})`;
  }
  return {
    notNull: opts.null === 'false',
    defaultValue: opts.default !== undefined ? formatRubyLiteral(opts.default) : null,
    typeSuffix,
  };
}

function splitRubyArray(inner: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuote) {
      cur += ch;
      if (ch === inQuote && inner[i - 1] !== '\\') {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === ',') {
      const part = cur.trim();
      if (part) {
        out.push(stripRubyQuotes(part));
      }
      cur = '';
      continue;
    }
    cur += ch;
  }
  const part = cur.trim();
  if (part) {
    out.push(stripRubyQuotes(part));
  }
  return out;
}

function splitTopLevelCommaOutsideParens(s: string): string[] {
  const out: string[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
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
      parenDepth++;
    } else if (ch === ')') {
      parenDepth--;
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth--;
    }
    if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
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

function parseIndexFirstArg(firstArg: string): { columns: string[]; columnNames: string[] } {
  const trimmed = firstArg.trim();
  if (trimmed.startsWith('[')) {
    const inner = trimmed.slice(1, trimmed.lastIndexOf(']'));
    const cols = splitRubyArray(inner);
    return {
      columns: cols,
      columnNames: cols.filter((c) => /^\w+$/.test(c)),
    };
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const expr = trimmed.slice(1, -1);
    const parts = splitTopLevelCommaOutsideParens(expr);
    const columnNames = parts
      .map((p) => colNameFromExpr(p.trim()))
      .filter((name): name is string => !!name);
    return { columns: [expr], columnNames };
  }
  if (trimmed.startsWith(':')) {
    const name = trimmed.slice(1);
    return { columns: [name], columnNames: [name] };
  }
  const name = stripRubyQuotes(trimmed);
  if (/^\w+$/.test(name)) {
    return { columns: [name], columnNames: [name] };
  }
  return { columns: [trimmed], columnNames: [] };
}

function defaultRubyIndexName(tableName: string, columnNames: string[]): string {
  if (columnNames.length) {
    return `index_${tableName}_on_${columnNames.join('_and_')}`;
  }
  return `${tableName}_index`;
}

function parseRubyCheckConstraintArgs(
  args: string
): { name: string; definition: string } | null {
  const parts = splitTopLevelCommaOutsideParens(args);
  if (parts.length === 0) {
    return null;
  }
  const opts = parseRubyHashOptions(parts.slice(1).join(', '));
  let name = stripRubyQuotes(parts[0]);
  let definition = parts.length >= 2 ? stripRubyQuotes(parts[1]) : '';
  if (opts.expression) {
    definition = opts.expression;
  }
  if (opts.name) {
    name = opts.name;
  }
  if (!definition) {
    return null;
  }
  const def = definition.startsWith('(') ? definition : `(${definition})`;
  return { name: name || 'check', definition: def };
}

function parseRubyAddCheckConstraint(
  rest: string
): { name: string; definition: string } | null {
  const parts = splitTopLevelCommaOutsideParens(rest);
  if (parts.length === 0) {
    return null;
  }
  const expr = stripRubyQuotes(parts[0]);
  const opts = parseRubyHashOptions(parts.slice(1).join(', '));
  const name = opts.name || 'check_constraint';
  const def = expr.startsWith('(') ? expr : `(${expr})`;
  return { name, definition: def };
}

function parseRubyIndexArgs(args: string): {
  name?: string;
  columns: string[];
  columnNames: string[];
  unique: boolean;
  predicate: string | null;
} | null {
  const parts = splitTopLevelCommaOutsideParens(args);
  if (parts.length === 0) {
    return null;
  }
  const { columns, columnNames } = parseIndexFirstArg(parts[0]);
  if (columns.length === 0) {
    return null;
  }
  const opts = parseRubyHashOptions(parts.slice(1).join(', '));
  const unique = opts.unique === 'true';
  const predicate = opts.where ? stripRubyQuotes(opts.where) : null;
  return { name: opts.name, columns, columnNames, unique, predicate };
}

function applyRubyIndex(
  table: SchemaTable,
  ix: {
    name: string;
    columns: string[];
    columnNames: string[];
    unique: boolean;
    predicate: string | null;
  }
): void {
  const colNames = ix.columnNames.length ? ix.columnNames : ix.columns;
  table.indexes.push({
    name: ix.name,
    columns: ix.columns,
    columnNames: colNames,
    unique: ix.unique,
    method: 'btree',
    predicate: ix.predicate,
  });
  for (const c of colNames) {
    if (/^\w+$/.test(c)) {
      table.indexedColumns.add(c);
    }
  }
  if (ix.unique && colNames.length) {
    if (colNames.length === 1) {
      table.uniqueColumns.add(colNames[0]);
    }
    table.uniqueColumnSets.push(colNames);
    table.constraints.push({
      name: ix.name,
      type: 'UNIQUE',
      columns: colNames,
      definition: `(${colNames.join(', ')})`,
    });
  }
}

function inferFkColumnFromTable(toTable: string): string {
  if (toTable.endsWith('ies')) {
    return `${toTable.slice(0, -3)}y_id`;
  }
  if (toTable.endsWith('s')) {
    return `${toTable.slice(0, -1)}_id`;
  }
  return `${toTable}_id`;
}

function parseRubyOnDelete(value?: string): string | null {
  if (!value) {
    return null;
  }
  const normalized = stripRubyQuotes(value).toLowerCase().replace(/\s+/g, ' ');
  if (normalized === 'nullify') {
    return 'SET NULL';
  }
  if (normalized === 'cascade') {
    return 'CASCADE';
  }
  if (normalized === 'restrict') {
    return 'RESTRICT';
  }
  if (normalized === 'set null') {
    return 'SET NULL';
  }
  if (normalized === 'set default') {
    return 'SET DEFAULT';
  }
  return normalized.toUpperCase();
}

function parseCreateTableOptions(headerLine: string): Record<string, string> {
  const optsPart = headerLine.replace(/^\s*create_table\s+["']\w+["']\s*,?\s*/, '').replace(/\s+do\s*\|t\|\s*$/, '');
  return parseRubyHashOptions(optsPart);
}

function applyImplicitIdColumn(cols: SchemaColumn[], tableOpts: Record<string, string>): void {
  if (tableOpts.id === 'false') {
    return;
  }
  if (cols.some((col) => col.name === 'id')) {
    return;
  }
  const idType = tableOpts.id ? stripRubyQuotes(tableOpts.id) : 'bigint';
  if (idType === 'uuid') {
    cols.unshift({
      name: 'id',
      type: 'uuid',
      notNull: true,
      defaultValue: tableOpts.default ? 'gen_random_uuid()' : null,
      isFk: false,
    });
    return;
  }
  cols.unshift({
    name: 'id',
    type: 'bigint',
    notNull: true,
    defaultValue: null,
    isFk: false,
  });
}

function applyRubyForeignKeys(ruby: string, tables: Map<string, SchemaTable>): void {
  for (const m of ruby.matchAll(/^\s*add_foreign_key\s+(.+)$/gm)) {
    const parts = splitTopLevelCommaOutsideParens(m[1].trim());
    if (parts.length < 2) {
      continue;
    }
    const fromTable = stripRubyQuotes(parts[0]);
    const toTable = stripRubyQuotes(parts[1]);
    const opts = parseRubyHashOptions(parts.slice(2).join(', '));
    const fromCol = opts.column ? stripRubyQuotes(opts.column) : inferFkColumnFromTable(toTable);
    const toCol = opts.primary_key ? stripRubyQuotes(opts.primary_key) : 'id';
    const onDelete = parseRubyOnDelete(opts.on_delete);
    const fk: SchemaForeignKey = {
      fromTable,
      fromCol,
      toTable,
      toCol,
      explicit: true,
      onDelete,
    };
    if (tables.has(fromTable)) {
      tables.get(fromTable)!.outgoingFks.push(fk);
    }
    if (tables.has(toTable)) {
      tables.get(toTable)!.incomingFks.push({ ...fk });
    }
  }
}

export function parseSchemaRb(ruby: string): Omit<ParsedSchema, 'uri'> {
  const tables = new Map<string, SchemaTable>();
  const order: string[] = [];
  const { types, typeOrder, views, viewOrder } = emptySchemaExtras();
  parseRubyEnumTypes(ruby, types, typeOrder);
  const lines = ruby.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i];
    const header = headerLine.match(/^\s*create_table\s+["'](\w+)["']/);
    if (!header) {
      continue;
    }
    const tableName = header[1];
    const tableOpts = parseCreateTableOptions(headerLine);
    let doLine = i;
    while (doLine < lines.length && !/\bdo\s*\|t\|/.test(lines[doLine])) {
      doLine++;
    }
    if (doLine >= lines.length) {
      continue;
    }

    let depth = 1;
    const bodyLines: string[] = [];
    for (let k = doLine + 1; k < lines.length && depth > 0; k++) {
      const line = lines[k];
      if (/\bdo\b/.test(line)) {
        depth++;
      }
      if (/\bend\b/.test(line)) {
        depth--;
        if (depth === 0) {
          break;
        }
      }
      bodyLines.push(line);
    }

    const cols: SchemaColumn[] = [];
    const tableIndexes: Array<{
      name?: string;
      columns: string[];
      columnNames: string[];
      unique: boolean;
      predicate: string | null;
    }> = [];
    const tableChecks: Array<{ name: string; definition: string }> = [];

    for (let b = 0; b < bodyLines.length; b++) {
      const line = bodyLines[b];

      const indexMatch = line.match(/^\s*t\.index\s+(.+)/);
      if (indexMatch) {
        const ix = parseRubyIndexArgs(indexMatch[1].trim());
        if (ix) {
          tableIndexes.push(ix);
        }
        continue;
      }

      const checkMatch = line.match(/^\s*t\.check_constraint\s+(.+)/);
      if (checkMatch) {
        const parsed = parseRubyCheckConstraintArgs(checkMatch[1].trim());
        if (parsed) {
          tableChecks.push(parsed);
        }
        continue;
      }

      const enumCol = line.match(/^\s*t\.enum\s+["':]?(\w+)["']?(?:,\s*(.*))?/);
      if (enumCol) {
        const enumOpts = parseRubyHashOptions(enumCol[2] ?? '');
        const enumType = enumOpts.enum_type ? stripRubyQuotes(enumOpts.enum_type) : enumCol[1];
        cols.push({
          name: enumCol[1],
          type: enumType,
          notNull: enumOpts.null === 'false',
          defaultValue: enumOpts.default !== undefined ? formatRubyLiteral(enumOpts.default) : null,
          isFk: false,
          enumType,
        });
        continue;
      }

      if (/^\s*t\.timestamps\b/.test(line)) {
        const tsOpts = parseRubyColumnOptions(line);
        cols.push({
          name: 'created_at',
          type: 'datetime',
          notNull: tsOpts.notNull,
          defaultValue: tsOpts.defaultValue,
          isFk: false,
        });
        cols.push({
          name: 'updated_at',
          type: 'datetime',
          notNull: tsOpts.notNull,
          defaultValue: tsOpts.defaultValue,
          isFk: false,
        });
        continue;
      }

      const ref = line.match(/^\s*t\.references\s+(?::(\w+)|["'](\w+)["'])/);
      if (ref) {
        const refName = ref[1] ?? ref[2];
        const refOpts = parseRubyColumnOptions(line);
        cols.push({
          name: `${refName}_id`,
          type: 'bigint',
          notNull: refOpts.notNull,
          defaultValue: refOpts.defaultValue,
          isFk: true,
        });
        continue;
      }

      const col = line.match(/^\s*t\.(\w+)\s+["'](\w+)["'](?:,\s*(.*))?/);
      if (col) {
        const colOpts = parseRubyColumnOptions(col[3] ?? '');
        cols.push({
          name: col[2],
          type: col[1] + colOpts.typeSuffix,
          notNull: colOpts.notNull,
          defaultValue: colOpts.defaultValue,
          isFk: false,
        });
        continue;
      }
    }

    applyImplicitIdColumn(cols, tableOpts);

    const table: SchemaTable = {
      ...emptyTable(tableName),
      columns: cols,
    };
    for (const ix of tableIndexes) {
      applyRubyIndex(table, {
        ...ix,
        name:
          ix.name ??
          defaultRubyIndexName(
            tableName,
            ix.columnNames.length ? ix.columnNames : ix.columns
          ),
        predicate: ix.predicate ?? null,
      });
    }
    for (const chk of tableChecks) {
      table.constraints.push({
        name: chk.name,
        type: 'CHECK',
        columns: [],
        definition: chk.definition,
      });
    }
    tables.set(tableName, table);
    order.push(tableName);
  }

  for (const t of tables.values()) {
    if (t.primaryKey) {
      continue;
    }
    if (t.columns.some((c) => c.name === 'id')) {
      t.primaryKey = ['id'];
    }
  }

  applyRubyForeignKeys(ruby, tables);

  for (const m of ruby.matchAll(/^\s*add_index\s+["'](\w+)["'],\s*(.+)$/gm)) {
    const tName = m[1];
    const t = tables.get(tName);
    if (!t) {
      continue;
    }
    const ix = parseRubyIndexArgs(m[2].trim());
    if (!ix) {
      continue;
    }
    applyRubyIndex(t, {
      ...ix,
      name:
        ix.name ??
        defaultRubyIndexName(tName, ix.columnNames.length ? ix.columnNames : ix.columns),
      predicate: ix.predicate ?? null,
    });
  }

  for (const m of ruby.matchAll(/^\s*add_check_constraint\s+["'](\w+)["'],\s*(.+)$/gm)) {
    const t = tables.get(m[1]);
    if (!t) {
      continue;
    }
    const parsed = parseRubyAddCheckConstraint(m[2].trim());
    if (parsed) {
      t.constraints.push({
        name: parsed.name,
        type: 'CHECK',
        columns: [],
        definition: parsed.definition,
      });
    }
  }

  postProcessTables(tables);
  return { tables, order, types, typeOrder, views, viewOrder };
}

export function parseSchemaDocument(
  doc: vscode.TextDocument
): Omit<ParsedSchema, 'uri'> {
  const text = doc.getText();
  if (doc.fileName.endsWith('schema.rb')) {
    return parseSchemaRb(text);
  }
  return parseStructureSql(text);
}
