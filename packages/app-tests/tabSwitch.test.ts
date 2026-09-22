import { strict as assert } from "node:assert";
import { test } from "vitest";
import { GOTO_TAB_LAST_POSITION, resolveTabSwitchTarget } from "../../apps/desktop/src/lib/tabSwitch.ts";

const tabs = (ids: string[]) => ids.map((id) => ({ id }));

test("next/prev tab moves to the adjacent tab in visible order", () => {
  const list = tabs(["a", "b", "c"]);
  assert.equal(resolveTabSwitchTarget(list, "a", "next"), "b");
  assert.equal(resolveTabSwitchTarget(list, "b", "next"), "c");
  assert.equal(resolveTabSwitchTarget(list, "b", "prev"), "a");
  assert.equal(resolveTabSwitchTarget(list, "c", "prev"), "b");
});

test("next/prev tab wraps around at the ends", () => {
  const list = tabs(["a", "b", "c"]);
  assert.equal(resolveTabSwitchTarget(list, "c", "next"), "a");
  assert.equal(resolveTabSwitchTarget(list, "a", "prev"), "c");
});

test("next/prev tab on a single tab stays on it", () => {
  const list = tabs(["a"]);
  assert.equal(resolveTabSwitchTarget(list, "a", "next"), "a");
  assert.equal(resolveTabSwitchTarget(list, "a", "prev"), "a");
});

test("next/prev tab is a no-op without tabs", () => {
  assert.equal(resolveTabSwitchTarget([], null, "next"), null);
  assert.equal(resolveTabSwitchTarget([], null, "prev"), null);
  assert.equal(resolveTabSwitchTarget([], null, 1), null);
  assert.equal(resolveTabSwitchTarget([], null, GOTO_TAB_LAST_POSITION), null);
});

test("next/prev tab without an active tab enters at the ends", () => {
  const list = tabs(["a", "b", "c"]);
  assert.equal(resolveTabSwitchTarget(list, null, "next"), "a");
  assert.equal(resolveTabSwitchTarget(list, null, "prev"), "c");
});

test("next/prev tab with an unknown active id enters at the ends", () => {
  const list = tabs(["a", "b", "c"]);
  assert.equal(resolveTabSwitchTarget(list, "missing", "next"), "a");
  assert.equal(resolveTabSwitchTarget(list, "missing", "prev"), "c");
});

test("goto tab activates the 1-based position and ignores out-of-range positions", () => {
  const list = tabs(["a", "b", "c"]);
  assert.equal(resolveTabSwitchTarget(list, "c", 1), "a");
  assert.equal(resolveTabSwitchTarget(list, "a", 3), "c");
  assert.equal(resolveTabSwitchTarget(list, "a", 4), null);
  assert.equal(resolveTabSwitchTarget(list, "a", 0), null);
});

test("goto tab 9 jumps to the last tab (browser convention), not the 9th", () => {
  const nine = tabs(["a", "b", "c"]);
  assert.equal(resolveTabSwitchTarget(nine, "a", GOTO_TAB_LAST_POSITION), "c");

  const ten = tabs(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
  assert.equal(resolveTabSwitchTarget(ten, "a", GOTO_TAB_LAST_POSITION), "j");
  assert.equal(resolveTabSwitchTarget(ten, "a", 8), "h");
});
