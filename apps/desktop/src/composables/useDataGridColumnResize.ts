import { ref, computed, type ComputedRef, type Ref } from "vue";
import { useElementSize } from "@vueuse/core";
import {
  calculateDataGridColumnWidth,
  DATA_GRID_COL_MIN_WIDTH,
  DATA_GRID_SAMPLE_ROWS,
} from "@/lib/dataGridColumnWidth";

type CellValue = string | number | boolean | null;

export const DATA_GRID_ROW_NUM_WIDTH = 48;

export interface UseDataGridColumnResizeOptions {
  columns: ComputedRef<string[]>;
  sourceRows: ComputedRef<CellValue[][]>;
  columnIndexes: ComputedRef<number[]>;
  gridRef: Ref<HTMLDivElement | undefined>;
  scrollbarGutter?: Ref<number>;
  /** Live inner (client) width of the grid scroller, when measured. */
  viewportWidth?: Ref<number>;
  /** Persisted widths (column name -> px) applied when widths initialize. */
  initialWidthsByName?: Ref<Record<string, number> | undefined> | ComputedRef<Record<string, number> | undefined>;
  /** Called once a width change settles (resize end / auto fit / re-init). */
  onWidthsSettled?: (widthsByName: Record<string, number>, columnNames: string[]) => void;
}

export function useDataGridColumnResize(options: UseDataGridColumnResizeOptions) {
  const {
    columns,
    sourceRows,
    columnIndexes,
    gridRef,
    scrollbarGutter,
    viewportWidth,
    initialWidthsByName,
    onWidthsSettled,
  } = options;

  const columnWidths = ref<number[]>([]);
  const { width: gridWidth } = useElementSize(gridRef);
  let isResizing = false;

  function sampleColumnValues(visibleColIdx: number): CellValue[] {
    const actualColIdx = columnIndexes.value[visibleColIdx];
    const rows = sourceRows.value;
    const end = Math.min(rows.length, DATA_GRID_SAMPLE_ROWS);
    const values: CellValue[] = [];
    for (let i = 0; i < end; i++) {
      values.push(rows[i][actualColIdx] ?? null);
    }
    return values;
  }

  function computedColumnWidth(visibleColIdx: number, colName: string): number {
    return (
      initialWidthsByName?.value?.[colName] ??
      calculateDataGridColumnWidth({
        columnName: colName,
        sampleValues: sampleColumnValues(visibleColIdx),
      })
    );
  }

  function reportWidthsSettled() {
    if (!onWidthsSettled) return;
    const names = columns.value;
    const widths: Record<string, number> = {};
    columnWidths.value.forEach((width, index) => {
      const name = names[index];
      if (name) widths[name] = width;
    });
    onWidthsSettled(widths, names);
  }

  function initColumnWidths() {
    if (columnWidths.value.length !== columns.value.length) {
      columnWidths.value = columns.value.map((colName, colIdx) => computedColumnWidth(colIdx, colName));
      reportWidthsSettled();
    }
  }

  /** Force widths back to the computed/persisted defaults (scope change). */
  function resetColumnWidths() {
    columnWidths.value = columns.value.map((colName, colIdx) => computedColumnWidth(colIdx, colName));
    reportWidthsSettled();
  }

  /**
   * Re-key the positional widths after a reorder/pin: `perm[i]` is the
   * position the column now at `i` came from. A null permutation (orders are
   * not the same multiset) is a no-op.
   */
  function applyWidthPermutation(perm: number[] | null) {
    if (!perm || perm.length !== columnWidths.value.length) return;
    if (perm.every((value, index) => value === index)) return;
    columnWidths.value = perm.map((from) => columnWidths.value[from] ?? 0);
  }

  function onResizeStart(colIdx: number, event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    const startX = event.clientX;
    const startWidth = columnWidths.value[colIdx];
    const onMove = (e: MouseEvent) => {
      columnWidths.value[colIdx] = Math.max(DATA_GRID_COL_MIN_WIDTH, startWidth + e.clientX - startX);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      requestAnimationFrame(() => {
        isResizing = false;
      });
      reportWidthsSettled();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function autoFitColumn(colIdx: number) {
    const colName = columns.value[colIdx];
    if (!colName) return;
    columnWidths.value[colIdx] = calculateDataGridColumnWidth({
      columnName: colName,
      sampleValues: sampleColumnValues(colIdx),
    });
    reportWidthsSettled();
  }

  const baseTotalWidth = computed(() => columnWidths.value.reduce((a, b) => a + b, 0));

  const renderedColumnWidths = computed(() => {
    const widths = columnWidths.value;
    if (widths.length === 0) return widths;

    // Fill the columns to the scroller's content area. The root-width-minus-gutter
    // estimate can transiently over-shoot the real client width (e.g. a stale
    // scrollbar gutter right after the cell-detail panel resizes the grid), which
    // would stretch the columns a scrollbar-width past what fits and leave a
    // spurious horizontal scrollbar. Clamp to the directly-measured viewport width
    // when we have it so the fill can never exceed the visible client area.
    const estimatedWidth = Math.max(0, gridWidth.value - (scrollbarGutter?.value ?? 0));
    const measuredWidth = viewportWidth?.value ?? 0;
    const availableWidth = measuredWidth > 0 ? Math.min(estimatedWidth, measuredWidth) : estimatedWidth;
    const extraWidth = Math.max(0, availableWidth - DATA_GRID_ROW_NUM_WIDTH - baseTotalWidth.value);
    if (extraWidth === 0) return widths;

    const extraPerColumn = extraWidth / widths.length;
    return widths.map((width) => width + extraPerColumn);
  });

  const totalWidth = computed(() => renderedColumnWidths.value.reduce((a, b) => a + b, 0) + DATA_GRID_ROW_NUM_WIDTH);

  const columnVars = computed(() => {
    const vars: Record<string, string> = {};
    renderedColumnWidths.value.forEach((w, i) => {
      vars[`--col-w-${i}`] = `${w}px`;
    });
    vars["--row-num-w"] = `${DATA_GRID_ROW_NUM_WIDTH}px`;
    vars["--total-w"] = `${totalWidth.value}px`;
    return vars;
  });

  function getIsResizing() {
    return isResizing;
  }

  return {
    columnWidths,
    initColumnWidths,
    resetColumnWidths,
    applyWidthPermutation,
    onResizeStart,
    autoFitColumn,
    renderedColumnWidths,
    totalWidth,
    columnVars,
    getIsResizing,
  };
}
