/**
 * Pure column-layout logic for the data grid: manual column order (drag
 * reorder) and pinned/frozen columns.
 *
 * The layout is persisted per tab next to the column widths (see
 * `useDataGridColumnLayout`). Both `order` and `pinned` identify columns by
 * NAME so a stored layout survives result reloads — actual column indexes are
 * unstable across queries, names are not (duplicate names from e.g. joins
 * collapse to their first occurrence; that trade-off is deliberate).
 *
 * Render order is always: pinned columns first (as a prefix, keeping their
 * relative order), then the remaining columns. Pinned is a *set* — dragging a
 * pinned column among unpinned ones reorders the sequence but the column stays
 * pinned (it stays in the sticky prefix).
 */

export interface DataGridColumnLayout {
  /** Column name -> base (unfilled) width in px, as persisted per tab. */
  widths?: Record<string, number>;
  /** Manual display order (names). Partial or stale entries are tolerated. */
  order?: string[];
  /** Pinned column names. Order inside the array carries no meaning. */
  pinned?: string[];
}

export function emptyDataGridColumnLayout(): DataGridColumnLayout {
  return {};
}

/**
 * Tolerant parse of a persisted layout. Layouts written before reorder/pin
 * existed carry `widths` only (or nothing at all) — those stay valid and mean
 * "original order, nothing pinned".
 */
export function normalizeDataGridColumnLayout(value: unknown): DataGridColumnLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const layout: DataGridColumnLayout = {};

  if (source.widths && typeof source.widths === "object" && !Array.isArray(source.widths)) {
    const widths: Record<string, number> = {};
    for (const [name, width] of Object.entries(source.widths as Record<string, unknown>)) {
      if (typeof name !== "string" || name.length === 0) continue;
      if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) continue;
      widths[name] = width;
    }
    if (Object.keys(widths).length > 0) layout.widths = widths;
  }

  if (Array.isArray(source.order)) {
    const order = source.order.filter((name): name is string => typeof name === "string" && name.length > 0);
    if (order.length > 0) layout.order = order;
  }

  if (Array.isArray(source.pinned)) {
    const pinned = source.pinned.filter((name): name is string => typeof name === "string" && name.length > 0);
    if (pinned.length > 0) layout.pinned = pinned;
  }

  return layout;
}

export function isColumnPinned(columnName: string, pinned: ReadonlyArray<string> | undefined): boolean {
  return !!pinned?.includes(columnName);
}

/**
 * Pin `columnName`. Refuses when every visible column would end up pinned
 * (same guard as column visibility: at least one unpinned column remains).
 */
export function pinColumnInLayout(
  columnName: string,
  pinned: ReadonlyArray<string> | undefined,
  visibleColumnCount: number,
): { pinned: string[]; changed: boolean } {
  if (!columnName) return { pinned: [...(pinned ?? [])], changed: false };
  if (pinned?.includes(columnName)) return { pinned: [...pinned], changed: false };
  // Pinning must keep at least one unpinned column behind.
  if (visibleColumnCount > 0 && (pinned?.length ?? 0) + 1 > visibleColumnCount - 1) {
    return { pinned: [...(pinned ?? [])], changed: false };
  }
  return { pinned: [...(pinned ?? []), columnName], changed: true };
}

/** Unpin `columnName`; unknown names are a no-op. */
export function unpinColumnFromLayout(
  columnName: string,
  pinned: ReadonlyArray<string> | undefined,
): { pinned: string[]; changed: boolean } {
  if (!pinned?.includes(columnName)) return { pinned: [...(pinned ?? [])], changed: false };
  return { pinned: pinned.filter((name) => name !== columnName), changed: true };
}

