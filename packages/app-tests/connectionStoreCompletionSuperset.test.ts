import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import type { ConnectionConfig, SidebarLayout } from "../../apps/desktop/src/types/database.ts";

// ---------------------------------------------------------------------------
// B2 fixtures. The store must cache one unfiltered (schema, capped) superset
// per scope and filter it client-side; keystroke filters may never change the
// cache key or re-invoke the backend (unless the superset was capped).
// ---------------------------------------------------------------------------

const PG_ID = "conn-pg";
const MY_ID = "conn-my";
const PG_DATABASE = "postgres";
const MY_DATABASE = "shop";

const PG_SCHEMAS = ["public", "sales"];

type FixtureTable = [name: string, tableType: string];

// Mixed-case names lock the case-insensitive `contains` semantics; the VIEW
// locks the table_type mapping.
const PG_TABLES: Record<string, FixtureTable[]> = {
  public: [
    ["UserAccounts", "BASE TABLE"],
    ["user_sessions", "BASE TABLE"],
    ["my_users", "BASE TABLE"],
    ["orders", "BASE TABLE"],
    ["active_users", "VIEW"],
  ],
  sales: [
    ["sales_users", "BASE TABLE"],
    ["targets", "BASE TABLE"],
  ],
};

// Single-database engine (MySQL is not schema-aware): completions list under
// the database itself.
const MY_TABLES: Record<string, FixtureTable[]> = {
  [MY_DATABASE]: [
    ["user_profiles", "BASE TABLE"],
    ["UserHistory", "BASE TABLE"],
    ["accounts", "BASE TABLE"],
    ["orders", "BASE TABLE"],
  ],
  // Four tables so a limit of 1 (expanded superset cap of 3) truncates the
  // superset and exercises the server-filter fallback.
  big: [
    ["alpha_user", "BASE TABLE"],
    ["beta_user", "BASE TABLE"],
    ["gamma", "BASE TABLE"],
    ["delta_user", "BASE TABLE"],
  ],
};

function conn(id: string, name: string, database: string, dbType: ConnectionConfig["db_type"]): ConnectionConfig {
  return {
    id,
    name,
    db_type: dbType,
    host: "127.0.0.1",
    port: dbType === "postgres" ? 5432 : 3306,
    username: "user",
    password: "secret",
    database,
  };
}

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
  return {
    restore() {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

type InvokeCounter = Record<string, number>;

/**
 * Stubs the Tauri invoke bridge with the real `list_tables` semantics:
 * case-insensitive contains on the name, listing order preserved, capped last.
 */
function installTauriInvokeStub(counter: InvokeCounter, connections: ConnectionConfig[]) {
  const layout: SidebarLayout = { groups: [], order: [] };
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        counter[cmd] = (counter[cmd] ?? 0) + 1;
        switch (cmd) {
          case "load_connections":
            return connections;
          case "load_sidebar_layout":
            return layout;
          case "save_sidebar_layout":
          case "save_connections":
          case "save_pinned_tree_node_ids":
          case "load_pinned_tree_node_ids":
          case "disconnect_db":
            return null;
          case "connect_db":
            return (args?.config as ConnectionConfig).id;
          case "list_schemas":
            return [...PG_SCHEMAS];
          case "list_completion_metadata": {
            const schemas = (args?.schemas as string[]) ?? [];
            return schemas.map((schema) => ({
              schema,
              tables: (PG_TABLES[schema] ?? []).map(([name, table_type]) => ({ name, table_type })),
              objects: [],
            }));
          }
          case "list_tables": {
            const schema = args?.schema as string;
            let tables = MY_TABLES[schema] ?? PG_TABLES[schema] ?? [];
            const filter = args?.filter as string | undefined;
            const limit = args?.limit as number | undefined;
            if (filter) tables = tables.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()));
            if (limit != null) tables = tables.slice(0, limit);
            return tables.map(([name, table_type]) => ({ name, table_type }));
          }
          default:
            return null;
        }
      },
    },
  };
  return () => {
    Reflect.deleteProperty(globalThis as any, "window");
  };
}

// The backend's per-schema listing semantics (`filter_table_infos`): lowercase
// contains, order preserved, capped last.
function serverTables(fixture: Record<string, FixtureTable[]>, schema: string, filter?: string, limit?: number) {
  let tables = fixture[schema] ?? [];
  if (filter) tables = tables.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()));
  if (limit != null) tables = tables.slice(0, limit);
  return tables.map(([name, table_type]) => ({ name, table_type }));
}

