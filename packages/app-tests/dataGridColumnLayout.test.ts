import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import { computed, nextTick, ref } from "vue";
import {
  columnDropTargetAtClientX,
  columnInsertSlot,
  isNoopColumnDrop,
  normalizeDataGridColumnLayout,
  permutationFromOrders,
  pinColumnInLayout,
  pinnedColumnViewportX,
  pinnedPrefixCount,
  reorderColumnSlots,
  resolveDataGridColumnRenderOrder,
  unpinColumnFromLayout,
} from "../../apps/desktop/src/lib/dataGridColumnLayout.ts";
import {
  clearDataGridColumnLayoutsForTab,
  readDataGridColumnLayoutForTesting,
  useDataGridColumnLayout,
  writeDataGridColumnLayoutForTesting,
} from "../../apps/desktop/src/composables/useDataGridColumnLayout.ts";
import { drawCanvasDataGrid } from "../../apps/desktop/src/lib/canvasDataGridRenderer.ts";
import en from "../../apps/desktop/src/i18n/locales/en.ts";
import es from "../../apps/desktop/src/i18n/locales/es.ts";
import it from "../../apps/desktop/src/i18n/locales/it.ts";
import ptBR from "../../apps/desktop/src/i18n/locales/pt-BR.ts";
import zhCN from "../../apps/desktop/src/i18n/locales/zh-CN.ts";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.ts";

const DATA_GRID_SOURCE = readFileSync(
  new URL("../../apps/desktop/src/components/grid/DataGrid.vue", import.meta.url),
  "utf8",
);
const RENDERER_SOURCE = readFileSync(
  new URL("../../apps/desktop/src/lib/canvasDataGridRenderer.ts", import.meta.url),
  "utf8",
);
const QUERY_STORE_SOURCE = readFileSync(
  new URL("../../apps/desktop/src/stores/queryStore.ts", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// Pure layout functions
// ---------------------------------------------------------------------------

test("normalizeDataGridColumnLayout keeps widths-only layouts valid and means original order (old data compat)", () => {
  // Old layouts (before reorder/pin existed) carry widths only.
  const legacy = normalizeDataGridColumnLayout({ widths: { a: 120 } });
  assert.deepEqual(legacy, { widths: { a: 120 } });
  assert.equal(legacy.order, undefined);
  assert.equal(legacy.pinned, undefined);

  assert.deepEqual(normalizeDataGridColumnLayout(undefined), {});
  assert.deepEqual(normalizeDataGridColumnLayout(null), {});
  assert.deepEqual(normalizeDataGridColumnLayout("garbage"), {});
  assert.deepEqual(normalizeDataGridColumnLayout([]), {});

  // Malformed entries are dropped, valid ones survive.
  const mixed = normalizeDataGridColumnLayout({
    widths: { a: 100, b: -3, c: "x", d: Number.NaN, "": 5 },
    order: ["a", 42, "b", ""],
    pinned: ["a", null, "b"],
  });
  assert.deepEqual(mixed, { widths: { a: 100 }, order: ["a", "b"], pinned: ["a", "b"] });
});

test("resolveDataGridColumnRenderOrder: no order field means original order", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["a", "b", "c"],
    visibleColumnIndexes: [0, 1, 2],
    order: undefined,
    pinned: undefined,
  });
  assert.deepEqual(order, [0, 1, 2]);
});

test("resolveDataGridColumnRenderOrder: manual order reorders and appends unmentioned columns", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["a", "b", "c", "d"],
    visibleColumnIndexes: [0, 1, 2, 3],
    order: ["c", "a"],
  });
  // c, a ranked; b and d keep their original relative order after them.
  assert.deepEqual(order, [2, 0, 1, 3]);
});

test("resolveDataGridColumnRenderOrder: stale order entries (hidden/unknown names) are ignored", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["a", "b", "c"],
    visibleColumnIndexes: [0, 2], // b hidden
    order: ["b", "c", "zzz", "a"],
  });
  assert.deepEqual(order, [2, 0]);
});

test("resolveDataGridColumnRenderOrder: pinned columns become a stable prefix", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["a", "b", "c", "d"],
    visibleColumnIndexes: [0, 1, 2, 3],
    order: ["d", "c", "b", "a"],
    pinned: ["b", "a"],
  });
  // Sequence is d,c,b,a; pinned partition keeps relative order: b,a then d,c.
  assert.deepEqual(order, [1, 0, 3, 2]);
});

