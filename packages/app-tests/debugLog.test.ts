import { beforeEach, expect, test, vi } from "vitest";

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
const ENABLED_KEY = "dbx-debug-logging-enabled";

const loadModule = async () => {
  vi.resetModules();
  return import("@/lib/debugLog");
};

beforeEach(() => {
  storage.clear();
  vi.useRealTimers();
});

test("append buffers entries and coalesces them into one storage write", async () => {
  vi.useFakeTimers();
  storage.setItem(ENABLED_KEY, "1");
  const debugLog = await loadModule();

  debugLog.appendDebugLog("info", "one");
  debugLog.appendDebugLog("warn", "two", { detail: 2 });
  expect(storage.getItem(ENTRIES_KEY)).toBeNull();

  vi.advanceTimersByTime(500);
  const persisted = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ level: string; message: string }>;
  expect(persisted).toHaveLength(2);
  expect(persisted[0]).toMatchObject({ level: "info", message: "one" });
  expect(persisted[1].level).toBe("warn");
});

test("append writes nothing while debug logging is disabled", async () => {
  vi.useFakeTimers();
  const debugLog = await loadModule();

  debugLog.appendDebugLog("info", "ignored");
  vi.advanceTimersByTime(5000);
  expect(storage.getItem(ENTRIES_KEY)).toBeNull();
});

test("flushDebugLogs persists pending entries without waiting for the timer", async () => {
  vi.useFakeTimers();
  storage.setItem(ENABLED_KEY, "1");
  const debugLog = await loadModule();

  debugLog.appendDebugLog("error", "boom");
  debugLog.flushDebugLogs();
  const persisted = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ message: string }>;
  expect(persisted).toHaveLength(1);
  expect(persisted[0].message).toBe("boom");
});

test("getDebugLogText includes buffered entries before they are persisted", async () => {
  storage.setItem(ENABLED_KEY, "1");
  const debugLog = await loadModule();

  debugLog.appendDebugLog("info", "in-memory");
  expect(debugLog.getDebugLogText()).toContain("in-memory");
  expect(storage.getItem(ENTRIES_KEY)).toBeNull();
});

test("clear empties the buffer and removes persisted entries", async () => {
  vi.useFakeTimers();
  storage.setItem(ENABLED_KEY, "1");
  storage.setItem(ENTRIES_KEY, JSON.stringify([{ timestamp: "t", level: "info", message: "old" }]));
  const debugLog = await loadModule();

  debugLog.appendDebugLog("info", "new");
  await debugLog.clearDebugLogs();
  const text = debugLog.getDebugLogText();
  expect(text).not.toContain("old");
  expect(text).not.toContain("new");
  expect(storage.getItem(ENTRIES_KEY)).toBeNull();

  debugLog.appendDebugLog("info", "fresh");
  debugLog.flushDebugLogs();
  const persisted = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ message: string }>;
  expect(persisted).toHaveLength(1);
  expect(persisted[0].message).toBe("fresh");
});

test("buffer trims to the max entry count", async () => {
  vi.useFakeTimers();
  storage.setItem(ENABLED_KEY, "1");
  const debugLog = await loadModule();

  for (let index = 0; index < 1600; index++) {
    debugLog.appendDebugLog("debug", `entry-${index}`);
  }
  debugLog.flushDebugLogs();
  const persisted = JSON.parse(storage.getItem(ENTRIES_KEY)!) as Array<{ message: string }>;
  expect(persisted).toHaveLength(1500);
  expect(persisted[0].message).toBe("entry-100");
  expect(persisted[1499].message).toBe("entry-1599");
});