// The relaxed two-character retry (filters of 3+ chars retry with the first
// two) and the expanded cap, exactly as the store applies them.
function relaxedOf(filter?: string): string | undefined {
  if (!filter || filter.length < 3) return undefined;
  return filter.slice(0, 2);
}

function expandedOf(limit?: number): number | undefined {
  if (!limit) return limit;
  return Math.min(Math.max(limit * 3, limit), 1000);
}

/**
 * What repeating the server round-trip returns for one (filter, limit):
 * strict contains first, the relaxed two-character retry only on a zero-match
 * strict filter.
 */
function serverFiltered(
  fixture: Record<string, FixtureTable[]>,
  schema: string,
  filter?: string,
  limit?: number,
  withSchema?: string,
) {
  const toCompletion = (rows: ReturnType<typeof serverTables>) =>
    rows.map((row) => {
      const mapped: { name: string; type: "table" | "view"; schema?: string } = {
        name: row.name,
        type: row.table_type === "VIEW" ? "view" : "table",
      };
      if (withSchema) mapped.schema = withSchema;
      return mapped;
    });
  const strict = toCompletion(serverTables(fixture, schema, filter, limit));
  if (strict.length > 0) return strict;
  const relaxed = relaxedOf(filter);
  if (!relaxed) return strict;
  return toCompletion(serverTables(fixture, schema, relaxed, expandedOf(limit))).slice(0, limit);
}

async function freshStore(connections: ConnectionConfig[]) {
  setActivePinia(createPinia());
  const store = useConnectionStore();
  await store.initFromDisk();
  assert.equal(store.connections.length, connections.length);
  return store;
}

