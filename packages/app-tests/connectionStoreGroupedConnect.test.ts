import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import type { ConnectionConfig, SidebarLayout, TreeNode } from "../../apps/desktop/src/types/database.ts";

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
    db_type: "mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: "secret",
  };
}

function countConnectionNodes(nodes: TreeNode[], connectionId: string): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === "connection" && node.connectionId === connectionId) count++;
    if (node.children) count += countConnectionNodes(node.children, connectionId);
  }
  return count;
}

test("connecting a grouped connection updates it in place instead of adding a root node", async () => {
  const storage = installMemoryStorage();
  const layout: SidebarLayout = {
    groups: [{ id: "group-1", name: "Group", collapsed: false }],
    order: [{ type: "group", id: "group-1", connectionIds: [] }],
  };

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "load_connections") {
      return [];
    }
    if (cmd === "load_sidebar_layout") {
      return layout;
    }
    if (cmd === "save_sidebar_layout") {
      return null;
    }
    if (cmd === "save_connections") {
      return null;
    }
    if (cmd === "connect_db") {
      return (args.config as ConnectionConfig).id;
    }
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    await store.initFromDisk();
    store.startCreatingConnectionInGroup("group-1");

    const config = conn("conn-1", "Grouped MySQL");
    await store.addConnection(config);
    await store.connect(config);

    assert.equal(store.treeNodes.length, 1);
    assert.equal(store.treeNodes[0].type, "connection-group");
    assert.deepEqual(store.treeNodes[0].children?.map((node) => node.id), ["conn-1"]);
    assert.equal(countConnectionNodes(store.treeNodes, "conn-1"), 1);
  } finally {
    restoreTauri();
    storage.restore();
  }
});
