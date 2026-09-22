import { readFileSync } from "node:fs";
import { describe, expect, it, test } from "vitest";
import {
  CHART_MAX_ROWS,
  chartResultFromToolText,
  hasChartableNumericColumn,
  isChartableToolStep,
  parseResultTableMarkdown,
} from "../../apps/desktop/src/lib/aiChartResult.ts";

const LOCALES = ["en", "es", "it", "pt-BR", "zh-CN", "zh-TW"] as const;

// The exact markdown shape the backend streams into a tool step's resultText
// (agent_tools.rs format_query_result_as_text): header, dash underline, data
// rows, then a non-pipe "(N rows, Xms)" footer. The underline of two columns
// concatenates to a single dash/space cell, not one cell per column.
const EXECUTE_QUERY_TEXT = [
  "| name | total |",
  "| ---  --- |",
  "| alice | 10 |",
  "| bob | 20 |",
  "| NULL | 3.5 |",
  "(3 rows, 5ms)",
].join("\n");

const assistantSource = readFileSync(
  new URL("../../apps/desktop/src/components/editor/AiAssistant.vue", import.meta.url),
  "utf8",
);

describe("parseResultTableMarkdown", () => {
  it("parses the backend markdown table and drops the row-count footer", () => {
    const table = parseResultTableMarkdown(EXECUTE_QUERY_TEXT);
    expect(table).toEqual({
      columns: ["name", "total"],
      rows: [
        ["alice", 10],
        ["bob", 20],
        [null, 3.5],
      ],
    });
  });

  it("coerces padded numeric cells to numbers and NULL to null", () => {
    const table = parseResultTableMarkdown("| n | s |\n| --- |\n| 42 | x |\n| -1.5 | 2024-01-01 |\n(2 rows, 1ms)");
    expect(table).toEqual({
      columns: ["n", "s"],
      rows: [
        [42, "x"],
        [-1.5, "2024-01-01"],
      ],
    });
  });

  it("unescapes the backend's \\| pipe escaping inside cells", () => {
    const table = parseResultTableMarkdown("| v | w |\n| ---  --- |\n| a\\|b | 1 |\n(1 rows, 1ms)");
    expect(table?.rows).toEqual([["a|b", 1]]);
  });

  it("keeps truncated cells as text instead of misreading them as numbers", () => {
    const longNumber = `${"1234567890".repeat(21)}…`;
    const table = parseResultTableMarkdown(`| v |\n| --- |\n| ${longNumber} |\n(1 rows, 1ms)`);
    expect(table?.rows).toEqual([[longNumber]]);
  });

  it("returns null for prose, error text and no-column statements", () => {
    expect(parseResultTableMarkdown("Here is the analysis of your schema.")).toBeNull();
    expect(parseResultTableMarkdown("Error: relation \"users\" does not exist")).toBeNull();
    expect(parseResultTableMarkdown("(no columns returned; 12 affected rows, 30ms)")).toBeNull();
    expect(parseResultTableMarkdown("")).toBeNull();
  });

  it("parses a zero-row result to an empty row list", () => {
    const table = parseResultTableMarkdown("| a |\n| --- |\n(0 rows, 2ms)");
    expect(table).toEqual({ columns: ["a"], rows: [] });
  });
});

describe("chartResultFromToolText (result card → QueryChart props)", () => {
  it("maps columns and rows straight through into a QueryResult-shaped prop", () => {
    const result = chartResultFromToolText(EXECUTE_QUERY_TEXT);
    expect(result).toEqual({
      columns: ["name", "total"],
      rows: [
        ["alice", 10],
        ["bob", 20],
        [null, 3.5],
      ],
      affected_rows: 0,
      execution_time_ms: 0,
    });
  });

  it("yields null for anything without chartable rows", () => {
    expect(chartResultFromToolText(undefined)).toBeNull();
    expect(chartResultFromToolText("plain prose answer")).toBeNull();
    expect(chartResultFromToolText("| a |\n| --- |\n(0 rows, 2ms)")).toBeNull();
  });

  it("caps rows at CHART_MAX_ROWS so an oversized table cannot fan the chart out", () => {
    const rows = Array.from({ length: CHART_MAX_ROWS + 50 }, (_, i) => `| r${i} | ${i} |`).join("\n");
    const result = chartResultFromToolText(`| k | v |\n| ---  --- |\n${rows}\n(150 rows, 9ms)`);
    expect(result?.rows.length).toBe(CHART_MAX_ROWS);
    expect(result?.rows[0]).toEqual(["r0", 0]);
  });
});