test("keystroke filters u/us/use share one backend listing (explicit schema)", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter, [conn(PG_ID, "PG Superset", PG_DATABASE, "postgres")]);
  try {
    const store = await freshStore([conn(PG_ID, "PG Superset", PG_DATABASE, "postgres")]);
    await store.refreshCompletionSchemas(PG_ID, PG_DATABASE);

    for (const filter of ["u", "us", "use"]) {
      const tables = await store.listCompletionTables(PG_ID, PG_DATABASE, filter, 200, "public");
      assert.deepEqual(tables, serverFiltered(PG_TABLES, "public", filter, 200, "public"));
    }
    assert.equal(counter.list_tables, 1, "u/us/use must be answered from one unfiltered listing");

    // Reversed order, repeats, and clearing the filter stay invoke-free too.
    for (const filter of ["use", "us", "u", ""]) {
      const tables = await store.listCompletionTables(PG_ID, PG_DATABASE, filter, 200, "public");
      assert.deepEqual(tables, serverFiltered(PG_TABLES, "public", filter || undefined, 200, "public"));
    }
    assert.equal(counter.list_tables, 1, "no filter may re-invoke the backend");

    // A second schema is one more listing, and then its keystrokes are free.
    await store.listCompletionTables(PG_ID, PG_DATABASE, "u", 200, "sales");
    assert.equal(counter.list_tables, 2);
    await store.listCompletionTables(PG_ID, PG_DATABASE, "us", 200, "sales");
    assert.equal(counter.list_tables, 2);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("keystroke filters u/us/use share one backend listing (single-database engine)", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter, [conn(MY_ID, "MY Superset", MY_DATABASE, "mysql")]);
  try {
    const store = await freshStore([conn(MY_ID, "MY Superset", MY_DATABASE, "mysql")]);

    for (const filter of ["u", "us", "use"]) {
      const tables = await store.listCompletionTables(MY_ID, MY_DATABASE, filter, 200);
      assert.deepEqual(tables, serverFiltered(MY_TABLES, MY_DATABASE, filter, 200));
    }
    assert.equal(counter.list_tables, 1, "u/us/use must be answered from one unfiltered listing");

    for (const filter of ["use", "u", ""]) {
      const tables = await store.listCompletionTables(MY_ID, MY_DATABASE, filter, 200);
      assert.deepEqual(tables, serverFiltered(MY_TABLES, MY_DATABASE, filter || undefined, 200));
    }
    assert.equal(counter.list_tables, 1);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("client-side filtering equals the server-side filter across filters and limits", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter, [conn(PG_ID, "PG Superset", PG_DATABASE, "postgres")]);
  try {
    const store = await freshStore([conn(PG_ID, "PG Superset", PG_DATABASE, "postgres")]);
    await store.refreshCompletionSchemas(PG_ID, PG_DATABASE);

    // Mixed-case and uppercase filters lock case-insensitivity; "xyz123"
    // locks the relaxed two-character retry (no "xy" match either).
    for (const filter of ["", "user", "User", "USER", "s", "orders", "xyz123"]) {
      for (const limit of [undefined, 200, 2]) {
        const tables = await store.listCompletionTables(PG_ID, PG_DATABASE, filter, limit, "public");
        assert.deepEqual(
          tables,
          serverFiltered(PG_TABLES, "public", filter || undefined, limit, "public"),
          `filter=${JSON.stringify(filter)} limit=${limit}`,
        );
      }
    }
    // Distinct caps (undefined / 200→600 / 2→6) cost one listing each; the
    // twenty-one filters above cost nothing.
    assert.equal(counter.list_tables, 3);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("a capped superset falls back to the server filter and still matches it", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter, [conn(MY_ID, "MY Superset", "big", "mysql")]);
  try {
    const store = await freshStore([conn(MY_ID, "MY Superset", "big", "mysql")]);

    // Four tables, limit 1 → superset cap 3: the listing is truncated.
    // No typed filter: the capped superset itself is the unfiltered listing.
    const top1 = await store.listCompletionTables(MY_ID, "big", "", 1);
    assert.deepEqual(top1, serverFiltered(MY_TABLES, "big", undefined, 1));
    assert.equal(counter.list_tables, 1, "no filter never repeats a server-side filter");

    // A match beyond the cap must come from the server-side filter.
    const delta = await store.listCompletionTables(MY_ID, "big", "delta", 1);
    assert.deepEqual(delta, serverFiltered(MY_TABLES, "big", "delta", 1));
    assert.equal(counter.list_tables, 2, "capped superset + typed filter repeats the server-side filter");

    // Zero strict matches retry with the relaxed two-character filter: two
    // round trips (the missed strict query, then the relaxed one).
    const alphx = await store.listCompletionTables(MY_ID, "big", "alphx", 1);
    assert.deepEqual(alphx, serverFiltered(MY_TABLES, "big", "alphx", 1));
    assert.deepEqual(alphx, [{ name: "alpha_user", type: "table" }]);
    assert.equal(counter.list_tables, 4);

    // Capped schemas repeat the server-side filter per new filter, exactly
    // like before B2 — correctness beats caching once the superset is capped.
    const beta = await store.listCompletionTables(MY_ID, "big", "beta", 1);
    assert.deepEqual(beta, serverFiltered(MY_TABLES, "big", "beta", 1));
    assert.equal(counter.list_tables, 5);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("cache entries do not grow with keystrokes and invalidate with the connection", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter, [conn(PG_ID, "PG Superset", PG_DATABASE, "postgres")]);
  try {
    const store = await freshStore([conn(PG_ID, "PG Superset", PG_DATABASE, "postgres")]);
    await store.refreshCompletionSchemas(PG_ID, PG_DATABASE);
    await store.listCompletionTables(PG_ID, PG_DATABASE);
    assert.equal(counter.list_completion_metadata, 1);

    // Twenty-five distinct filters on the bulk path and on a pinned schema —
    // every one served from the cached superset, none re-invoke anything.
    for (let i = 0; i < 25; i++) {
      await store.listCompletionTables(PG_ID, PG_DATABASE, `f${i}x`, 200);
      await store.listCompletionTables(PG_ID, PG_DATABASE, `f${i}`, 200, "public");
    }
    assert.equal(counter.list_completion_metadata, 1, "bulk metadata stays the single invoke");
    assert.equal(counter.list_tables, 1, "pinned-schema filters share one unfiltered listing");

    // Re-running the very first filter of the sequence is still invoke-free.
    await store.listCompletionTables(PG_ID, PG_DATABASE, "u", 200, "public");
    assert.equal(counter.list_tables, 1);

    // The superset cache participates in completion invalidation.
    const config = store.connections.find((c) => c.id === PG_ID);
    assert.ok(config);
    await store.updateConnection({ ...config });
    await store.listCompletionTables(PG_ID, PG_DATABASE, "u", 200, "public");
    assert.equal(counter.list_tables, 2, "invalidation clears the superset so it refetches once");
  } finally {
    restoreTauri();
    storage.restore();
  }
});