test("resolveDataGridColumnRenderOrder: pinned without manual order pins from the original sequence", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["a", "b", "c"],
    visibleColumnIndexes: [0, 1, 2],
    pinned: ["c"],
  });
  assert.deepEqual(order, [2, 0, 1]);
});

test("resolveDataGridColumnRenderOrder: pinned names that are not visible do nothing", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["a", "b", "c"],
    visibleColumnIndexes: [0, 1, 2],
    pinned: ["zzz"],
  });
  assert.deepEqual(order, [0, 1, 2]);
});

test("resolveDataGridColumnRenderOrder: duplicate column names map positionally (first unconsumed occurrence)", () => {
  const order = resolveDataGridColumnRenderOrder({
    columnNames: ["id", "name", "id"], // join producing duplicate "id"
    visibleColumnIndexes: [0, 1, 2],
    order: ["id", "name", "id"],
    pinned: ["id"],
  });
  // Both "id" columns are pinned; the "name" column stays between them.
  assert.deepEqual(order, [0, 2, 1]);
});

test("pinnedPrefixCount counts the leading pinned run of the render order", () => {
  const columnNames = ["a", "b", "c", "d"];
  const renderOrder = resolveDataGridColumnRenderOrder({
    columnNames,
    visibleColumnIndexes: [0, 1, 2, 3],
    order: ["b", "d", "c", "a"],
    pinned: ["b", "a"],
  });
  // Sequence b,d,c,a; the pinned partition keeps relative order: b,a then d,c.
  assert.deepEqual(renderOrder, [1, 0, 3, 2]);
  assert.equal(pinnedPrefixCount(renderOrder, columnNames, ["b", "a"]), 2);
  // A pinned column hidden later shrinks the prefix (b is not visible here).
  const hiddenB = resolveDataGridColumnRenderOrder({
    columnNames,
    visibleColumnIndexes: [0, 2, 3],
    order: ["a", "c", "d"],
    pinned: ["b", "a"],
  });
  assert.deepEqual(hiddenB, [0, 2, 3]);
  assert.equal(pinnedPrefixCount(hiddenB, ["a", "c", "d"], ["b", "a"]), 1);
});

test("pinColumnInLayout appends and refuses to pin every visible column", () => {
  const first = pinColumnInLayout("a", undefined, 3);
  assert.deepEqual(first, { pinned: ["a"], changed: true });
  const second = pinColumnInLayout("c", first.pinned, 3);
  assert.deepEqual(second, { pinned: ["a", "c"], changed: true });
  // Pinning a third of three visible columns would leave zero unpinned.
  const refused = pinColumnInLayout("b", second.pinned, 3);
  assert.deepEqual(refused, { pinned: ["a", "c"], changed: false });
  // Re-pinning a pinned column is a no-op.
  const noop = pinColumnInLayout("a", second.pinned, 3);
  assert.deepEqual(noop, { pinned: ["a", "c"], changed: false });
});

test("unpinColumnFromLayout removes and reports no-ops", () => {
  assert.deepEqual(unpinColumnFromLayout("a", ["a", "b"]), { pinned: ["b"], changed: true });
  assert.deepEqual(unpinColumnFromLayout("zzz", ["a", "b"]), { pinned: ["a", "b"], changed: false });
  assert.deepEqual(unpinColumnFromLayout("a", undefined), { pinned: [], changed: false });
});

test("reorderColumnSlots moves columns forward and backward like splice-out/splice-in", () => {
  const order = [0, 1, 2, 3];
  // Drag col 0 after col 2.
  assert.deepEqual(reorderColumnSlots(order, 0, 3), [1, 2, 0, 3]);
  // Drag col 3 before col 1.
  assert.deepEqual(reorderColumnSlots(order, 3, 1), [0, 3, 1, 2]);
  // Same-position drops are no-ops.
  assert.deepEqual(reorderColumnSlots(order, 1, 1), order);
  assert.deepEqual(reorderColumnSlots(order, 1, 2), order);
  assert.deepEqual(reorderColumnSlots(order, 2, 2), order);
});

