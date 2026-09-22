import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  IDLE_TIMEOUT_SUPPORTED_TYPES,
  SCHEMA_AWARE_TYPES,
  TREE_SCHEMA_TYPES,
  databaseObjectTreeNodeSchema,
  databaseObjectTreeQuerySchema,
  getDatabaseCapability,
  sidebarObjectKindsForDatabase,
  supportsDatabaseCreation,
  supportsDatabaseSearch,
  supportsDriverManagement,
  supportsFieldLineage,
  supportsIdleTimeout,
  supportsObjectBrowser,
  supportsObjectBrowserTreeNode,
  supportsSchemaDiagram,
  supportsSqlFileExecution,
  supportsTableImport,
  supportsTableTruncate,
  supportsTableStructureEditing,
  supportsTransfer,
  usesDatabaseObjectTreeMode,
  usesPostgresLikeStructureCopy,
  usesTreeSchemaMode,
} from "../../apps/desktop/src/lib/databaseCapabilities.ts";
import en from "../../apps/desktop/src/i18n/locales/en.ts";
import es from "../../apps/desktop/src/i18n/locales/es.ts";
import it from "../../apps/desktop/src/i18n/locales/it.ts";
import ptBR from "../../apps/desktop/src/i18n/locales/pt-BR.ts";
import zhCN from "../../apps/desktop/src/i18n/locales/zh-CN.ts";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.ts";
import type { DatabaseType } from "../../apps/desktop/src/types/database.ts";

test("treats Trino catalogs as schema tree roots", () => {
  assert.equal(TREE_SCHEMA_TYPES.has("trino"), true);
});

test("treats DB2 databases as schema tree roots", () => {
  assert.equal(TREE_SCHEMA_TYPES.has("db2"), true);
  assert.equal(usesTreeSchemaMode("db2"), true);
});

test("treats TDengine databases as schema tree roots and agent driver databases", () => {
  assert.equal(TREE_SCHEMA_TYPES.has("tdengine"), true);
  assert.equal(SCHEMA_AWARE_TYPES.has("tdengine"), true);
  assert.equal(supportsDriverManagement("tdengine"), true);
});

test("treats XuguDB as a schema-aware agent driver database", () => {
  assert.equal(TREE_SCHEMA_TYPES.has("xugu"), true);
  assert.equal(SCHEMA_AWARE_TYPES.has("xugu"), true);
  assert.equal(supportsDatabaseSearch("xugu"), true);
  assert.equal(supportsDriverManagement("xugu"), true);
});

test("treats IoTDB as a schema-aware agent driver database", () => {
  assert.equal(TREE_SCHEMA_TYPES.has("iotdb"), true);
  assert.equal(SCHEMA_AWARE_TYPES.has("iotdb"), true);
  assert.equal(supportsDatabaseSearch("iotdb"), true);
  assert.equal(supportsDriverManagement("iotdb"), true);
});

test("treats Access as a local single-database agent driver", () => {
  assert.equal(SCHEMA_AWARE_TYPES.has("access"), false);
  assert.equal(supportsDriverManagement("access"), true);
  assert.equal(supportsDatabaseSearch("access"), true);
  assert.equal(supportsTableImport("access"), true);
});

test("exposes the extended JDBC agent ecosystem through driver management", () => {
  for (const dbType of [
    "databricks",
    "saphana",
    "teradata",
    "vertica",
    "firebird",
    "exasol",
    "opengauss",
    "oceanbase-oracle",
    "gbase",
  ] as const) {
    assert.equal(supportsDriverManagement(dbType), true, `${dbType} should be agent-managed`);
    assert.equal(supportsDatabaseSearch(dbType), true, `${dbType} should support database search`);
  }

  assert.equal(SCHEMA_AWARE_TYPES.has("databricks"), true);
  assert.equal(SCHEMA_AWARE_TYPES.has("opengauss"), true);
  assert.equal(SCHEMA_AWARE_TYPES.has("oceanbase-oracle"), true);
  assert.equal(SCHEMA_AWARE_TYPES.has("firebird"), false);
});

test("describes schema tree mode through the capability helper", () => {
  assert.equal(usesTreeSchemaMode("trino"), true);
  assert.equal(usesTreeSchemaMode("h2"), true);
  assert.equal(usesTreeSchemaMode("mysql"), false);
  assert.equal(usesTreeSchemaMode(undefined), false);
});

