/**
 * Horizontal scroll math for bringing a scrollable (non-pinned) grid column on
 * screen. Coordinates are in scroller content space: `columnLeft` already
 * includes the row-number gutter. The row-number gutter and pinned columns are
 * sticky, so the part of the viewport a scrollable column can actually show is
 * `[scrollLeft + rowNumberWidth + pinnedWidth, scrollLeft + clientWidth]` —
 * aligning against the raw viewport would leave the column under the pinned
 * area.
 */
export interface DataGridColumnScrollGeometry {
  columnLeft: number;
  columnWidth: number;
  scrollLeft: number;
  clientWidth: number;
  rowNumberWidth: number;
  pinnedWidth: number;
}

function stickyWidth(geometry: DataGridColumnScrollGeometry): number {
  return geometry.rowNumberWidth + geometry.pinnedWidth;
}

/** The scrollLeft that reveals the column with minimal movement, or null when it is already fully visible. */
export function dataGridScrollLeftToRevealColumn(geometry: DataGridColumnScrollGeometry): number | null {
  const { columnLeft, columnWidth, scrollLeft, clientWidth } = geometry;
  const sticky = stickyWidth(geometry);
  const viewportLeft = scrollLeft + sticky;
  const viewportRight = scrollLeft + clientWidth;
  const alignLeft = Math.max(0, columnLeft - sticky);
  if (columnLeft < viewportLeft) return alignLeft;
  if (columnLeft + columnWidth > viewportRight) {
    // A column wider than the scrollable area keeps its left edge (and header) visible.
    if (columnWidth > clientWidth - sticky) return alignLeft;
    return Math.max(0, columnLeft + columnWidth - clientWidth);
  }
  return null;
}

/** The scrollLeft that centers the column within the scrollable (non-sticky) part of the viewport. */
export function dataGridScrollLeftToCenterColumn(geometry: DataGridColumnScrollGeometry): number {
  const { columnLeft, columnWidth, clientWidth } = geometry;
  const sticky = stickyWidth(geometry);
  const available = Math.max(0, clientWidth - sticky);
  return Math.max(0, columnLeft + columnWidth / 2 - sticky - available / 2);
}
