import { describe, expect, it } from "vitest";
import { extractAiStructuredSql, parseAiMessage } from "../../apps/desktop/src/lib/aiMessageRender";

describe("parseAiMessage", () => {
  it("parses a clean fenced code block", () => {
    const segments = parseAiMessage("Intro\n```sql\nSELECT 1;\n```\nDone");
    expect(segments).toEqual([
      { type: "text", content: "Intro" },
      { type: "code", lang: "sql", content: "SELECT 1;" },
      { type: "text", content: "Done" },
    ]);
  });

  it("splits prose glued onto a closing fence back into a text segment", () => {
    // Streamed agent output where a tool call between two text runs left the
    // closing fence stuck to the following prose: "```No results...".
    const raw = "```sql\nSELECT 1\n    FROM t;\n```No results — the threshold may be too low.";
    const segments = parseAiMessage(raw);
    expect(segments).toEqual([
      { type: "code", lang: "sql", content: "SELECT 1\n    FROM t;" },
      { type: "text", content: "No results — the threshold may be too low." },
    ]);
  });

  it("does not swallow following prose when the code block closes without a trailing newline", () => {
    const segments = parseAiMessage("```sql\nSELECT 1;\n```");
    expect(segments).toEqual([{ type: "code", lang: "sql", content: "SELECT 1;" }]);
  });

  it("keeps backtick-prefixed content as a closing fence + trailing text, not a swallowed block", () => {
    const segments = parseAiMessage("```\nplain code\n``` and then more text");
    expect(segments).toEqual([
      { type: "code", lang: "sql", content: "plain code" },
      { type: "text", content: "and then more text" },
    ]);
  });
});