test("columnInsertSlot maps drop halves to insert slots and isNoopColumnDrop flags self-drops", () => {
  assert.equal(columnInsertSlot(2, true), 2);
  assert.equal(columnInsertSlot(2, false), 3);
  assert.equal(isNoopColumnDrop(1, 1, true), true);
  assert.equal(isNoopColumnDrop(1, 2, true), true);
  assert.equal(isNoopColumnDrop(1, 1, false), true);
  assert.equal(isNoopColumnDrop(1, 2, false), false);
  assert.equal(isNoopColumnDrop(1, 0, true), false);
});

test("permutationFromOrders yields the width permutation and rejects mismatched multisets", () => {
  assert.deepEqual(permutationFromOrders([0, 1, 2], [0, 1, 2]), [0, 1, 2]);
  assert.deepEqual(permutationFromOrders([0, 1, 2], [2, 0, 1]), [2, 0, 1]);
  assert.equal(permutationFromOrders([0, 1], [0, 2]), null);
  assert.equal(permutationFromOrders([0, 1], [0]), null);

  // Widths follow their column: applying the permutation to positional widths
  // carries each column's width to its new position.
  const widths = [100, 200, 300];
  const after = reorderColumnSlots([0, 1, 2], 0, 3); // [1,2,0]
  const perm = permutationFromOrders([0, 1, 2], after)!;
  const remapped = perm.map((from) => widths[from]);
  assert.deepEqual(remapped, [200, 300, 100]);
});

test("columnDropTargetAtClientX: pinned-region hit is independent of scrollLeft (no-drift hit testing)", () => {
  // widths 100,120,140,160; row number 48; first two columns pinned.
  const widths = [100, 120, 140, 160];
  const offsets = [0, 100, 220, 360, 520];
  for (const scrollLeft of [0, 500, 5000]) {
    // Viewport x 168 → content x 120 within the pinned region: column 1 spans
    // offsets 100..220, and 120 is its left half.
    const leftHalf = columnDropTargetAtClientX({
      clientX: 148 + 20,
      headerRectLeft: 0,
      headerScrollLeft: scrollLeft,
      rowNumberWidth: 48,
      offsets,
      widths,
      pinnedCount: 2,
    });
    assert.deepEqual(leftHalf, { position: 1, placeBefore: true }, `scrollLeft=${scrollLeft}`);
    // Same x in the right half of pinned col 1.
    const rightHalf = columnDropTargetAtClientX({
      clientX: 48 + 100 + 90,
      headerRectLeft: 0,
      headerScrollLeft: scrollLeft,
      rowNumberWidth: 48,
      offsets,
      widths,
      pinnedCount: 2,
    });
    assert.deepEqual(rightHalf, { position: 1, placeBefore: false }, `scrollLeft=${scrollLeft}`);
    // And a pointer over pinned col 0 hits it identically at every scroll.
    const first = columnDropTargetAtClientX({
      clientX: 48 + 40,
      headerRectLeft: 0,
      headerScrollLeft: scrollLeft,
      rowNumberWidth: 48,
      offsets,
      widths,
      pinnedCount: 2,
    });
    assert.deepEqual(first, { position: 0, placeBefore: true }, `scrollLeft=${scrollLeft}`);
  }
});

test("columnDropTargetAtClientX: unpinned region accounts for scrollLeft", () => {
  const widths = [100, 120, 140, 160];
  const offsets = [0, 100, 220, 360, 520];
  // Pointer over the pinned region stays in the pinned region no matter how
  // far the grid is scrolled (viewport-space hit test).
  const far = columnDropTargetAtClientX({
    clientX: 48 + 20,
    headerRectLeft: 0,
    headerScrollLeft: 1000,
    rowNumberWidth: 48,
    offsets,
    widths,
    pinnedCount: 2,
  });
  assert.deepEqual(far, { position: 0, placeBefore: true });

  // scrollLeft=100: pinned region covers viewport x up to 48+220=268, so a
  // pointer at x=168 hits pinned col 1 (local x 120 in offsets 100..220,
  // left half) — the scroll value plays no part.
  const underPinned = columnDropTargetAtClientX({
    clientX: 168,
    headerRectLeft: 0,
    headerScrollLeft: 100,
    rowNumberWidth: 48,
    offsets,
    widths,
    pinnedCount: 2,
  });
  assert.deepEqual(underPinned, { position: 1, placeBefore: true });

  const mid = columnDropTargetAtClientX({
    clientX: 398, // 308 + half of 160 + a nudge right
    headerRectLeft: 0,
    headerScrollLeft: 100,
    rowNumberWidth: 48,
    offsets,
    widths,
    pinnedCount: 2,
  });
  assert.deepEqual(mid, { position: 3, placeBefore: false });
});

