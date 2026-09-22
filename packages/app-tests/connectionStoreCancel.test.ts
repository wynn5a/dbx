import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPinia, setActivePinia } from "pinia";
import { test, vi } from "vitest";
import {
  ConnectionAttemptCancelledError,
  useConnectionStore,
} from "../../apps/desktop/src/stores/connectionStore.ts";
import * as api from "../../apps/desktop/src/lib/api.ts";
import type { ConnectionConfig, TreeNode } from "../../apps/desktop/src/types/database.ts";

interface RecordedCall {
  cmd: string;
  args: Record<string, unknown>;
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

function conn(id: string, overrides?: Partial<ConnectionConfig>): ConnectionConfig {
  return {
    id,
    name: id,
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "",
    ...overrides,
  };
}

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children ? findNode(node.children, id) : undefined;
    if (child) return child;
  }
  return undefined;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("cancelling a connect aborts the backend attempt, resets the UI and discards the late result", async () => {
  const restoreStorage = installMemoryStorage();
  const calls: RecordedCall[] = [];
  const pendingConnect = deferred<string>();
  let sentAttemptId = "";
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "connect_db") {
      sentAttemptId = String(args.attemptId ?? "");
      return pendingConnect.promise;
    }
    if (cmd === "cancel_connection_attempt") return true;
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    const config = conn("conn-1");
    await store.addConnection(config);
    assert.equal(store.connectedIds.has("conn-1"), false);

    const connecting = store.connect(config);
    assert.equal(findNode(store.treeNodes, "conn-1")?.isLoading, true, "the row should show the connecting spinner");

    assert.equal(store.cancelTreeNodeLoading("conn-1"), true);
    // Tree commits replace node instances immutably — re-read from the store.
    assert.equal(
      findNode(store.treeNodes, "conn-1")?.isLoading,
      false,
      "the row must return to idle immediately",
    );

    // The cancel IPC carries the same attempt id the connect was sent with.
    await vi.waitFor(() => {
      assert.ok(
        calls.some((call) => call.cmd === "cancel_connection_attempt" && call.args.attemptId === sentAttemptId),
        "cancel_connection_attempt must be called with the connect attempt id",
      );
    });
    assert.notEqual(sentAttemptId, "", "connect_db must receive an attempt id");

    // The backend connect resolves late (it was aborted, but pretend it
    // committed anyway): the result must not leak into state.
    pendingConnect.resolve("conn-1");
    await assert.rejects(() => connecting, ConnectionAttemptCancelledError);
    assert.equal(findNode(store.treeNodes, "conn-1")?.isLoading, false);
    assert.equal(store.connectedIds.has("conn-1"), false, "a cancelled connect must not mark the connection connected");
    assert.equal(store.activeConnectionId, null);
    assert.equal(store.connectionErrors["conn-1"], undefined, "a cancelled connect stays silent");
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("a connect can be retried immediately after cancelling", async () => {
  const restoreStorage = installMemoryStorage();
  let connectCalls = 0;
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "connect_db") {
      connectCalls++;
      return (args.config as ConnectionConfig).id;
    }
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    const config = conn("conn-1");
    await store.addConnection(config);

    const first = store.connect(config);
    assert.equal(store.cancelTreeNodeLoading("conn-1"), true);
    await assert.rejects(() => first, ConnectionAttemptCancelledError);

    const id = await store.connect(config);
    assert.equal(id, "conn-1");
    assert.equal(connectCalls, 2);
    assert.equal(store.connectedIds.has("conn-1"), true);
    assert.equal(store.activeConnectionId, "conn-1");
    assert.equal(findNode(store.treeNodes, "conn-1")?.isLoading, false);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("a late backend failure after cancel is swallowed instead of recorded", async () => {
  const restoreStorage = installMemoryStorage();
  const pendingConnect = deferred<string>();
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "connect_db") return pendingConnect.promise;
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    const config = conn("conn-1");
    await store.addConnection(config);

    const connecting = store.connect(config);
    store.cancelTreeNodeLoading("conn-1");
    pendingConnect.reject(new Error("connection refused"));

    await assert.rejects(() => connecting, ConnectionAttemptCancelledError);
    assert.equal(store.connectionErrors["conn-1"], undefined, "late errors of a cancelled attempt are dropped");
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("cancelling a schema load resets the row and discards the late metadata result", async () => {
  const restoreStorage = installMemoryStorage();
  const pendingList = deferred<unknown>();
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "connect_db") return "conn-1";
    if (cmd === "list_databases") return pendingList.promise;
    if (cmd === "load_schema_cache") return null;
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    await store.addConnection(conn("conn-1"));
    // rebuildTreeNodes seeds connection nodes with utility children (user
    // admin); capture that baseline so we can assert the load wrote nothing.
    const baselineChildren = (findNode(store.treeNodes, "conn-1")?.children ?? []).map((child) => child.id);

    const loading = store.loadDatabases("conn-1");
    assert.equal(findNode(store.treeNodes, "conn-1")?.isLoading, true);

    assert.equal(store.cancelTreeNodeLoading("conn-1"), true);
    assert.equal(
      findNode(store.treeNodes, "conn-1")?.isLoading,
      false,
      "the row must return to idle immediately",
    );

    // The hung metadata query resolves late: the load must drop it instead of
    // writing children into the tree.
    pendingList.resolve([
      { name: "postgres" },
      { name: "sales" },
    ]);
    await loading;
    const node = findNode(store.treeNodes, "conn-1");
    assert.equal(node?.isLoading, false);
    assert.deepEqual(
      (node?.children ?? []).map((child) => child.id),
      baselineChildren,
      "a cancelled load must not write its late result",
    );
    assert.equal(store.connectionErrors["conn-1"], undefined, "a cancelled load stays silent");
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("a superseded load attempt cannot overwrite the winner's result", async () => {
  const restoreStorage = installMemoryStorage();
  // Each list_databases call parks on its own deferred; the queue order is
  // pinned below with waitFor, so "first" and "second" are unambiguous.
  const pendingLists: Array<ReturnType<typeof deferred<unknown>>> = [];
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "connect_db") return "conn-1";
    if (cmd === "list_databases") {
      const pending = deferred<unknown>();
      pendingLists.push(pending);
      return pending.promise;
    }
    if (cmd === "load_schema_cache") return null;
    return null;
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    await store.addConnection(conn("conn-1"));

    const first = store.loadDatabases("conn-1");
    await vi.waitFor(() => assert.equal(pendingLists.length, 1));
    // A second (forced) load supersedes the first before it finishes — the
    // attempt-id guard must keep the loser from writing state.
    const second = store.loadDatabases("conn-1", { force: true });
    await vi.waitFor(() => assert.equal(pendingLists.length, 2));

    pendingLists[1].resolve([{ name: "sales" }]);
    await second;
    const children = () => (findNode(store.treeNodes, "conn-1")?.children ?? []).map((child) => child.id);
    // A successful load re-appends the utility (user admin) node after the
    // loaded databases.
    assert.deepEqual(children(), ["conn-1:sales", "conn-1:__user_admin"]);

    pendingLists[0].resolve([{ name: "stale" }, { name: "older" }]);
    await first;
    assert.deepEqual(
      children(),
      ["conn-1:sales", "conn-1:__user_admin"],
      "the superseded attempt's late result must be discarded",
    );
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("the connect timeout fires a backend cancel for the attempt", async () => {
  const restoreStorage = installMemoryStorage();
  const calls: RecordedCall[] = [];
  const pendingConnect = deferred<string>();
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "connect_db") return pendingConnect.promise;
    if (cmd === "cancel_connection_attempt") return true;
    return null;
  });

  try {
    // Pre-warm the lazy backend module so no dynamic import is pending under
    // fake timers.
    await api.cancelConnectionAttempt("prewarm").catch(() => undefined);
    vi.useFakeTimers();
    setActivePinia(createPinia());
    const store = useConnectionStore();
    const config = conn("conn-1", { connect_timeout_secs: 1 });
    await store.addConnection(config);

    const connecting = store.connect(config).catch((error: unknown) => error);
    // connectionAttemptTimeoutMs = 1s timeout + 2s buffer.
    await vi.advanceTimersByTimeAsync(3001);
    const error = await connecting;
    assert.ok(error instanceof Error && /timed out/.test(error.message), "the attempt times out as before");
    assert.ok(
      calls.some((call) => call.cmd === "cancel_connection_attempt"),
      "the timeout must fire-and-forget a backend cancel so the dial stops",
    );
    assert.match(store.connectionErrors["conn-1"] ?? "", /timed out/);
    assert.equal(findNode(store.treeNodes, "conn-1")?.isLoading, false);
  } finally {
    vi.useRealTimers();
    restoreTauri();
    restoreStorage();
  }
});

test("cancelling with no in-flight attempt is a harmless no-op", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => null);
  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    assert.equal(store.cancelTreeNodeLoading("no-such-node"), false);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

// ---------------------------------------------------------------------------
// Source contracts: the spinner surfaces are plain .vue templates (no mount
// test facility), so the cancel wiring is asserted against the sources — same
// approach as the appTheme/main.ts contract tests.
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("tree rows expose a cancel affordance while loading, wired to the store", () => {
  const treeItem = readSource("../../apps/desktop/src/components/sidebar/TreeItem.vue");
  assert.match(treeItem, /v-if="node\.isLoading"[\s\S]*?sidebar\.cancelLoading/, "cancel button must show while loading");
  assert.match(treeItem, /onCancelNodeLoading/);
  assert.match(treeItem, /cancelTreeNodeLoading\(props\.node\.id\)/);
});

test("fire-and-forget connect callers stay silent on a deliberate cancel", () => {
  const app = readSource("../../apps/desktop/src/App.vue");
  const fileDrop = readSource("../../apps/desktop/src/composables/useFileDrop.ts");
  for (const [name, source] of [
    ["App.vue", app],
    ["useFileDrop.ts", fileDrop],
  ] as const) {
    assert.match(
      source,
      /ConnectionAttemptCancelledError/,
      `${name} must distinguish a deliberate cancel from a real failure`,
    );
  }
  const dialog = readSource("../../apps/desktop/src/components/connection/ConnectionDialog.vue");
  assert.match(dialog, /ConnectionAttemptCancelledError/, "the dialog must not toast a cancelled connect as failed");
});
