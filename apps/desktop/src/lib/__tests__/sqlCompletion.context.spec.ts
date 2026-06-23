import { describe, expect, it } from "vitest";
import { buildSqlCompletionItems, getSqlCompletionContext } from "@/lib/sqlCompletion";

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
