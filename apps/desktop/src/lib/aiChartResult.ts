import type { QueryResult } from "@/types/database";

// "Chart this result" bridge for the AI assistant (perf plan §5 D8).
//
// The agent's SQL tools (`execute_query`, `get_sample_data`) stream their result
// to the chat as the markdown table rendered by the backend's
// `format_query_result_as_text` — there is no structured side-channel for them
// (unlike `explain_query`, which carries `explain_data`). These helpers parse
// that table back into a `QueryResult` so the existing `QueryChart.vue` can be
// reused as-is: no new chart code, no new dependencies.

/** Tools whose result text is a markdown table of query rows. */
const CHARTABLE_TOOLS = new Set(["execute_query", "get_sample_data"]);

/**
 * Upper bound on rows handed to the chart. The backend already caps the
 * markdown table at its own MAX_ALLOWED_ROWS (100), so this mirrors the same
 * bound defensively on the parsing side — charting can never fan out over an
 * unbounded result.
 */
export const CHART_MAX_ROWS = 100;

export interface ParsedResultTable {
  columns: string[];
  rows: (string | number | null)[][];
}

/**
 * Parse the markdown table the backend streams into tool `resultText`:
 *
 *    | name | total |
 *    | ---  | ---   |
 *    | alice | 10 |
 *
 *    (2 rows, 5ms)
 *
 * The trailing "(N rows, Xms)" footer is not a pipe line and falls away
 * naturally. Returns null when the text holds no table (prose answers, DDL
 * "(no columns returned; ...)" notes, error text).
 */
export function parseResultTableMarkdown(text: string): ParsedResultTable | null {
  const lines = text.split("\n").filter((line) => line.trim().startsWith("|"));
  if (lines.length === 0) return null;

  const columns = splitTableRow(lines[0]!).map((cell) => cell.trim());
  if (columns.length === 0) return null;

  const rows: (string | number | null)[][] = [];
  for (const line of lines.slice(1)) {
    const cells = splitTableRow(line);
    if (isSeparatorRow(cells)) continue;
    // Pad/trim so every row aligns with the header — QueryChart indexes cells
    // by column position.
    const row = columns.map((_, i) => coerceCellValue(cells[i] ?? ""));
    rows.push(row);
  }
  return { columns, rows };
}

/** Split `| a | b |` into cells, honoring the backend's `\|` pipe escaping. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|"));
}

/** The backend renders the header underline as dash/space-only cells. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^[\s:-]*$/.test(cell));
}

/**
 * Chart-side coercion for a cell. Cells arrive padded by the markdown
 * delimiter (`| alice | 10 |`), so they are trimmed first; `NULL` cells become
 * null; numeric-looking cells become numbers so QueryChart's numeric-column
 * detection (it checks `typeof row[idx] === "number"`) sees chartable series;
 * everything else stays a display string. The backend truncates cells (…
 * suffix), so a spoiled number simply stays text.
 */
function coerceCellValue(cell: string): string | number | null {
  const trimmed = cell.trim();
  if (trimmed === "NULL") return null;
  if (trimmed !== "") {
    const value = Number(trimmed);
    if (Number.isFinite(value)) return value;
  }
  return trimmed;
}

/**
 * Build the `QueryResult`-shaped prop for QueryChart from a tool step's result
 * text, or null when there is nothing to chart (no table, no rows). Column
 * names and row order pass straight through; the row cap is the guard for
 * oversized results.
 */
export function chartResultFromToolText(text: string | undefined | null): QueryResult | null {
  if (!text) return null;
  const table = parseResultTableMarkdown(text);
  if (!table || table.rows.length === 0) return null;
  return {
    columns: table.columns,
    rows: table.rows.slice(0, CHART_MAX_ROWS),
    affected_rows: 0,
    execution_time_ms: 0,
  };
}

/**
 * Whether a table has anything QueryChart can plot: at least one row (checked
 * by the caller) and at least one column with a numeric value — mirrors
 * QueryChart's own `numericColumns`/`hasData` logic so the action only appears
 * when the chart would render an actual plot rather than its empty state.
 */
export function hasChartableNumericColumn(table: Pick<QueryResult, "columns" | "rows">): boolean {
  return table.columns.some((_, idx) => table.rows.some((row) => typeof row[idx] === "number"));
}

/**
 * Whether the assistant should show the "Chart" action on a tool step: a
 * row-returning SQL tool that finished successfully with a parseable table
 * holding at least one numeric column.
 */
export function isChartableToolStep(step: { name: string; status: string; resultText?: string }): boolean {
  if (!CHARTABLE_TOOLS.has(step.name)) return false;
  if (step.status !== "done") return false;
  const result = chartResultFromToolText(step.resultText);
  return !!result && hasChartableNumericColumn(result);
}

export interface ToolStepChartCache {
  /** Memoized `chartResultFromToolText(step.resultText)`: the same object while the step's text is unchanged. */
  result(step: { id: string; resultText?: string }): QueryResult | null;
  /** Memoized `isChartableToolStep(step)`. */
  chartable(step: { id: string; name: string; status: string; resultText?: string }): boolean;
  clear(): void;
}

/**
 * Per-step memo for the chat's chart action. The assistant template re-renders
 * on every keystroke in the prompt box and every streaming delta; without a
 * memo each render re-parses every chartable step's table and hands QueryChart
 * a fresh `result` object, whose identity watch then resets the user's X/Y
 * column choices. Entries are keyed by step id and invalidated when the step's
 * `resultText` changes.
 */
export function createToolStepChartCache(): ToolStepChartCache {
  const entries = new Map<string, { text: string | undefined; result: QueryResult | null; numeric: boolean }>();

  function entry(step: { id: string; resultText?: string }) {
    const cached = entries.get(step.id);
    if (cached && cached.text === step.resultText) return cached;
    const result = chartResultFromToolText(step.resultText);
    const fresh = { text: step.resultText, result, numeric: !!result && hasChartableNumericColumn(result) };
    entries.set(step.id, fresh);
    return fresh;
  }

  return {
    result: (step) => entry(step).result,
    chartable: (step) => CHARTABLE_TOOLS.has(step.name) && step.status === "done" && entry(step).numeric,
    clear: () => entries.clear(),
  };
}
