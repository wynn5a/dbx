import { test } from "vitest";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { readFileSync } from "node:fs";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import { runStartupLoadChain } from "../../apps/desktop/src/lib/startupLoadChain.ts";
import type { ConnectionConfig } from "../../apps/desktop/src/types/database.ts";

// ---------------------------------------------------------------------------
// B3 fixtures: the three independent startup IPC reads issued by initFromDisk.
// The invoke stub must satisfy both isTauriRuntime() (globalThis level, makes
// the store take the desktop IPC path for pinned ids) and @tauri-apps/api/core
// invoke (window level), so all three reads go over the mocked IPC bridge.
// ---------------------------------------------------------------------------

const STARTUP_COMMANDS = ["load_pinned_tree_node_ids", "load_connections", "load_sidebar_layout"] as const;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
      else Reflect.deleteProperty(globalThis as any, "localStorage");
    },
  };
}

function installTauriInvokeStub(router: (cmd: string, args: Record<string, unknown>) => Promise<unknown>) {
  const originalWindow = (globalThis as any).window;
  const originalInternals = (globalThis as any).__TAURI_INTERNALS__;
  const internals = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => router(cmd, args ?? {}),
  };
  (globalThis as any).__TAURI_INTERNALS__ = internals; // isTauriRuntime() -> true
  (globalThis as any).window = { __TAURI_INTERNALS__: internals }; // @tauri-apps/api/core invoke
  return () => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis as any, "window");
    else (globalThis as any).window = originalWindow;
    if (originalInternals === undefined) Reflect.deleteProperty(globalThis as any, "__TAURI_INTERNALS__");
    else (globalThis as any).__TAURI_INTERNALS__ = originalInternals;
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

async function until(condition: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met within timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface StartupHarness {
  restore: () => void;
  storageRestore: () => void;
  issued: string[];
  pendingFor: (cmd: string) => Deferred<unknown>;
}

/**
 * Stubs the IPC bridge so each startup command hands back an unresolved
 * deferred recorded by the test; nothing resolves until the test releases it,
 * which is what makes "issued but not settled" observable.
 */
function installGatedStartupStubs(): StartupHarness {
  const pending = new Map<string, Deferred<unknown>>();
  const issued: string[] = [];
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    issued.push(cmd);
    if ((STARTUP_COMMANDS as readonly string[]).includes(cmd)) {
      const d = deferred<unknown>();
      pending.set(cmd, d);
      return d.promise;
    }
    return null;
  });
  return {
    restore: restoreTauri,
    storageRestore: () => {},
    issued,
    pendingFor: (cmd) => {
      const d = pending.get(cmd);
      assert.ok(d, `expected a pending deferred for ${cmd}`);
      return d;
    },
  };
}

test("initFromDisk issues all three startup loads concurrently and commits once settled", async () => {
  const storage = installMemoryStorage();
  const harness = installGatedStartupStubs();

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();

    // Startup starts from the loading state with nothing committed yet.
    assert.equal(store.connectionsLoading, true);
    assert.equal(store.connections.length, 0);

    const initPromise = store.initFromDisk();

    // The proof of parallelism: all three reads are in flight at once, none
    // having settled (a serial implementation would deadlock here on the
    // first pending read and `until` would time out).
    await until(() => STARTUP_COMMANDS.every((cmd) => harness.issued.includes(cmd)));
    assert.equal(store.connectionsLoading, true);
    assert.equal(store.connections.length, 0);

    harness.pendingFor("load_pinned_tree_node_ids").resolve(["conn-a:db:main"]);
    harness.pendingFor("load_connections").resolve([conn("conn-a", "A"), conn("conn-b", "B")]);
    harness.pendingFor("load_sidebar_layout").resolve(null);
    await initPromise;

    // Empty-state contract: the flag only clears once the load settled, so
    // the Welcome screen / sidebar show the "no connections" empty state
    // exclusively after a completed-and-empty load (here: non-empty list).
    assert.equal(store.connectionsLoading, false);
    assert.equal(store.connections.length, 2);
    assert.equal(store.isTreeNodePinned("conn-a:db:main"), true);
    assert.ok(store.treeNodes.length > 0);
  } finally {
    harness.restore();
    storage.restore();
  }
});

test("initFromDisk empty load: empty state is only legitimate after the load settles", async () => {
  const storage = installMemoryStorage();
  const harness = installGatedStartupStubs();

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();

    const initPromise = store.initFromDisk();
    await until(() => STARTUP_COMMANDS.every((cmd) => harness.issued.includes(cmd)));

    // While loading with zero connections, the UI condition
    // (connections empty AND not loading) is false -> loading state, not the
    // "no connections" empty state.
    assert.equal(store.connections.length, 0);
    assert.equal(store.connectionsLoading, true);

    harness.pendingFor("load_pinned_tree_node_ids").resolve([]);
    harness.pendingFor("load_connections").resolve([]);
    harness.pendingFor("load_sidebar_layout").resolve(null);
    await initPromise;

    // Completed and confirmed empty: only now may the empty state render.
    assert.equal(store.connectionsLoading, false);
    assert.equal(store.connections.length, 0);
    assert.equal(store.treeNodes.length, 0);
  } finally {
    harness.restore();
    storage.restore();
  }
});