describe("parseAiMessage structured SQL (T42)", () => {
  it("renders a bare contract JSON reply as explanation text plus the SQL block", () => {
    // A reply that is only the contract object.
    const segments = parseAiMessage('{"sql": "SELECT id FROM users;", "explanation": "One statement."}');
    expect(segments).toEqual([
      { type: "text", content: "One statement." },
      { type: "code", lang: "sql", content: "SELECT id FROM users;" },
    ]);
  });

  it("extracts the contract JSON from a ```json fence, dropping the wrapper from the prose", () => {
    const raw = 'Here is the query.\n\n```json\n{"sql": "SELECT 1;", "explanation": "ok"}\n```';
    const segments = parseAiMessage(raw);
    // Prose before the object and the explanation render as one text segment.
    expect(segments).toEqual([
      { type: "text", content: "Here is the query.\n\nok" },
      { type: "code", lang: "sql", content: "SELECT 1;" },
    ]);
  });

  it("extracts the SQL when prose surrounds the JSON object", () => {
    const raw = 'Notes first.\n{"sql": "SELECT 2;", "explanation": "mid"}\nTrailing remark.';
    const segments = parseAiMessage(raw);
    expect(segments).toEqual([
      { type: "text", content: "Notes first.\n\nmid\n\nTrailing remark." },
      { type: "code", lang: "sql", content: "SELECT 2;" },
    ]);
  });

  it("strips a code fence the model wrapped into the sql string value", () => {
    const raw = '{"sql": "```sql\\nSELECT 3;\\n```", "explanation": "wrapped"}';
    const segments = parseAiMessage(raw);
    expect(segments).toEqual([
      { type: "text", content: "wrapped" },
      { type: "code", lang: "sql", content: "SELECT 3;" },
    ]);
  });

  it("renders an empty-sql contract reply (clarifying question) as explanation-only text", () => {
    const segments = parseAiMessage('{"sql": "", "explanation": "Which table holds the orders?"}');
    expect(segments).toEqual([{ type: "text", content: "Which table holds the orders?" }]);
  });

  it("keeps a legacy fence reply on the fallback path, byte-identical to the pre-T42 parse", () => {
    const raw = "Intro\n```sql\nSELECT 1;\n```\nDone";
    expect(parseAiMessage(raw)).toEqual([
      { type: "text", content: "Intro" },
      { type: "code", lang: "sql", content: "SELECT 1;" },
      { type: "text", content: "Done" },
    ]);
  });

  it("falls back to the fence scan when trailing JSON has no string sql field", () => {
    const raw = 'Result:\n```json\n{"rows": 5}\n```';
    expect(parseAiMessage(raw)).toEqual([
      { type: "text", content: "Result:" },
      { type: "code", lang: "json", content: '{"rows": 5}' },
    ]);
  });

  it("ignores a trailing JSON array instead of hijacking the reply", () => {
    const raw = "Data:\n[{\"row\": 1}]";
    expect(parseAiMessage(raw)).toEqual([{ type: "text", content: "Data:\n[{\"row\": 1}]" }]);
  });

  it("renders the prompt-compliant shape (prose + sql fence + JSON line) with the SQL exactly once", () => {
    const raw = [
      "This counts paid orders per customer.",
      "",
      "```sql",
      "SELECT customer_id, COUNT(*) FROM orders WHERE status = 'paid' GROUP BY customer_id;",
      "```",
      '{"sql": "SELECT customer_id, COUNT(*) FROM orders WHERE status = \'paid\' GROUP BY customer_id;", "explanation": "Counts paid orders per customer."}',
    ].join("\n");
    expect(parseAiMessage(raw)).toEqual([
      { type: "text", content: "This counts paid orders per customer.\n" },
      {
        type: "code",
        lang: "sql",
        content: "SELECT customer_id, COUNT(*) FROM orders WHERE status = 'paid' GROUP BY customer_id;",
      },
      { type: "text", content: "Counts paid orders per customer." },
    ]);
  });

  it("keeps every sql fence actionable and matches the contract SQL modulo whitespace", () => {
    const raw = [
      "First create the index:",
      "```sql",
      "CREATE INDEX idx_orders_status ON orders (status);",
      "```",
      "Then run:",
      "```sql",
      "SELECT *",
      "FROM orders",
      "WHERE status = 'paid'",
      "```",
      '```json\n{"sql": "SELECT * FROM orders WHERE status = \'paid\';", "explanation": ""}\n```',
    ].join("\n");
    expect(parseAiMessage(raw)).toEqual([
      { type: "text", content: "First create the index:" },
      { type: "code", lang: "sql", content: "CREATE INDEX idx_orders_status ON orders (status);" },
      { type: "text", content: "Then run:" },
      { type: "code", lang: "sql", content: "SELECT *\nFROM orders\nWHERE status = 'paid'" },
    ]);
  });

  it("appends the contract SQL when no fence in the prose carries it", () => {
    const raw = 'Old version:\n```sql\nSELECT 1;\n```\n{"sql": "SELECT 2;", "explanation": "Use this instead."}';
    expect(parseAiMessage(raw)).toEqual([
      { type: "text", content: "Old version:" },
      { type: "code", lang: "sql", content: "SELECT 1;" },
      { type: "text", content: "Use this instead." },
      { type: "code", lang: "sql", content: "SELECT 2;" },
    ]);
  });

  it("renders malformed output (neither JSON nor a fence) as plain text, locked to the legacy behavior", () => {
    const raw = '{"sql": "SELECT 1;';
    expect(parseAiMessage(raw)).toEqual([{ type: "text", content: raw }]);
    const prose = "Sure — could you say which schema?";
    expect(parseAiMessage(prose)).toEqual([{ type: "text", content: prose }]);
  });
});

describe("extractAiStructuredSql", () => {
  it("returns null when the reply carries no contract JSON", () => {
    expect(extractAiStructuredSql("```sql\nSELECT 1;\n```")).toBeNull();
    expect(extractAiStructuredSql("plain prose only")).toBeNull();
    expect(extractAiStructuredSql('{"sql": "SELECT 1;')).toBeNull();
  });

  it("honors string escapes while brace-balancing the candidate object", () => {
    const parsed = extractAiStructuredSql('{"sql": "SELECT \'{braced}\', \\"q\\" FROM t;", "explanation": "x"}');
    expect(parsed?.sql).toBe("SELECT '{braced}', \"q\" FROM t;");
  });
});
