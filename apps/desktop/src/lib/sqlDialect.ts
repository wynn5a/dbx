// Single shared SQL-dialect mapping for the editor, completion, and the backend
// SQL analyzer. The alias table mirrors `normalize_dialect` in
// crates/dbx-core/src/sql_analysis.rs — the two tables MUST stay in sync.
// packages/app-tests/sqlDialect.test.ts hardcodes the Rust table and fails when
// either side drifts; a Rust unit test locks the same table from the other side.

export type SqlDialect = "mysql" | "postgres" | "sqlite" | "sqlserver" | "clickhouse" | "duckdb" | "oracle" | "generic";

// Mirrors `normalize_dialect` (crates/dbx-core/src/sql_analysis.rs). Covers the
// backend's own aliases (e.g. `postgresql`, `mariadb`, `mssql`) plus every
// `DatabaseType` so raw connection types can be passed through unchanged:
// PG-family engines (KingbaseES, Vastbase, KWDB) parse as postgres, MySQL-family
// engines (GoldenDB, Databend) as mysql, Oracle-family engines (DM8, YashanDB,
// OceanBase Oracle mode) as oracle, RQLite as sqlite. Everything else — engines
// with their own SQL or unknown JDBC drivers — stays generic instead of being
// mis-typed as mysql.
const SQL_DIALECT_ALIASES: Record<string, SqlDialect> = {
  postgres: "postgres",
  postgresql: "postgres",
  redshift: "postgres",
  opengauss: "postgres",
  gaussdb: "postgres",
  highgo: "postgres",
  kingbase: "postgres",
  vastbase: "postgres",
  kwdb: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  doris: "mysql",
  starrocks: "mysql",
  oceanbase: "mysql",
  goldendb: "mysql",
  databend: "mysql",
  sqlite: "sqlite",
  rqlite: "sqlite",
  sqlserver: "sqlserver",
  mssql: "sqlserver",
  clickhouse: "clickhouse",
  duckdb: "duckdb",
  oracle: "oracle",
  dameng: "oracle",
  "oceanbase-oracle": "oracle",
  yashandb: "oracle",
};

export function sqlDialectForDatabaseType(databaseType?: string | null): SqlDialect {
  if (!databaseType) return "generic";
  return SQL_DIALECT_ALIASES[databaseType.toLowerCase()] ?? "generic";
}

// DuckDB-only keywords for the CodeMirror editor dialect (SUMMARIZE, PIVOT,
// reader functions, …). They are meaningless — and previously wrong — on other
// engines, so the pack is enabled only for DuckDB connections.
const DUCKDB_EDITOR_KEYWORDS =
  "PIVOT UNPIVOT EXCLUDE REPLACE QUALIFY ASOF POSITIONAL ANTI SEMI SAMPLE TABLESAMPLE STRUCT MAP LIST ARRAY LAMBDA UNNEST LATERAL FILTER RECURSIVE SUMMARIZE PRAGMA READ_CSV READ_PARQUET READ_JSON DESCRIBE SHOW COPY EXPORT IMPORT";

export function duckdbEditorKeywords(databaseType?: string | null): string {
  return databaseType === "duckdb" ? DUCKDB_EDITOR_KEYWORDS : "";
}
