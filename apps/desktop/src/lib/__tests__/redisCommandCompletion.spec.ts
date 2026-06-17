import { describe, expect, it } from "vitest";
import {
  applyRedisCompletion,
  buildRedisCompletionItems,
  getRedisCompletionToken,
  measureInputCaretLeft,
  REDIS_COMMANDS,
} from "@/lib/redisCommandCompletion";

describe("getRedisCompletionToken", () => {
  it("treats the first word as the command token", () => {
    const token = getRedisCompletionToken("GE", 2);
    expect(token).toMatchObject({ start: 0, end: 2, value: "GE", isFirstToken: true });
  });

  it("treats a word after whitespace as an argument token", () => {
    const text = "GET foo";
    const token = getRedisCompletionToken(text, text.length);
    expect(token).toMatchObject({ start: 4, end: 7, value: "foo", isFirstToken: false });
  });

  it("returns an empty argument token when the caret sits on a trailing space", () => {
    const text = "GET ";
    const token = getRedisCompletionToken(text, text.length);
    expect(token).toMatchObject({ start: 4, end: 4, value: "", isFirstToken: false });
  });

  it("only reads up to the caret, not the whole word", () => {
    const text = "GETSET";
    const token = getRedisCompletionToken(text, 3);
    expect(token).toMatchObject({ start: 0, end: 3, value: "GET", isFirstToken: true });
  });
});

describe("buildRedisCompletionItems", () => {
  it("suggests commands for the first token, prefix matches first", () => {
    const items = buildRedisCompletionItems("ge", 2, []);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.kind === "command")).toBe(true);
    expect(items[0].label).toBe("GET");
    // Every result actually contains the query.
    expect(items.every((item) => item.label.includes("GET") || item.label.includes("GE"))).toBe(true);
  });

  it("is case-insensitive for commands", () => {
    const lower = buildRedisCompletionItems("set", 3, []).map((i) => i.label);
    const upper = buildRedisCompletionItems("SET", 3, []).map((i) => i.label);
    expect(lower).toEqual(upper);
    expect(lower).toContain("SET");
  });

  it("tags write commands in the detail", () => {
    const set = buildRedisCompletionItems("SET", 3, []).find((i) => i.label === "SET");
    expect(set?.detail).toContain("(write)");
    const get = buildRedisCompletionItems("GET", 3, []).find((i) => i.label === "GET");
    expect(get?.detail ?? "").not.toContain("(write)");
  });

  it("suggests matching key names for argument tokens", () => {
    const keys = ["user:1", "user:2", "session:abc", "cart:9"];
    const items = buildRedisCompletionItems("GET user", 8, keys);
    expect(items.map((i) => i.label)).toEqual(["user:1", "user:2"]);
    expect(items.every((item) => item.kind === "key")).toBe(true);
  });

  it("returns nothing for an empty argument token", () => {
    expect(buildRedisCompletionItems("GET ", 4, ["user:1"])).toEqual([]);
  });

  it("returns nothing when no command matches", () => {
    expect(buildRedisCompletionItems("zzzznotacommand", 15, [])).toEqual([]);
  });
});

describe("applyRedisCompletion", () => {
  it("inserts a command with a trailing space", () => {
    const result = applyRedisCompletion("ge", 2, { label: "GET", kind: "command" });
    expect(result.text).toBe("GET ");
    expect(result.caret).toBe(4);
  });

  it("replaces only the token under the caret", () => {
    const text = "GET us";
    const result = applyRedisCompletion(text, text.length, { label: "user:1", kind: "key" });
    expect(result.text).toBe("GET user:1");
    expect(result.caret).toBe("GET user:1".length);
  });

  it("does not append a space for key completions", () => {
    const result = applyRedisCompletion("HGET h fi", 9, { label: "field1", kind: "key" });
    expect(result.text).toBe("HGET h field1");
  });
});

describe("REDIS_COMMANDS catalog", () => {
  it("has unique, upper-cased command names", () => {
    const names = REDIS_COMMANDS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name === name.toUpperCase())).toBe(true);
  });
});

describe("measureInputCaretLeft", () => {
  it("is safe to call without a DOM (returns 0)", () => {
    // vitest runs in a node environment here; the helper guards on `document`.
    expect(measureInputCaretLeft({ value: "GET foo" } as HTMLInputElement, 3)).toBe(0);
  });
});