test("columnDropTargetAtClientX: over the row number returns null, past the last column appends", () => {
  const widths = [100, 100];
  const offsets = [0, 100, 200];
  assert.equal(
    columnDropTargetAtClientX({
      clientX: 10,
      headerRectLeft: 0,
      headerScrollLeft: 0,
      rowNumberWidth: 48,
      offsets,
      widths,
      pinnedCount: 0,
    }),
    null,
  );
  const append = columnDropTargetAtClientX({
    clientX: 48 + 250,
    headerRectLeft: 0,
    headerScrollLeft: 0,
    rowNumberWidth: 48,
    offsets,
    widths,
    pinnedCount: 0,
  });
  assert.deepEqual(append, { position: 1, placeBefore: false });
});

test("pinnedColumnViewportX depends only on the offsets, never on the scroll position", () => {
  const offsets = [0, 100, 220, 360];
  for (const scrollLeft of [0, 123, 9999]) {
    // The formula has no scrollLeft term — assert the fixed x values directly.
    assert.equal(pinnedColumnViewportX(0, offsets, 48), 48 + 0);
    assert.equal(pinnedColumnViewportX(1, offsets, 48), 48 + 100);
    assert.equal(pinnedColumnViewportX(2, offsets, 48), 48 + 220);
  }
});

// ---------------------------------------------------------------------------
// useDataGridColumnLayout (per-tab persistence)
// ---------------------------------------------------------------------------

function makeLayoutComposable(cacheKeyValue: string | undefined) {
  return useDataGridColumnLayout({
    cacheKey: computed(() => cacheKeyValue),
    columnNames: computed(() => ["a", "b", "c", "d"]),
    baseVisibleColumnIndexes: computed(() => [0, 1, 2, 3]),
    scopeKey: ref("scope-1"),
  });
}

test("layout composable: pin/drag reorder render order and persist per cacheKey", async () => {
  clearDataGridColumnLayoutsForTab("tab-1");
  const layout = makeLayoutComposable("tab-1-0");
  assert.deepEqual(layout.orderedVisibleColumnIndexes.value, [0, 1, 2, 3]);
  assert.equal(layout.pinnedVisiblePrefixCount.value, 0);

  assert.equal(layout.togglePinColumn(2), true);
  assert.deepEqual(layout.orderedVisibleColumnIndexes.value, [2, 0, 1, 3]);
  assert.equal(layout.pinnedVisiblePrefixCount.value, 1);
  await nextTick(); // watcher flush persists to the cache

  assert.equal(layout.setColumnOrder([1, 0, 2, 3]), undefined);
  await nextTick();
  assert.deepEqual(layout.orderedVisibleColumnIndexes.value, [2, 1, 0, 3]);
  const stored = readDataGridColumnLayoutForTesting("tab-1-0");
  assert.deepEqual(stored?.pinned, ["c"]);
  assert.deepEqual(stored?.order, ["b", "a", "c", "d"]);
});

test("layout composable: a new instance restores the per-tab layout; clearing the tab drops it", async () => {
  clearDataGridColumnLayoutsForTab("tab-2");
  writeDataGridColumnLayoutForTesting("tab-2-0", { widths: { a: 150 }, order: ["c", "a", "b", "d"], pinned: ["a"] });
  const layout = makeLayoutComposable("tab-2-0");
  assert.deepEqual(layout.orderedVisibleColumnIndexes.value, [0, 2, 1, 3]);
  assert.equal(layout.pinnedVisiblePrefixCount.value, 1);
  assert.deepEqual(layout.persistedWidths.value, { a: 150 });

  clearDataGridColumnLayoutsForTab("tab-2");
  assert.equal(readDataGridColumnLayoutForTesting("tab-2-0"), undefined);
  // cacheKeyBelongsToTab semantics: <tabId>-<resultIndex> clears with the tab.
  clearDataGridColumnLayoutsForTab("tab-3");
  writeDataGridColumnLayoutForTesting("tab-3-0", { pinned: ["a"] });
  clearDataGridColumnLayoutsForTab("tab-3");
  assert.equal(readDataGridColumnLayoutForTesting("tab-3-0"), undefined);
});

