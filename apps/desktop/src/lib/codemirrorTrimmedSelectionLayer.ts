import { EditorSelection } from "@codemirror/state";
import { layer, RectangleMarker, type BlockInfo, type EditorView } from "@codemirror/view";

const MIN_EMPTY_LINE_WIDTH = 14;
const END_OF_LINE_PADDING = 3;
const CONTIGUOUS_LINE_GAP = 1.5;
const CORNER_COVERAGE_GAP = 1;

type TrimmedSelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function layerBase(view: EditorView) {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
}

// A wrapped document line renders as several visual rows sharing one line
// block, so rects are computed per row: the block only provides the vertical
// slot, and the row containing `y` is derived from the uniform row height.
function rowRect(
  view: EditorView,
  lineBlock: BlockInfo,
  base: { left: number; top: number },
  y: number,
  left: number,
  right: number,
): TrimmedSelectionRect {
  const blockTop = view.documentTop + lineBlock.top;
  const rowCount = Math.max(1, Math.round(lineBlock.height / view.defaultLineHeight));
  const rowHeight = lineBlock.height / rowCount;
  const row = Math.min(rowCount - 1, Math.max(0, Math.floor((y - blockTop) / rowHeight)));
  return {
    left: left - base.left,
    top: blockTop + row * rowHeight - base.top,
    width: Math.max(1, right - left),
    height: Math.max(1, rowHeight),
  };
}

function markersForLineRange(
  view: EditorView,
  from: number,
  to: number,
  lineFrom: number,
  lineTo: number,
  lineBlock: BlockInfo,
  includesLineBreak: boolean,
  base: { left: number; top: number },
): TrimmedSelectionRect[] {
  const lineStart = view.coordsAtPos(lineFrom, 1);
  const lineEnd = view.coordsAtPos(lineTo, -1) ?? lineStart;

  if (from >= to) {
    // Empty line inside a multi-line selection.
    if (!lineStart) return [];
    return [
      rowRect(
        view,
        lineBlock,
        base,
        (lineStart.top + lineStart.bottom) / 2,
        lineStart.left,
        lineStart.left + MIN_EMPTY_LINE_WIDTH,
      ),
    ];
  }

  const rects: TrimmedSelectionRect[] = [];
  let rowFrom = from;
  while (rowFrom < to) {
    // End of the visual row containing rowFrom; on wrapped lines this is the
    // wrap point, not the document line end.
    const rowBoundary = view.moveToLineBoundary(EditorSelection.cursor(rowFrom, 1), true, true).head;
    const rowTo = Math.min(to, Math.max(rowBoundary, rowFrom));
    const start = view.coordsAtPos(rowFrom, 1);
    const end = rowTo > rowFrom ? view.coordsAtPos(rowTo, -1) : start;
    if (!start || !end) break;

    let right = Math.max(start.right, end.right);
    if (includesLineBreak && rowTo >= lineTo && lineEnd) {
      right = Math.max(right, lineEnd.right + END_OF_LINE_PADDING);
    }
    rects.push(rowRect(view, lineBlock, base, (start.top + start.bottom) / 2, Math.min(start.left, end.left), right));

    if (rowTo >= to || rowBoundary <= rowFrom) break;
    rowFrom = rowTo;
  }
  return rects;
}

function coversX(rect: TrimmedSelectionRect | undefined, x: number): boolean {
  if (!rect) return false;
  return rect.left <= x + CORNER_COVERAGE_GAP && rect.left + rect.width >= x - CORNER_COVERAGE_GAP;
}

function markerClass(rects: TrimmedSelectionRect[], index: number): string {
  const prev = rects[index - 1];
  const current = rects[index];
  const next = rects[index + 1];
  const touchesPrev = !!prev && Math.abs(prev.top + prev.height - current.top) <= CONTIGUOUS_LINE_GAP;
  const touchesNext = !!next && Math.abs(current.top + current.height - next.top) <= CONTIGUOUS_LINE_GAP;
  const left = current.left;
  const right = current.left + current.width;

  const classes = ["cm-trimmedSelection"];
  if (!touchesPrev || !coversX(prev, left)) classes.push("cm-trimmedSelection-topLeft");
  if (!touchesPrev || !coversX(prev, right)) classes.push("cm-trimmedSelection-topRight");
  if (!touchesNext || !coversX(next, left)) classes.push("cm-trimmedSelection-bottomLeft");
  if (!touchesNext || !coversX(next, right)) classes.push("cm-trimmedSelection-bottomRight");

  return classes.join(" ");
}

export function trimmedSelectionLayer() {
  return layer({
    above: false,
    class: "cm-trimmedSelectionLayer",
    markers(view) {
      const markers: InstanceType<typeof RectangleMarker>[] = [];
      const base = layerBase(view);

      for (const range of view.state.selection.ranges) {
        if (range.empty) continue;
        const rects: TrimmedSelectionRect[] = [];

        for (const visible of view.visibleRanges) {
          let pos = Math.max(range.from, visible.from, view.viewport.from);
          const endPos = Math.min(range.to, visible.to, view.viewport.to);

          while (pos < endPos) {
            const line = view.state.doc.lineAt(pos);
            const from = Math.max(pos, line.from);
            const to = Math.min(endPos, line.to);
            const lineBlock = view.lineBlockAt(line.from);
            const includesLineBreak = endPos > line.to && range.to > line.to;
            rects.push(...markersForLineRange(view, from, to, line.from, line.to, lineBlock, includesLineBreak, base));

            const next = line.to + 1;
            if (next <= pos) break;
            pos = next;
          }
        }

        rects.sort((a, b) => a.top - b.top || a.left - b.left);
        rects.forEach((rect, index) => {
          markers.push(new RectangleMarker(markerClass(rects, index), rect.left, rect.top, rect.width, rect.height));
        });
      }

      return markers;
    },
    update(update) {
      return update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged;
    },
  });
}
