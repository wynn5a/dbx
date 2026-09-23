import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSqlReferencesCache,
  ensureSqlStatementReferences,
  getSqlStatementReferences,
  setSqlReferencesFetcherForTests,
  shouldRefreshCompletionForSettledReferences,
  SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS,
  sqlReferencesFromAnalysis,
  subscribeSqlReferences,
  type SqlReferencesCompletionPass,
  type SqlReferencesSettledEvent,
} from "../../apps/desktop/src/lib/sqlReferences";
import {
  buildSqlCompletionItems,
  extractSqlReferencesFallback,
  extractSqlStatementAt,
  getSqlCompletionContext,
} from "../../apps/desktop/src/lib/sqlCompletion";
import type { SqlReferenceAnalysis, SqlTableReference } from "../../apps/desktop/src/types/database";

const unparseableFixture = JSON.parse(
  readFileSync(new URL("./fixtures/unparseable-cursor-statements.json", import.meta.url), "utf8"),
) as { cases: Array<{ sql: string; cursor?: string; qualifier?: string; tables: Array<[string, string | null]> }> };

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
    expect(withReference.referencedTables).toEqual([
      { name: "cte", schema: undefined, alias: undefined, columns: ["id", "name"] },
    ]);

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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setSqlReferencesFetcherForTests(null);
  });

  it("serves an exact statement text synchronously once analyzed", async () => {
    const { fetcher, pending } = deferredFetcher();
    setSqlReferencesFetcherForTests(fetcher);

    const sql = "select id from users where id = 1";
    // Cold: the regex fallback serves now; the backend parse is debounced.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables.map((t) => t.name)).toEqual(["users"]);
    expect(pending).toHaveLength(0);
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(analysis({ tables: [table("users", { alias: "x" })] }));
    await ensureSqlStatementReferences(sql, "postgres");

    // Warm: pure synchronous hit on the AST result, no second fetch.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables).toEqual([
      { name: "users", schema: undefined, alias: "x" },
    ]);
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    expect(pending).toHaveLength(1);
  });

  it("debounces background parses so a burst of keystrokes sends one IPC", () => {
    const { fetcher, pending } = deferredFetcher();
    setSqlReferencesFetcherForTests(fetcher);
    const typed = "select * from users u where u.name";
    for (let length = "select * from users".length; length <= typed.length; length += 1) {
      getSqlStatementReferences(typed.slice(0, length), "postgres");
      vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS / 3);
    }
    expect(pending).toHaveLength(0);
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    expect(pending.map((entry) => entry.statement)).toEqual([typed]);
  });

  it("serves the longest analyzed prefix while typing and notifies on settle", async () => {
    const { fetcher, pending } = deferredFetcher();
    setSqlReferencesFetcherForTests(fetcher);
    const events: SqlReferencesSettledEvent[] = [];
    const unsubscribe = subscribeSqlReferences((event) => events.push(event));

    const prefix = "select id from users where";
    const longer = `${prefix} name = 'x'`;
    const settle = ensureSqlStatementReferences(prefix, "postgres");
    pending[0]!.resolve(analysis({ tables: [table("users", { schema: "app" })] }));
    await settle;
    expect(events.map((event) => event.statement)).toEqual([prefix]);

    // Typing on: the longer statement is a cache miss, but the prefix's AST
    // references are served immediately — no empty window.
    const stale = getSqlStatementReferences(longer, "postgres");
    expect(stale.referencedTables).toEqual([{ name: "users", schema: "app", alias: undefined }]);
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    expect(pending).toHaveLength(2);
    expect(pending[1]!.statement).toBe(longer);

    // The fresh analysis takes over once it lands.
    pending[1]!.resolve(analysis({ tables: [table("users"), table("profiles")] }));
    await ensureSqlStatementReferences(longer, "postgres");
    expect(getSqlStatementReferences(longer, "postgres").referencedTables).toHaveLength(2);
    expect(events.at(-1)?.references.referencedTables).toHaveLength(2);
    unsubscribe();
  });

  it("adds tables typed after the analyzed prefix from the fallback scan", async () => {
    setSqlReferencesFetcherForTests(() => Promise.resolve(analysis({ tables: [table("users", { alias: "u" })] })));
    await ensureSqlStatementReferences("select * from users u", "postgres");
    const served = getSqlStatementReferences("select * from users u join orders o on o.", "postgres");
    expect(served.referencedTables.map((t) => [t.name, t.alias])).toEqual([
      ["users", "u"],
      ["orders", "o"],
    ]);
  });

  it("does not serve prefixes from a different dialect", async () => {
    setSqlReferencesFetcherForTests(() => Promise.resolve(analysis({ tables: [table("users", { schema: "app" })] })));
    const sql = "select id from users";
    await ensureSqlStatementReferences(sql, "mysql");
    // Postgres gets its own (fallback) answer, not mysql's AST entry.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables).toEqual([{ name: "users", alias: undefined }]);
  });

  it("caches a failed parse as fallback references, fetched only once", async () => {
    let calls = 0;
    setSqlReferencesFetcherForTests(() => {
      calls += 1;
      return Promise.reject(new Error("sql parser error:Unterminated dollar-quoted string"));
    });

    const sql = "select * from logs where tags = $$";
    const settled = await ensureSqlStatementReferences(sql, "postgres");
    expect(settled.referencedTables.map((t) => t.name)).toEqual(["logs"]);
    expect(calls).toBe(1);
    // Second lookup is a cache hit — no retry storm per keystroke.
    expect(getSqlStatementReferences(sql, "postgres").referencedTables.map((t) => t.name)).toEqual(["logs"]);
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    expect(calls).toBe(1);
  });

  it("never lets a failed parse win the prefix lookup over an older successful analysis", async () => {
    const good = "select * from users u where u";
    const broken = "select * from users u where u.";
    setSqlReferencesFetcherForTests((statement) =>
      statement === good
        ? Promise.resolve(analysis({ tables: [table("users", { schema: "app", alias: "u" })] }))
        : Promise.reject(new Error("sql parser error: Expected: identifier, found: EOF")),
    );
    await ensureSqlStatementReferences(good, "postgres");
    await ensureSqlStatementReferences(broken, "postgres");
    // `…u.n` extends both keys; the longer one failed, so the AST entry (with
    // its schema) is served, not the failed entry's fallback guess.
    expect(getSqlStatementReferences(`${broken}n`, "postgres").referencedTables).toEqual([
      { name: "users", schema: "app", alias: "u" },
    ]);
  });

  it("evicts the oldest entries beyond the cache limit", async () => {
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
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    expect(fetched).toHaveLength(301);
  });

  it("caps the cache by total statement size", async () => {
    const fetched: string[] = [];
    setSqlReferencesFetcherForTests((statement) => {
      fetched.push(statement);
      return Promise.resolve(analysis({ tables: [table("users")] }));
    });
    // Twelve ~64 KB statements exceed the 512 KB text budget well before the
    // 256-entry limit: the oldest are evicted, the newest stay cached.
    const filler = "x".repeat(64 * 1024);
    const statements = Array.from({ length: 12 }, (_, i) => `select '${filler}' as c${i} from users`);
    for (const statement of statements) await ensureSqlStatementReferences(statement, "postgres");
    await ensureSqlStatementReferences(statements[0]!, "postgres");
    expect(fetched).toHaveLength(13);
    await ensureSqlStatementReferences(statements[11]!, "postgres");
    expect(fetched).toHaveLength(13);
  });
});

