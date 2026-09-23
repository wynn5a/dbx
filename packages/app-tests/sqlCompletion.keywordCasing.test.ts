import { describe, it, expect } from "vitest";
import {
  applyKeywordCasing,
  applySnippetBodyCasing,
  buildSnippetItemsForTest,
  buildSqlCompletionItems,
  type SqlCompletionColumn,
  type SqlCompletionTable,
} from "../../apps/desktop/src/lib/sqlCompletion";

// T33: keyword completions follow the case of the typed prefix instead of always
// inserting the canonical uppercase catalog form.

describe("applyKeywordCasing", () => {
  it("lowercases the keyword for an all-lowercase prefix", () => {
    expect(applyKeywordCasing("SELECT", "sel")).toBe("select");
    expect(applyKeywordCasing("GROUP BY", "gro")).toBe("group by");
    expect(applyKeywordCasing("ROW_NUMBER", "row_n")).toBe("row_number");
  });

  it("uppercases the keyword for an all-uppercase prefix", () => {
    expect(applyKeywordCasing("SELECT", "SEL")).toBe("SELECT");
    expect(applyKeywordCasing("GROUP BY", "GRO")).toBe("GROUP BY");
  });

  it("resolves mixed-case prefixes by their first letter", () => {
    expect(applyKeywordCasing("SELECT", "Sel")).toBe("SELECT");
    expect(applyKeywordCasing("SELECT", "sEL")).toBe("select");
  });

  it("follows the first alphabetic character and ignores letter-less prefixes", () => {
    expect(applyKeywordCasing("SELECT", "_sel")).toBe("select");
    expect(applyKeywordCasing("SELECT", "123")).toBe("SELECT");
    expect(applyKeywordCasing("SELECT", " ")).toBe("SELECT");
  });

  it("keeps the canonical uppercase for an empty prefix", () => {
    expect(applyKeywordCasing("SELECT", "")).toBe("SELECT");
    expect(applyKeywordCasing("IS NOT NULL", "")).toBe("IS NOT NULL");
  });

  it("is stable as the prefix grows, so an offered completion never flips case", () => {
    const grown = ["S", "SE", "SEL", "SELE", "s", "se", "sel", "sele"].map((prefix) =>
      applyKeywordCasing("SELECT", prefix),
    );
    expect(new Set(grown).size).toBe(2);
    expect(grown.slice(0, 4)).toEqual(["SELECT", "SELECT", "SELECT", "SELECT"]);
    expect(grown.slice(4)).toEqual(["select", "select", "select", "select"]);
  });
});

describe("applySnippetBodyCasing", () => {
  it("cases keyword words in the body to a lowercase prefix", () => {
    expect(applySnippetBodyCasing("SELECT *\nFROM {table}\nLIMIT 100;", "sel")).toBe(
      "select *\nfrom {table}\nlimit 100;",
    );
  });

  it("cases keyword words to an uppercase prefix, and keeps canonical uppercase for an empty prefix", () => {
    expect(applySnippetBodyCasing("select 1", "SEL")).toBe("SELECT 1");
    expect(applySnippetBodyCasing("select 1", "")).toBe("SELECT 1");
  });

  it("leaves placeholders, numbers, punctuation and non-keyword words as authored", () => {
    expect(applySnippetBodyCasing("SELECT my_col, {table} FROM t2 WHERE ${x} = 100;", "sel")).toBe(
      "select my_col, {table} from t2 where ${x} = 100;",
    );
  });

  it("keeps pre-existing ${name} / #{name} CodeMirror fields untouched", () => {
    expect(applySnippetBodyCasing("SELECT ${table} and #{col}", "sel")).toBe("select ${table} and #{col}");
  });

  it("never recases quoted identifiers or string literals", () => {
    // T33 review: PG `"Date"` -> `"date"` is a different identifier and
    // `'TABLE'` -> `'table'` changes data.
    expect(
      applySnippetBodyCasing(`SELECT * FROM "User" WHERE "Date" > {since} AND kind = 'TABLE'`, "sel"),
    ).toBe(`select * from "User" where "Date" > {since} and kind = 'TABLE'`);
    expect(applySnippetBodyCasing("SELECT `Order`, [Select] FROM t WHERE s = 'it''s FROM'", "sel")).toBe(
      "select `Order`, [Select] from t where s = 'it''s FROM'",
    );
  });

  it("recases a user snippet end-to-end without touching its literals", () => {
    const items = buildSnippetItemsForTest("sel", [
      { id: "u1", prefix: "selu", label: "select users", body: `SELECT * FROM "User" WHERE kind = 'TABLE'` },
    ]);
    expect(items[0]?.detail).toBe(`select * from "User" where kind = 'TABLE'`);
  });
});

