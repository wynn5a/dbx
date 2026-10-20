// DataGrid performance harness: mounts the real DataGrid.vue with synthetic
// data in a plain browser page (no Tauri) and exposes window.__bench ops that
// perf/grid-bench/bench.mjs drives over CDP. All measurements happen in-page
// with performance.now() and rAF sampling; the driver only collects results.
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { createPinia } from "pinia";
import VueVirtualScroller from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import "@/styles/globals.css";
import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import DataGrid from "@/components/grid/DataGrid.vue";
import type { QueryResult } from "@/types/database";

const params = new URLSearchParams(location.search);
const ROWS = Number(params.get("rows") ?? 10000);
const COLS = Number(params.get("cols") ?? 20);
const SEED = Number(params.get("seed") ?? 42);
const MODE = params.get("mode") === "dom" ? "dom" : "canvas";

// Deterministic PRNG so every sample renders the same data.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ["name", "email", "status", "amount", "created", "notes", "flag"] as const;

function makeResult(rows: number, cols: number, seed: number): QueryResult {
  const rand = mulberry32(seed);
  const columns: string[] = [];
  const columnTypes: string[] = [];
  for (let c = 0; c < cols; c++) {
    const kind = c === 0 ? "id" : KINDS[(c - 1) % KINDS.length];
    columns.push(c === 0 ? "id" : `${kind}_${c}`);
    columnTypes.push(
      kind === "id" || kind === "amount" ? "numeric" : kind === "created" ? "timestamp" : "text",
    );
  }
  const statuses = ["active", "pending", "closed", "review"];
  const rowsOut: (string | number | boolean | null)[][] = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row: (string | number | boolean | null)[] = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const kind = c === 0 ? "id" : KINDS[(c - 1) % KINDS.length];
      const nully = c > 0 && rand() < 0.06;
      if (nully) {
        row[c] = null;
        continue;
      }
      switch (kind) {
        case "id":
          row[c] = r + 1;
          break;
        case "name":
          row[c] = `user-${String(Math.floor(rand() * rows)).padStart(6, "0")}`;
          break;
        case "email":
          row[c] = `user${Math.floor(rand() * rows)}@example.com`;
          break;
        case "status":
          row[c] = statuses[Math.floor(rand() * statuses.length)];
          break;
        case "amount":
          row[c] = Math.round(rand() * 1000000) / 100;
          break;
        case "created":
          row[c] = new Date(Date.UTC(2026, 0, 1) + rand() * 3.15e10).toISOString();
          break;
        case "notes":
          row[c] =
            rand() < 0.1
              ? `note ${r}/${c}: ` + "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(3)
              : `note-${Math.floor(rand() * 1e6)}`;
          break;
        default:
          row[c] = rand() < 0.5;
      }
    }
    rowsOut[r] = row;
  }
  return {
    columns,
    column_types: columnTypes,
    rows: rowsOut,
    affected_rows: rows,
    execution_time_ms: 0,
    truncated: false,
    session_id: null,
    has_more: false,
  };
}

const style = document.createElement("style");
style.textContent = "html,body,#app{height:100%;margin:0;overflow:hidden}";
document.head.appendChild(style);

// Synthetic data is built before the timing window so firstFrameMs measures
// grid work only, not harness data generation.
const initialResult = makeResult(ROWS, COLS, SEED);
const t0 = performance.now();
const app = createApp(
  defineComponent({
    setup() {
      const result = shallowRef(initialResult);
      const gridRef = ref();
      (window as any).__dbx = {
        makeResult,
        regenerate: () => {
          result.value = makeResult(ROWS, COLS, SEED + 1);
        },
        grid: () => gridRef.value,
      };
      return () =>
        h(TooltipProvider, () =>
          h(DataGrid, {
            ref: gridRef,
            result: result.value,
            sql: "SELECT * FROM bench_table",
            databaseType: "postgres",
            context: "results",
            editable: false,
            cacheKey: "grid-bench",
          }),
        );
    },
  }),
);
app.use(createPinia());
app.use(i18n);
app.use(VueVirtualScroller);
const mountDone = performance.now();
app.mount("#app");

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number, quietMs = 0): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  let lastChange = performance.now();
  let prev = pred();
  while (performance.now() < deadline) {
    await raf();
    const now = pred();
    if (now !== prev) {
      prev = now;
      lastChange = performance.now();
    }
    if (now && performance.now() - lastChange >= quietMs) return true;
  }
  return prev;
}

function scrollerEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".data-grid-scroller");
}

function canvasEl(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>("canvas.canvas-grid-surface");
}

// --- frame sampling ---------------------------------------------------------

interface FrameStats {
  frames: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  over32: number;
  over50: number;
}

function frameSampler() {
  const gaps: number[] = [];
  let last = 0;
  let running = true;
  const loop = (t: number) => {
    if (last > 0) gaps.push(t - last);
    last = t;
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    stop(): FrameStats {
      running = false;
      const values = gaps.slice(1);
      const sorted = [...values].sort((a, b) => a - b);
      const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
      return {
        frames: values.length,
        p50Ms: round(at(0.5)),
        p95Ms: round(at(0.95)),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
        over32: values.filter((g) => g > 32).length,
        over50: values.filter((g) => g > 50).length,
      };
    },
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

// Long-animation-frame entries are the main-thread blocking signal that survives
// vsync-floor frame gaps: busyMs is time the page was actually janked.
const longFrameLog: Array<{ start: number; duration: number }> = [];
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longFrameLog.push({ start: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "long-animation-frame", buffered: true } as PerformanceObserverInit);
} catch {
  // older Chrome: no LOAF; busyMs stays 0
}

async function measure(op: () => Promise<void>, settleMs: number): Promise<{ wallMs: number; busyMs: number; longFrames: number; frames: FrameStats }> {
  const loafMark = longFrameLog.length;
  const sampler = frameSampler();
  const start = performance.now();
  await op();
  await wait(settleMs);
  const wallMs = performance.now() - start;
  let busyMs = 0;
  let longFrames = 0;
  for (let i = loafMark; i < longFrameLog.length; i++) {
    busyMs += longFrameLog[i].duration;
    longFrames++;
  }
  return { wallMs: round(wallMs), busyMs: round(busyMs), longFrames, frames: sampler.stop() };
}

async function settleGrid(): Promise<void> {
  await raf();
  await raf();
  await wait(120);
}

// --- ops --------------------------------------------------------------------

async function firstFrameMs(): Promise<number> {
  const appeared = await waitFor(() => (MODE === "canvas" ? !!canvasEl() : !!scrollerEl()), 5000);
  if (!appeared) throw new Error("grid scroller/canvas never appeared");
  await raf();
  await raf();
  return round(performance.now() - t0);
}

async function scrollVertical(ms: number) {
  const scroller = scrollerEl();
  if (!scroller) throw new Error("no scroller");
  const maxTop = scroller.scrollHeight - scroller.clientHeight;
  const result = await measure(async () => {
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (t: number) => {
        const progress = Math.min(1, (t - start) / ms);
        const target = Math.round(maxTop * progress);
        scroller.scrollTop = target;
        if (progress >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, 150);
  scroller.scrollTop = 0;
  await settleGrid();
  return { ...result, maxTopPx: maxTop };
}

async function scrollHorizontal(ms: number) {
  const scroller = scrollerEl();
  if (!scroller) throw new Error("no scroller");
  const maxLeft = scroller.scrollWidth - scroller.clientWidth;
  if (maxLeft <= 0) return { skipped: "no horizontal overflow" };
  const result = await measure(async () => {
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const step = (t: number) => {
        const progress = Math.min(1, (t - start) / ms);
        scroller.scrollLeft = Math.round(maxLeft * progress);
        if (progress >= 1) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, 150);
  scroller.scrollLeft = 0;
  await settleGrid();
  return { ...result, maxLeftPx: maxLeft };
}

async function searchInput(): Promise<HTMLInputElement> {
  let el = document.querySelector<HTMLInputElement>("[data-grid-root] input.w-48");
  if (!el) {
    // The search box is a Ctrl+F overlay; open it via the exposed focus action.
    (window as any).__dbx.grid()?.focusSearch?.();
    await waitFor(() => !!document.querySelector<HTMLInputElement>("[data-grid-root] input.w-48"), 3000);
    el = document.querySelector<HTMLInputElement>("[data-grid-root] input.w-48");
  }
  if (!el) throw new Error("search input not found");
  return el;
}

function spacerHeight(): number {
  const scroller = scrollerEl();
  if (!scroller) return -1;
  return scroller.scrollHeight;
}

async function search(text: string) {
  const input = await searchInput();
  const before = spacerHeight();
  const result = await measure(async () => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Settles when the virtualized content height reflects the filtered set
    // (search includes a 150ms component-level debounce). A needle that matches
    // every row legitimately leaves the height unchanged and waits out the cap.
    await waitFor(() => spacerHeight() !== before, 4000, 220);
  }, 120);
  return { ...result, beforeHeight: before, afterHeight: spacerHeight() };
}

async function clearSearch() {
  const input = await searchInput();
  const before = spacerHeight();
  const result = await measure(async () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => spacerHeight() !== before, 4000, 220);
  }, 120);
  return { ...result, beforeHeight: before, afterHeight: spacerHeight() };
}

async function selectDrag(rowSpan: number) {
  if (MODE !== "canvas") return { skipped: "canvas-only scenario" };
  const canvas = canvasEl();
  const scroller = scrollerEl();
  if (!canvas || !scroller) throw new Error("no canvas");
  const rect = canvas.getBoundingClientRect();
  const startX = rect.left + 120;
  const startY = rect.top + 3 * 26 + 13;
  const endY = Math.min(rect.bottom - 2, startY + rowSpan * 26);
  const result = await measure(async () => {
    const fire = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1 }),
      );
    fire("mousemove", startX, startY);
    fire("mousedown", startX, startY);
    const steps = Math.max(8, Math.round(rowSpan / 4));
    for (let i = 1; i <= steps; i++) {
      const y = startY + ((endY - startY) * i) / steps;
      fire("mousemove", startX + 80, y);
      await raf();
    }
    canvas.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: startX + 80, clientY: endY }),
    );
  }, 150);
  return result;
}

