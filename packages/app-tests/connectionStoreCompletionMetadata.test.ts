import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import type { ConnectionConfig, SidebarLayout } from "../../apps/desktop/src/types/database.ts";

// ---------------------------------------------------------------------------
// B1 fixtures: a schema-aware (postgres) connection with three schemas.
// ---------------------------------------------------------------------------

const CONNECTION_ID = "conn-pg";
const DATABASE = "postgres";

const SCHEMAS = ["public", "sales", "reporting"];

type FixtureTable = [name: string, tableType: string];

const TABLES: Record<string, FixtureTable[]> = {
  public: [
    ["accounts", "BASE TABLE"],
    ["orders", "BASE TABLE"],
    ["user_sessions", "BASE TABLE"],
    ["users", "BASE TABLE"],
    ["active_users", "VIEW"],
  ],
  sales: [
    ["sales_users", "BASE TABLE"],
    ["targets", "BASE TABLE"],
  ],
  reporting: [["report_users", "BASE TABLE"]],
};

const OBJECTS: Record<string, Array<{ name: string; object_type: string; schema: string }>> = {
  public: [{ name: "get_user", object_type: "FUNCTION", schema: "public" }],
  sales: [],
  reporting: [{ name: "monthly_rollup", object_type: "PROCEDURE", schema: "reporting" }],
};

function conn(id: string, name: string): ConnectionConfig {
  return {
    id,
    name,
    db_type: "postgres",
    host: "127.0.0.1",
    port: 5432,
    username: "postgres",
    password: "secret",
    database: DATABASE,
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

interface RouterOptions {
  bulkFailure?: boolean;
}

/**
 * Stubs the Tauri invoke bridge and records how many times each command runs,
 * so the tests can assert the completion metadata load costs exactly one
 * `list_completion_metadata` invoke (improvement-plan B1 acceptance).
 */
function installTauriInvokeStub(counter: InvokeCounter, options: RouterOptions = {}) {
  const layout: SidebarLayout = { groups: [], order: [] };
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        counter[cmd] = (counter[cmd] ?? 0) + 1;
        switch (cmd) {
          case "load_connections":
            return [conn(CONNECTION_ID, "PG Bulk Meta")];
          case "load_sidebar_layout":
            return layout;
          case "save_sidebar_layout":
          case "save_connections":
          case "save_pinned_tree_node_ids":
          case "load_pinned_tree_node_ids":
            return null;
          case "connect_db":
            return (args?.config as ConnectionConfig).id;
          case "list_schemas":
            return [...SCHEMAS];
          case "list_completion_metadata": {
            if (options.bulkFailure) throw new Error("bulk listing unavailable");
            const schemas = (args?.schemas as string[]) ?? [];
            assert.deepEqual(schemas, SCHEMAS, "bulk invoke must request every schema once");
            return schemas.map((schema) => ({
              schema,
              tables: TABLES[schema].map(([name, table_type]) => ({ name, table_type })),
              objects: OBJECTS[schema].map((object) => ({ ...object })),
            }));
          }
          case "list_tables": {
            const schema = args?.schema as string;
            let tables = TABLES[schema] ?? [];
            const filter = args?.filter as string | undefined;
            const limit = args?.limit as number | undefined;
            if (filter) tables = tables.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()));
            if (limit != null) tables = tables.slice(0, limit);
            return tables.map(([name, table_type]) => ({ name, table_type }));
          }
          case "list_completion_objects": {
            const schema = args?.schema as string;
            return (OBJECTS[schema] ?? []).map((object) => ({ ...object }));
          }
          default:
            return null;
        }
      },
    },
  };
  return () => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis as any, "window");
    else (globalThis as any).window = originalWindow;
  };
}

// The per-schema `list_tables` server semantics (contains-filter, then limit),
// which the store's bulk path must reproduce exactly.
function serverTables(schema: string, filter?: string, limit?: number) {
  let tables = TABLES[schema] ?? [];
  if (filter) tables = tables.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()));
  if (limit != null) tables = tables.slice(0, limit);
  return tables.map(([name, table_type]) => ({
    name,
    schema,
    type: table_type === "VIEW" ? ("view" as const) : ("table" as const),
  }));
}

function expectedFromSchemas(select: (schema: string) => ReturnType<typeof serverTables>) {
  return SCHEMAS.flatMap(select);
}

async function freshStore() {
  setActivePinia(createPinia());
  const store = useConnectionStore();
  await store.initFromDisk();
  return store;
}

