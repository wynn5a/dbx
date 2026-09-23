import type { DatabaseType } from "@/types/database";
import { qualifiedTableName } from "@/lib/tableSelectSql";
import { quoteSqlIdentifier } from "@/lib/sqlCompletion";
import { sqlDialectForDatabaseType } from "@/lib/sqlDialect";

// One MIME type carries both sidebar reference kinds (table and column); the
// payload's `kind` discriminates them. The MIME only has to answer "is this
// our drag?" during dragover, where dataTransfer content is unreadable.
export const DBX_TABLE_REFERENCE_MIME = "application/x-dbx-table-reference";
export const DBX_TABLE_REFERENCE_DROP_EVENT = "dbx-table-reference-drop";

export interface QueryEditorTableReferencePayload {
  kind: "dbx-table-reference";
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
  databaseType?: DatabaseType;
}

export interface QueryEditorColumnReferencePayload {
  kind: "dbx-column-reference";
  connectionId: string;
  database: string;
  schema?: string;
  tableName?: string;
  columnName: string;
  databaseType?: DatabaseType;
}

export type QueryEditorSidebarReferencePayload = QueryEditorTableReferencePayload | QueryEditorColumnReferencePayload;

export interface QueryEditorTableReferenceDropDetail {
  payload: QueryEditorSidebarReferencePayload;
  clientX: number;
  clientY: number;
}

let activeTableReferencePayload: QueryEditorSidebarReferencePayload | null = null;

export function createTableReferencePayload(options: {
  connectionId?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  databaseType?: DatabaseType;
}): QueryEditorTableReferencePayload | null {
  if (!options.connectionId || options.database == null || !options.tableName) return null;
  const payload: QueryEditorTableReferencePayload = {
    kind: "dbx-table-reference",
    connectionId: options.connectionId,
    database: options.database,
    tableName: options.tableName,
  };
  if (options.schema) payload.schema = options.schema;
  if (options.databaseType) payload.databaseType = options.databaseType;
  return payload;
}

export function createColumnReferencePayload(options: {
  connectionId?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  columnName?: string;
  databaseType?: DatabaseType;
}): QueryEditorColumnReferencePayload | null {
  if (!options.connectionId || options.database == null || !options.columnName) return null;
  const payload: QueryEditorColumnReferencePayload = {
    kind: "dbx-column-reference",
    connectionId: options.connectionId,
    database: options.database,
    columnName: options.columnName,
  };
  if (options.schema) payload.schema = options.schema;
  if (options.tableName) payload.tableName = options.tableName;
  if (options.databaseType) payload.databaseType = options.databaseType;
  return payload;
}

export function serializeTableReferencePayload(payload: QueryEditorSidebarReferencePayload): string {
  return JSON.stringify(payload);
}

export function parseTableReferencePayload(value: string | undefined | null): QueryEditorTableReferencePayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<QueryEditorTableReferencePayload>;
    if (
      parsed.kind !== "dbx-table-reference" ||
      typeof parsed.connectionId !== "string" ||
      typeof parsed.database !== "string" ||
      typeof parsed.tableName !== "string" ||
      !parsed.connectionId ||
      !parsed.tableName
    ) {
      return null;
    }
    const payload: QueryEditorTableReferencePayload = {
      kind: "dbx-table-reference",
      connectionId: parsed.connectionId,
      database: parsed.database,
      tableName: parsed.tableName,
    };
    if (typeof parsed.schema === "string" && parsed.schema) payload.schema = parsed.schema;
    if (parsed.databaseType) payload.databaseType = parsed.databaseType;
    return payload;
  } catch {
    return null;
  }
}

export function parseColumnReferencePayload(
  value: string | undefined | null,
): QueryEditorColumnReferencePayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<QueryEditorColumnReferencePayload>;
    if (
      parsed.kind !== "dbx-column-reference" ||
      typeof parsed.connectionId !== "string" ||
      typeof parsed.database !== "string" ||
      typeof parsed.columnName !== "string" ||
      !parsed.connectionId ||
      !parsed.columnName
    ) {
      return null;
    }
    const payload: QueryEditorColumnReferencePayload = {
      kind: "dbx-column-reference",
      connectionId: parsed.connectionId,
      database: parsed.database,
      columnName: parsed.columnName,
    };
    if (typeof parsed.schema === "string" && parsed.schema) payload.schema = parsed.schema;
    if (typeof parsed.tableName === "string" && parsed.tableName) payload.tableName = parsed.tableName;
    if (parsed.databaseType) payload.databaseType = parsed.databaseType;
    return payload;
  } catch {
    return null;
  }
}

// Accepts either sidebar reference kind; the editor's drop handler cannot know
// which one a drag carries until the payload is readable (drop stage / active
// payload), so it parses both and branches on `kind` at insertion time.
export function parseSidebarReferencePayload(
  value: string | undefined | null,
): QueryEditorSidebarReferencePayload | null {
  return parseTableReferencePayload(value) ?? parseColumnReferencePayload(value);
}

export function hasTableReferencePayloadType(types: Iterable<string> | undefined | null): boolean {
  if (!types) return false;
  for (const type of types) {
    if (type === DBX_TABLE_REFERENCE_MIME) return true;
  }
  return false;
}

export function setActiveTableReferencePayload(payload: QueryEditorSidebarReferencePayload | null) {
  activeTableReferencePayload = payload;
}

export function activeTableReferencePayloadValue(): QueryEditorSidebarReferencePayload | null {
  return activeTableReferencePayload;
}

export function clearActiveTableReferencePayload(payload?: QueryEditorSidebarReferencePayload | null) {
  if (!payload || activeTableReferencePayload === payload) {
    activeTableReferencePayload = null;
  }
}

export function createTableReferenceDropEvent(detail: QueryEditorTableReferenceDropDetail) {
  return new CustomEvent<QueryEditorTableReferenceDropDetail>(DBX_TABLE_REFERENCE_DROP_EVENT, { detail });
}

export function tableReferenceInsertText(
  payload: QueryEditorTableReferencePayload,
  fallbackDatabaseType?: DatabaseType,
): string {
  return qualifiedTableName({
    databaseType: payload.databaseType ?? fallbackDatabaseType,
    schema: payload.schema,
    tableName: payload.tableName,
  });
}

// Columns insert as the bare column name — the same text completion inserts for
// a column item — quoted with the T06 rules (quoteSqlIdentifier) for the source
// dialect. Tables keep the schema-qualified form from tableReferenceInsertText.
export function sidebarReferenceInsertText(
  payload: QueryEditorSidebarReferencePayload,
  fallbackDatabaseType?: DatabaseType,
): string {
  if (payload.kind === "dbx-column-reference") {
    const dialect = sqlDialectForDatabaseType(payload.databaseType ?? fallbackDatabaseType);
    return quoteSqlIdentifier(payload.columnName, dialect);
  }
  return tableReferenceInsertText(payload, fallbackDatabaseType);
}
