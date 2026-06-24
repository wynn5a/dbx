import { describe, expect, it } from "vitest";
import { parseExplainResult } from "@/lib/explainPlan";
import type { QueryResult } from "@/types/database";

// Mirrors the column order of SET SHOWPLAN_ALL ON.
const COLUMNS = [
  "StmtText",
  "StmtId",
  "NodeId",
  "Parent",
  "PhysicalOp",
  "LogicalOp",
  "Argument",
  "DefinedValues",
  "EstimateRows",
  "EstimateIO",
  "EstimateCPU",
  "AvgRowSize",
  "TotalSubtreeCost",
  "OutputList",
  "Warnings",
  "Type",
  "Parallel",
  "EstimateExecutions",
];

function showplanResult(rows: (string | number | null)[][]): QueryResult {
  return { columns: COLUMNS, rows, affected_rows: 0, execution_time_ms: 1 };
}

describe("parseSqlServerExplain", () => {
  it("builds a tree from NodeId/Parent and extracts table/index from Argument", () => {
    const result = showplanResult([
      // statement row (Type = SELECT) — root
      [
        "SELECT * FROM dbo.t WHERE id = 1",
        1,
        1,
        0,
        null,
        null,
        null,
        null,
        1,
        null,
        null,
        null,
        0.0033,
        null,
        null,
        "SELECT",
        0,
        null,
      ],
      // operator row — child of node 1
      [
        "  |--Clustered Index Seek(...)",
        1,
        2,
        1,
        "Clustered Index Seek",
        "Clustered Index Seek",
        "OBJECT:([db].[dbo].[t].[PK_t]), SEEK:([db].[dbo].[t].[id]=(1)) ORDERED FORWARD",
        null,
        1,
        null,
        null,
        9,
        0.0033,
        null,
        null,
        "PLAN_ROW",
        0,
        1,
      ],
    ]);

    const plan = parseExplainResult("sqlserver", result);
    expect(plan.databaseType).toBe("sqlserver");
    expect(plan.nodes).toHaveLength(1);

    const root = plan.nodes[0];
    expect(root.nodeType).toBe("SELECT");
    expect(root.cost).toBe("0.0033");
    expect(root.children).toHaveLength(1);

    const seek = root.children[0];
    expect(seek.nodeType).toBe("Clustered Index Seek");
    expect(seek.relation).toBe("t");
    expect(seek.index).toBe("PK_t");
    expect(seek.title).toBe("Clustered Index Seek on t");
    expect(seek.rows).toBe("1");
    expect(seek.width).toBe("9");
    // The predicate (minus the OBJECT clause) is surfaced as a detail.
    expect(seek.details.some((d) => d.includes("SEEK:"))).toBe(true);
  });

  it("strips a trailing alias from the Argument object", () => {
    const result = showplanResult([
      ["SELECT", 1, 1, 0, null, null, null, null, 1, null, null, null, 1, null, null, "SELECT", 0, null],
      [
        "  |--Table Scan",
        1,
        2,
        1,
        "Table Scan",
        "Table Scan",
        "OBJECT:([db].[dbo].[orders] AS [o])",
        null,
        100,
        null,
        null,
        12,
        1,
        null,
        null,
        "PLAN_ROW",
        0,
        1,
      ],
    ]);

    const scan = parseExplainResult("sqlserver", result).nodes[0].children[0];
    expect(scan.relation).toBe("orders");
    expect(scan.index).toBeUndefined();
  });
});