describe("hasChartableNumericColumn", () => {
  it("sees a chartable series when any column carries a number", () => {
    expect(hasChartableNumericColumn({ columns: ["name", "total"], rows: [["alice", 10]] })).toBe(true);
  });

  it("rejects all-text tables and empty results", () => {
    expect(hasChartableNumericColumn({ columns: ["name"], rows: [["alice"], ["bob"]] })).toBe(false);
    expect(hasChartableNumericColumn({ columns: ["a", "b"], rows: [] })).toBe(false);
  });
});

describe("isChartableToolStep (whether the result card shows the Chart action)", () => {
  const step = (overrides: Partial<{ name: string; status: string; resultText: string }> = {}) => ({
    name: "execute_query",
    status: "done",
    resultText: EXECUTE_QUERY_TEXT,
    ...overrides,
  });

  it("offers the chart on finished query/sample tools with a numeric column", () => {
    expect(isChartableToolStep(step())).toBe(true);
    expect(isChartableToolStep(step({ name: "get_sample_data" }))).toBe(true);
  });

  it("stays hidden for non-row tools, unfinished or failed calls", () => {
    expect(isChartableToolStep(step({ name: "list_tables" }))).toBe(false);
    expect(isChartableToolStep(step({ name: "explain_query" }))).toBe(false);
    expect(isChartableToolStep(step({ status: "running" }))).toBe(false);
    expect(isChartableToolStep(step({ status: "error", resultText: "Error: syntax error" }))).toBe(false);
  });

  it("stays hidden when the table has no numeric column or no rows", () => {
    expect(isChartableToolStep(step({ resultText: "| name |\n| --- |\n| alice |\n(1 rows, 1ms)" }))).toBe(false);
    expect(isChartableToolStep(step({ resultText: "| a |\n| --- |\n(0 rows, 1ms)" }))).toBe(false);
  });
});

describe("AiAssistant wiring contract", () => {
  it("loads QueryChart lazily (ECharts stays out of the chat chunk), never statically", () => {
    expect(assistantSource).toMatch(/defineAsyncComponent\(\(\) => import\("@\/components\/chart\/QueryChart\.vue"\)\)/);
    expect(assistantSource).not.toMatch(/^import QueryChart /m);
  });

  it("gates the action on the pure predicate and feeds the parsed result as the prop", () => {
    expect(assistantSource).toMatch(/import \{ chartResultFromToolText, isChartableToolStep \} from "@\/lib\/aiChartResult";/);
    expect(assistantSource).toMatch(/v-if="isChartableToolStep\(step\)"/);
    expect(assistantSource).toMatch(/v-if="chartStepId === step\.id && stepChartResult\(step\)"/);
    expect(assistantSource).toMatch(/:result="stepChartResult\(step\)!"/);
    expect(assistantSource).toMatch(/@click="toggleStepChart\(step\.id\)"/);
  });

  it("labels the action from the shared ai.chartResult key", () => {
    expect(assistantSource).toMatch(/t\("ai\.chartResult"\)/);
  });
});

test("the chart action label is translated in all six locales", () => {
  for (const locale of LOCALES) {
    const source = readFileSync(
      new URL(`../../apps/desktop/src/i18n/locales/${locale}.ts`, import.meta.url),
      "utf8",
    );
    const match = source.match(/chartResult: "([^"]+)"/);
    expect(match, `${locale} defines ai.chartResult`).toBeTruthy();
    expect(match![1].length, `${locale} label is non-empty`).toBeGreaterThan(0);
  }
});
