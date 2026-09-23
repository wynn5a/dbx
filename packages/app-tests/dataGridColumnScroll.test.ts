import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  dataGridScrollLeftToCenterColumn,
  dataGridScrollLeftToRevealColumn,
} from "../../apps/desktop/src/lib/dataGridColumnScroll.ts";

const DATA_GRID_SOURCE = readFileSync(
  new URL("../../apps/desktop/src/components/grid/DataGrid.vue", import.meta.url),
  "utf8",
);

const ROW = 50;
const PINNED = 200;

test("reveal: a column scrolled under the pinned area lands right of the pinned columns", () => {
  // Column content x = 600 (incl. row gutter), 120 wide; scrolled to 500, so its
  // viewport x is 100 — under the 200px pinned column.
  const next = dataGridScrollLeftToRevealColumn({
    columnLeft: 600,
    columnWidth: 120,
    scrollLeft: 500,
    clientWidth: 1000,
    rowNumberWidth: ROW,
    pinnedWidth: PINNED,
  });
  assert.equal(next, 600 - ROW - PINNED);
  // After the scroll the column's viewport x equals the sticky width.
  assert.equal(600 - next!, ROW + PINNED);
});

test("reveal: fully visible columns do not scroll; right overflow aligns the right edge", () => {
  const base = { columnWidth: 100, scrollLeft: 0, clientWidth: 800, rowNumberWidth: ROW, pinnedWidth: PINNED };
  assert.equal(dataGridScrollLeftToRevealColumn({ ...base, columnLeft: 300 }), null);
  assert.equal(dataGridScrollLeftToRevealColumn({ ...base, columnLeft: 900 }), 1000 - 800);
  // Wider than the scrollable area: keep the left edge visible instead.
  assert.equal(dataGridScrollLeftToRevealColumn({ ...base, columnLeft: 900, columnWidth: 700 }), 900 - ROW - PINNED);
  // Without pinned columns the gutter alone is subtracted.
  assert.equal(
    dataGridScrollLeftToRevealColumn({ ...base, pinnedWidth: 0, columnLeft: 100, scrollLeft: 400 }),
    100 - ROW,
  );
});

test("center: the column is centered within the scrollable part of the viewport", () => {
  const geometry = {
    columnLeft: 2000,
    columnWidth: 100,
    scrollLeft: 0,
    clientWidth: 1050,
    rowNumberWidth: ROW,
    pinnedWidth: PINNED,
  };
  const scrollLeft = dataGridScrollLeftToCenterColumn(geometry);
  const columnCenterInViewport = geometry.columnLeft + geometry.columnWidth / 2 - scrollLeft;
  const scrollableCenter = ROW + PINNED + (geometry.clientWidth - ROW - PINNED) / 2;
  assert.equal(columnCenterInViewport, scrollableCenter);
  assert.equal(dataGridScrollLeftToCenterColumn({ ...geometry, columnLeft: 300 }), 0);
});

test("DataGrid scroll-into-view and column highlight use the pinned-aware scroll math", () => {
  assert.match(DATA_GRID_SOURCE, /dataGridScrollLeftToRevealColumn\(columnScrollGeometry\(visibleColIdx, scroller\)\)/);
  assert.match(DATA_GRID_SOURCE, /dataGridScrollLeftToCenterColumn\(columnScrollGeometry\(visibleColIdx, scroller\)\)/);
  assert.match(DATA_GRID_SOURCE, /pinnedWidth: pinnedTotalColumnWidth\.value,/);
});