async function toggleColumn() {
  const grid = (window as any).__dbx.grid();
  if (!grid) throw new Error("grid ref missing");
  const targetCol = Math.min(4, COLS - 1);
  const hide = await measure(async () => {
    grid.toggleColumnVisibility(targetCol);
    await nextTick();
    await raf();
    await raf();
  }, 120);
  const show = await measure(async () => {
    grid.showAllColumns();
    await nextTick();
    await raf();
    await raf();
  }, 120);
  return { hide, show };
}

async function resizeColumn(steps: number) {
  const scroller = scrollerEl();
  if (!scroller) throw new Error("no scroller");
  const scrollerTop = scroller.getBoundingClientRect().top;
  const handles = [...document.querySelectorAll<HTMLElement>('[class*="cursor-col-resize"]')].filter((el) => {
    const rect = el.getBoundingClientRect();
    // header drag handles are header-height strips; the search-split handle is
    // much taller and must not match
    return rect.width > 0 && rect.height > 0 && rect.height <= 60 && rect.bottom <= scrollerTop + 2;
  });
  if (handles.length < 3) return { skipped: `only ${handles.length} header resize handles found` };
  const handle = handles[Math.min(3, handles.length - 1)];
  const rect = handle.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const result = await measure(async () => {
    handle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
    for (let i = 1; i <= steps; i++) {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x + i * 3, clientY: y }),
      );
      await raf();
    }
    document.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: x + steps * 3, clientY: y }),
    );
  }, 150);
  return result;
}

async function replaceResult() {
  const before = spacerHeight();
  const result = await measure(async () => {
    (window as any).__dbx.regenerate();
    await waitFor(() => spacerHeight() !== -1, 5000, 150);
  }, 150);
  void before;
  return result;
}

function domStats() {
  return {
    elements: document.getElementsByTagName("*").length,
    mode: MODE,
    rows: ROWS,
    cols: COLS,
  };
}

// --- expose -----------------------------------------------------------------

const firstFrame = await firstFrameMs();

(window as any).__bench = {
  ready: async () => ({ firstFrameMs: firstFrame, mountScriptMs: round(mountDone - t0), mode: MODE }),
  info: domStats,
  scrollVertical: () => scrollVertical(2000),
  scrollHorizontal: () => scrollHorizontal(1200),
  search: () => search("user-000042"),
  // ~1% of rows per name column (values 000400-000499) — a real subset.
  searchBroad: () => search("user-0004"),
  clearSearch,
  selectDrag: () => selectDrag(120),
  toggleColumn,
  resizeColumn: () => resizeColumn(30),
  replaceResult,
};
await settleGrid();
