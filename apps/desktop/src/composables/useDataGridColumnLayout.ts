import { computed, ref, watch, type ComputedRef } from "vue";
import {
  canPinColumnName,
  mergeDataGridColumnOrder,
  normalizeDataGridColumnLayout,
  pinColumnInLayout,
  resolveDataGridColumnRenderOrder,
  unpinColumnFromLayout,
  type DataGridColumnLayout,
} from "@/lib/dataGridColumnLayout";

/**
 * Per-tab column layout (widths + manual order + pinned columns), keyed by the
 * DataGrid `cacheKey` (`<tabId>` or `<tabId>-<resultIndex>`) — the same keying
 * system the pending-changes/scroll snapshots use. Entries survive DataGrid
 * unmount/remount (tab switches, result re-executions) for the lifetime of the
 * session and are dropped when their tab closes.
 *
 * Each entry remembers the grid scope it was saved for: the cache key alone is
 * reused by every query run in the same tab (`<tab>-0`), so a layout saved for
 * query A must not be restored onto query B's result.
 */
interface CachedDataGridColumnLayout {
  /** Scope key the layout belongs to; undefined = unscoped (tests). */
  scope?: string;
  layout: DataGridColumnLayout;
}

const layoutCache = new Map<string, CachedDataGridColumnLayout>();

function cacheKeyBelongsToTab(cacheKey: string, tabId: string) {
  return cacheKey === tabId || cacheKey.startsWith(`${tabId}-`);
}

export function clearDataGridColumnLayoutsForTab(tabId: string) {
  layoutCache.delete(tabId);
  for (const key of [...layoutCache.keys()]) {
    if (cacheKeyBelongsToTab(key, tabId)) layoutCache.delete(key);
  }
}

export function readDataGridColumnLayoutForTesting(cacheKey: string): DataGridColumnLayout | undefined {
  return layoutCache.get(cacheKey)?.layout;
}

export function writeDataGridColumnLayoutForTesting(cacheKey: string, layout: DataGridColumnLayout, scope?: string) {
  layoutCache.set(cacheKey, { scope, layout: normalizeDataGridColumnLayout(layout) });
}

function restorableLayout(cacheKey: string | undefined, scope: string): DataGridColumnLayout | undefined {
  const cached = cacheKey ? layoutCache.get(cacheKey) : undefined;
  if (!cached) return undefined;
  if (cached.scope !== undefined && cached.scope !== scope) return undefined;
  return cached.layout;
}

export interface UseDataGridColumnLayoutOptions {
  /** DataGrid cache key: `<tabId>` (table data) or `<tabId>-<resultIndex>`. */
  cacheKey: ComputedRef<string | undefined>;
  /** All result column names (actual result column indexes index into this). */
  columnNames: ComputedRef<string[]>;
  /** Visible column indexes in the original (visibility-filtered) order. */
  baseVisibleColumnIndexes: ComputedRef<number[]>;
  /**
   * Identity of the grid scope (connection/database/table/sql/columns). A
   * change resets the layout — same lifecycle as the hidden-column reset.
   */
  scopeKey: ComputedRef<string>;
}

