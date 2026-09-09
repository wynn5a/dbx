import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { test } from "vitest";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import type { ConnectionConfig } from "../../apps/desktop/src/types/database.ts";

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
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

function conn(id: string): ConnectionConfig {
  return {
    id,
    name: id,
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "",
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

test("successful disconnect clears the connection error", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "disconnect_db") {
      return null;
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    store.addEphemeralConnection(conn("conn-1"));
    store.recordConnectionError("conn-1", new Error("metadata failed"));

    await store.disconnect("conn-1");

    assert.equal(store.connectionErrors["conn-1"], undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("failed disconnect keeps the existing connection error", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "disconnect_db") {
      throw new Error("disconnect failed");
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    setActivePinia(createPinia());
    const store = useConnectionStore();
    store.addEphemeralConnection(conn("conn-1"));
    store.recordConnectionError("conn-1", new Error("metadata failed"));

    await assert.rejects(() => store.disconnect("conn-1"), /disconnect failed/);

    assert.equal(store.connectionErrors["conn-1"], "metadata failed");
  } finally {
    restoreTauri();
    restoreStorage();
  }
});