test("layout composable: scope change resets order, pinned and widths", async () => {
  clearDataGridColumnLayoutsForTab("tab-4");
  const scopeKey = ref("scope-A");
  const layout = useDataGridColumnLayout({
    cacheKey: computed(() => "tab-4-0"),
    columnNames: computed(() => ["a", "b", "c", "d"]),
    baseVisibleColumnIndexes: computed(() => [0, 1, 2, 3]),
    scopeKey,
  });
  layout.togglePinColumn(1);
  layout.setColumnWidths({ a: 200 });
  await nextTick();
  assert.deepEqual(layout.orderedVisibleColumnIndexes.value, [1, 0, 2, 3]);

  scopeKey.value = "scope-B";
  await nextTick();
  assert.deepEqual(layout.orderedVisibleColumnIndexes.value, [0, 1, 2, 3]);
  assert.equal(layout.pinnedVisiblePrefixCount.value, 0);
  assert.equal(layout.persistedWidths.value, undefined);
  const stored = readDataGridColumnLayoutForTesting("tab-4-0");
  assert.equal(stored?.order, undefined);
  assert.equal(stored?.pinned, undefined);
  assert.equal(stored?.widths, undefined);
});

// ---------------------------------------------------------------------------
// Canvas renderer: pinned columns paint in a second, scroll-independent pass
// ---------------------------------------------------------------------------

type RecordedOp = { op: string; args: unknown[] };

function createRecordingCanvasContext() {
  const ops: RecordedOp[] = [];
  const ctx: Record<string, unknown> = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: "left",
    textBaseline: "middle",
    imageSmoothingEnabled: false,
    setTransform: (...args: unknown[]) => ops.push({ op: "setTransform", args }),
    clearRect: (...args: unknown[]) => ops.push({ op: "clearRect", args }),
    fillRect: (...args: unknown[]) => ops.push({ op: "fillRect", args }),
    strokeRect: (...args: unknown[]) => ops.push({ op: "strokeRect", args }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    rect: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    fillText: (...args: unknown[]) => ops.push({ op: "fillText", args }),
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  return { ctx, ops };
}

function drawOnce(options: { scrollLeft: number; pinnedColumnCount: number }) {
  const { ctx, ops } = createRecordingCanvasContext();
  const canvas = { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx };
  const scroller = {
    scrollTop: 0,
    scrollLeft: options.scrollLeft,
    clientWidth: 800,
    clientHeight: 400,
  };
  const row = {
    id: 0,
    displayIndex: 0,
    data: ["a0", "b1", "c2", "d3"],
    isNew: false,
    isDeleted: false,
    isDirtyCol: [false, false, false, false],
    status: "clean" as const,
  };
  drawCanvasDataGrid({
    canvas: canvas as unknown as HTMLCanvasElement,
    scroller: scroller as unknown as HTMLElement,
    width: 800,
    height: 400,
    pixelRatio: 1,
    isDark: false,
    rowCount: 1,
    rowAt: () => row,
    renderedColumnWidths: [100, 120, 140, 160],
    renderedColumnOffsets: [0, 100, 220, 360, 520],
    visibleColumnIndexes: [0, 1, 2, 3],
    rowNumberWidth: 48,
    pinnedColumnCount: options.pinnedColumnCount,
    hoverCell: null,
    isScrolling: false,
    editingCell: null,
    singleSelectedCell: null,
    searchMatchKeys: new Set(),
    currentSearchMatch: null,
    formatCell: (value) => String(value),
    isRowActive: () => false,
    isRowSelected: () => false,
    rowCellsUseSelectionVisual: () => false,
    cellIsSelected: () => false,
    cellCanHover: () => false,
    isForeignKeyCell: () => false,
  });
  return ops;
}

function fillTextXFor(ops: RecordedOp[], text: string): number[] {
  return ops
    .filter((entry) => entry.op === "fillText" && entry.args[0] === text)
    .map((entry) => entry.args[1] as number);
}

test("canvas renderer: pinned cells keep their x across scroll positions; unpinned cells shift", () => {
  const installed = typeof (globalThis as Record<string, unknown>).getComputedStyle !== "function";
  if (installed) {
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      fontFamily: "monospace",
      fontSize: "12px",
      fontWeight: "400",
      lineHeight: "16px",
      getPropertyValue: () => "",
    });
  }
  try {
    const atRest = drawOnce({ scrollLeft: 0, pinnedColumnCount: 2 });
    const scrolled = drawOnce({ scrollLeft: 1000, pinnedColumnCount: 2 });

    // Pinned columns (prefix positions 0 and 1) draw at content x + row number
    // width regardless of scrollLeft: x = 48 + offset + 12 (text padding).
    assert.deepEqual(fillTextXFor(atRest, "a0"), [48 + 0 + 12]);
    assert.deepEqual(fillTextXFor(scrolled, "a0"), [48 + 0 + 12]);
    assert.deepEqual(fillTextXFor(atRest, "b1"), [48 + 100 + 12]);
    assert.deepEqual(fillTextXFor(scrolled, "b1"), [48 + 100 + 12]);

    // Unpinned column 2 (offset 220) is at 48 + 220 - scrollLeft + 12.
    assert.deepEqual(fillTextXFor(atRest, "c2"), [48 + 220 - 0 + 12]);
    // Scrolled far past it, it is clipped away under the pinned region.
    assert.deepEqual(fillTextXFor(scrolled, "c2"), []);

    // The pinned overlay pass runs after the scrolling pass (a0 after c2).
    const atRestOrder = atRest.map((entry) => (entry.op === "fillText" ? String(entry.args[0]) : ""));
    assert.ok(atRestOrder.lastIndexOf("c2") < atRestOrder.indexOf("a0"));
  } finally {
    if (installed) delete (globalThis as Record<string, unknown>).getComputedStyle;
  }
});