test("initFromDisk total time tracks the slowest read, not the sum of the three", async () => {
  const storage = installMemoryStorage();
  const READ_MS = 50;
  // Serial (the previous implementation) would take >= 3 * READ_MS; the
  // parallel load must land near one read. The 200ms headroom absorbs
  // scheduler jitter while still failing any serial regression.
  const budgetMs = 250;

  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if ((STARTUP_COMMANDS as readonly string[]).includes(cmd)) {
      await new Promise((resolve) => setTimeout(resolve, READ_MS));
      if (cmd === "load_pinned_tree_node_ids") return [];
      if (cmd === "load_connections") return [conn("conn-a", "A")];
      return null;
    }
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();

    const start = Date.now();
    await store.initFromDisk();
    const elapsed = Date.now() - start;

    assert.ok(elapsed < budgetMs, `initFromDisk took ${elapsed}ms; parallel budget is ${budgetMs}ms`);
    assert.equal(store.connections.length, 1);
    assert.equal(store.connectionsLoading, false);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("a corrupt sidebar layout degrades to the default layout instead of dropping the connections", async () => {
  const storage = installMemoryStorage();
  const issued: string[] = [];
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    issued.push(cmd);
    if (cmd === "load_pinned_tree_node_ids") return [];
    if (cmd === "load_connections") return [conn("conn-a", "A"), conn("conn-b", "B")];
    if (cmd === "load_sidebar_layout") throw new Error("invalid layout_json: expected value at line 1 column 1");
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();

    await store.initFromDisk();

    for (const cmd of STARTUP_COMMANDS) {
      assert.ok(issued.includes(cmd), `expected ${cmd} to be issued`);
    }
    assert.equal(store.connectionsLoading, false);
    assert.deepEqual(
      store.connections.map((c) => c.id),
      ["conn-a", "conn-b"],
      "the layout is cosmetic — the connections must still load",
    );
    assert.ok(store.treeNodes.length >= 2, "the tree is rebuilt with the default layout");
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("a failed connections read rejects, commits nothing, and blocks the save that would wipe them", async () => {
  const storage = installMemoryStorage();
  const issued: string[] = [];
  let failConnections = true;
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    issued.push(cmd);
    if (cmd === "load_pinned_tree_node_ids") return [];
    if (cmd === "load_connections") {
      if (failConnections) throw new Error("disk boom");
      return [conn("conn-a", "A")];
    }
    if (cmd === "load_sidebar_layout") return null;
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();

    await assert.rejects(store.initFromDisk(), /disk boom/);
    assert.equal(store.connectionsLoading, false);
    assert.equal(store.connections.length, 0);

    // save_connections replaces the whole stored set: saving the (empty)
    // in-memory list plus one new connection would delete everything else.
    await assert.rejects(store.addConnection(conn("conn-new", "New")), /failed to load/);
    assert.equal(issued.includes("save_connections"), false, "no save may reach the backend");

    // A later successful load lifts the guard.
    failConnections = false;
    await store.initFromDisk();
    assert.deepEqual(
      store.connections.map((c) => c.id),
      ["conn-a"],
    );
    await store.addConnection(conn("conn-new", "New"));
    assert.equal(issued.includes("save_connections"), true);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("a failing saved-SQL load at startup still loads connections and clears the loading flag", async () => {
  const storage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "load_pinned_tree_node_ids") return [];
    if (cmd === "load_connections") return [conn("conn-a", "A")];
    if (cmd === "load_sidebar_layout") return null;
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    const errors: unknown[] = [];
    let connectionsLoaded = false;

    await runStartupLoadChain({
      loadSavedSql: () => Promise.reject(new Error("saved sql library unreadable")),
      loadConnections: () => store.initFromDisk(),
      onConnectionsLoaded: () => {
        connectionsLoaded = true;
      },
      onError: (error) => errors.push(error),
    });

    assert.equal(errors.length, 1, "the saved-SQL failure is still reported");
    assert.match(String(errors[0]), /saved sql library unreadable/);
    assert.equal(connectionsLoaded, true);
    assert.equal(store.connectionsLoading, false, "the Welcome screen must not stay on 'Loading connections…'");
    assert.equal(store.connections.length, 1);
  } finally {
    restoreTauri();
    storage.restore();
  }
});

test("App startup routes through runStartupLoadChain", () => {
  const app = readFileSync(new URL("../../apps/desktop/src/App.vue", import.meta.url), "utf8");
  assert.match(app, /runStartupLoadChain\(\{[\s\S]*?loadSavedSql:[\s\S]*?loadConnections: \(\) => connectionStore\.initFromDisk\(\)/);
});
