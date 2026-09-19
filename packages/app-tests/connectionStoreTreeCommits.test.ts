import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { isProxy } from "vue";
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
      else Reflect.deleteProperty(globalThis as any, "localStorage");
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

function findNodeById(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children ? findNodeById(node.children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

async function setupStoreWithConnection(router?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>) {
  const storage = installMemoryStorage();
  const layout: SidebarLayout = { groups: [], order: [] };
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "load_connections") return [];
    if (cmd === "load_sidebar_layout") return layout;
    if (cmd === "save_sidebar_layout") return null;
    if (cmd === "save_connections") return null;
    if (router) return router(cmd, args);
    return null;
  });
  setActivePinia(createPinia());
  const store = useConnectionStore();
  await store.initFromDisk();
  const config = conn("conn-1", "MySQL");
  await store.addConnection(config);
  return {
    store,
    config,
    cleanup() {
      restoreTauri();
      storage.restore();
    },
  };
}

test("tree nodes are plain objects and commits replace the root array", async () => {
  const { store, cleanup } = await setupStoreWithConnection();
  try {
    const node = store.treeNodes[0];
    assert.ok(node, "connection node exists");
    assert.equal(isProxy(node), false, "nodes must not be reactive proxies");
    assert.equal(isProxy(store.treeNodes), false, "the root array must not be a reactive proxy");

    const rootBefore = store.treeNodes;
    store.setTreeNodeExpanded(node, true);
    assert.notEqual(store.treeNodes, rootBefore, "a commit must swap the root array to trigger shallow readers");
    assert.equal(store.treeNodes[0].isExpanded, true);
    assert.equal(node.isExpanded, false, "the captured instance is a detached clone after the commit");
  } finally {
    cleanup();
  }
});

test("commits addressed through a stale instance still land on the current node by id", async () => {
  const { store, cleanup } = await setupStoreWithConnection();
  try {
    const stale = store.treeNodes[0];
    store.setTreeNodeExpanded(stale, true);
    const current = store.treeNodes[0];
    assert.notEqual(current, stale, "the committed node is a fresh instance");

    store.setTreeNodeExpanded(stale, false);
    assert.equal(store.treeNodes[0].isExpanded, false, "the fresh instance must carry the by-id commit");
    assert.equal(current.isExpanded, true, "detached clones never receive later writes");
  } finally {
    cleanup();
  }
});

test("resetTreeNodeChildren collapses and clears, and expandTreeNodes expands in-tree nodes", async () => {
  const { store, cleanup } = await setupStoreWithConnection();
  try {
    const node = store.treeNodes[0];
    store.setTreeNodeExpanded(node, true);
    store.resetTreeNodeChildren(node);
    assert.equal(store.treeNodes[0].isExpanded, false);
    assert.deepEqual(store.treeNodes[0].children, []);

    const rootBefore = store.treeNodes;
    store.expandTreeNodes([store.treeNodes[0]]);
    assert.notEqual(store.treeNodes, rootBefore);
    assert.equal(store.treeNodes[0].isExpanded, true);

    const rootAfter = store.treeNodes;
    store.expandTreeNodes([store.treeNodes[0]]);
    assert.equal(store.treeNodes, rootAfter, "no commit when every node is already expanded");
  } finally {
    cleanup();
  }
});

test("reloading children preserves expanded databases that already have loaded children", async () => {
  const { store, config, cleanup } = await setupStoreWithConnection(async (cmd, args) => {
    if (cmd === "connect_db") return (args.config as ConnectionConfig).id;
    if (cmd === "list_databases") {
      return [
        { name: "db1", default: false },
        { name: "db2", default: false },
      ];
    }
    if (cmd === "list_tables") {
      return [{ name: "t1", table_type: "BASE TABLE" }];
    }
    return null;
  });
  try {
    await store.connect(config);
    await store.loadDatabases("conn-1", { force: true });
    const db1 = findNodeById(store.treeNodes, "conn-1:db1") ?? findNodeById(store.treeNodes, "conn-1:db1:db1");
    assert.ok(db1, "db1 node exists");

    store.setTreeNodeExpanded(db1, true);
    await store.loadTables("conn-1", "db1");
    const loaded = findNodeById(store.treeNodes, db1.id);
    assert.ok(loaded?.children?.length, "tables loaded under db1");

    await store.loadDatabases("conn-1", { force: true });
    const reloaded = findNodeById(store.treeNodes, db1.id);
    assert.ok(reloaded, "db1 survives the reload");
    assert.equal(reloaded?.isExpanded, true, "setChildren merge must carry expansion across reloads");
    assert.equal(
      reloaded?.children?.length,
      loaded.children?.length,
      "loaded children are carried into the merged node",
    );
  } finally {
    cleanup();
  }
});
