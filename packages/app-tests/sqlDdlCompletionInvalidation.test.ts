import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import { refreshMetadataAfterExecution } from "../../apps/desktop/src/composables/useSqlExecution.ts";
import type { ConnectionConfig } from "../../apps/desktop/src/types/database.ts";

// ---------------------------------------------------------------------------
// C4 fixtures. After the editor executes DDL successfully, the completion
// caches for that connection + database must be dropped so new objects are
// completable on the next request. DDL detection reuses sqlMetadataRefreshTarget
// (the classification that already drives the sidebar tree refresh), so these
// tests lock the whole contract: object DDL invalidates its database (and only
// it), database-level DDL invalidates the whole connection, SELECT/DML (and
// TRUNCATE — data-only per the classifier) never invalidate, comments are
// stripped before matching, and a failed execution never reaches the refresh
// path at all.
// ---------------------------------------------------------------------------

const CONN_ID = "conn-ddl";
const DATABASE = "shop";

// The "backend" listing per database, mutated mid-test to simulate the server
// learning about objects created or dropped by the executed SQL.
const listings: Record<string, string[]> = {};
const listTablesCalls: Record<string, number> = {};

function installMemoryStorage() {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis as any, "localStorage");
  };
}

function installTauriInvokeStub(router: (cmd: string, args: Record<string, unknown>) => Promise<unknown>) {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => router(cmd, args ?? {}),
    },
  };
  return () => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis as any, "window");
    else (globalThis as any).window = originalWindow;
  };
}

// Single-database engine (MySQL is not schema-aware): completions list under
// the database itself, one `list_tables` round trip per scope.
function conn(): ConnectionConfig {
  return {
    id: CONN_ID,
    name: "DDL",
    db_type: "mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "user",
    password: "",
  };
}

async function freshStore() {
  resetBackendFixtures();
  setActivePinia(createPinia());
  const store = useConnectionStore();
  store.addEphemeralConnection(conn());
  return store;
}

// The fixtures are module-level (the invoke stub closes over them); tests run
// sequentially in this file, so each freshStore resets them.
function resetBackendFixtures() {
  for (const key of Object.keys(listings)) delete listings[key];
  for (const key of Object.keys(listTablesCalls)) delete listTablesCalls[key];
}

async function completionNames(store: ReturnType<typeof useConnectionStore>, database: string) {
  const tables = await store.listCompletionTables(CONN_ID, database, "", undefined, undefined);
  return tables.map((table) => table.name);
}

function execute(
  store: ReturnType<typeof useConnectionStore>,
  sql: string,
  success: boolean,
  database = DATABASE,
) {
  return refreshMetadataAfterExecution(store, { connectionId: CONN_ID, database }, sql, success);
}

test("successful CREATE TABLE drops the database's completion cache so the new table is completable", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "list_tables") {
      const database = args.database as string;
      listTablesCalls[database] = (listTablesCalls[database] ?? 0) + 1;
      return (listings[database] ?? []).map((name) => ({ name, table_type: "BASE TABLE" }));
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const store = await freshStore();
    listings[DATABASE] = ["users"];
    listings.other = ["keep_me"];
    assert.deepEqual(await completionNames(store, DATABASE), ["users"]);
    assert.deepEqual(await completionNames(store, "other"), ["keep_me"]);
    assert.equal(listTablesCalls[DATABASE], 1);

    // The backend only learns the new table because the DDL ran.
    listings[DATABASE] = ["users", "audit_log"];
    await execute(store, "CREATE TABLE audit_log (id int)", true);

    assert.deepEqual(
      await completionNames(store, DATABASE),
      ["users", "audit_log"],
      "next completion request refetches and sees the new table",
    );
    assert.equal(listTablesCalls[DATABASE], 2, "the DDL dropped the cache, so one refetch happened");
    assert.deepEqual(await completionNames(store, "other"), ["keep_me"]);
    assert.equal(listTablesCalls.other, 1, "only the affected database is invalidated");
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("ALTER stays database-scoped while CREATE DATABASE invalidates the whole connection", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "list_tables") {
      const database = args.database as string;
      listTablesCalls[database] = (listTablesCalls[database] ?? 0) + 1;
      return (listings[database] ?? []).map((name) => ({ name, table_type: "BASE TABLE" }));
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const store = await freshStore();
    listings[DATABASE] = ["a"];
    listings.other = ["b"];
    await completionNames(store, DATABASE);
    await completionNames(store, "other");

    // Object DDL: one refetch of the affected database only.
    listings[DATABASE] = ["a_alt"];
    await execute(store, "ALTER TABLE a ADD COLUMN c int", true);
    assert.deepEqual(await completionNames(store, DATABASE), ["a_alt"]);
    assert.equal(listTablesCalls[DATABASE], 2);
    assert.equal(listTablesCalls.other, 1);

    // Database-level DDL: the database list itself changed — every scope of
    // this connection refetches.
    listings[DATABASE] = ["a2"];
    listings.other = ["b2"];
    await execute(store, "CREATE DATABASE reporting", true);
    assert.deepEqual(await completionNames(store, DATABASE), ["a2"]);
    assert.deepEqual(await completionNames(store, "other"), ["b2"]);
    assert.equal(listTablesCalls[DATABASE], 3, "connection-scoped DDL also drops this database");
    assert.equal(listTablesCalls.other, 2, "connection-scoped DDL also drops the other database");
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("SELECT/DML (and TRUNCATE) never invalidate the completion cache", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "list_tables") {
      const database = args.database as string;
      listTablesCalls[database] = (listTablesCalls[database] ?? 0) + 1;
      return (listings[database] ?? []).map((name) => ({ name, table_type: "BASE TABLE" }));
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const store = await freshStore();
    listings[DATABASE] = ["users"];
    await completionNames(store, DATABASE);
    listings[DATABASE] = ["users", "sneaky"];

    for (const sql of [
      "SELECT * FROM users",
      "INSERT INTO users VALUES (1)",
      "UPDATE users SET id = 1",
      "DELETE FROM users WHERE id = 1",
      // Data-only per sqlMetadataRefresh (no structural change to complete on).
      "TRUNCATE TABLE users",
      // Comments are stripped before DDL matching, so this must not trigger.
      "SELECT 1 -- CREATE TABLE sneaky",
    ]) {
      await execute(store, sql, true);
    }

    assert.equal(listTablesCalls[DATABASE], 1, "the cache survived every non-DDL statement");
    assert.deepEqual(await completionNames(store, DATABASE), ["users"]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("a failed execution never invalidates the completion cache", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "list_tables") {
      const database = args.database as string;
      listTablesCalls[database] = (listTablesCalls[database] ?? 0) + 1;
      return (listings[database] ?? []).map((name) => ({ name, table_type: "BASE TABLE" }));
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const store = await freshStore();
    listings[DATABASE] = ["users"];
    await completionNames(store, DATABASE);
    listings[DATABASE] = ["users", "not_created"];

    await execute(store, "CREATE TABLE not_created (id int)", false);

    assert.equal(listTablesCalls[DATABASE], 1, "failure means no invalidation and no refetch");
    assert.deepEqual(await completionNames(store, DATABASE), ["users"]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});
