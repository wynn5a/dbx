import assert from "node:assert/strict";
import { test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { buildSqlCompletionItems, recordCompletionSelection } from "../../apps/desktop/src/lib/sqlCompletion.ts";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import type { ConnectionConfig, TableInfo } from "../../apps/desktop/src/types/database.ts";

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

function postgresConnection(): ConnectionConfig {
  return {
    id: "conn-large",
    name: "Large Postgres",
    db_type: "postgres",
    host: "127.0.0.1",
    port: 5432,
    username: "postgres",
    password: "secret",
  };
}

function largeCatalogFixture(schemaCount = 120, tablesPerSchema = 25) {
  const schemas = Array.from({ length: schemaCount }, (_, index) => `schema_${String(index).padStart(3, "0")}`);
  const tablesBySchema = new Map<string, TableInfo[]>();
  for (const schema of schemas) {
    tablesBySchema.set(
      schema,
      Array.from({ length: tablesPerSchema }, (_, index) => ({
        name: `customer_event_${schema}_${String(index).padStart(3, "0")}`,
        table_type: index % 7 === 0 ? "VIEW" : "BASE TABLE",
      })),
    );
  }
  return { schemas, tablesBySchema };
}

test("large table catalogs produce bounded SQL completion items", () => {
  const tables = Array.from({ length: 2500 }, (_, index) => ({
    name: `customer_event_${String(index).padStart(4, "0")}`,
    schema: `schema_${index % 100}`,
    type: "table" as const,
  }));

  const items = buildSqlCompletionItems("select * from customer", "select * from customer".length, {
    tables,
    columnsByTable: new Map(),
    dialect: "postgres",
  });

  const tableItems = items.filter((item) => item.type === "table");
  assert.equal(tableItems.length, 200);
  assert.equal(tableItems[0].label, "customer_event_0000");
});

test("recently selected completion items receive a ranking boost", () => {
  const tables = [
    { name: "customer_accounts", schema: "public", type: "table" as const },
    { name: "customer_accounts_archive", schema: "public", type: "table" as const },
  ];

  const before = buildSqlCompletionItems("select * from customer_acc", "select * from customer_acc".length, {
    tables,
    columnsByTable: new Map(),
    dialect: "postgres",
  }).filter((item) => item.type === "table");
  assert.equal(before[0].label, "customer_accounts");

  recordCompletionSelection("customer_accounts_archive", "table");
  const after = buildSqlCompletionItems("select * from customer_acc", "select * from customer_acc".length, {
    tables,
    columnsByTable: new Map(),
    dialect: "postgres",
  }).filter((item) => item.type === "table");
  assert.equal(after[0].label, "customer_accounts_archive");
});

test("completion metadata refresh is deduplicated and local lookups rank the current schema first", async () => {
  const storage = installMemoryStorage();
  const { schemas, tablesBySchema } = largeCatalogFixture();
  let schemaCalls = 0;
  let tableCalls = 0;

  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        const invokeArgs = args ?? {};
        if (cmd === "list_schemas") {
          schemaCalls++;
          return schemas;
        }
        if (cmd === "list_tables") {
          tableCalls++;
          const schema = (invokeArgs.schema as string) ?? "";
          const filter = ((invokeArgs.filter as string) ?? "").toLowerCase();
          const limit = Number(invokeArgs.limit || 0) || undefined;
          const tables = (tablesBySchema.get(schema) ?? [])
            .filter((table) => !filter || table.name.toLowerCase().includes(filter))
            .slice(0, limit);
          return tables;
        }
        return null;
      },
    },
  };

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    store.addEphemeralConnection(postgresConnection());

    await Promise.all([
      store.refreshCompletionTables("conn-large", "app", "customer", 20, "schema_010"),
      store.refreshCompletionTables("conn-large", "app", "customer", 20, "schema_010"),
    ]);

    assert.equal(tableCalls, 1);
    assert.equal(schemaCalls, 0);

    await store.refreshCompletionTables("conn-large", "app", "customer", 20, "schema_011");
    const localTables = store.lookupLocalCompletionTables("conn-large", "app", "customer", 5, "schema_011");
    assert.equal(localTables.length, 5);
    assert.equal(localTables[0].schema, "schema_011");
  } finally {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis as any, "window");
    else (globalThis as any).window = originalWindow;
    storage.restore();
  }
});