describe("keyword completion end-to-end casing", () => {
  const tables: SqlCompletionTable[] = [{ name: "users", schema: "public", type: "table" }];
  const columnsByTable = new Map<string, SqlCompletionColumn[]>([]);

  it("inserts a lowercase keyword for a lowercase prefix", () => {
    const items = buildSqlCompletionItems("sel", 3, { tables, columnsByTable });
    const keyword = items.find((item) => item.type === "keyword" && item.label === "select");
    expect(keyword).toBeDefined();
    // Keywords carry no `apply`: the editor inserts `apply ?? label`, so the label
    // is exactly the text that lands in the document.
    expect(keyword!.apply).toBeUndefined();
  });

  it("inserts an uppercase keyword for an uppercase prefix", () => {
    const items = buildSqlCompletionItems("SEL", 3, { tables, columnsByTable });
    expect(items.some((item) => item.type === "keyword" && item.label === "SELECT")).toBe(true);
    expect(items.some((item) => item.type === "keyword" && item.label === "select")).toBe(false);
  });

  it("resolves a mixed-case prefix by its first letter", () => {
    const upperFirst = buildSqlCompletionItems("Sel", 3, { tables, columnsByTable });
    expect(upperFirst.some((item) => item.type === "keyword" && item.label === "SELECT")).toBe(true);
    const lowerFirst = buildSqlCompletionItems("sEL", 3, { tables, columnsByTable });
    expect(lowerFirst.some((item) => item.type === "keyword" && item.label === "select")).toBe(true);
  });

  it("keeps the canonical uppercase when no word is typed (empty prefix)", () => {
    const sql = "select * from users where ";
    const items = buildSqlCompletionItems(sql, sql.length, { tables, columnsByTable });
    expect(items.some((item) => item.type === "keyword" && item.label === "AND")).toBe(true);
    expect(items.some((item) => item.type === "keyword" && item.label === "and")).toBe(false);
  });

  it("cases per-dialect keyword items as well", () => {
    const sql = "create table events (payload js";
    const items = buildSqlCompletionItems(sql, sql.length, {
      tables: [],
      columnsByTable: new Map(),
      databaseType: "postgres",
    });
    expect(items.some((item) => item.type === "keyword" && item.label === "jsonb")).toBe(true);
  });

  it("cases the comparison value hints (NULL / IS NULL) so they do not fork the catalog item", () => {
    const sql = "select * from users where name = n";
    const items = buildSqlCompletionItems(sql, sql.length, { tables, columnsByTable });
    // The catalog keyword NULL and the value-hint NULL dedupe by `type:label`;
    // casing both keeps them merged into one lowercase item instead of two.
    expect(items.some((item) => item.type === "keyword" && item.label === "null")).toBe(true);
    expect(items.some((item) => item.type === "keyword" && item.label === "NULL")).toBe(false);
  });

  it("cases builtin snippet bodies end-to-end (apply template follows the prefix)", () => {
    const items = buildSqlCompletionItems("sel", 3, { tables, columnsByTable });
    const snippet = items.find((item) => item.type === "snippet" && item.label === "select *");
    expect(snippet).toBeDefined();
    expect(snippet!.apply).toBe("select *\nfrom ${table}\nlimit 100;");
    expect(snippet!.detail).toBe("select *\nfrom {table}\nlimit 100;");
  });

  it("leaves builtin snippet bodies uppercase for an uppercase prefix", () => {
    const upperItems = buildSqlCompletionItems("SEL", 3, { tables, columnsByTable });
    const upperSnippet = upperItems.find((item) => item.type === "snippet" && item.label === "select *");
    expect(upperSnippet).toBeDefined();
    expect(upperSnippet!.apply).toBe("SELECT *\nFROM ${table}\nLIMIT 100;");
  });
});
