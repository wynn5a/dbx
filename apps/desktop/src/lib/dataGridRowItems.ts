import type { CellValue } from "@/lib/cellValue";
import type { RowStatus } from "@/lib/gridRowStatus";

/**
 * Per-row caches for the data grid. Cell commits used to rebuild every row ref
 * and row item (rows of allocations per keystroke at large page sizes); these
 * caches make an edit rebuild only the touched row. Validity is fully
 * self-checking — ref field equality, revision counters, the row's dirty-entry
 * snapshot and the base row identity — so mutation sites need no invalidation
 * bookkeeping. Cached objects are frozen; treat them as read-only.
 */

export type GridDisplayRowRef =
  | {
      id: number;
      displayIndex: number;
      sourceIndex: number;
      isNew: false;
      isDeleted: boolean;
      status: RowStatus;
    }
  | {
      id: number;
      displayIndex: number;
      newIndex: number;
      isNew: true;
      isDeleted: false;
      status: RowStatus;
    };

export type GridExistingRowRef = Extract<GridDisplayRowRef, { isNew: false }>;

/** Column→value pairs currently overriding a row's base cells. */
export type GridDirtySnapshot = ReadonlyArray<readonly [number, CellValue]>;

export const NO_GRID_SEARCH_MATCHES: readonly number[] = Object.freeze([]);

export function gridDirtySnapshot(dirty: Map<number, CellValue> | undefined): GridDirtySnapshot | null {
  return dirty?.size ? Array.from(dirty, ([column, value]) => [column, value] as const) : null;
}

