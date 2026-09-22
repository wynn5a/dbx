import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  duckdbEditorKeywords,
  sqlDialectForDatabaseType,
  type SqlDialect,
} from "../../apps/desktop/src/lib/sqlDialect.ts";

// Hardcoded copy of `normalize_dialect` (crates/dbx-core/src/sql_analysis.rs).
// The Rust side locks the same table with its own unit test; if either table
// drifts, one of the two tests fails. Update both together with the lib table.
const BACKEND_DIALECT_GROUPS: Record<string, SqlDialect> = {
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

test("frontend dialect mapping agrees with the backend normalize_dialect grouping", () => {
  for (const [alias, expected] of Object.entries(BACKEND_DIALECT_GROUPS)) {
    assert.equal(sqlDialectForDatabaseType(alias), expected, `alias ${alias}`);
  }
});

test("maps every DatabaseType with the shared backend grouping", () => {
  // Every member of the DatabaseType union (types/database.ts) and the dialect
  // the backend analyzer must use for it. Engine families: PG (KingbaseES,
  // Vastbase, KWDB), MySQL (GoldenDB, Databend), Oracle (DM8, YashanDB,
  // OceanBase Oracle mode), RQLite (SQLite); engines with their own SQL or
  // unknown JDBC drivers stay generic instead of being mis-typed as mysql.
  const expectedByDatabaseType: Record<string, SqlDialect> = {
    mysql: "mysql",
    postgres: "postgres",
    sqlite: "sqlite",
    rqlite: "sqlite",
    redis: "generic",
    duckdb: "duckdb",
    clickhouse: "clickhouse",
    sqlserver: "sqlserver",
    mongodb: "generic",
    oracle: "oracle",
    elasticsearch: "generic",
    doris: "mysql",
    starrocks: "mysql",
    databend: "mysql",
    redshift: "postgres",
    dameng: "oracle",
    gaussdb: "postgres",
    kingbase: "postgres",
    highgo: "postgres",
    vastbase: "postgres",
    goldendb: "mysql",
    kwdb: "postgres",
    yashandb: "oracle",
    databricks: "generic",
    saphana: "generic",
    teradata: "generic",
    vertica: "generic",
    firebird: "generic",
    exasol: "generic",
    opengauss: "postgres",
    "oceanbase-oracle": "oracle",
    gbase: "generic",
    access: "generic",
    h2: "generic",
    snowflake: "generic",
    trino: "generic",
    hive: "generic",
    db2: "generic",
    informix: "generic",
    neo4j: "generic",
    cassandra: "generic",
    bigquery: "generic",
    kylin: "generic",
    sundb: "generic",
    tdengine: "generic",
    xugu: "generic",
    iotdb: "generic",
    etcd: "generic",
    iris: "generic",
    jdbc: "generic",
  };

  for (const [databaseType, expected] of Object.entries(expectedByDatabaseType)) {
    const backendGrouping = BACKEND_DIALECT_GROUPS[databaseType];
    if (expected === "generic") {
      // Generic-family engines may stay off the backend alias table (its
      // default arm covers them) but must never hold a family alias.
      assert.ok(
        backendGrouping === undefined || backendGrouping === "generic",
        `backend grouping for ${databaseType} should be generic, got ${backendGrouping}`,
      );
    } else {
      // A DatabaseType missing from the backend table would silently degrade
      // to a generic parse — keep the Rust grouping in sync when engines that
      // belong to a family are added.
      assert.equal(backendGrouping, expected, `backend grouping is missing ${databaseType}`);
    }
    assert.equal(sqlDialectForDatabaseType(databaseType), expected, `database type ${databaseType}`);
  }
});

test("falls back to the generic dialect like the backend, case-insensitively", () => {
  assert.equal(sqlDialectForDatabaseType(undefined), "generic");
  assert.equal(sqlDialectForDatabaseType(null), "generic");
  assert.equal(sqlDialectForDatabaseType(""), "generic");
  assert.equal(sqlDialectForDatabaseType("some-future-engine"), "generic");
  assert.equal(sqlDialectForDatabaseType("Postgres"), "postgres");
  assert.equal(sqlDialectForDatabaseType("OCEANBASE-ORACLE"), "oracle");
});

test("enables the DuckDB editor keyword pack only for DuckDB connections", () => {
  const duckdb = duckdbEditorKeywords("duckdb");
  for (const keyword of ["SUMMARIZE", "PIVOT", "QUALIFY", "READ_CSV", "LAMBDA"]) {
    assert.ok(duckdb.includes(keyword), `DuckDB keyword pack should contain ${keyword}`);
  }

  // Other engines — notably MySQL — must not receive DuckDB-only keywords.
  for (const databaseType of [undefined, null, "", "mysql", "postgres", "sqlite", "clickhouse", "oracle"]) {
    assert.equal(duckdbEditorKeywords(databaseType), "", `keyword pack should be empty for ${databaseType}`);
  }
});
