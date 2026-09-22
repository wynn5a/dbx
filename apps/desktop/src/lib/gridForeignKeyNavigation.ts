import type { DatabaseType, ForeignKeyInfo } from "@/types/database";
import type { GridCellValue } from "@/lib/dataGridSql";
import { quoteTableIdentifier } from "@/lib/tableSelectSql";

/**
 * Payload emitted by the grid when the user activates a foreign-key cell.
 * Structurally compatible with `NavigationTarget` from `useNavigationTargets`,
 * which opens the target table tab and locates the matching rows.
 */
export interface ForeignKeyNavigationTarget {
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
  whereInput: string;
}

// MySQL-family dialects treat backslash as an escape inside string literals;
// every other engine follows standard SQL where only '' needs doubling.
const BACKSLASH_ESCAPE_DATABASE_TYPES: ReadonlySet<DatabaseType> = new Set([
  "mysql",
  "doris",
  "starrocks",
  "goldendb",
  "sundb",
]);

export type ForeignKeyByColumn = Map<string, ForeignKeyInfo>;

/** Indexes foreign keys by local column name, case-insensitively; first FK wins. */
export function foreignKeyByColumnName(foreignKeys: readonly ForeignKeyInfo[]): ForeignKeyByColumn {
  const byColumn: ForeignKeyByColumn = new Map();
  for (const foreignKey of foreignKeys) {
    const key = foreignKey.column.toLowerCase();
    if (!key || byColumn.has(key)) continue;
    byColumn.set(key, foreignKey);
  }
  return byColumn;
}

export function foreignKeyForColumn(
  byColumn: ForeignKeyByColumn,
  columnName: string | undefined,
): ForeignKeyInfo | undefined {
  if (!columnName) return undefined;
  return byColumn.get(columnName.toLowerCase());
}

/**
 * Only non-null scalar cells can navigate: NULL has no value to locate, and
 * composite (JSON/array) values would produce a predicate no scalar key matches.
 */
export function isForeignKeyCellValueNavigable(value: GridCellValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" || typeof value === "boolean";
}

function escapeForeignKeyText(text: string, databaseType: DatabaseType | undefined): string {
  let escaped = text.replace(/'/g, "''");
  if (databaseType && BACKSLASH_ESCAPE_DATABASE_TYPES.has(databaseType)) {
    escaped = escaped.replace(/\\/g, "\\\\");
  }
  return escaped;
}

export function formatForeignKeyCellLiteral(value: string | number | boolean, databaseType?: DatabaseType): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const escaped = escapeForeignKeyText(value, databaseType);
  return databaseType === "sqlserver" ? `N'${escaped}'` : `'${escaped}'`;
}

export function buildForeignKeyWhereInput(options: {
  foreignKey: ForeignKeyInfo;
  value: GridCellValue | undefined;
  databaseType?: DatabaseType;
}): string | null {
  const { foreignKey, value, databaseType } = options;
  if (!foreignKey.ref_column || !foreignKey.ref_table) return null;
  if (!isForeignKeyCellValueNavigable(value)) return null;
  const column = quoteTableIdentifier(databaseType, foreignKey.ref_column);
  return `${column} = ${formatForeignKeyCellLiteral(value as string | number | boolean, databaseType)}`;
}

export function formatForeignKeyTargetLabel(foreignKey: ForeignKeyInfo): string {
  const schema = foreignKey.ref_schema?.trim();
  return schema
    ? `${schema}.${foreignKey.ref_table}.${foreignKey.ref_column}`
    : `${foreignKey.ref_table}.${foreignKey.ref_column}`;
}

/**
 * Builds the navigation target for a clicked FK cell: open the referenced
 * table (falling back to the current schema when the FK has no ref schema)
 * filtered to `ref_column = <cell value>`. Returns null when the cell cannot
 * navigate (missing metadata, NULL/composite value, unknown connection).
 */
export function buildForeignKeyNavigationTarget(options: {
  connectionId: string | undefined;
  database: string;
  schema?: string;
  databaseType?: DatabaseType;
  foreignKey: ForeignKeyInfo;
  value: GridCellValue | undefined;
}): ForeignKeyNavigationTarget | null {
  const { connectionId, database, schema, databaseType, foreignKey, value } = options;
  if (!connectionId) return null;
  const whereInput = buildForeignKeyWhereInput({ foreignKey, value, databaseType });
  if (!whereInput) return null;
  const refSchema = foreignKey.ref_schema?.trim();
  return {
    connectionId,
    database,
    schema: refSchema || schema?.trim() || undefined,
    tableName: foreignKey.ref_table,
    whereInput,
  };
}