export function useDataGridColumnLayout(options: UseDataGridColumnLayoutOptions) {
  const { cacheKey, columnNames, baseVisibleColumnIndexes, scopeKey } = options;

  // Order keys (`dataGridColumnOrderKeys`): names, disambiguated for duplicates.
  const columnOrderNames = ref<string[] | undefined>(undefined);
  const pinnedColumnNames = ref<string[]>([]);
  const persistedWidths = ref<Record<string, number> | undefined>(undefined);

  // Restore the per-tab layout once per DataGrid instance — only when it was
  // saved for this same scope (same table / SQL / column set).
  const initial = normalizeDataGridColumnLayout(restorableLayout(cacheKey.value, scopeKey.value));
  columnOrderNames.value = initial.order;
  pinnedColumnNames.value = initial.pinned ?? [];
  persistedWidths.value = initial.widths;

  function persist() {
    const key = cacheKey.value;
    if (!key) return;
    const layout: DataGridColumnLayout = {};
    if (persistedWidths.value && Object.keys(persistedWidths.value).length > 0) {
      layout.widths = { ...persistedWidths.value };
    }
    if (columnOrderNames.value && columnOrderNames.value.length > 0) {
      layout.order = [...columnOrderNames.value];
    }
    if (pinnedColumnNames.value.length > 0) {
      layout.pinned = [...pinnedColumnNames.value];
    }
    layoutCache.set(key, { scope: scopeKey.value, layout });
  }

  watch([columnOrderNames, pinnedColumnNames], persist);

  const orderedVisibleColumnIndexes = computed(() =>
    resolveDataGridColumnRenderOrder({
      columnNames: columnNames.value,
      visibleColumnIndexes: baseVisibleColumnIndexes.value,
      order: columnOrderNames.value,
      pinned: pinnedColumnNames.value,
    }),
  );

  const pinnedVisiblePrefixCount = computed(() => {
    const pinnedSet = new Set(pinnedColumnNames.value);
    let count = 0;
    for (const actualIdx of orderedVisibleColumnIndexes.value) {
      if (!pinnedSet.has(columnNames.value[actualIdx] ?? "")) break;
      count++;
    }
    return count;
  });

  function isColumnNamePinned(name: string): boolean {
    return pinnedColumnNames.value.includes(name);
  }

  const visibleColumnNames = computed(() =>
    baseVisibleColumnIndexes.value.map((actualIdx) => columnNames.value[actualIdx] ?? ""),
  );

  /** Whether pinning `name` still leaves a visible unpinned column (hidden pinned names don't count). */
  function canPinColumn(name: string): boolean {
    return canPinColumnName(name, pinnedColumnNames.value, visibleColumnNames.value);
  }

  /** Pin by actual result column index (header menus resolve to indexes). */
  function pinColumn(actualColumnIndex: number): boolean {
    const name = columnNames.value[actualColumnIndex];
    if (!name) return false;
    const result = pinColumnInLayout(name, pinnedColumnNames.value, visibleColumnNames.value);
    if (!result.changed) return false;
    pinnedColumnNames.value = result.pinned;
    return true;
  }

  function unpinColumn(actualColumnIndex: number): boolean {
    const name = columnNames.value[actualColumnIndex];
    if (!name) return false;
    const result = unpinColumnFromLayout(name, pinnedColumnNames.value);
    if (!result.changed) return false;
    pinnedColumnNames.value = result.pinned;
    return true;
  }

  function togglePinColumn(actualColumnIndex: number): boolean {
    const name = columnNames.value[actualColumnIndex];
    if (!name) return false;
    return isColumnNamePinned(name) ? unpinColumn(actualColumnIndex) : pinColumn(actualColumnIndex);
  }

  /**
   * Replace the manual order with the given render order (actual indexes of the
   * visible columns). Hidden columns keep their previous slot.
   */
  function setColumnOrder(renderOrder: number[]) {
    columnOrderNames.value = mergeDataGridColumnOrder({
      columnNames: columnNames.value,
      renderOrder,
      previousOrder: columnOrderNames.value,
    });
  }

  /** Store column widths (name -> px) produced by the resize composable. */
  function setColumnWidths(widthsByName: Record<string, number>) {
    persistedWidths.value = { ...widthsByName };
    persist();
  }

  // A scope change (different table/sql/column set) resets the layout — the
  // same lifecycle the hidden-column reset follows in DataGrid.
  watch(scopeKey, () => {
    columnOrderNames.value = undefined;
    pinnedColumnNames.value = [];
    persistedWidths.value = undefined;
    persist();
  });

  return {
    orderedVisibleColumnIndexes,
    pinnedVisiblePrefixCount,
    pinnedColumnNames,
    columnOrderNames,
    persistedWidths,
    isColumnNamePinned,
    canPinColumn,
    togglePinColumn,
    setColumnOrder,
    setColumnWidths,
  };
}
