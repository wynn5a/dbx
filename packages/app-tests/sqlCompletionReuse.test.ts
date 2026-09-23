import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  buildSqlCompletionItemsFromContext,
  getSqlCompletionContext,
  type SqlCompletionColumn,
  type SqlCompletionContext,
  type SqlCompletionItem,
  type SqlStatementReferences,
} from "../../apps/desktop/src/lib/sqlCompletion.ts";
import {
  buildReusableSqlCompletionResult,
  canReuseSqlCompletionResult,
  type ReusableSqlCompletionResult,
} from "../../apps/desktop/src/lib/sqlCompletionReuse.ts";

// T36 review fix: QueryEditor builds SQL results with `filter: false` (our own
// ranking), so a `validFor` reuse kept the ORIGINAL list and order while typing
// and Enter could insert the wrong item. These tests drive the same composition
// QueryEditor uses — getSqlCompletionContext → buildSqlCompletionItemsFromContext
// → buildReusableSqlCompletionResult — and then replay typing through the
// result's `update` hook the way CodeMirror's ActiveResult does (mapped `from`,
// a CompletionContext over the new state).

const columnsByTable = new Map<string, SqlCompletionColumn[]>([
  [
    "users",
    [
      { name: "updated_at", table: "users", dataType: "datetime" },
      { name: "upper_bound", table: "users", dataType: "int" },
      { name: "id", table: "users", dataType: "bigint" },
    ],
  ],
]);
const references: SqlStatementReferences = { referencedTables: [{ name: "users", alias: "u" }] };

type Option = { label: string; type: string };

function openPopup(doc: string) {
  const context = getSqlCompletionContext(doc, doc.length, references, { dialect: "mysql" });
  const build = (ctx: SqlCompletionContext) =>
    buildSqlCompletionItemsFromContext(ctx, { tables: [], columnsByTable, dialect: "mysql", databaseType: "mysql" });
  const toOption = (item: SqlCompletionItem): Option => ({ label: item.label, type: item.type });
  const result = buildReusableSqlCompletionResult(build(context), doc.length - context.prefix.length, toOption, {
    context,
    build,
  });
  assert.ok(result, "the popup opens");
  return result;
}

/** What CodeMirror does on a simple keystroke over an active result. */
function typeInto(result: ReusableSqlCompletionResult<Option>, doc: string) {
  if (!result.update) return null;
  return result.update(result, result.from, doc.length, {
    pos: doc.length,
    state: { sliceDoc: (from = 0, to = doc.length) => doc.slice(from, to) },
  });
}

test("typing on re-ranks the reused popup so Enter picks the best match", () => {
  const base = "SELECT * FROM users u WHERE ";
  const opened = openPopup(`${base}up`);
  assert.equal(opened.options[0]?.label, "updated_at", "precondition: updated_at leads for `up`");

  const narrowed = typeInto(opened, `${base}upper_b`);
  assert.ok(narrowed, "a continuation of the token reuses the result without re-running the source");
  assert.equal(narrowed.options[0]?.label, "upper_bound", "the selected (top) item follows the typed token");
  assert.ok(
    !narrowed.options.some((option) => option.label === "updated_at"),
    "items that no longer match are narrowed away",
  );

  // Keeps working across consecutive keystrokes (the hook is carried along).
  const further = typeInto(narrowed, `${base}upper_bo`);
  assert.equal(further?.options[0]?.label, "upper_bound");
});

test("backspacing below the original prefix recomputes, so a new token is not served stale items", () => {
  const opened = openPopup("se");
  assert.ok(opened.options.some((option) => option.label.toUpperCase() === "SELECT"));

  // `se` -> `s`: shorter than the prefix the metadata was fetched for.
  assert.equal(typeInto(opened, "s"), null, "the source re-runs (CodeMirror goes back to pending)");
  // `sh` from a `se` list would miss SHOW — never reuse it.
  assert.equal(typeInto(opened, "sh"), null);
});

test("a narrowed list that matches nothing hands back to the source", () => {
  const opened = openPopup("SELECT * FROM users u WHERE up");
  assert.equal(typeInto(opened, "SELECT * FROM users u WHERE upzzzz"), null);
});

test("one-character prefixes never carry an update hook", () => {
  const opened = openPopup("SELECT * FROM users u WHERE u");
  assert.equal(opened.update, undefined);
});

test("reuse rules: only identifier continuations of a 2+ character prefix", () => {
  for (const typed of ["fr", "fro", "from", "FROM", "frOm", "from_2", "from$1"]) {
    assert.equal(canReuseSqlCompletionResult("fr", typed), true, typed);
  }
  // Context switches, token ends, and different/shorter tokens recompute.
  for (const typed of ["f", "fx", "us.", "fr ", "fr(", "fr'", 'fr"', "fr+", "fr;", "@fr", ""]) {
    assert.equal(canReuseSqlCompletionResult("fr", typed), false, JSON.stringify(typed));
  }
  assert.equal(canReuseSqlCompletionResult("f", "fr"), false, "prefixes below two characters never reuse");
  assert.equal(canReuseSqlCompletionResult('"Us', '"Use'), false, "quoted tokens recompute");
});
