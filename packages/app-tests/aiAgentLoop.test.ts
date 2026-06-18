import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  buildAgentFixInstruction,
  MAX_AGENT_FIX_ATTEMPTS,
  nextAgentLoopStep,
} from "../../apps/desktop/src/lib/aiAgentLoop.ts";

test("summarizes a successful execution", () => {
  assert.deepEqual(nextAgentLoopStep({ success: true, resultPreview: "count=3" }, 0), { kind: "summarize" });
});

test("self-corrects a failure while attempts remain", () => {
  assert.deepEqual(nextAgentLoopStep({ success: false, error: "no such column" }, 0), { kind: "fix", attempt: 1 });
  assert.deepEqual(nextAgentLoopStep({ success: false, error: "no such column" }, 1), { kind: "fix", attempt: 2 });
});

test("stops once the fix budget is exhausted", () => {
  assert.deepEqual(nextAgentLoopStep({ success: false, error: "boom" }, MAX_AGENT_FIX_ATTEMPTS), {
    kind: "stop",
    reason: "exhausted",
  });
});

test("fix instruction includes the failed SQL and error without negative-execution phrasing", () => {
  const instruction = buildAgentFixInstruction(
    "how many users",
    "SELECT * FROM userz",
    'relation "userz" does not exist',
  );
  assert.match(instruction, /SELECT \* FROM userz/);
  assert.match(instruction, /relation "userz" does not exist/);
  assert.match(instruction, /how many users/);
  // Must not trip shouldAttemptAiAutoExecute's negative-execution guard.
  assert.doesNotMatch(instruction, /do not execute|don't execute|only generate|without executing/i);
});

test("fix instruction tolerates empty original request and error", () => {
  const instruction = buildAgentFixInstruction("", "SELECT 1", "");
  assert.match(instruction, /SELECT 1/);
  assert.match(instruction, /no extra instruction provided/);
  assert.match(instruction, /no error message/);
});
