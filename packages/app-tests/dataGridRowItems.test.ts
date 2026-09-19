import { strict as assert } from "node:assert";
import { describe, test } from "vitest";
import {
  createGridDisplayRefCache,
  createGridProjectionCache,
  createGridRowItemCache,
  createGridRowSearchCache,
  gridDirtySnapshot,
  gridDirtySnapshotsEqual,
  type GridDisplayRowRef,
} from "../../apps/desktop/src/lib/dataGridRowItems.ts";
import type { CellValue } from "../../apps/desktop/src/lib/cellValue.ts";

interface TestRowItem {
  ref: GridDisplayRowRef;
  data: CellValue[];
}

function existingRef(sourceIndex = 0, displayIndex = 0): GridDisplayRowRef {
  return {
    id: sourceIndex,
    displayIndex,
    sourceIndex,
    isNew: false,
    isDeleted: false,
    status: "clean",
  };
}

describe("gridDirtySnapshot", () => {
  test("empty and missing dirty maps collapse to null", () => {
    assert.equal(gridDirtySnapshot(undefined), null);
    assert.equal(gridDirtySnapshot(new Map()), null);
    assert.deepEqual(gridDirtySnapshot(new Map([[2, "x"] as [number, CellValue]])), [[2, "x"]]);
  });

  test("snapshots compare by column and value", () => {
    const a: Array<readonly [number, CellValue]> = [
      [1, "a"],
      [2, null],
    ];
    assert.ok(gridDirtySnapshotsEqual(a, [[1, "a"], [2, null]]));
    assert.ok(!gridDirtySnapshotsEqual(a, [[1, "a"], [2, "b"]]));
    assert.ok(!gridDirtySnapshotsEqual(a, [[1, "a"]]));
    assert.ok(!gridDirtySnapshotsEqual(a, null));
    assert.ok(gridDirtySnapshotsEqual(null, null));
  });
});

describe("createGridDisplayRefCache", () => {
  test("reuses the same ref while its fields are unchanged", () => {
    const cache = createGridDisplayRefCache();
    const first = cache.existingRow(7, 0, false, "clean");
    const second = cache.existingRow(7, 0, false, "clean");
    assert.equal(first, second);
    assert.ok(Object.isFrozen(first));
  });

  test("rebuilds when display index, deletion or status changes", () => {
    const cache = createGridDisplayRefCache();
    const clean = cache.existingRow(7, 0, false, "clean");
    const moved = cache.existingRow(7, 3, false, "clean");
    const edited = cache.existingRow(7, 3, false, "edited");
    const deleted = cache.existingRow(7, 3, true, "deleted");
    assert.notEqual(clean, moved);
    assert.notEqual(moved, edited);
    assert.notEqual(edited, deleted);
    assert.equal(moved.displayIndex, 3);
    assert.equal(edited.status, "edited");
    assert.equal(deleted.isDeleted, true);
  });

  test("new rows use negative ids keyed by new index", () => {
    const cache = createGridDisplayRefCache();
    const first = cache.newRow(0, 5);
    assert.equal(first.id, -1);
    assert.equal(first.isNew, true);
    assert.equal(cache.newRow(0, 5), first);
    assert.notEqual(cache.newRow(0, 6), first);
    assert.equal(cache.newRow(1, 6).id, -2);
  });
});

function makeDeps(overrides: Partial<Parameters<typeof createGridRowItemCache<TestRowItem>>[0]> = {}) {
  const rows: CellValue[][] = [
    ["a", "b"],
    ["c", "d"],
  ];
  const newRows: CellValue[][] = [["n1"]];
  const dirty = new Map<number, Map<number, CellValue>>();
  let rowsRevision = 0;
  let newRowsRevision = 0;
  let builds = 0;
  const deps = {
    rowsRevision: () => rowsRevision,
    newRowsRevision: () => newRowsRevision,
    baseRowFor: (ref: GridDisplayRowRef) => rows[ref.sourceIndex ?? -1],
    dirtySnapshotFor: (ref: GridDisplayRowRef) => gridDirtySnapshot(dirty.get(ref.sourceIndex ?? -1)),
    build: (ref: GridDisplayRowRef): TestRowItem => {
      builds++;
      const base = ref.isNew ? newRows[ref.newIndex] ?? [] : rows[ref.sourceIndex] ?? [];
      return { ref, data: [...base] };
    },
    ...overrides,
  };
  return {
    deps,
    builds: () => builds,
    bumpRows: () => rowsRevision++,
    bumpNewRows: () => newRowsRevision++,
    setDirty: (row: number, col: number, value: CellValue) => {
      if (!dirty.has(row)) dirty.set(row, new Map());
      dirty.get(row)!.set(col, value);
    },
    clearDirty: (row: number) => dirty.delete(row),
    replaceBaseRow: (row: number, values: CellValue[]) => {
      rows[row] = values;
    },
  };
}