/**
 * Resolve the final render order of the visible columns.
 *
 * - `visibleColumnIndexes` are actual result column indexes in the original
 *   (post visibility-filter) order.
 * - `order` ranks columns by name; names missing from `order` keep their
 *   original relative order after all ranked ones. Names in `order` that are
 *   not visible (hidden / stale) are ignored.
 * - `pinned` stable-partitions the result: pinned columns become the prefix,
 *   both groups keep their relative order.
 */
export function resolveDataGridColumnRenderOrder(options: {
  columnNames: ReadonlyArray<string>;
  visibleColumnIndexes: ReadonlyArray<number>;
  order?: ReadonlyArray<string>;
  pinned?: ReadonlyArray<string>;
}): number[] {
  const { columnNames, visibleColumnIndexes, order, pinned } = options;

  let ordered: Array<{ actualIdx: number; name: string }>;
  if (order && order.length > 0) {
    const rankByName = new Map<string, number>();
    order.forEach((name, index) => {
      if (!rankByName.has(name)) rankByName.set(name, index);
    });
    ordered = visibleColumnIndexes
      .map((actualIdx, position) => ({ actualIdx, name: columnNames[actualIdx] ?? "", position }))
      .sort((a, b) => {
        const rankA = rankByName.get(a.name) ?? order.length + a.position;
        const rankB = rankByName.get(b.name) ?? order.length + b.position;
        return rankA - rankB;
      });
  } else {
    ordered = visibleColumnIndexes.map((actualIdx) => ({ actualIdx, name: columnNames[actualIdx] ?? "" }));
  }

  if (!pinned || pinned.length === 0) {
    return ordered.map((entry) => entry.actualIdx);
  }
  const pinnedSet = new Set(pinned);
  // Stable partition: pinned first, relative order inside both groups intact.
  const sorted = [...ordered].sort((a, b) => (pinnedSet.has(a.name) ? 0 : 1) - (pinnedSet.has(b.name) ? 0 : 1));
  return sorted.map((entry) => entry.actualIdx);
}

/**
 * Count of leading render-order columns that are pinned. The resolver puts
 * every pinned column into the prefix, so the count is the length of the
 * leading run of pinned names.
 */
export function pinnedPrefixCount(
  renderOrder: ReadonlyArray<number>,
  columnNames: ReadonlyArray<string>,
  pinned: ReadonlyArray<string> | undefined,
): number {
  if (!pinned || pinned.length === 0) return 0;
  const pinnedSet = new Set(pinned);
  let count = 0;
  while (count < renderOrder.length && pinnedSet.has(columnNames[renderOrder[count]] ?? "")) {
    count++;
  }
  return count;
}

/**
 * Move the column at `fromPos` so it lands at `insertSlot`, where slots count
 * positions of the array *without* the dragged column. Equivalent to splicing
 * the column out and splicing it back in.
 */
export function reorderColumnSlots(order: ReadonlyArray<number>, fromPos: number, insertSlot: number): number[] {
  if (fromPos < 0 || fromPos >= order.length) return [...order];
  const next = [...order];
  const [moved] = next.splice(fromPos, 1);
  const slot = Math.max(0, Math.min(next.length, insertSlot > fromPos ? insertSlot - 1 : insertSlot));
  next.splice(slot, 0, moved);
  return next;
}

/**
 * Drop target `(position, placeBefore)` from the header hit test to the insert
 * slot consumed by `reorderColumnSlots`.
 */
export function columnInsertSlot(targetPos: number, placeBefore: boolean): number {
  return placeBefore ? targetPos : targetPos + 1;
}

/**
 * True when dropping at `(targetPos, placeBefore)` would put the column
 * dragged from `fromPos` back where it came from.
 */
export function isNoopColumnDrop(fromPos: number, targetPos: number, placeBefore: boolean): boolean {
  if (targetPos === fromPos) return true;
  return placeBefore && targetPos === fromPos + 1;
}

/**
 * Permutation turning `before` into `after`: `after[i] === before[perm[i]]`.
 * Returns null when the two arrays are not the same multiset (the caller then
 * keeps the current widths).
 */
