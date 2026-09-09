import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import type { ConnectionConfig } from "../../apps/desktop/src/types/database.ts";

function installMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
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
    values,
    restore() {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
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

function conn(id: string, name: string): ConnectionConfig {
  return {
    id,
    name,
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "",
  };
}

test("removeConnection prunes pinned ids and persists the pruned set", async () => {
  const storage = installMemoryStorage({
    "dbx-pinned-tree-nodes": JSON.stringify(["conn-a", "conn-a:db:main", "conn-b:db:main"]),
  });
  const savedPayloads: unknown[] = [];

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "load_connections") {
      return [conn("conn-a", "A"), conn("conn-b", "B")];
    }
    if (cmd === "load_sidebar_layout") {
      return null;
    }
    if (cmd === "save_sidebar_layout") {
      return null;
    }
    if (cmd === "save_connections") {
      savedPayloads.push(args);
      return null;
    }
    return [];
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    await store.initFromDisk();

    assert.equal(store.isTreeNodePinned("conn-a"), true);
    assert.equal(store.isTreeNodePinned("conn-a:db:main"), true);
    assert.equal(store.isTreeNodePinned("conn-b:db:main"), true);

    await store.removeConnection("conn-a");

    assert.equal(store.isTreeNodePinned("conn-a"), false);
    assert.equal(store.isTreeNodePinned("conn-a:db:main"), false);
    assert.equal(store.isTreeNodePinned("conn-b:db:main"), true);
    assert.deepEqual(JSON.parse(storage.values.get("dbx-pinned-tree-nodes") || "[]"), ["conn-b:db:main"]);
    assert.equal(savedPayloads.length >= 1, true);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

