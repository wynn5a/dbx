import { describe, expect, it } from "vitest";
import {
  clearSqlReferencesCache,
  ensureSqlStatementReferences,
  getSqlStatementReferences,
  setSqlReferencesFetcherForTests,
  sqlReferencesFromAnalysis,
  subscribeSqlReferences,
} from "../../apps/desktop/src/lib/sqlReferences";
import { getSqlCompletionContext } from "../../apps/desktop/src/lib/sqlCompletion";
import type { SqlReferenceAnalysis, SqlTableReference } from "../../apps/desktop/src/types/database";

function analysis(overrides: Partial<SqlReferenceAnalysis> = {}): SqlReferenceAnalysis {
  return {
    tables: [],
    columns: [],
    select_aliases: [],
    alias_columns: [],
    cte_definitions: [],
    derived_tables: [],
    ...overrides,
  };
}

function table(name: string, extra: Partial<SqlTableReference> = {}): SqlTableReference {
  return { name, span: { start_line: 1, start_column: 1, end_line: 1, end_column: 1 }, ...extra };
}

// Deferred fetcher for controlling when background analyses settle.
function deferredFetcher() {
  const pending: Array<{ statement: string; resolve: (analysis: SqlReferenceAnalysis) => void }> = [];
  const fetcher = (statement: string) =>
    new Promise<SqlReferenceAnalysis>((resolve) => {
      pending.push({ statement, resolve });
    });
  return { fetcher, pending };
}

describe("sqlReferencesFromAnalysis mapping", () => {
  it("maps table references with schema and alias", () => {
    const references = sqlReferencesFromAnalysis(
      analysis({ tables: [table("users", { schema: "public", alias: "u" }), table("orders")] }),
    );
    expect(references.referencedTables).toEqual([
      { name: "users", schema: "public", alias: "u" },
      { name: "orders", schema: undefined, alias: undefined },
    ]);
  });

  it("appends CTE definitions as referenced tables and fills columns into existing entries", () => {
    // `WITH cte AS … SELECT * FROM cte` — the CTE reference is a plain table
    // entry from the AST; the definition enriches it with output columns.
    const withReference = sqlReferencesFromAnalysis(
      analysis({
        tables: [table("cte")],
        cte_definitions: [{ name: "cte", columns: ["id", "name"] }],
      }),
    );
    expect(withReference.referencedTables).toEqual([{ name: "cte", schema: undefined, alias: undefined, columns: ["id", "name"] }]);

    // A CTE never referenced in the body is still completable.
    const unreferenced = sqlReferencesFromAnalysis(
      analysis({ cte_definitions: [{ name: "recent_orders", columns: ["id"] }] }),
    );
    expect(unreferenced.referencedTables).toEqual([{ name: "recent_orders", columns: ["id"] }]);
  });

  it("appends derived-table aliases with their output columns", () => {
    const references = sqlReferencesFromAnalysis(
      analysis({
        tables: [table("users")],
        derived_tables: [{ alias: "sub", columns: ["id", "name"] }],
      }),
    );
    expect(references.referencedTables).toEqual([
      { name: "users", schema: undefined, alias: undefined },
      { name: "sub", alias: "sub", columns: ["id", "name"] },
    ]);
  });
});