describe("unparseable cursor-time statements keep their tables", () => {
  // Every statement here fails `analyze_sql_references` with a parse error in
  // pg/mysql/generic (pinned by `cursor_time_statements_do_not_parse` in
  // crates/dbx-core/tests/sql_analysis.rs); the fetcher mirrors that rejection.
  const parseError = () => Promise.reject(new Error("sql parser error: Expected: an expression, found: EOF"));

  for (const { sql, cursor: beforeCursor, qualifier, tables } of unparseableFixture.cases) {
    it(`resolves ${JSON.stringify(sql)} through the awaited (Ctrl+Space / hover) path`, async () => {
      setSqlReferencesFetcherForTests(parseError);
      const cursor = beforeCursor?.length ?? sql.length;
      const statement = extractSqlStatementAt(sql, cursor, "postgres");
      const references = await ensureSqlStatementReferences(statement, "postgres");
      const context = getSqlCompletionContext(sql, cursor, references, { dialect: "postgres" });
      expect(context.referencedTables.map((t) => [t.name, t.alias ?? null])).toEqual(tables);
      if (qualifier) expect(context.qualifier).toBe(qualifier);
      setSqlReferencesFetcherForTests(null);
    });
  }

  it("keeps alias columns after the failed parse settles (no vanishing popup)", async () => {
    vi.useFakeTimers();
    const good = "SELECT * FROM users u WHERE u";
    setSqlReferencesFetcherForTests((statement) =>
      statement === good ? Promise.resolve(analysis({ tables: [table("users", { alias: "u" })] })) : parseError(),
    );
    await ensureSqlStatementReferences(good, "postgres");
    const sql = `${good}.`;
    const columnsByTable = new Map([
      [
        "users",
        [
          { name: "id", table: "users" },
          { name: "name", table: "users" },
        ],
      ],
    ]);
    const resolver = (statement: string) => getSqlStatementReferences(statement, "postgres");
    const columnsNow = () =>
      buildSqlCompletionItems(sql, sql.length, { tables: [], columnsByTable, references: resolver })
        .filter((item) => item.type === "column")
        .map((item) => item.label);

    // Keystroke: served from the analyzed prefix.
    expect(columnsNow()).toEqual(["id", "name"]);
    // The debounced parse fails and settles; the exact hit still resolves `u`.
    vi.advanceTimersByTime(SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS);
    await ensureSqlStatementReferences(sql, "postgres");
    expect(columnsNow()).toEqual(["id", "name"]);
    vi.useRealTimers();
    setSqlReferencesFetcherForTests(null);
  });
});