test("generic JDBC database nodes list objects directly under catalogs", () => {
  assert.equal(TREE_SCHEMA_TYPES.has("jdbc"), true);
  assert.equal(usesDatabaseObjectTreeMode("jdbc"), true);
  assert.equal(databaseObjectTreeQuerySchema("jdbc", "test"), "");
  assert.equal(databaseObjectTreeNodeSchema("jdbc", "test"), undefined);
  assert.equal(databaseObjectTreeQuerySchema("jdbc", "test", "dataeye_starpony"), "");
  assert.equal(databaseObjectTreeNodeSchema("jdbc", "test", "dataeye_starpony"), undefined);
});

test("schema tree databases still use database nodes as default schema context", () => {
  assert.equal(usesDatabaseObjectTreeMode("postgres"), false);
  assert.equal(databaseObjectTreeQuerySchema("postgres", "app"), "app");
  assert.equal(databaseObjectTreeNodeSchema("postgres", "app"), "app");
});

test("treats Trino tables as schema-qualified SQL targets", () => {
  assert.equal(SCHEMA_AWARE_TYPES.has("trino"), true);
});

test("describes table editing capabilities for special database engines", () => {
  assert.deepEqual(getDatabaseCapability("hive").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: true,
    transaction: false,
  });

  assert.deepEqual(getDatabaseCapability("dameng").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });

  assert.deepEqual(getDatabaseCapability("trino").tableData, {
    insert: true,
    updateRequiresPrimaryKey: true,
    deleteRequiresPrimaryKey: true,
    keylessRowPredicate: false,
    requiresTransactionalTableForExistingRows: false,
    transaction: false,
  });

  assert.deepEqual(getDatabaseCapability("jdbc").tableData, {
    insert: false,
    updateRequiresPrimaryKey: true,
    deleteRequiresPrimaryKey: true,
    keylessRowPredicate: false,
    requiresTransactionalTableForExistingRows: false,
    transaction: false,
  });

  assert.deepEqual(getDatabaseCapability("yashandb").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });

  assert.equal(getDatabaseCapability("oracle").syntheticKey, "oracle-rowid");
  assert.equal(getDatabaseCapability("neo4j").syntheticKey, "neo4j-element-id");
});

test("uses Navicat-style table editing defaults for updateable SQL table engines", () => {
  assert.deepEqual(getDatabaseCapability("postgres").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });
  assert.deepEqual(getDatabaseCapability("mysql").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });
  assert.deepEqual(getDatabaseCapability("sqlite").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });
  assert.deepEqual(getDatabaseCapability("rqlite").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });
  assert.deepEqual(getDatabaseCapability("kwdb").tableData, {
    insert: true,
    updateRequiresPrimaryKey: false,
    deleteRequiresPrimaryKey: false,
    keylessRowPredicate: true,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });
});

test("keeps conservative table editing defaults for unknown database types", () => {
  assert.deepEqual(getDatabaseCapability(undefined).tableData, {
    insert: false,
    updateRequiresPrimaryKey: true,
    deleteRequiresPrimaryKey: true,
    keylessRowPredicate: false,
    requiresTransactionalTableForExistingRows: false,
    transaction: true,
  });
});

