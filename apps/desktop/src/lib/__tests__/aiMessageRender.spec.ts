import { describe, expect, it } from "vitest";
import { parseAiMessage } from "@/lib/aiMessageRender";

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