export function permutationFromOrders(before: ReadonlyArray<number>, after: ReadonlyArray<number>): number[] | null {
  if (before.length !== after.length) return null;
  const remaining = new Map<number, number>();
  for (const value of before) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  const perm: number[] = [];
  const used = new Array<number>(before.length).fill(0);
  for (const value of after) {
    const count = remaining.get(value) ?? 0;
    if (count <= 0) return null;
    remaining.set(value, count - 1);
  }
  for (const value of after) {
    let found = -1;
    for (let i = 0; i < before.length; i++) {
      if (!used[i] && before[i] === value) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    used[found] = 1;
    perm.push(found);
  }
  return perm;
}

export interface ColumnDropTarget {
  /** Insert position in render order (drop happens before/after this column). */
  position: number;
  placeBefore: boolean;
}

/**
 * Header hit test for a header drag: maps a pointer clientX to the column it
 * hovers and whether the drop goes to the left or right half.
 *
 * Coordinates: `headerRectLeft` is the header scrollport's left edge, and the
 * header's scrollLeft is synced with the grid scroller. Column content x is
 * `rowNumberWidth + offsets[position]`; pinned columns (the leading
 * `pinnedCount` positions) sit at that x regardless of scrollLeft.
 */
export function columnDropTargetAtClientX(options: {
  clientX: number;
  headerRectLeft: number;
  headerScrollLeft: number;
  rowNumberWidth: number;
  offsets: ReadonlyArray<number>;
  widths: ReadonlyArray<number>;
  pinnedCount: number;
}): ColumnDropTarget | null {
  const { clientX, headerRectLeft, headerScrollLeft, rowNumberWidth, offsets, widths, pinnedCount } = options;
  const totalColumns = widths.length;
  if (totalColumns === 0) return null;

  const x = clientX - headerRectLeft;
  if (x < rowNumberWidth) return null;

  // The pinned region lives at a fixed viewport x — independent of the scroll
  // position — so its hit test must run in viewport space.
  const pinnedTotalWidth = offsets[pinnedCount] ?? 0;
  if (x < rowNumberWidth + pinnedTotalWidth) {
    const columnLocalX = x - rowNumberWidth;
    let low = 0;
    let high = Math.min(pinnedCount, totalColumns) - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((offsets[mid + 1] ?? 0) <= columnLocalX) low = mid + 1;
      else high = mid;
    }
    const left = offsets[low] ?? 0;
    const width = widths[low] ?? 0;
    return { position: low, placeBefore: columnLocalX < left + width / 2 };
  }

  // Unpinned region: content-space x within the column region (offsets are
  // relative to it).
  const contentX = x + headerScrollLeft - rowNumberWidth;
  const positionAt = (contentPosition: number): ColumnDropTarget | null => {
    if (contentPosition < 0 || contentPosition >= totalColumns) return null;
    const left = offsets[contentPosition] ?? 0;
    const width = widths[contentPosition] ?? 0;
    return { position: contentPosition, placeBefore: contentX < left + width / 2 };
  };

  // Beyond the last column (gutter side) appends at the end.
  if (contentX >= (offsets[totalColumns] ?? 0)) {
    return { position: totalColumns - 1, placeBefore: false };
  }
  let low = pinnedCount;
  let high = totalColumns - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((offsets[mid + 1] ?? 0) <= contentX) low = mid + 1;
    else high = mid;
  }
  return positionAt(low);
}

/**
 * Viewport x of a pinned column's left edge: pinned columns render as a sticky
 * prefix, so the x is their plain content offset — deliberately independent of
 * the horizontal scroll position (this is the no-drift property).
 */
export function pinnedColumnViewportX(
  pinnedPos: number,
  offsets: ReadonlyArray<number>,
  rowNumberWidth: number,
): number {
  return rowNumberWidth + (offsets[pinnedPos] ?? 0);
}