export function gridDirtySnapshotsEqual(a: GridDirtySnapshot | null, b: GridDirtySnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

interface GridDisplayRefCacheEntry {
  ref: GridDisplayRowRef;
  displayIndex: number;
  isNew: boolean;
  isDeleted: boolean;
  status: RowStatus;
}

export interface GridDisplayRefCache {
  existingRow(sourceIndex: number, displayIndex: number, isDeleted: boolean, status: RowStatus): GridDisplayRowRef;
  newRow(newIndex: number, displayIndex: number): GridDisplayRowRef;
  clear(): void;
}

export function createGridDisplayRefCache(limit = 150_000): GridDisplayRefCache {
  const entries = new Map<number, GridDisplayRefCacheEntry>();
  return {
    existingRow(sourceIndex, displayIndex, isDeleted, status) {
      const cached = entries.get(sourceIndex);
      if (
        cached &&
        !cached.isNew &&
        cached.displayIndex === displayIndex &&
        cached.isDeleted === isDeleted &&
        cached.status === status
      ) {
        return cached.ref;
      }
      if (entries.size >= limit) entries.clear();
      const ref: GridDisplayRowRef = Object.freeze({
        id: sourceIndex,
        displayIndex,
        sourceIndex,
        isNew: false,
        isDeleted,
        status,
      });
      entries.set(sourceIndex, { ref, displayIndex, isNew: false, isDeleted, status });
      return ref;
    },
    newRow(newIndex, displayIndex) {
      const id = -(newIndex + 1);
      const cached = entries.get(id);
      if (cached && cached.isNew && cached.displayIndex === displayIndex) return cached.ref;
      if (entries.size >= limit) entries.clear();
      const ref: GridDisplayRowRef = Object.freeze({
        id,
        displayIndex,
        newIndex,
        isNew: true,
        isDeleted: false,
        status: "new",
      });
      entries.set(id, { ref, displayIndex, isNew: true, isDeleted: false, status: "new" });
      return ref;
    },
    clear() {
      entries.clear();
    },
  };
}

export interface GridRowItemCacheDeps<TItem> {
  /** Bumped when result.rows contents are mutated in place (e.g. after a save). */
  rowsRevision(): number;
  /** Bumped when a new row's cells are mutated in place. */
  newRowsRevision(): number;
  baseRowFor(ref: GridExistingRowRef): CellValue[] | undefined;
  dirtySnapshotFor(ref: GridExistingRowRef): GridDirtySnapshot | null;
  build(ref: GridDisplayRowRef): TItem;
}

export interface GridRowItemCache<TItem> {
  get(ref: GridDisplayRowRef): TItem;
  clear(): void;
  size(): number;
}

export function createGridRowItemCache<TItem>(
  deps: GridRowItemCacheDeps<TItem>,
  limit = 150_000,
): GridRowItemCache<TItem> {
  interface Entry {
    ref: GridDisplayRowRef;
    rowsRevision: number;
    newRowsRevision: number;
    dirtySnapshot: GridDirtySnapshot | null;
    baseRow: CellValue[] | undefined;
    item: TItem;
  }
  const entries = new Map<number, Entry>();
  return {
    get(ref) {
      // Existing rows validate against the base-row state; new rows against the
      // new-rows revision. Reading only the relevant counter keeps unrelated
      // bumps (e.g. a save) from invalidating rows they cannot affect, while
      // still being tracked by the calling computed.
      const isNew = ref.isNew;
      const baseRow = isNew ? undefined : deps.baseRowFor(ref);
      const dirtySnapshot = isNew ? null : deps.dirtySnapshotFor(ref);
      const rowsRevision = isNew ? 0 : deps.rowsRevision();
      const newRowsRevision = isNew ? deps.newRowsRevision() : 0;
      const cached = entries.get(ref.id);
      if (
        cached &&
        cached.ref === ref &&
        cached.baseRow === baseRow &&
        cached.rowsRevision === rowsRevision &&
        cached.newRowsRevision === newRowsRevision &&
        gridDirtySnapshotsEqual(cached.dirtySnapshot, dirtySnapshot)
      ) {
        return cached.item;
      }
      const item = deps.build(ref);
      if (entries.size >= limit) entries.clear();
      entries.set(ref.id, { ref, rowsRevision, newRowsRevision, dirtySnapshot, baseRow, item });
      return item;
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

export interface GridProjectionCache<TItem, TProjected> {
  /** Invalidate every projection when the projection input (visible columns) changes. */
  invalidate(): void;
  get(item: TItem): TProjected;
  clear(): void;
}

export function createGridProjectionCache<TItem extends { id: number }, TProjected>(
  build: (item: TItem) => TProjected,
  limit = 150_000,
): GridProjectionCache<TItem, TProjected> {
  interface Entry {
    item: TItem;
    version: number;
    projected: TProjected;
  }
  const entries = new Map<number, Entry>();
  let version = 0;
  return {
    invalidate() {
      version++;
    },
    get(item) {
      const cached = entries.get(item.id);
      if (cached && cached.item === item && cached.version === version) return cached.projected;
      const projected = build(item);
      if (entries.size >= limit) entries.clear();
      entries.set(item.id, { item, version, projected });
      return projected;
    },
    clear() {
      entries.clear();
    },
  };
}

export interface GridRowSearchCache<TItem> {
  matchesFor(ref: GridDisplayRowRef, item: TItem, query: string): readonly number[];
  clear(): void;
}

/** Per-row search matches; valid while the query and the row item are unchanged. */
export function createGridRowSearchCache<TItem>(
  scan: (item: TItem, query: string) => number[],
  limit = 150_000,
): GridRowSearchCache<TItem> {
  interface Entry {
    query: string;
    item: TItem;
    matches: readonly number[];
  }
  const entries = new Map<number, Entry>();
  return {
    matchesFor(ref, item, query) {
      const cached = entries.get(ref.id);
      if (cached && cached.query === query && cached.item === item) return cached.matches;
      const matches = scan(item, query);
      if (entries.size >= limit) entries.clear();
      entries.set(ref.id, { query, item, matches });
      return matches;
    },
    clear() {
      entries.clear();
    },
  };
}
