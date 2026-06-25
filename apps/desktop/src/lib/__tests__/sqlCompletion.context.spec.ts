import { describe, expect, it } from "vitest";
import { buildSqlCompletionItems, getSqlCompletionContext, shouldAutoOpenSqlCompletion } from "@/lib/sqlCompletion";

describe("shouldAutoOpenSqlCompletion after numeric literals", () => {
  it("does not auto-open after a completed numeric value in a comparison", () => {
    const sql = "select * from dashboards t where t.id = 1000";
    expect(shouldAutoOpenSqlCompletion(sql, sql.length)).toBe(false);
  });

  it("does not auto-open after a decimal value", () => {
    const sql = "select * from t where t.price = 19.95";
    expect(shouldAutoOpenSqlCompletion(sql, sql.length)).toBe(false);
  });

  it("does not auto-open after a numeric value inside an IN list", () => {
    const sql = "select * from t where t.id in (1, 2, 3";
    // previous char is a digit, not a bracket, so the value-literal guard applies
    expect(shouldAutoOpenSqlCompletion(sql, sql.length)).toBe(false);
  });

  it("still auto-opens for an identifier whose tail is a digit", () => {
    const sql = "select * from addr2";
    expect(shouldAutoOpenSqlCompletion(sql, sql.length)).toBe(true);
  });

  it("still auto-opens after a qualifier dot", () => {
    const sql = "select t. from orders t";
    expect(shouldAutoOpenSqlCompletion(sql, "select t.".length)).toBe(true);
  });
});

describe("sqlCompletion quoted schema qualifiers", () => {
  it("parses quoted PostgreSQL schema names before a dot", () => {
    const sql = 'SELECT *\nFROM "order-management".';
    const context = getSqlCompletionContext(sql, sql.length);

    expect(context.qualifier).toBe("order-management");
    expect(context.prefix).toBe("");
    expect(context.suggestTables).toBe(true);
    expect(context.exclusiveColumnSuggestions).toBe(false);
  });

  it("suggests tables after a quoted schema qualifier", () => {
    const sql = 'SELECT *\nFROM "order-management".';
    const items = buildSqlCompletionItems(sql, sql.length, {
      dialect: "postgres",
      tables: [
        { name: "orders", schema: "order-management", type: "table" },
        { name: "shipments", schema: "order-management", type: "table" },
      ],
      columnsByTable: new Map(),
    });

    expect(items.some((item) => item.label === "orders" && item.type === "table")).toBe(true);
    expect(items.some((item) => item.label === "shipments" && item.type === "table")).toBe(true);
  });
});

describe("sqlCompletion column vs snippet ranking", () => {
  const sql = "SELECT * FROM new_test WHERE name = 'eee' AND c";
  const buildItems = () =>
    buildSqlCompletionItems(sql, sql.length, {
      tables: [{ name: "new_test", type: "table" }],
      columnsByTable: new Map([
        [
          "new_test",
          [
            { name: "created_at", table: "new_test", dataType: "datetime" },
            { name: "name", table: "new_test", dataType: "varchar" },
            { name: "id", table: "new_test", dataType: "bigint" },
          ],
        ],
      ]),
    });

  it("ranks a matching column of a referenced table above snippets in a WHERE clause", () => {
    const items = buildItems();
    const column = items.find((item) => item.label === "created_at" && item.type === "column");
    const topSnippet = items.find((item) => item.type === "snippet");
    expect(column).toBeDefined();
    if (topSnippet) {
      expect(column!.boost).toBeGreaterThan(topSnippet.boost);
    }
  });

  it("does not suggest statement-starting snippets mid-expression", () => {
    const labels = buildItems()
      .filter((item) => item.type === "snippet")
      .map((item) => item.label);
    expect(labels).not.toContain("create table");
    expect(labels).not.toContain("create index");
    expect(labels).not.toContain("common table expression");
  });
});

describe("sqlCompletion statement boundaries", () => {
  it("does not bleed into the next statement when a semicolon is missing", () => {
    // No semicolon after the AutomationQueue select; the following lines start a
    // separate statement that also aliases a table as `t`.
    const sql = ["select * from AutomationQueue t where t.", "SELECT *", "FROM Automations t where t.id = 1;"].join(
      "\n",
    );
    const cursor = sql.indexOf("where t.") + "where t.".length;
    const context = getSqlCompletionContext(sql, cursor);

    expect(context.qualifier).toBe("t");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["AutomationQueue"]);
  });

  it("keeps UNION-ed selects in a single statement", () => {
    const sql = "select a from t1\nunion all\nselect b from t2 where t2.";
    const cursor = sql.indexOf("from t1") + "from t1".length;
    const context = getSqlCompletionContext(sql, cursor);

    expect(context.referencedTables.map((table) => table.name)).toEqual(["t1", "t2"]);
  });

  it("does not bound the outer statement at a subquery select", () => {
    const sql = "select * from orders o where o.id in (\nselect id from items i where i.\n)";
    const cursor = sql.indexOf("where i.") + "where i.".length;
    const context = getSqlCompletionContext(sql, cursor);

    expect(context.qualifier).toBe("i");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["items"]);
  });

  it("keeps a multi-line single statement intact", () => {
    const sql = "SELECT *\nFROM Automations t where t.";
    const context = getSqlCompletionContext(sql, sql.length);

    expect(context.qualifier).toBe("t");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["Automations"]);
  });
});
