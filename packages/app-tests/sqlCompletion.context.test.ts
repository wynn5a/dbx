import { describe, expect, it } from "vitest";
import {
  buildSqlCompletionItems,
  extractSqlStatementAt,
  getSqlCompletionContext,
  shouldAutoOpenSqlCompletion,
  type SqlCompletionReferencedTable,
  type SqlStatementReferences,
} from "../../apps/desktop/src/lib/sqlCompletion";

// What the backend AST analysis returns for a statement; the extraction itself
// (comments, dollar bodies, nesting) is locked by the Rust suite and by
// sqlReferences.test.ts, so context tests feed it in explicitly.
const refs = (...referencedTables: SqlCompletionReferencedTable[]): SqlStatementReferences => ({
  referencedTables,
});

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
      references: refs({ name: "new_test" }),
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
    const context = getSqlCompletionContext(sql, cursor, refs({ name: "AutomationQueue", alias: "t" }));

    expect(context.qualifier).toBe("t");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["AutomationQueue"]);
  });

  it("keeps UNION-ed selects in a single statement", () => {
    const sql = "select a from t1\nunion all\nselect b from t2 where t2.";
    const cursor = sql.indexOf("from t1") + "from t1".length;
    // The statement under the cursor spans the UNION arms, so both sides count.
    const context = getSqlCompletionContext(
      sql,
      cursor,
      refs({ name: "t1" }, { name: "t2", alias: "t2" }),
    );

    expect(context.referencedTables.map((table) => table.name)).toEqual(["t1", "t2"]);
  });

  it("does not bound the outer statement at a subquery select", () => {
    const sql = "select * from orders o where o.id in (\nselect id from items i where i.\n)";
    const cursor = sql.indexOf("where i.") + "where i.".length;
    // Statement extraction bounds at the subquery's select, so only `items`
    // (not the outer `orders`) is referenced at this cursor.
    const context = getSqlCompletionContext(sql, cursor, refs({ name: "items", alias: "i" }));

    expect(context.qualifier).toBe("i");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["items"]);
  });

  it("keeps a multi-line single statement intact", () => {
    const sql = "SELECT *\nFROM Automations t where t.";
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "Automations", alias: "t" }));

    expect(context.qualifier).toBe("t");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["Automations"]);
  });
});