test("loading completion metadata for a multi-schema database costs one invoke", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter);
  try {
    const store = await freshStore();
    await store.refreshCompletionSchemas(CONNECTION_ID, DATABASE);

    const tables = await store.listCompletionTables(CONNECTION_ID, DATABASE);
    const objects = await store.listCompletionObjects(CONNECTION_ID, DATABASE);

    assert.equal(counter.list_completion_metadata, 1, "tables + routines must arrive in a single bulk invoke");
    assert.equal(counter.list_tables ?? 0, 0, "no per-schema list_tables fan-out");
    assert.equal(counter.list_completion_objects ?? 0, 0, "no per-schema list_completion_objects fan-out");

    assert.deepEqual(
      tables,
      expectedFromSchemas((schema) => serverTables(schema)),
    );
    assert.equal(objects.length, 2);
    assert.ok(objects.some((object) => object.name === "get_user" && object.schema === "public"));
    assert.ok(objects.some((object) => object.name === "monthly_rollup" && object.schema === "reporting"));
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("filtered and limited table lookups stay invoke-free and match per-schema server filtering", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter);
  try {
    const store = await freshStore();
    await store.refreshCompletionSchemas(CONNECTION_ID, DATABASE);
    await store.listCompletionTables(CONNECTION_ID, DATABASE);
    assert.equal(counter.list_completion_metadata, 1);

    // Strict filter with a cap: the store must return exactly what repeating
    // the per-schema `list_tables(conn, db, schema, "user", 2)` calls return.
    const filtered = await store.listCompletionTables(CONNECTION_ID, DATABASE, "user", 2);
    assert.deepEqual(
      filtered,
      expectedFromSchemas((schema) => serverTables(schema, "user", 2)).slice(0, 2),
    );
    assert.equal(counter.list_completion_metadata, 1, "the cached bulk metadata serves new filters");

    // Un-capped filter: every per-schema match, schema by schema.
    const allMatches = await store.listCompletionTables(CONNECTION_ID, DATABASE, "user");
    assert.deepEqual(
      allMatches,
      expectedFromSchemas((schema) => serverTables(schema, "user")),
    );

    // No strict match falls back to the relaxed two-character filter.
    const relaxed = await store.listCompletionTables(CONNECTION_ID, DATABASE, "usx", 3);
    assert.deepEqual(
      relaxed,
      expectedFromSchemas((schema) => serverTables(schema, "us", 3)).slice(0, 3),
    );
    assert.equal(counter.list_completion_metadata, 1, "relaxed retries never re-invoke either");
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("a failed bulk invoke falls back to the per-schema calls with identical results", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter, { bulkFailure: true });
  try {
    const store = await freshStore();
    await store.refreshCompletionSchemas(CONNECTION_ID, DATABASE);

    const tables = await store.listCompletionTables(CONNECTION_ID, DATABASE);
    assert.deepEqual(
      tables,
      expectedFromSchemas((schema) => serverTables(schema)),
    );
    assert.equal(counter.list_completion_metadata, 1, "the bulk attempt still happened once");
    assert.equal(counter.list_tables, SCHEMAS.length, "fallback repeats the per-schema table calls");
    assert.equal(
      counter.list_completion_objects,
      SCHEMAS.length,
      "the fallback pass fetches tables and routines together so the cache is complete",
    );

    const objects = await store.listCompletionObjects(CONNECTION_ID, DATABASE);
    assert.equal(objects.length, 2);
    assert.equal(counter.list_completion_objects, SCHEMAS.length, "objects are served from the fallback metadata");
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("an explicit schema keeps the single targeted list_tables call", async () => {
  const storage = installMemoryStorage();
  const counter: InvokeCounter = {};
  const restoreTauri = installTauriInvokeStub(counter);
  try {
    const store = await freshStore();
    await store.refreshCompletionSchemas(CONNECTION_ID, DATABASE);

    const tables = await store.listCompletionTables(CONNECTION_ID, DATABASE, "user", 2, "public");
    assert.deepEqual(tables, serverTables("public", "user", 2));
    assert.equal(counter.list_completion_metadata ?? 0, 0, "one schema must not pull the whole database");
    assert.equal(counter.list_tables, 1);

    const objects = await store.listCompletionObjects(CONNECTION_ID, DATABASE, "", undefined, "sales");
    assert.deepEqual(objects, []);
    assert.equal(counter.list_completion_objects, 1);
  } finally {
    restoreTauri();
    storage.restore();
  }
});
