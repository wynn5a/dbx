import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../apps/desktop/src/lib/api";
import {
  formatCompactTokenCount,
  formatTokenUsage,
  hasTokenUsage,
  shouldPersistSupersededAgentRun,
  usageFromAgentEndEvent,
  usageFromPersistedMessage,
} from "../../apps/desktop/src/lib/aiTokenUsage";

function agentEnd(inputTokens?: number, outputTokens?: number): AgentEvent {
  // Mirrors the Rust AgentEvent::AgentEnd wire shape: absent counts are omitted.
  return {
    type: "agent_end",
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
  };
}

describe("usageFromAgentEndEvent", () => {
  it("reads the usage off a terminal agent_end event", () => {
    expect(usageFromAgentEndEvent(agentEnd(1200, 3400))).toEqual({ inputTokens: 1200, outputTokens: 3400 });
  });

  it("keeps a usage object when only one count is reported", () => {
    expect(usageFromAgentEndEvent(agentEnd(undefined, 3400))).toEqual({ inputTokens: undefined, outputTokens: 3400 });
    expect(usageFromAgentEndEvent(agentEnd(1200, undefined))).toEqual({ inputTokens: 1200, outputTokens: undefined });
  });

  it("yields undefined when the provider reports no usage at all", () => {
    // The text-only fallback loop always ends with `AgentEnd { None, None }`,
    // which serializes with both fields skipped.
    expect(usageFromAgentEndEvent(agentEnd())).toBeUndefined();
  });

  it("ignores every non-terminal event", () => {
    expect(usageFromAgentEndEvent({ type: "text_delta", delta: "SELECT 1" })).toBeUndefined();
    expect(usageFromAgentEndEvent({ type: "turn_end", turn: 0 })).toBeUndefined();
  });

  it("still reports a zero count the provider explicitly sent", () => {
    expect(usageFromAgentEndEvent(agentEnd(0, 0))).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("usageFromPersistedMessage (history-load compatibility)", () => {
  it("loads an old message persisted before usage existed", () => {
    const message = JSON.parse('{"role":"assistant","content":"ok"}');
    expect(usageFromPersistedMessage(message.usage)).toBeUndefined();
  });

  it("reads usage from a message saved by the new format", () => {
    const message = JSON.parse('{"role":"assistant","content":"ok","usage":{"inputTokens":1200,"outputTokens":3400}}');
    expect(usageFromPersistedMessage(message.usage)).toEqual({ inputTokens: 1200, outputTokens: 3400 });
  });

  it("maps a whole old conversation without throwing and shows no usage anywhere", () => {
    const messages = JSON.parse(
      '[{"role":"user","content":"hi"},{"role":"assistant","content":"hello","reasoning":"hmm"}]',
    );
    const restored = messages.map((m: { usage?: unknown }) => usageFromPersistedMessage(m.usage));
    expect(restored).toEqual([undefined, undefined]);
  });

  it("rejects malformed usage values instead of leaking them into the UI", () => {
    expect(usageFromPersistedMessage(undefined)).toBeUndefined();
    expect(usageFromPersistedMessage(null)).toBeUndefined();
    expect(usageFromPersistedMessage("1200")).toBeUndefined();
    expect(usageFromPersistedMessage(42)).toBeUndefined();
    expect(usageFromPersistedMessage([])).toBeUndefined();
    expect(usageFromPersistedMessage({ inputTokens: "1200" })).toBeUndefined();
    expect(usageFromPersistedMessage({ outputTokens: -5 })).toBeUndefined();
    expect(usageFromPersistedMessage({ inputTokens: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
});

describe("rendering contract", () => {
  const tokens = "tokens";

  it("renders a meta line only when usage exists", () => {
    expect(hasTokenUsage({ inputTokens: 1200, outputTokens: 3400 })).toBe(true);
    expect(hasTokenUsage({ inputTokens: undefined, outputTokens: 3400 })).toBe(true);
    expect(hasTokenUsage({})).toBe(false);
    expect(hasTokenUsage(undefined)).toBe(false);
  });

  it("formats the up/down meta line", () => {
    expect(formatTokenUsage({ inputTokens: 1200, outputTokens: 3400 }, tokens)).toBe("↑ 1.2k / ↓ 3.4k tokens");
    expect(formatTokenUsage({ inputTokens: 1200, outputTokens: undefined }, tokens)).toBe("↑ 1.2k tokens");
    expect(formatTokenUsage({ inputTokens: undefined, outputTokens: 3400 }, tokens)).toBe("↓ 3.4k tokens");
  });

  it("formats nothing when there is no usage (old providers stay blank)", () => {
    expect(formatTokenUsage(undefined, tokens)).toBe("");
    expect(formatTokenUsage({}, tokens)).toBe("");
    expect(formatTokenUsage({ inputTokens: undefined, outputTokens: undefined }, tokens)).toBe("");
  });

  it("keeps the localized unit word glued to the counts", () => {
    expect(formatTokenUsage({ inputTokens: 1000, outputTokens: undefined }, "Token")).toBe("↑ 1k Token");
  });
});

describe("formatCompactTokenCount", () => {
  it("leaves sub-k counts alone", () => {
    expect(formatCompactTokenCount(0)).toBe("0");
    expect(formatCompactTokenCount(999)).toBe("999");
  });

  it("compacts thousands with one decimal, dropping a trailing .0", () => {
    expect(formatCompactTokenCount(1000)).toBe("1k");
    expect(formatCompactTokenCount(1234)).toBe("1.2k");
    expect(formatCompactTokenCount(5678)).toBe("5.7k");
  });

  it("compacts millions", () => {
    expect(formatCompactTokenCount(3_400_000)).toBe("3.4m");
    expect(formatCompactTokenCount(1_000_000)).toBe("1m");
  });
});

describe("shouldPersistSupersededAgentRun", () => {
  const usage = usageFromAgentEndEvent(agentEnd(120, 45));

  it("re-persists a cancelled run whose agent_end usage arrived after the early save", () => {
    expect(shouldPersistSupersededAgentRun({ runStillCurrent: false, messageStillShown: true, usage })).toBe(true);
  });

  it("does not persist for the current run (finalizeRun does), without usage, or after the chat moved on", () => {
    expect(shouldPersistSupersededAgentRun({ runStillCurrent: true, messageStillShown: true, usage })).toBe(false);
    expect(shouldPersistSupersededAgentRun({ runStillCurrent: false, messageStillShown: true, usage: undefined })).toBe(
      false,
    );
    expect(shouldPersistSupersededAgentRun({ runStillCurrent: false, messageStillShown: false, usage })).toBe(false);
  });

  it("is wired into AiAssistant's runBackendAgent settle path", () => {
    const source = readFileSync(
      new URL("../../apps/desktop/src/components/editor/AiAssistant.vue", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/shouldPersistSupersededAgentRun\(\{\s*runStillCurrent,\s*messageStillShown: messages\.value\[assistantIdx\] === runMessage,\s*usage: runMessage\?\.usage,/);
    expect(source).toMatch(/void persistConversation\(\);/);
  });
});