describe("sqlCompletion comment stripping", () => {
  const expectNeutral = (context: ReturnType<typeof getSqlCompletionContext>) => {
    expect(context.prefix).toBe("");
    expect(context.qualifier).toBeUndefined();
    expect(context.referencedTables).toEqual([]);
    expect(context.suggestTables).toBe(false);
    expect(context.suggestColumns).toBe(false);
    expect(context.statementKind).toBe("unknown");
  };

  it("returns a neutral context when the cursor is inside a line comment", () => {
    const sql = "select * from users where id = 1 -- TODO: also filter by created_at";
    const cursor = sql.indexOf("filter") + 2;
    expectNeutral(getSqlCompletionContext(sql, cursor));
  });

  it("returns a neutral context when the cursor is inside a block comment", () => {
    const sql = "select 1;\n/* select * from hidden_table where id = */";
    const cursor = sql.indexOf("hidden_table") + 1;
    expectNeutral(getSqlCompletionContext(sql, cursor));
  });

  it("gives code after a comment the correct context", () => {
    const sql = [
      "select *",
      "-- join secret_table on secret_table.id = orders.id",
      "from orders o join items i on i.order_id = o.id where o.",
    ].join("\n");
    // The comment line is blanked before the statement is analyzed, so the
    // references fixture (analysis of the stripped statement) has no secret_table.
    const context = getSqlCompletionContext(
      sql,
      sql.length,
      refs({ name: "orders", alias: "o" }, { name: "items", alias: "i" }),
    );

    expect(context.qualifier).toBe("o");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["orders", "items"]);
    expect(context.statementKind).toBe("select");
  });

  it("keeps a statement intact across a fully commented line", () => {
    const sql = "select *\n-- only active rows below\nfrom users where";
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "users" }));

    expect(context.referencedTables.map((table) => table.name)).toEqual(["users"]);
    expect(context.statementKind).toBe("select");
    expect(context.suggestColumns).toBe(true);
  });

  it("does not count commented-out tables as referenced", () => {
    const sql = "select a from t1 -- , t2 from hidden_db join t3\nwhere a > 0";
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "t1" }));

    expect(context.referencedTables.map((table) => table.name)).toEqual(["t1"]);
    expect(context.statementKind).toBe("select");
  });

  it("does not let a commented-out statement change the statement kind", () => {
    const sql = "-- drop table secret_table;\nselect id from users";
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "users" }));

    expect(context.statementKind).toBe("select");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["users"]);
  });

  it("does not treat comment openers inside dollar-quoted strings as comments", () => {
    const untagged = "select x from logs where tags = $$-- not a comment$$ and logs.";
    const untaggedContext = getSqlCompletionContext(untagged, untagged.length, refs({ name: "logs" }));
    expect(untaggedContext.qualifier).toBe("logs");
    expect(untaggedContext.referencedTables.map((table) => table.name)).toEqual(["logs"]);

    const tagged = "select x from logs where tags = $note$/* still a string */$note$ and logs.";
    const taggedContext = getSqlCompletionContext(tagged, tagged.length, refs({ name: "logs" }));
    expect(taggedContext.qualifier).toBe("logs");
    expect(taggedContext.referencedTables.map((table) => table.name)).toEqual(["logs"]);
  });

  it("does not treat comment openers inside string literals as comments", () => {
    const sql = "select x from app_logs where msg = 'it''s -- not a comment /* really' and app_logs.";
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "app_logs" }));

    expect(context.qualifier).toBe("app_logs");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["app_logs"]);
  });

  it("keeps quoted qualifier parsing intact after a trailing comment", () => {
    const sql = 'select *\nfrom events -- recent events only\njoin "my schema".';
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "events" }));

    expect(context.qualifier).toBe("my schema");
    expect(context.suggestTables).toBe(true);
    const names = context.referencedTables.map((table) => table.name);
    expect(names).toContain("events");
    expect(names.some((name) => name === "recent" || name === "only")).toBe(false);
  });
});

// T05 review: the statement handed to the backend reference analysis (the
// resolver argument) is what decides which tables the cursor can see, so these
// tests assert on it directly — it is exactly what getSqlCompletionContext
// sends to sqlReferences.ts.
function statementSeenBy(sql: string, cursor: number, dialect?: Parameters<typeof extractSqlStatementAt>[2]) {
  let seen: string | undefined;
  const context = getSqlCompletionContext(
    sql,
    cursor,
    (statement) => {
      seen = statement;
      return refs({ name: "users", alias: "u" });
    },
    { dialect },
  );
  expect(extractSqlStatementAt(sql, cursor, dialect)).toBe(seen ?? "");
  return { context, statement: seen ?? "" };
}

