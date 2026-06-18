// Bounded agent loop: after an agent-mode SQL statement is auto-executed, the
// outcome is fed back here to decide the next step — summarize a successful
// result, self-correct a failure (up to a fixed budget), or stop.

export const MAX_AGENT_FIX_ATTEMPTS = 2;

export interface AiAgentExecutionOutcome {
  success: boolean;
  error?: string;
  resultPreview?: string;
}

export type AiAgentLoopStep =
  | { kind: "summarize" }
  | { kind: "fix"; attempt: number }
  | { kind: "stop"; reason: "exhausted" };

/**
 * Decide what the agent loop should do after an auto-executed statement.
 *
 * @param outcome  Result of the just-executed SQL.
 * @param attempts Number of automatic fix attempts already spent this run.
 */
export function nextAgentLoopStep(outcome: AiAgentExecutionOutcome, attempts: number): AiAgentLoopStep {
  if (outcome.success) return { kind: "summarize" };
  if (attempts >= MAX_AGENT_FIX_ATTEMPTS) return { kind: "stop", reason: "exhausted" };
  return { kind: "fix", attempt: attempts + 1 };
}

/**
 * Build the instruction for an automatic fix turn. Kept free of any
 * negative-execution phrasing so that `shouldAttemptAiAutoExecute` still
 * allows the corrected SQL to auto-run.
 */
export function buildAgentFixInstruction(originalRequest: string, failedSql: string, error: string): string {
  const request = originalRequest.trim() || "(no extra instruction provided)";
  return [
    "The previous SQL was executed automatically and failed. Produce a corrected query.",
    "",
    "Original request:",
    request,
    "",
    "SQL that failed:",
    failedSql.trim(),
    "",
    "Database error:",
    error.trim() || "(no error message)",
  ].join("\n");
}