test("describes feature support through capability helpers", () => {
  assert.equal(supportsSqlFileExecution("mysql"), true);
  assert.equal(supportsSqlFileExecution("redis"), false);
  assert.equal(supportsSchemaDiagram("oracle"), true);
  assert.equal(supportsSchemaDiagram("trino"), false);
  assert.equal(supportsDatabaseSearch("neo4j"), true);
  assert.equal(supportsDatabaseSearch("redis"), false);
  assert.equal(supportsTableImport("duckdb"), true);
  assert.equal(supportsTableImport("hive"), false);
  assert.equal(supportsTableStructureEditing("postgres"), true);
  assert.equal(supportsTableStructureEditing("duckdb"), true);
  assert.equal(supportsTableStructureEditing("oracle"), true);
  assert.equal(supportsTableStructureEditing("dameng"), true);
  assert.equal(supportsTableStructureEditing("gaussdb"), true);
  assert.equal(supportsTableStructureEditing("kwdb"), true);
  assert.equal(supportsTableStructureEditing("opengauss"), true);
  assert.equal(supportsTableStructureEditing("redshift"), true);
  assert.equal(supportsTableStructureEditing("clickhouse"), true);
  assert.equal(supportsTableStructureEditing("rqlite"), true);
  assert.equal(supportsTableStructureEditing("mongodb"), false);
  assert.equal(supportsDatabaseCreation("clickhouse"), true);
  assert.equal(supportsDatabaseCreation("sqlite"), false);
  assert.equal(supportsFieldLineage("gaussdb"), true);
  assert.equal(supportsFieldLineage("kwdb"), true);
  assert.equal(supportsFieldLineage("trino"), false);
  assert.equal(supportsTransfer("duckdb"), true);
  assert.equal(supportsTransfer("hive"), true);
  assert.equal(supportsTransfer("mongodb"), true);
  assert.equal(supportsDriverManagement("oracle"), true);
  assert.equal(supportsDriverManagement("mysql"), false);
  assert.equal(supportsDriverManagement("kwdb"), false);
  assert.equal(usesPostgresLikeStructureCopy("gaussdb"), true);
  assert.equal(usesPostgresLikeStructureCopy("kwdb"), true);
  assert.equal(usesPostgresLikeStructureCopy("mysql"), false);
  assert.equal(supportsObjectBrowser("mysql"), true);
  assert.equal(supportsObjectBrowser("mongodb"), false);
  assert.equal(supportsTableTruncate("mysql"), true);
  assert.equal(supportsTableTruncate("duckdb"), false);
  assert.equal(supportsTableTruncate("rqlite"), false);
});

test("object browser entry follows database tree shape", () => {
  assert.equal(supportsObjectBrowserTreeNode("postgres", "database"), false);
  assert.equal(supportsObjectBrowserTreeNode("postgres", "schema"), true);
  assert.equal(supportsObjectBrowserTreeNode("sqlserver", "database"), true);
  assert.equal(supportsObjectBrowserTreeNode("sqlserver", "schema"), true);
  assert.equal(supportsObjectBrowserTreeNode("mysql", "database"), true);
  assert.equal(supportsObjectBrowserTreeNode("jdbc", "database"), true);
  assert.equal(supportsObjectBrowserTreeNode("mongodb", "database"), false);
});

test("sidebar object capability registry describes object groups by database type", () => {
  assert.deepEqual(sidebarObjectKindsForDatabase("databend"), ["TABLE", "VIEW"]);
  assert.deepEqual(sidebarObjectKindsForDatabase("postgres"), ["TABLE", "VIEW", "PROCEDURE", "FUNCTION", "SEQUENCE"]);
  assert.deepEqual(sidebarObjectKindsForDatabase("oracle"), [
    "TABLE",
    "VIEW",
    "PROCEDURE",
    "FUNCTION",
    "PACKAGE",
    "PACKAGE_BODY",
  ]);
});

// ---------------------------------------------------------------------------
// T29 idle-timeout honesty (improvement-plan-2026-09 §2 A7): the connection
// dialog only offers `idle_timeout_secs` for engines whose backend pool really
// consumes it. The backend audit lives on IDLE_TIMEOUT_SUPPORTED_TYPES; the
// source contracts below keep this list aligned with the Rust consumers.
// ---------------------------------------------------------------------------