// ---------------------------------------------------------------------------
// Source contracts: DataGrid + renderer + store wiring
// ---------------------------------------------------------------------------

test("DataGrid renders pinned columns as a sticky prefix with opaque backgrounds", () => {
  // One combined render list; the before-spacer renders inline before the
  // first unpinned column.
  assert.match(DATA_GRID_SOURCE, /renderedGridColumnsWithPinned/);
  assert.match(DATA_GRID_SOURCE, /v-if="col\.visibleColIdx === pinnedVisibleColumnCount"/);
  assert.match(DATA_GRID_SOURCE, /'sticky z-10 data-grid-pinned-cell': isPinnedGridColumn\(col\)/);
  assert.match(DATA_GRID_SOURCE, /'sticky z-10 data-grid-pinned-header': isPinnedGridColumn\(col\)/);
  assert.match(DATA_GRID_SOURCE, /data-grid-pinned-header-active/);
  // Sticky left comes from content offsets only — no scrollLeft term.
  assert.match(DATA_GRID_SOURCE, /function pinnedColumnStickyLeft\(visibleColIdx: number\): number \{\n  return columnContentOffsetLeft\(visibleColIdx\);\n\}/);
  // Scoped CSS keeps pinned cells opaque and layers translucent tints on top.
  assert.match(DATA_GRID_SOURCE, /\.data-grid-pinned-header \{\n  background-color: var\(--ds-bg-elevated\);/);
  assert.match(DATA_GRID_SOURCE, /\.data-grid-pinned-cell \{\n  background-color: var\(--background\);\n  background-image: linear-gradient/);
});

test("DataGrid wires the header drag and applies reorder + width permutation", () => {
  assert.match(DATA_GRID_SOURCE, /@mousedown="onColumnDragStart\(col\.visibleColIdx, \$event\)"/);
  assert.match(DATA_GRID_SOURCE, /columnDropTargetAtClientX\(\{/);
  assert.match(DATA_GRID_SOURCE, /function applyColumnReorder\(fromPos: number, targetPos: number, placeBefore: boolean\)/);
  assert.match(DATA_GRID_SOURCE, /applyWidthPermutation\(permutationFromOrders\(before, visibleColumnIndexes\.value\)\)/);
  assert.match(DATA_GRID_SOURCE, /columnDropIndicatorFor\(col\) === 'before'/);
  assert.match(DATA_GRID_SOURCE, /columnDropIndicatorFor\(col\) === 'after'/);
  // A completed drag swallows the trailing click (no accidental column select).
  assert.match(DATA_GRID_SOURCE, /columnDragGuardUntil/);
  assert.match(DATA_GRID_SOURCE, /function onHeaderCellClick\(visibleColIdx: number, event: MouseEvent\)/);
  assert.match(DATA_GRID_SOURCE, /detachColumnDragListeners\(\);/);
});

test("DataGrid exposes pin/unpin via header context menu and compact header dropdown", () => {
  assert.match(DATA_GRID_SOURCE, /isContextHeaderColumnPinned\.value \? t\("grid\.unpinColumn"\) : t\("grid\.pinColumn"\)/);
  assert.match(DATA_GRID_SOURCE, /action: toggleContextHeaderPin/);
  assert.match(DATA_GRID_SOURCE, /isColumnNamePinned\(col\.name\) \? t\("grid\.unpinColumn"\) : t\("grid\.pinColumn"\)/);
  assert.match(DATA_GRID_SOURCE, /@select\.prevent="toggleColumnPinWithWidths\(col\.actualColIdx\)"/);
  // Pinning keeps at least one unpinned column behind.
  assert.match(DATA_GRID_SOURCE, /function canPinAdditionalColumn\(\): boolean/);
});

test("DataGrid feeds the pinned prefix to the canvas renderer and hit-testing", () => {
  assert.match(DATA_GRID_SOURCE, /pinnedColumnCount: pinnedVisibleColumnCount\.value,/);
  assert.match(DATA_GRID_SOURCE, /const pinnedTotalWidth = offsets\[pinnedCount\] \?\? 0;/);
  assert.match(DATA_GRID_SOURCE, /columnLocalX < pinnedTotalWidth/);
  // Pinned cells never scroll: their viewport x is the content x itself.
  assert.match(DATA_GRID_SOURCE, /const isPinned = visibleColIdx < pinnedVisibleColumnCount\.value;/);
  // Scrolling helpers skip pinned columns.
  assert.match(DATA_GRID_SOURCE, /if \(visibleColIdx < pinnedVisibleColumnCount\.value\) return;\n  const scroller/);
});

test("canvas renderer source keeps the two-pass pinned overlay", () => {
  assert.match(RENDERER_SOURCE, /pinnedColumnCount\?: number;/);
  assert.match(RENDERER_SOURCE, /Pass 1: horizontally scrolling \(unpinned\) columns/);
  assert.match(RENDERER_SOURCE, /Pass 2: pinned overlay/);
  assert.match(RENDERER_SOURCE, /const pinnedClipX = rowNumberWidth \+ \(offsets\[pinnedCount\] \?\? 0\);/);
  assert.match(RENDERER_SOURCE, /const firstCol = Math\.max\(pinnedCount, firstVisibleColumn\(offsets, contentStart\)\);/);
});

test("closing a tab clears its column layouts next to the pending snapshots", () => {
  const snapshotCalls = QUERY_STORE_SOURCE.match(/clearDataGridPendingSnapshotsForTab\(/g)?.length ?? 0;
  const layoutCalls = QUERY_STORE_SOURCE.match(/clearDataGridColumnLayoutsForTab\(/g)?.length ?? 0;
  // One import line + one call per pending-snapshot call site.
  assert.equal(layoutCalls, snapshotCalls);
  assert.match(QUERY_STORE_SOURCE, /clearDataGridPendingSnapshotsForTab\(id\);\n    clearDataGridColumnLayoutsForTab\(id\);/);
});

test("pin/unpin copy exists in all six locales", () => {
  const locales: Record<string, Record<string, unknown>> = { en, es, it, "pt-BR": ptBR, "zh-CN": zhCN, "zh-TW": zhTW };
  for (const [name, messages] of Object.entries(locales)) {
    const grid = messages.grid as Record<string, unknown>;
    for (const key of ["pinColumn", "unpinColumn"]) {
      assert.equal(typeof grid[key], "string", `${name}.grid.${key} is a string`);
      assert.ok((grid[key] as string).length > 0, `${name}.grid.${key} is non-empty`);
    }
  }
});
