import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  REDUCED_MOTION_MEDIA_QUERY,
  prefersReducedMotion,
  scrollBehaviorForMotion,
} from "../../apps/desktop/src/lib/reducedMotion.ts";

const globalsCss = readFileSync(new URL("../../apps/desktop/src/styles/globals.css", import.meta.url), "utf8");
const useTabScrollSource = readFileSync(new URL("../../apps/desktop/src/composables/useTabScroll.ts", import.meta.url), "utf8");
const appTabBarSource = readFileSync(new URL("../../apps/desktop/src/components/layout/AppTabBar.vue", import.meta.url), "utf8");

/** Extracts the balanced `{...}` body of the reduced-motion media query. */
function reducedMotionBlock(css: string): string {
  const marker = "@media (prefers-reduced-motion: reduce)";
  const start = css.indexOf(marker);
  assert.ok(start >= 0, "styles/globals.css must declare @media (prefers-reduced-motion: reduce)");
  const open = css.indexOf("{", start);
  assert.ok(open > start, "media query must open a block");
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  assert.fail("unbalanced braces in styles/globals.css");
}

test("prefersReducedMotion reads the system media query state", () => {
  assert.equal(REDUCED_MOTION_MEDIA_QUERY, "(prefers-reduced-motion: reduce)");
  const queries: string[] = [];
  const on = prefersReducedMotion((query) => {
    queries.push(query);
    return { matches: true };
  });
  assert.equal(on, true);
  assert.deepEqual(queries, [REDUCED_MOTION_MEDIA_QUERY]);
  assert.equal(prefersReducedMotion(() => ({ matches: false })), false);
});

test("scrollBehaviorForMotion turns smooth scrolling instant under reduced motion only", () => {
  const reduced = (query: string) => ({ matches: query === REDUCED_MOTION_MEDIA_QUERY });
  assert.equal(scrollBehaviorForMotion("smooth", reduced), "auto");
  assert.equal(scrollBehaviorForMotion(undefined, reduced), "auto");
  assert.equal(scrollBehaviorForMotion("auto", reduced), "auto");
  assert.equal(scrollBehaviorForMotion("smooth", () => ({ matches: false })), "smooth");
  assert.equal(scrollBehaviorForMotion(undefined, () => ({ matches: false })), "smooth");
  assert.equal(scrollBehaviorForMotion("auto", () => ({ matches: false })), "auto");
});

test("default matcher treats a missing matchMedia as reduced motion off", () => {
  // The vitest node environment has no window; the browser path uses window.matchMedia.
  assert.equal(prefersReducedMotion(), false);
  assert.equal(scrollBehaviorForMotion("smooth"), "smooth");
});

test("globals.css collapses every animation/transition under prefers-reduced-motion", () => {
  const block = reducedMotionBlock(globalsCss);
  // Universal coverage, including pseudo-elements where keyframes can run.
  for (const selector of ["*", "*::before", "*::after"]) {
    assert.ok(block.includes(selector), `media query must cover ${selector}`);
  }
  // Near-instant single frame instead of removing declarations: state changes stay
  // immediate, transitionend/animationend keep firing (Vue <Transition> completes),
  // and infinite loops (spinners, skeletons, tree status pulse) stop on frame one.
  assert.match(block, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(block, /animation-iteration-count:\s*1\s*!important/);
  assert.match(block, /transition-duration:\s*0\.01ms\s*!important/);
  // No CSS-declared smooth scrolling escapes the collapse.
  assert.match(block, /scroll-behavior:\s*auto\s*!important/);
});

test("tab bar smooth scrolling consults the reduced-motion preference", () => {
  // Composable: arrow-button page scroll must go through the helper.
  assert.match(useTabScrollSource, /import \{ scrollBehaviorForMotion \} from "@\/lib\/reducedMotion";/);
  assert.match(useTabScrollSource, /behavior: scrollBehaviorForMotion\("smooth"\)/);
  assert.ok(!useTabScrollSource.includes('behavior: "smooth"'), "useTabScroll must not keep an unguarded smooth scroll");
  // Component: active-tab reveal (all callers pass through scrollActiveTabIntoView)
  // and the driver-store reveal must go through the helper too.
  assert.match(appTabBarSource, /import \{ scrollBehaviorForMotion \} from "@\/lib\/reducedMotion";/);
  assert.match(appTabBarSource, /scrollBehaviorForMotion\(behavior\)/);
  assert.match(appTabBarSource, /scrollBehaviorForMotion\("smooth"\)/);
  assert.ok(!appTabBarSource.includes('behavior: "smooth"'), "AppTabBar must not keep an unguarded smooth scroll");
});