test("idle_timeout is supported by MongoDB only, across the whole DatabaseType union", () => {
  assert.deepEqual([...IDLE_TIMEOUT_SUPPORTED_TYPES], ["mongodb"]);

  // Parse the union out of types/database.ts so a newly added engine must be
  // consciously classified here (test fails until the list above is revisited).
  const typesSource = readFileSync(new URL("../../apps/desktop/src/types/database.ts", import.meta.url), "utf8");
  const unionBlock = typesSource.match(/export type DatabaseType =([\s\S]*?);/);
  assert.ok(unionBlock, "DatabaseType union found in types/database.ts");
  const allTypes = [...unionBlock[1].matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
  assert.ok(allTypes.length >= 50, `DatabaseType union fully parsed (${allTypes.length} members)`);

  for (const dbType of allTypes) {
    assert.equal(supportsIdleTimeout(dbType as DatabaseType), dbType === "mongodb", `supportsIdleTimeout(${dbType})`);
  }

  // Spot-check the engines called out by the plan plus representative others.
  assert.equal(supportsIdleTimeout("mongodb"), true);
  assert.equal(supportsIdleTimeout(undefined), false);
});

test("idle_timeout support list agrees with the backend consumers (source contract)", () => {
  // dbx-core get_or_create_pool: the binding is defined once and passed to
  // exactly one driver — the native Mongo client.
  const connectionRs = readFileSync(new URL("../../crates/dbx-core/src/connection.rs", import.meta.url), "utf8");
  assert.equal(
    connectionRs.match(/idle_timeout\b/g)?.length,
    2,
    "connection.rs: idle_timeout binding + its single consumer",
  );
  assert.ok(
    connectionRs.includes("db::mongo_driver::connect(&url, connect_timeout, idle_timeout)"),
    "connection.rs: only the MongoDb branch receives idle_timeout",
  );

  // Desktop-shell copies of the pool builder (test/probe connections) — same shape.
  const tauriConnectionRs = readFileSync(
    new URL("../../src-tauri/src/commands/connection.rs", import.meta.url),
    "utf8",
  );
  assert.equal(tauriConnectionRs.match(/idle_timeout\b/g)?.length, 4, "two bindings + two Mongo consumers");
  assert.equal(
    tauriConnectionRs.match(/db::mongo_driver::connect\(&url, connect_timeout, idle_timeout\)/g)?.length,
    2,
    "src-tauri: both idle_timeout consumers are the Mongo connect",
  );

  // The Mongo driver genuinely consumes it (ClientOptions::max_idle_time).
  const mongoDriverRs = readFileSync(new URL("../../crates/dbx-core/src/db/mongo_driver.rs", import.meta.url), "utf8");
  assert.ok(mongoDriverRs.includes("max_idle_time = Some(idle_timeout)"), "mongo maps idle_timeout to max_idle_time");

  // Engines that ignore the setting — the reason they stay on the hidden list.
  const mysqlRs = readFileSync(new URL("../../crates/dbx-core/src/db/mysql.rs", import.meta.url), "utf8");
  assert.ok(
    mysqlRs.includes("with_inactive_connection_ttl(Duration::from_secs(300))"),
    "mysql pool hardcodes its inactive TTL and ignores idle_timeout_secs",
  );
  const postgresRs = readFileSync(new URL("../../crates/dbx-core/src/db/postgres.rs", import.meta.url), "utf8");
  assert.equal(postgresRs.match(/idle_timeout\b/g)?.length ?? 0, 0, "postgres pool has no idle timeout wiring");
});

test("idle_timeout copy exists in all six locales", () => {
  const locales: Record<string, Record<string, unknown>> = {
    en: en as unknown as Record<string, unknown>,
    es: es as unknown as Record<string, unknown>,
    it: it as unknown as Record<string, unknown>,
    "pt-BR": ptBR as unknown as Record<string, unknown>,
    "zh-CN": zhCN as unknown as Record<string, unknown>,
    "zh-TW": zhTW as unknown as Record<string, unknown>,
  };
  for (const [locale, messages] of Object.entries(locales)) {
    const connection = messages.connection as Record<string, unknown> | undefined;
    assert.equal(typeof connection?.idleTimeout, "string", `${locale} is missing connection.idleTimeout`);
    assert.ok((connection?.idleTimeout as string).length > 0, `${locale} has empty copy for connection.idleTimeout`);
  }
});

test("connection dialog gates the idle_timeout field on supportsIdleTimeout (source contract)", () => {
  const dialog = readFileSync(
    new URL("../../apps/desktop/src/components/connection/ConnectionDialog.vue", import.meta.url),
    "utf8",
  );
  assert.ok(
    dialog.includes('v-show="supportsIdleTimeout(form.db_type)"'),
    "idle_timeout field visibility must come from the shared predicate",
  );
  assert.ok(dialog.includes('v-model="form.idle_timeout_secs"'), "idle_timeout field stays bound to the form");
  assert.ok(
    !dialog.includes(`v-show="form.db_type === 'mongodb'"`),
    "the inline mongodb-only gate is replaced by the shared predicate",
  );
  // Stored values survive for engines with the control hidden: the form load
  // and save normalization keep idle_timeout_secs regardless of engine.
  assert.ok(
    dialog.includes("idle_timeout_secs: config.idle_timeout_secs ?? 60"),
    "loading a saved connection preserves its stored idle_timeout_secs",
  );
});
