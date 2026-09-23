import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  buildReusableElasticsearchCompletionResult,
  getElasticsearchCompletionContext,
  type ElasticsearchCompletionItem,
  type ReusableElasticsearchCompletionResult,
} from "../../apps/desktop/src/lib/elasticsearchCompletion.ts";

// Elasticsearch counterpart of the T36 fix: results are `filter: false` (our
// own ranking), so a `validFor` reuse kept the ORIGINAL list and order while
// typing and Enter could insert the wrong item. These tests drive the same
// composition QueryEditor uses and replay typing through the `update` hook the
// way CodeMirror's ActiveResult does.

type Option = { label: string };
const indices = ["sales", "logs"];
const toOption = (item: ElasticsearchCompletionItem): Option => ({ label: item.label });

function openPopup(doc: string) {
  const context = getElasticsearchCompletionContext(doc, doc.length);
  const result = buildReusableElasticsearchCompletionResult(context, { indices }, toOption);
  assert.ok(result, "the popup opens");
  return result;
}

function typeInto(result: ReusableElasticsearchCompletionResult<Option>, doc: string, from = result.from) {
  return result.update(result, from, doc.length, {
    pos: doc.length,
    state: { sliceDoc: (start = 0, end = doc.length) => doc.slice(start, end) },
  });
}

const labels = (result: ReusableElasticsearchCompletionResult<Option> | null) =>
  result?.options.map((option) => option.label) ?? [];

test("extending the prefix re-narrows and re-ranks instead of keeping the stale top item", () => {
  const opened = openPopup("GET /s");
  assert.equal(labels(opened)[0], "sales");

  const typed = typeInto(opened, "GET /sea");
  assert.ok(typed, "reused without re-running the source");
  // Stale `validFor` reuse would still have `sales` on top, and Enter would
  // replace `sea` with it.
  assert.notEqual(labels(typed)[0], "sales");
  assert.ok(!labels(typed).includes("sales"));
  // Same list and order as a fresh request at the new cursor.
  assert.deepEqual(labels(typed), labels(openPopup("GET /sea")));
  assert.equal(typed.from, opened.from);

  // Chained updates keep working.
  const more = typeInto(typed, "GET /sear");
  assert.deepEqual(labels(more), labels(openPopup("GET /sear")));
  assert.ok(labels(more).every((label) => label.includes("sear")));
});

test("backspacing within the token rebuilds from the same (unfiltered) input", () => {
  const opened = openPopup("GET /sea");
  const back = typeInto(opened, "GET /s");
  assert.equal(labels(back)[0], "sales");
});

test("json keys re-rank as the prefix grows", () => {
  const doc = 'GET /sales/_search\n{\n  "m';
  const opened = openPopup(doc);
  assert.ok(labels(opened).length > 1);
  const typed = typeInto(opened, `${doc}ust_`);
  assert.deepEqual(labels(typed), ['"must_not"']);
});

test("leaving the token or moving the slot re-runs the source", () => {
  const opened = openPopup("GET /sa");
  assert.equal(typeInto(opened, "GET /sa "), null, "whitespace ends the token");
  assert.equal(typeInto(opened, "GET /sales/"), null, "a new path segment recomputes");
  assert.equal(typeInto(opened, "GET "), null, "backspacing past the start recomputes");
  assert.equal(typeInto(opened, "POST /sa", opened.from + 1), null, "an edit before the token recomputes");
  assert.equal(typeInto(opened, "GET /sazz"), null, "nothing matches any more");
});
