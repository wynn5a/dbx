import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import type { ComponentPublicInstance } from "vue";
import {
  createUnhandledVueErrorHandler,
  formatUnhandledVueError,
  installGlobalErrorHandler,
  vueComponentLabel,
  type GlobalErrorHandlerDeps,
} from "@/lib/globalErrorHandler";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const storage = new MemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  configurable: true,
});

const ENTRIES_KEY = "dbx-debug-log-entries";

function fakeInstance(name: string | null): ComponentPublicInstance | null {
  if (name === null) return null;
  return { $options: { name } } as unknown as ComponentPublicInstance;
}

function makeDeps(now: () => number) {
  const calls = { logged: [] as string[], consoled: [] as unknown[][], toasts: 0 };
  const deps: GlobalErrorHandlerDeps = {
    logError: (message) => calls.logged.push(message),
    consoleError: (...args) => calls.consoled.push(args),
    showErrorToast: () => {
      calls.toasts += 1;
    },
    now,
  };
  return { deps, calls };
}

beforeEach(() => {
  storage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("formatUnhandledVueError includes component name, hook info and the stack", () => {
  const error = new Error("boom");
  const message = formatUnhandledVueError({ error, instance: fakeInstance("QueryEditor"), info: "render function" });
  expect(message).toContain("[vue:error]");
  expect(message).toContain("component=QueryEditor");
  expect(message).toContain("hook=render function");
  expect(message).toContain("Error: boom");
  expect(message).toContain(error.stack!);
});

test("formatUnhandledVueError tolerates anonymous components and non-Error values", () => {
  const message = formatUnhandledVueError({ error: "strange failure", instance: fakeInstance(null), info: "" });
  expect(message).toBe("[vue:error] strange failure");
  expect(formatUnhandledVueError({ error: 42, instance: null, info: "setup function" })).toBe(
    "[vue:error] hook=setup function 42",
  );
});

test("vueComponentLabel prefers name and falls back to __name", () => {
  expect(vueComponentLabel(fakeInstance("Named"))).toBe("Named");
  expect(
    vueComponentLabel({ $options: { __name: "ScriptSetup" } } as unknown as ComponentPublicInstance),
  ).toBe("ScriptSetup");
  expect(vueComponentLabel(null)).toBeNull();
});

test("handler logs the error, keeps console.error visible and toasts once", () => {
  let clock = 1000;
  const { deps, calls } = makeDeps(() => clock);
  const handler = createUnhandledVueErrorHandler(deps);

  handler(new Error("boom"), fakeInstance("QueryEditor"), "render function");

  expect(calls.logged).toHaveLength(1);
  expect(calls.logged[0]).toContain("component=QueryEditor");
  expect(calls.consoled).toHaveLength(1);
  expect(calls.consoled[0][0]).toContain("component=QueryEditor");
  expect(calls.consoled[0][1]).toBeInstanceOf(Error);
  expect(calls.toasts).toBe(1);
});

test("consecutive errors log every entry but the toast is throttled to one per window", () => {
  let clock = 1000;
  const { deps, calls } = makeDeps(() => clock);
  const handler = createUnhandledVueErrorHandler(deps);

  handler(new Error("one"), fakeInstance("Grid"), "render function");
  clock += 5_000;
  handler(new Error("two"), fakeInstance("Grid"), "render function");
  clock += 4_000;
  handler(new Error("three"), fakeInstance("Grid"), "render function");

  expect(calls.logged).toHaveLength(3);
  expect(calls.consoled).toHaveLength(3);
  expect(calls.toasts).toBe(1);

  clock += 1_100;
  handler(new Error("four"), fakeInstance("Grid"), "render function");
  expect(calls.logged).toHaveLength(4);
  expect(calls.toasts).toBe(2);
});

test("installGlobalErrorHandler wires the Vue errorHandler to the debug-log buffer", async () => {
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const toast = vi.fn();
  // Logging is intentionally left disabled — unhandled errors must still land
  // in the buffer so an exported log contains the stack.
  const { createApp } = await import("vue");
  const app = createApp({ name: "NeverMounted", render: () => null });
  installGlobalErrorHandler(app, toast);

  const handler = app.config.errorHandler!;
  handler(new Error("boom"), fakeInstance("QueryEditor"), "render function");

  expect(toast).toHaveBeenCalledTimes(1);
  expect(consoleSpy).toHaveBeenCalledTimes(1);
  // appendErrorDebugLog flushes synchronously, so the entry is persisted at once.
  const persisted = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ level: string; message: string }>;
  expect(persisted).toHaveLength(1);
  expect(persisted[0].level).toBe("error");
  expect(persisted[0].message).toContain("component=QueryEditor");
  expect(persisted[0].message).toContain("hook=render function");
  expect(persisted[0].message).toContain("Error: boom");
});

test("main.ts registers the handler on the app before mount", () => {
  const mainTs = readFileSync(new URL("../../apps/desktop/src/main.ts", import.meta.url), "utf8");
  const registration = mainTs.indexOf("installAppErrorHandler(app");
  const mount = mainTs.indexOf('app.mount("#root")');
  expect(registration).toBeGreaterThan(-1);
  expect(mount).toBeGreaterThan(-1);
  expect(registration).toBeLessThan(mount);
});

test("with debug logging on, an unhandled error is logged once, not again by the console capture", async () => {
  const originalError = console.error;
  const sink = vi.fn();
  console.error = sink;
  const g = globalThis as Record<string, unknown>;
  const hadWindow = "window" in g;
  const hadDocument = "document" in g;
  if (!hadWindow) g.window = { addEventListener: () => {} };
  if (!hadDocument) g.document = { addEventListener: () => {} };
  try {
    storage.setItem("dbx-debug-logging-enabled", "1");
    vi.resetModules();
    const debugLog = await import("@/lib/debugLog");
    const handlerModule = await import("@/lib/globalErrorHandler");
    debugLog.installDebugLogCapture();
    expect(debugLog.isDebugLoggingEnabled()).toBe(true);

    const { createApp } = await import("vue");
    const app = createApp({ name: "NeverMounted", render: () => null });
    handlerModule.installGlobalErrorHandler(app, vi.fn());
    app.config.errorHandler!(new Error("boom"), fakeInstance("QueryEditor"), "render function");
    debugLog.flushDebugLogs();

    const persisted = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ message: string }>;
    expect(persisted.filter((entry) => entry.message.includes("[vue:error]"))).toHaveLength(1);
    // The console still shows it (through the pre-capture console.error).
    expect(sink).toHaveBeenCalledTimes(1);

    // Ordinary console.error calls are still captured.
    console.error("plain failure");
    debugLog.flushDebugLogs();
    const after = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ message: string }>;
    expect(after.some((entry) => entry.message.includes("plain failure"))).toBe(true);
  } finally {
    console.error = originalError;
    if (!hadWindow) delete g.window;
    if (!hadDocument) delete g.document;
  }
});
