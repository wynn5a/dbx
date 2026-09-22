import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mainTsSource = readFileSync(new URL("../../apps/desktop/src/main.ts", import.meta.url), "utf8");
const appVueSource = readFileSync(new URL("../../apps/desktop/src/App.vue", import.meta.url), "utf8");
const debugLogSource = readFileSync(new URL("../../apps/desktop/src/lib/debugLog.ts", import.meta.url), "utf8");
const startupMarksSource = readFileSync(new URL("../../apps/desktop/src/lib/startupMarks.ts", import.meta.url), "utf8");

// Same in-memory localStorage stand-in as debugLog.test.ts: the debug log
// persists through localStorage, which does not exist in the node environment.
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
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

const ENTRIES_KEY = "dbx-debug-log-entries";
const ENABLED_KEY = "dbx-debug-logging-enabled";

const loadModule = async () => {
  vi.resetModules();
  const debugLog = await import("@/lib/debugLog");
  const startupMarks = await import("@/lib/startupMarks");
  return { debugLog, startupMarks };
};

beforeEach(() => {
  storage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("markStartupPhase records phases on the monotonic clock with gaps to the previous mark", async () => {
  const performanceMark = vi.fn();
  let clock = 100;
  vi.stubGlobal("performance", {
    now: () => (clock += 10),
    mark: performanceMark,
  });
  const { startupMarks } = await loadModule();

  startupMarks.markStartupPhase("startup:bootstrap-begin");
  startupMarks.markStartupPhase("startup:modules-loaded");

  expect(startupMarks.getStartupPhaseRecords()).toEqual([
    { phase: "startup:bootstrap-begin", atMs: 110, sincePrevMs: null },
    { phase: "startup:modules-loaded", atMs: 120, sincePrevMs: 10 },
  ]);
  // Every phase is also a real user-timing mark for the DevTools performance panel.
  expect(performanceMark.mock.calls).toEqual([["startup:bootstrap-begin"], ["startup:modules-loaded"]]);
});

test("markStartupPhase is idempotent: a phase is recorded on its first call only", async () => {
  let clock = 0;
  vi.stubGlobal("performance", { now: () => (clock += 10), mark: vi.fn() });
  const { startupMarks } = await loadModule();

  startupMarks.markStartupPhase("startup:theme-applied");
  clock += 50;
  startupMarks.markStartupPhase("startup:theme-applied");
  startupMarks.markStartupPhase("startup:init-app-begin");

  expect(startupMarks.getStartupPhaseRecords().map((record) => record.phase)).toEqual([
    "startup:theme-applied",
    "startup:init-app-begin",
  ]);
  expect(startupMarks.getStartupPhaseRecords()[1]!.sincePrevMs).toBe(60);
});

test("missing performance API degrades to Date.now without throwing", async () => {
  vi.stubGlobal("performance", undefined);
  const { startupMarks } = await loadModule();

  expect(() => startupMarks.markStartupPhase("startup:bootstrap-begin")).not.toThrow();
  const records = startupMarks.getStartupPhaseRecords();
  expect(records).toHaveLength(1);
  expect(typeof records[0]!.atMs).toBe("number");
  expect(startupMarks.formatStartupTimingSummary()).toContain("startup:bootstrap-begin");
});

test("summary format lists each phase with its absolute time and step", async () => {
  let clock = 0;
  vi.stubGlobal("performance", { now: () => (clock += 10), mark: vi.fn() });
  const { startupMarks } = await loadModule();

  startupMarks.markStartupPhase("startup:bootstrap-begin");
  startupMarks.markStartupPhase("startup:modules-loaded");

  expect(startupMarks.formatStartupTimingSummary()).toBe(
    "startup:bootstrap-begin 10ms | startup:modules-loaded 20ms(+10ms)",
  );
});

test("flushStartupMarks with no marks writes nothing", async () => {
  storage.setItem(ENABLED_KEY, "1");
  const { startupMarks } = await loadModule();

  expect(() => startupMarks.flushStartupMarks()).not.toThrow();
  expect(storage.getItem(ENTRIES_KEY)).toBeNull();
});

test("the exported debug log contains the startup phase timings when logging is on", async () => {
  storage.setItem(ENABLED_KEY, "1");
  vi.useFakeTimers();
  const { debugLog, startupMarks } = await loadModule();

  startupMarks.markStartupPhase("startup:bootstrap-begin");
  startupMarks.markStartupPhase("startup:modules-loaded");
  startupMarks.flushStartupMarks();

  const exported = debugLog.getDebugLogText();
  expect(exported).toContain("[DBX][startup-timing]");
  expect(exported).toContain("startup:bootstrap-begin 0ms | startup:modules-loaded");
  // The export source also reaches localStorage once the coalesced write runs.
  vi.advanceTimersByTime(500);
  expect(storage.getItem(ENTRIES_KEY)).toContain("[DBX][startup-timing]");
});

test("marks collected while logging was off reach the log once logging is enabled, without duplicates", async () => {
  // setDebugLoggingEnabled(true) snapshots browser context info.
  vi.stubGlobal("location", { href: "test://dbx/local" });
  vi.stubGlobal("window", { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 });
  vi.stubGlobal("navigator", { language: "en-US", onLine: true });
  const { debugLog, startupMarks } = await loadModule();

  startupMarks.markStartupPhase("startup:bootstrap-begin");
  startupMarks.flushStartupMarks(); // logging is off: stays buffered in memory
  expect(debugLog.getDebugLogText()).not.toContain("[DBX][startup-timing]");

  debugLog.setDebugLoggingEnabled(true); // fires the onDebugLoggingEnabled hook
  const exported = debugLog.getDebugLogText();
  expect(exported).toContain("[DBX][startup-timing]");
  expect(exported).toContain("startup:bootstrap-begin");

  const summaries = exported.split("\n").filter((line) => line.includes("[DBX][startup-timing]"));
  expect(summaries).toHaveLength(1);

  // Toggling logging off and on again must not append a second summary.
  debugLog.setDebugLoggingEnabled(false);
  debugLog.setDebugLoggingEnabled(true);
  const exportedAgain = debugLog.getDebugLogText();
  expect(exportedAgain.split("\n").filter((line) => line.includes("[DBX][startup-timing]"))).toHaveLength(1);
});

test("marks landing after a flushed summary produce one updated complete summary", async () => {
  storage.setItem(ENABLED_KEY, "1");
  const { debugLog, startupMarks } = await loadModule();

  startupMarks.markStartupPhase("startup:bootstrap-begin");
  startupMarks.flushStartupMarks(); // first-frame flush
  startupMarks.markStartupPhase("startup:connections-loaded");
  startupMarks.flushStartupMarks(); // end-of-init-chain flush

  const summaries = debugLog
    .getDebugLogText()
    .split("\n")
    .filter((line) => line.includes("[DBX][startup-timing]"));
  expect(summaries).toHaveLength(2);
  expect(summaries[0]).not.toContain("startup:connections-loaded");
  // The later entry is the complete one, so the export always ends with it.
  expect(summaries[1]).toContain("startup:bootstrap-begin");
  expect(summaries[1]).toContain("startup:connections-loaded");
});

test("startup files mark their phases instead of ad-hoc console timing", () => {
  // The regression this task fixes: console.log(performance.now()) lines that
  // never reached the exported debug log.
  for (const [label, source] of [
    ["main.ts", mainTsSource],
    ["App.vue", appVueSource],
  ] as const) {
    const offenders = source.split("\n").filter((line) => line.includes("console.log") && line.includes("performance.now"));
    expect(offenders, `${label} must not time via console.log(performance.now())`).toEqual([]);
    expect(source, `${label} must not keep [STARTUP] console milestones`).not.toMatch(/console\.log\((`|")\[STARTUP\]/);
  }

  expect(mainTsSource).toMatch(/import \{ flushStartupMarks, markStartupPhase \} from "@\/lib\/startupMarks";/);
  for (const phase of [
    "startup:bootstrap-begin",
    "startup:modules-loaded",
    "startup:locale-ready",
    "startup:app-created",
    "startup:vue-mounted",
    "startup:first-frame",
  ]) {
    expect(mainTsSource, `main.ts must mark ${phase}`).toContain(`markStartupPhase("${phase}")`);
  }
  expect(mainTsSource).toMatch(/markStartupPhase\("startup:first-frame"\);\s*\n\s*flushStartupMarks\(\);/);

  expect(appVueSource).toMatch(/import \{ flushStartupMarks, markStartupPhase \} from "@\/lib\/startupMarks";/);
  for (const phase of [
    "startup:on-mounted-begin",
    "startup:theme-applied",
    "startup:init-app-begin",
    "startup:saved-sql-loaded",
    "startup:connections-loaded",
    "startup:on-mounted-sync-done",
  ]) {
    expect(appVueSource, `App.vue must mark ${phase}`).toContain(`markStartupPhase("${phase}")`);
  }
  expect(appVueSource).toMatch(/markStartupPhase\("startup:connections-loaded"\);\s*\n\s*\/\//);
  expect(appVueSource).toMatch(/flushStartupMarks\(\);\s*\n\s*reconnectRestoredTabs\(\);/);
});

test("the debug-log enable hook and the startup summary wiring stay in place", () => {
  expect(debugLogSource).toMatch(/export function onDebugLoggingEnabled\(listener: \(\) => void\)/);
  expect(debugLogSource).toMatch(/debugLoggingEnabledListeners\.forEach\(\(listener\) => listener\(\)\);/);
  expect(startupMarksSource).toMatch(/onDebugLoggingEnabled\(\(\) => flushStartupMarks\(\)\);/);
  // The summary lands through the debug log, not a raw console write.
  expect(startupMarksSource).toMatch(/appendDebugLog\("info", "\[DBX\]\[startup-timing\]", formatStartupTimingSummary\(\)\);/);
});