describe("sqlCompletion comment stripping (dialect-aware)", () => {
  it("keeps the statement intact across a multi-line block comment", () => {
    const sql = "SELECT u.\n/*\n  old:\n  FROM archived a\n*/\nFROM users u";
    const cursor = "SELECT u.".length;
    const { context, statement } = statementSeenBy(sql, cursor);

    expect(statement).toContain("FROM users u");
    expect(statement).not.toContain("archived");
    expect(context.qualifier).toBe("u");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["users"]);
  });

  it("still ends the statement at a real blank line", () => {
    const sql = "select * from users u where u.\n\nselect * from archived a";
    const { statement } = statementSeenBy(sql, "select * from users u where u.".length);
    expect(statement).not.toContain("archived");
  });

  it("treats MySQL backslash-escaped quotes as part of the string", () => {
    const sql = "SELECT 'it\\'s -- x', u. FROM users u";
    const cursor = sql.indexOf("u.") + 2;
    const { context, statement } = statementSeenBy(sql, cursor, "mysql");

    expect(context.qualifier).toBe("u");
    expect(statement).toContain("FROM users u");
    expect(context.referencedTables.map((table) => table.name)).toEqual(["users"]);
  });

  it("treats PostgreSQL E'…' backslash escapes as part of the string", () => {
    const sql = "SELECT E'it\\'s -- x', u. FROM users u";
    const cursor = sql.indexOf("u.") + 2;
    const { context, statement } = statementSeenBy(sql, cursor, "postgres");
    expect(context.qualifier).toBe("u");
    expect(statement).toContain("FROM users u");
  });

  it("keeps standard strings standard: a trailing backslash does not escape the quote", () => {
    // PostgreSQL standard_conforming_strings: 'C:\' is a complete string.
    const sql = "SELECT 'C:\\' -- FROM archived a\nFROM users u WHERE u.";
    const { context, statement } = statementSeenBy(sql, sql.length, "postgres");
    expect(context.qualifier).toBe("u");
    expect(statement).not.toContain("archived");
  });

  it("strips MySQL # comments", () => {
    const sql = "SELECT * FROM users u # FROM archived a\nWHERE u.";
    const { context, statement } = statementSeenBy(sql, sql.length, "mysql");
    expect(statement).not.toContain("archived");
    expect(context.qualifier).toBe("u");
    // Only MySQL: `#` is an operator elsewhere (e.g. PostgreSQL `#>`).
    const pgSql = "SELECT data #> '{a}' FROM users u WHERE u.";
    const pg = statementSeenBy(pgSql, pgSql.length, "postgres");
    expect(pg.statement).toContain("FROM users u");
  });

  it("treats a cursor inside a MySQL # comment as neutral", () => {
    const sql = "SELECT 1 # note from users";
    expect(getSqlCompletionContext(sql, sql.length - 2, undefined, { dialect: "mysql" }).suggestTables).toBe(false);
  });

  it("strips nested block comments on PostgreSQL and SQL Server", () => {
    for (const dialect of ["postgres", "sqlserver"] as const) {
      const sql = "SELECT * FROM users u /* a /* b */ FROM archived x */ WHERE u.";
      const { context, statement } = statementSeenBy(sql, sql.length, dialect);
      expect(statement, dialect).not.toContain("archived");
      expect(context.qualifier, dialect).toBe("u");
    }
  });

  it("does not treat comment openers inside SQL Server bracket identifiers as comments", () => {
    const sql = "SELECT [a--b], u. FROM users u";
    const cursor = sql.indexOf("u.") + 2;
    const { context, statement } = statementSeenBy(sql, cursor, "sqlserver");
    expect(context.qualifier).toBe("u");
    expect(statement).toContain("FROM users u");
  });
});

// T06 review: identifiers completion inserts as `[…]` on SQL Server must parse
// back as qualifiers and INSERT targets.
describe("sqlCompletion SQL Server bracket identifiers", () => {
  it("resolves a bracketed qualifier", () => {
    const sql = "SELECT * FROM [order] WHERE [order].";
    const context = getSqlCompletionContext(sql, sql.length, refs({ name: "order" }), { dialect: "sqlserver" });
    expect(context.qualifier).toBe("order");
    expect(context.exclusiveColumnSuggestions).toBe(true);
  });

  it("resolves an alias of a bracketed table with spaces and suggests its columns", () => {
    const sql = "SELECT * FROM [Order Details] od WHERE od.";
    const items = buildSqlCompletionItems(sql, sql.length, {
      tables: [],
      columnsByTable: new Map([["Order Details", [{ name: "UnitPrice", table: "Order Details" }]]]),
      references: refs({ name: "Order Details", alias: "od" }),
      dialect: "sqlserver",
    });
    expect(items.map((item) => item.label)).toContain("UnitPrice");
  });

  it("parses a bracketed schema-qualified name with an escaped bracket", () => {
    const sql = "SELECT * FROM [dbo].[we]]ird] WHERE [dbo].[we]]ird].";
    const context = getSqlCompletionContext(sql, sql.length, undefined, { dialect: "sqlserver" });
    expect(context.qualifier).toBe("dbo.we]ird");
  });

  it("detects a bracketed INSERT target", () => {
    const sql = "INSERT INTO [dbo].[Order Details] (";
    const context = getSqlCompletionContext(sql, sql.length, undefined, { dialect: "sqlserver" });
    expect(context.insertSchema).toBe("dbo");
    expect(context.insertTable?.toLowerCase()).toBe("order details");
  });
});
