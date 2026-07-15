import { describe, expect, it } from "vitest";
import { sqlStatementRangeAt } from "@/lib/sqlStatementSelection";

function selected(sql: string, pos: number): string | null {
  const range = sqlStatementRangeAt(sql, pos);
  return range ? sql.slice(range.from, range.to) : null;
}

describe("sqlStatementRangeAt", () => {
  it("selects a single statement without a semicolon", () => {
    expect(selected("select 1", 3)).toBe("select 1");
  });

  it("keeps the trailing semicolon and trims surrounding whitespace", () => {
    expect(selected("\n\nselect 1;\n", 5)).toBe("select 1;");
  });

  it("selects the whole statement when it spans multiple lines", () => {
    const sql = "select t.id,\n  t.name\nfrom users t\nwhere t.id = 1;";
    expect(selected(sql, sql.indexOf("from"))).toBe(sql);
  });

  it("selects only the statement containing the cursor", () => {
    const sql = "select 1;\nselect 2;\nselect 3;";
    expect(selected(sql, sql.indexOf("2"))).toBe("select 2;");
  });

  it("ignores semicolons inside string literals", () => {
    const sql = "select 'a;b' as x;\nselect 2;";
    expect(selected(sql, 3)).toBe("select 'a;b' as x;");
  });

  it("ignores semicolons inside escaped and doubled quotes", () => {
    const sql = "select 'it''s; fine' as x;";
    expect(selected(sql, 3)).toBe(sql);
    const escaped = "select 'a\\';b' as x;";
    expect(selected(escaped, 3)).toBe(escaped);
  });

  it("ignores semicolons inside line comments", () => {
    const sql = "select 1 -- not here;\nfrom dual;";
    expect(selected(sql, 3)).toBe(sql);
  });

  it("ignores semicolons inside block comments", () => {
    const sql = "select 1 /* not; here */ from dual;";
    expect(selected(sql, 3)).toBe(sql);
  });

  it("selects the previous statement when the cursor sits just past its semicolon", () => {
    const sql = "select 1;\nselect 2;";
    expect(selected(sql, sql.indexOf(";") + 1)).toBe("select 1;");
  });

  it("selects the previous statement from trailing whitespace at the end", () => {
    const sql = "select 1;\nselect 2;\n\n";
    expect(selected(sql, sql.length)).toBe("select 2;");
  });

  it("selects the next statement when the cursor is in its leading indent", () => {
    const sql = "select 1;  select 2;";
    expect(selected(sql, sql.indexOf(";") + 2)).toBe("select 2;");
  });

  it("selects the first statement from blank lines before it", () => {
    expect(selected("\n\nselect 1;", 0)).toBe("select 1;");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(sqlStatementRangeAt("", 0)).toBeNull();
    expect(sqlStatementRangeAt("   \n  ", 3)).toBeNull();
  });

  it("clamps out-of-range positions", () => {
    expect(selected("select 1;", 100)).toBe("select 1;");
    expect(selected("select 1;", -5)).toBe("select 1;");
  });
});
