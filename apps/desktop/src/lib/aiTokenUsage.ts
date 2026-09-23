import type { AgentEvent, AiMessageUsage } from "@/lib/api";

// Token-usage meta line for AI assistant answers.
//
// The backend agent loop reports best-effort usage on the terminal `agent_end`
// event; the assistant persists it on the assistant message (`AiChatMessage.usage`)
// and renders a small "↑ 1.2k / ↓ 3.4k tokens" line under the answer. Providers
// that report nothing simply render no line — every helper here treats a missing
// or malformed value as "no usage", never as an error.
//
// Cost estimates are deliberately not computed: DBX talks to eight providers
// (claude / openai / gemini / deepseek / qwen / ollama / openai-compatible /
// custom) with free-form model ids and endpoints, and no price data exists in
// the repo. Any static table would present made-up numbers as fact.

/** Extract persisted usage from an `agent_end` event, if it carries any. */
export function usageFromAgentEndEvent(event: AgentEvent): AiMessageUsage | undefined {
  if (event.type !== "agent_end") return undefined;
  return normalizeUsage({ inputTokens: event.input_tokens, outputTokens: event.output_tokens });
}

/**
 * Whether a superseded agent run (the user pressed Stop, which bumps the run
 * token and persists the conversation at once) must persist again when its
 * stream finally settles. The backend's terminal `agent_end` — and with it the
 * run's usage — lands after that early save, so without a second save the usage
 * shown under the answer is lost on reload. Only when the run's message is
 * still in the visible conversation (not cleared / switched away) and actually
 * received usage.
 */
export function shouldPersistSupersededAgentRun(run: {
  runStillCurrent: boolean;
  messageStillShown: boolean;
  usage: AiMessageUsage | undefined;
}): boolean {
  return !run.runStillCurrent && run.messageStillShown && run.usage !== undefined;
}

/**
 * Tolerant read of the `usage` field from a persisted message. Conversations
 * saved before the field existed (and any malformed value) yield `undefined`,
 * so history loads without errors and shows no usage line.
 */
export function usageFromPersistedMessage(value: unknown): AiMessageUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return normalizeUsage({ inputTokens: raw.inputTokens, outputTokens: raw.outputTokens });
}

/** `undefined` unless at least one count is a usable non-negative number. */
function normalizeUsage(usage: { inputTokens: unknown; outputTokens: unknown }): AiMessageUsage | undefined {
  const inputTokens = tokenCount(usage.inputTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Whether a usage line should be rendered for this message. */
export function hasTokenUsage(usage: AiMessageUsage | undefined | null): boolean {
  return !!usage && (tokenCount(usage.inputTokens) !== undefined || tokenCount(usage.outputTokens) !== undefined);
}

/**
 * "↑ 1.2k / ↓ 3.4k tokens" — the arrows are locale-neutral; `tokensLabel` is
 * the localized unit word. Returns "" when there is nothing to show.
 */
export function formatTokenUsage(usage: AiMessageUsage | undefined | null, tokensLabel: string): string {
  const parts: string[] = [];
  const input = usage ? tokenCount(usage.inputTokens) : undefined;
  const output = usage ? tokenCount(usage.outputTokens) : undefined;
  if (input !== undefined) parts.push(`↑ ${formatCompactTokenCount(input)}`);
  if (output !== undefined) parts.push(`↓ ${formatCompactTokenCount(output)}`);
  if (!parts.length) return "";
  return `${parts.join(" / ")} ${tokensLabel}`.trim();
}

/** Compact token counts: 999 → "999", 1000 → "1k", 1234 → "1.2k", 3400000 → "3.4m". */
export function formatCompactTokenCount(count: number): string {
  const abs = Math.abs(count);
  if (abs >= 1_000_000) return `${dropTrailingZero((count / 1_000_000).toFixed(1))}m`;
  if (abs >= 1_000) return `${dropTrailingZero((count / 1_000).toFixed(1))}k`;
  return String(count);
}

function dropTrailingZero(text: string): string {
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}
