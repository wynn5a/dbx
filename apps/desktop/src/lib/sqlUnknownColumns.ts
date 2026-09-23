import type { SqlColumnReference, SqlReferenceAnalysis, SqlTableReference } from "@/types/database";
import type { SqlSemanticDiagnostic } from "@/lib/sqlSemanticDiagnostics";

/**
 * Confidence-gated "unknown column" diagnostics.
 *
 * The editor's schema view is incomplete by design (partial listings, aliases,
 * computed columns, cross-schema references), so an unknown-column warning is
 * only safe when every table the SQL touches is fully known:
 *
 * 1. Each table reference resolves to exactly one table in the loaded schema
 *    listing (a name matching zero or several tables drops the whole batch).
 * 2. That table's full column list is loaded — a partial cache never warns.
 * 3. Identifiers that are visible in scope but are not schema columns (CTE
 *    names, select-list aliases, table-alias column lists) are never flagged.
 *
 * Any failed check yields zero diagnostics for the whole statement: the gate
 * is global, so other diagnostics (parser errors) are unaffected but a schema
 * the editor cannot vouch for never produces a false warning.
 */

/** Verdict for one table reference against the loaded schema. */
export type SqlTableResolution =
  | { status: "resolved"; schema?: string; columns: string[] }
  | { status: "ambiguous" }
  | { status: "unresolved" };

export function tableRefKey(table: { name: string; schema?: string | null }): string {
  return `${(table.schema ?? "").toLowerCase()}\u0000${table.name.toLowerCase()}`;
}

export interface SqlUnknownColumnConfidence {
  tables: SqlTableReference[];
  columns: SqlColumnReference[];
  /** Resolution verdict per table reference, keyed by tableRefKey. */
  resolutions: Map<string, SqlTableResolution>;
  /** CTE names defined by the statement — they shadow schema tables. */
  cteNames?: readonly string[];
  /** Identifiers visible in scope that are not schema columns (select-list
   *  aliases, table-alias column lists). Matched case-insensitively. */
  scopeAliases?: readonly string[];
  /** FROM sources whose output columns are unknown (table functions / UNNEST
   *  without a column list). While any is present, unqualified names are
   *  not attributable: they may be one of its columns or the source itself. */
  opaqueSources?: readonly string[];
  /** Other in-scope relation names (derived-table aliases). An unqualified
   *  identifier equal to one is a whole-row reference, not a column. */
  relationNames?: readonly string[];
  formatMessage?: (column: string, table: string) => string;
}

export interface SqlUnknownColumnContext {
  cteNames?: readonly string[];
  resolveTable: (tableRef: { name: string; schema?: string | null }) => Promise<SqlTableResolution>;
  formatMessage?: (column: string, table: string) => string;
}

// The sync decision core. Given per-reference resolutions, decides which
// column references can be flagged — and when nothing can.
export function gateUnknownColumnDiagnostics(confidence: SqlUnknownColumnConfidence): SqlSemanticDiagnostic[] {
  const tables = confidence.tables;
  const columns = confidence.columns;
  const formatMessage = confidence.formatMessage ?? defaultFormatMessage;
  if (tables.length === 0 || columns.length === 0) return [];

  const cteNames = lowercaseSet(confidence.cteNames);
  const scopeAliases = lowercaseSet(confidence.scopeAliases);
  const hasOpaqueSource = (confidence.opaqueSources ?? []).length > 0;
  // A table alias/name (or other relation) used as a value — PG
  // `row_to_json(u)`, `json_agg(t)`, `SELECT u FROM users u` — is a whole-row
  // reference, never a column of that table.
  const relationNames = lowercaseSet([
    ...tables.flatMap((table) => (table.alias ? [table.alias, table.name] : [table.name])),
    ...(confidence.relationNames ?? []),
    ...(confidence.opaqueSources ?? []),
    ...(confidence.cteNames ?? []),
  ]);

  for (const table of tables) {
    // A CTE shadows any same-named schema table; the reference the SQL actually
    // sees is the CTE, not the table the schema knows.
    if (cteNames.has(table.name.toLowerCase())) return [];
    const resolution = confidence.resolutions.get(tableRefKey(table));
    if (!resolution || resolution.status !== "resolved") return [];
  }

  const diagnostics: SqlSemanticDiagnostic[] = [];
  for (const column of columns) {
    if (scopeAliases.has(column.name.toLowerCase())) continue;
    let ref: SqlTableReference | undefined;
    if (column.qualifier) {
      const qualifier = column.qualifier.toLowerCase();
      const matches = tables.filter(
        (table) => table.alias?.toLowerCase() === qualifier || table.name.toLowerCase() === qualifier,
      );
      // Zero matches (derived tables, CTE outputs, schema-qualified four-part
      // names) or several (duplicate aliases across scopes) are not attributable.
      if (matches.length !== 1) continue;
      ref = matches[0];
    } else {
      // Unqualified columns are attributable only in single-table statements:
      // joins, subqueries and multi-statement scripts scope them in ways the
      // flat reference list cannot see. A table function without a column
      // list is an extra source the table list does not show.
      if (tables.length !== 1 || hasOpaqueSource) continue;
      if (relationNames.has(column.name.toLowerCase())) continue;
      ref = tables[0];
    }
    if (!ref) continue;
    const resolution = confidence.resolutions.get(tableRefKey(ref));
    if (!resolution || resolution.status !== "resolved") continue;
    const lowered = column.name.toLowerCase();
    if (resolution.columns.some((name) => name.toLowerCase() === lowered)) continue;
    diagnostics.push({
      span: column.span,
      message: formatMessage(column.name, tableDisplayName(ref)),
      severity: "warning",
    });
  }
  return diagnostics;
}

export async function buildUnknownColumnDiagnostics(
  analysis: SqlReferenceAnalysis,
  context: SqlUnknownColumnContext,
): Promise<SqlSemanticDiagnostic[]> {
  const tables = analysis.tables ?? [];
  const columns = analysis.columns ?? [];
  if (tables.length === 0 || columns.length === 0) return [];

  // Resolve each distinct table reference once; a failing resolver (backend
  // error for a table that does not exist, IPC hiccup) means "cannot vouch".
  const resolutions = new Map<string, SqlTableResolution>();
  for (const table of tables) {
    const key = tableRefKey(table);
    if (resolutions.has(key)) continue;
    let resolution: SqlTableResolution;
    try {
      resolution = await context.resolveTable({ name: table.name, schema: table.schema });
    } catch {
      resolution = { status: "unresolved" };
    }
    resolutions.set(key, resolution);
  }

  return gateUnknownColumnDiagnostics({
    tables,
    columns,
    resolutions,
    cteNames: context.cteNames,
    scopeAliases: [...(analysis.select_aliases ?? []), ...(analysis.alias_columns ?? [])],
    opaqueSources: analysis.opaque_sources ?? [],
    relationNames: (analysis.derived_tables ?? []).map((derived) => derived.alias),
    formatMessage: context.formatMessage,
  });
}

function tableDisplayName(table: SqlTableReference): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

function defaultFormatMessage(column: string, table: string): string {
  return `Unknown column "${column}" in "${table}"`;
}

function lowercaseSet(values?: readonly string[]): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}