describe("fallback reference scan", () => {
  it("ignores table-like text inside string literals and dollar-quoted bodies", () => {
    const references = extractSqlReferencesFallback(
      "select * from logs l where l.msg = 'join secrets s on' and body = $$from hidden$$ and l.",
    );
    expect(references.referencedTables.map((t) => [t.name, t.alias])).toEqual([["logs", "l"]]);
  });

  it("reads CTE and derived-table output columns", () => {
    const references = extractSqlReferencesFallback(
      "with recent (id, total) as (select id, total from orders) select * from (select id, name from users) sub join recent r on ",
    );
    const byName = new Map(references.referencedTables.map((t) => [t.name, t]));
    expect(byName.get("recent")?.columns).toEqual(["id", "total"]);
    expect(byName.get("sub")?.columns).toEqual(["id", "name"]);
  });
});

describe("completion refresh on settled references", () => {
  const served = { referencedTables: [{ name: "users", alias: "u" }] };
  const settledDifferent = { referencedTables: [{ name: "users", alias: "u", schema: "app" }] };
  const pass: SqlReferencesCompletionPass = {
    epoch: 7,
    position: 30,
    statement: "select * from users u where u.",
    dialect: "postgres",
    served,
    returnedResult: true,
  };
  const base = {
    pass,
    settled: { statement: pass.statement, dialect: "postgres", references: settledDifferent },
    currentEpoch: 7,
    currentPosition: 30,
    popupActive: true,
    currentStatement: () => pass.statement,
    autoOpenAllowed: () => true,
  };

  it("refreshes an open popup when the settled references differ", () => {
    expect(shouldRefreshCompletionForSettledReferences(base)).toBe(true);
  });

  it("does not reopen a popup dismissed with Esc", () => {
    expect(shouldRefreshCompletionForSettledReferences({ ...base, popupActive: false })).toBe(false);
  });

  it("opens a popup the missing references suppressed, only where typing auto-opens", () => {
    const suppressed = { ...base, popupActive: false, pass: { ...pass, returnedResult: false } };
    expect(shouldRefreshCompletionForSettledReferences(suppressed)).toBe(true);
    // Inside a string literal / after a space or `;` the auto-open gate is closed.
    expect(shouldRefreshCompletionForSettledReferences({ ...suppressed, autoOpenAllowed: () => false })).toBe(false);
  });

  it("ignores settles that change nothing, are for another statement, or are stale", () => {
    expect(
      shouldRefreshCompletionForSettledReferences({
        ...base,
        settled: { ...base.settled, references: { referencedTables: [{ name: "users", alias: "u" }] } },
      }),
    ).toBe(false);
    expect(
      shouldRefreshCompletionForSettledReferences({ ...base, settled: { ...base.settled, statement: "select 1" } }),
    ).toBe(false);
    expect(shouldRefreshCompletionForSettledReferences({ ...base, currentEpoch: 8 })).toBe(false);
    expect(shouldRefreshCompletionForSettledReferences({ ...base, currentPosition: 31 })).toBe(false);
    expect(shouldRefreshCompletionForSettledReferences({ ...base, currentStatement: () => "other" })).toBe(false);
    expect(shouldRefreshCompletionForSettledReferences({ ...base, pass: null })).toBe(false);
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