describe("createGridRowItemCache", () => {
  test("builds once and reuses the item while nothing changed", () => {
    const ctx = makeDeps();
    const cache = createGridRowItemCache<TestRowItem>(ctx.deps);
    const ref = existingRef(0, 0);
    const item = cache.get(ref);
    assert.equal(cache.get(ref), item);
    assert.equal(ctx.builds(), 1);
  });

  test("a dirty-cell change rebuilds only that row", () => {
    const ctx = makeDeps();
    const cache = createGridRowItemCache<TestRowItem>(ctx.deps);
    const ref0 = existingRef(0, 0);
    const ref1 = existingRef(1, 1);
    const item0 = cache.get(ref0);
    const item1 = cache.get(ref1);
    ctx.setDirty(0, 1, "changed");
    assert.notEqual(cache.get(ref0), item0);
    assert.equal(cache.get(ref1), item1);
    // The test builder copies the base row, so content is unchanged — the
    // contract under test is that the item was rebuilt for the dirty row only.
    assert.deepEqual(cache.get(ref0).data, ["a", "b"]);
    // Reverting to the base values is a different snapshot shape, then stable.
    ctx.clearDirty(0);
    const reverted = cache.get(ref0);
    assert.deepEqual(reverted.data, ["a", "b"]);
    assert.equal(cache.get(ref0), reverted);
    assert.equal(cache.get(ref1), item1);
  });

  test("new rows rebuild on the new-rows revision only", () => {
    const ctx = makeDeps();
    const cache = createGridRowItemCache<TestRowItem>(ctx.deps);
    const newRef: GridDisplayRowRef = { id: -1, displayIndex: 2, newIndex: 0, isNew: true, isDeleted: false, status: "new" };
    const item = cache.get(newRef);
    ctx.bumpRows();
    assert.equal(cache.get(newRef), item, "rows revision must not affect new rows");
    ctx.bumpNewRows();
    assert.notEqual(cache.get(newRef), item);
  });

  test("existing rows rebuild on the rows revision or base-row replacement", () => {
    const ctx = makeDeps();
    const cache = createGridRowItemCache<TestRowItem>(ctx.deps);
    const ref = existingRef(0, 0);
    const item = cache.get(ref);
    ctx.bumpNewRows();
    assert.equal(cache.get(ref), item, "new-rows revision must not affect existing rows");
    ctx.bumpRows();
    assert.notEqual(cache.get(ref), item);
    const afterRevision = cache.get(ref);
    ctx.replaceBaseRow(0, ["x", "y"]);
    assert.notEqual(cache.get(ref), afterRevision);
    assert.deepEqual(cache.get(ref).data, ["x", "y"]);
  });

  test("rebuilding after a ref change uses the new ref", () => {
    const ctx = makeDeps();
    const cache = createGridRowItemCache<TestRowItem>(ctx.deps);
    const clean = cache.get(existingRef(0, 0));
    const editedRef: GridDisplayRowRef = { ...existingRef(0, 0), status: "edited" };
    const edited = cache.get(editedRef);
    assert.notEqual(clean, edited);
    assert.equal(edited.ref.status, "edited");
  });
});

describe("createGridProjectionCache", () => {
  test("reuses projections until the item or version changes", () => {
    const cache = createGridProjectionCache<GridDisplayRowRef, { id: number }>((ref) => ({ id: ref.id }));
    const refA = existingRef(0, 0);
    const first = cache.get(refA);
    assert.equal(cache.get(refA), first);
    cache.invalidate();
    assert.notEqual(cache.get(refA), first);
    const second = cache.get(refA);
    assert.equal(cache.get(refA), second);
  });
});

describe("createGridRowSearchCache", () => {
  test("rescans only when the query or row item changes", () => {
    let scans = 0;
    const cache = createGridRowSearchCache<TestRowItem>((item, q) => {
      scans++;
      return item.data.reduce<number[]>((acc, _value, col) => {
        if (String(item.data[col]).toLowerCase().includes(q)) acc.push(col);
        return acc;
      }, []);
    });
    const ctx = makeDeps();
    const itemCache = createGridRowItemCache<TestRowItem>(ctx.deps);
    const ref = existingRef(0, 0);
    assert.deepEqual(cache.matchesFor(ref, itemCache.get(ref), "a"), [0]);
    assert.deepEqual(cache.matchesFor(ref, itemCache.get(ref), "a"), [0]);
    assert.equal(scans, 1);
    assert.deepEqual(cache.matchesFor(ref, itemCache.get(ref), "b"), [1]);
    assert.equal(scans, 2);
    ctx.setDirty(0, 1, "match-a");
    const before = itemCache.get(ref);
    ctx.setDirty(0, 1, "match-b");
    const rebuilt = itemCache.get(ref);
    assert.notEqual(rebuilt, before, "dirty change must rebuild the row item");
    assert.deepEqual(cache.matchesFor(ref, rebuilt, "a"), [0], "rescans the rebuilt item");
    assert.equal(scans, 3);
    const otherRef = existingRef(1, 1);
    assert.deepEqual(cache.matchesFor(otherRef, itemCache.get(otherRef), "a"), []);
    assert.equal(scans, 4);
  });
});