describe("per-statement reference cache", () => {
  it("serves an exact statement text synchronously once analyzed", async () => {
    clearSqlReferencesCache();
    const { fetcher, pending } = deferredFetcher();
    setSqlReferencesFetcherForTests(fetcher);

    const sql = "select id from users where id = 1";
    // Cold: empty now, but a fetch is kicked for the exact statement.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables).toEqual([]);
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(analysis({ tables: [table("users")] }));
    await ensureSqlStatementReferences(sql, "postgres");

    // Warm: pure synchronous hit, no second fetch.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables.map((t) => t.name)).toEqual(["users"]);
    expect(pending).toHaveLength(1);
    setSqlReferencesFetcherForTests(null);
  });

  it("serves the longest analyzed prefix while typing and notifies on settle", async () => {
    clearSqlReferencesCache();
    const { fetcher, pending } = deferredFetcher();
    setSqlReferencesFetcherForTests(fetcher);
    let notifications = 0;
    const unsubscribe = subscribeSqlReferences(() => {
      notifications += 1;
    });

    const prefix = "select id from users where";
    const longer = `${prefix} name = 'x'`;
    getSqlStatementReferences(prefix, "postgres");
    pending[0]!.resolve(analysis({ tables: [table("users")] }));
    await ensureSqlStatementReferences(prefix, "postgres");
    expect(notifications).toBe(1);

    // Typing on: the longer statement is a cache miss (its own fetch starts)
    // but the prefix's references are served immediately — no empty window.
    const stale = getSqlStatementReferences(longer, "postgres");
    expect(stale.referencedTables.map((t) => t.name)).toEqual(["users"]);
    expect(pending).toHaveLength(2);
    expect(pending[1]!.statement).toBe(longer);

    // The fresh analysis takes over once it lands.
    pending[1]!.resolve(analysis({ tables: [table("users"), table("profiles")] }));
    await ensureSqlStatementReferences(longer, "postgres");
    expect(getSqlStatementReferences(longer, "postgres").referencedTables).toHaveLength(2);
    unsubscribe();
    setSqlReferencesFetcherForTests(null);
  });

  it("does not serve prefixes from a different dialect", async () => {
    clearSqlReferencesCache();
    const { fetcher, pending } = deferredFetcher();
    setSqlReferencesFetcherForTests(fetcher);

    const sql = "select id from users";
    getSqlStatementReferences(sql, "mysql");
    pending[0]!.resolve(analysis({ tables: [table("users")] }));
    await ensureSqlStatementReferences(sql, "mysql");

    expect(getSqlStatementReferences(sql, "postgres").referencedTables).toEqual([]);
    setSqlReferencesFetcherForTests(null);
  });

  it("caches an empty verdict when the backend cannot parse (mid-typing)", async () => {
    clearSqlReferencesCache();
    let calls = 0;
    setSqlReferencesFetcherForTests((_statement) => {
      calls += 1;
      return Promise.reject(new Error("sql parser error:Unterminated dollar-quoted string"));
    });

    const sql = "select * from logs where tags = $$";
    expect(getSqlStatementReferences(sql, "postgres").referencedTables).toEqual([]);
    await ensureSqlStatementReferences(sql, "postgres");
    expect(calls).toBe(1);
    // Second lookup is a (negative) cache hit — no retry storm per keystroke.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables).toEqual([]);
    expect(calls).toBe(1);
    setSqlReferencesFetcherForTests(null);
  });

  it("evicts the oldest entries beyond the cache limit", async () => {
    clearSqlReferencesCache();
    const fetched: string[] = [];
    setSqlReferencesFetcherForTests((statement) => {
      fetched.push(statement);
      return Promise.resolve(analysis({ tables: [table("users")] }));
    });
    const statements = Array.from({ length: 300 }, (_, i) => `select ${i} from users`);
    await Promise.all(statements.map((statement) => ensureSqlStatementReferences(statement, "postgres")));
    expect(fetched).toHaveLength(300);

    // The oldest entries were evicted (limit 256): a re-request fetches again,
    // while the most recent entries are still served from cache.
    await ensureSqlStatementReferences(statements[0]!, "postgres");
    expect(fetched).toHaveLength(301);

    const newest = statements[299]!;
    getSqlStatementReferences(newest, "postgres");
    expect(fetched).toHaveLength(301);
    setSqlReferencesFetcherForTests(null);
  });
});

describe("regex-fragile boundaries through the completion path", () => {
  // The old regex extractors read raw statement text; these lock that the
  // frontend now (a) hands the analyzer comment-free statement text and
  // (b) takes every reference from the AST result — matching the backend
  // behavior pinned in crates/dbx-core/tests/sql_analysis.rs.
  it("passes the comment-stripped statement to the analyzer and hides commented tables", () => {
    clearSqlReferencesCache();
    const seen: string[] = [];
    const sql = "select a from t1 -- , t2 from hidden join t3\nwhere a > 0";
    const context = getSqlCompletionContext(sql, sql.length, (statement) => {
      seen.push(statement);
      return { referencedTables: [{ name: "t1" }] };
    });
    // The comment body becomes same-length whitespace (offsets stay valid),
    // so what reaches the analyzer no longer contains the commented tables.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.startsWith("select a from t1 --")).toBe(true);
    expect(seen[0]!.endsWith("where a > 0")).toBe(true);
    expect(seen[0]!.includes("hidden")).toBe(false);
    expect(context.referencedTables.map((t) => t.name)).toEqual(["t1"]);
  });

  it("keeps dollar-quoted bodies out of the analyzed statement", () => {
    clearSqlReferencesCache();
    const seen: string[] = [];
    const sql = "select x from logs where tags = $$-- not a comment$$ and logs.";
    getSqlCompletionContext(sql, sql.length, (statement) => {
      seen.push(statement);
      return { referencedTables: [{ name: "logs" }] };
    });
    // The $$ body is intact (it is a string, not a comment) and contains no
    // comment opener that could truncate the statement before `logs.`.
    expect(seen).toEqual(["select x from logs where tags = $$-- not a comment$$ and logs."]);
  });

  it("reports no references for a cursor inside a comment", () => {
    clearSqlReferencesCache();
    const sql = "select 1;\n/* select * from hidden_table where id = */";
    const cursor = sql.indexOf("hidden_table") + 1;
    let resolverCalls = 0;
    const context = getSqlCompletionContext(sql, cursor, () => {
      resolverCalls += 1;
      return { referencedTables: [{ name: "hidden_table" }] };
    });
    expect(resolverCalls).toBe(0);
    expect(context.referencedTables).toEqual([]);
  });

  it("sees tables through nested subqueries per the AST result", () => {
    clearSqlReferencesCache();
    const sql =
      "select * from orders o where o.id in (select order_id from items i where i.user_id in (select user_id from banned))";
    const context = getSqlCompletionContext(
      sql,
      sql.length,
      sqlReferencesFromAnalysis(
        analysis({
          tables: [table("orders", { alias: "o" }), table("items", { alias: "i" }), table("banned")],
        }),
      ),
    );
    expect(context.referencedTables.map((t) => t.name)).toEqual(["orders", "items", "banned"]);
  });
});
