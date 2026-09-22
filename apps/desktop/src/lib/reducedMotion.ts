/**
 * OS "reduce motion" accessibility preference (`prefers-reduced-motion: reduce`).
 *
 * CSS-side transitions and animations are collapsed globally in
 * `styles/globals.css` via a `@media (prefers-reduced-motion: reduce)` block;
 * JS-driven smooth scrolling (tab bar) consults this module instead, because no
 * stylesheet can reach an explicit `behavior: "smooth"` argument.
 */

export const REDUCED_MOTION_MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

/** Reads the system preference; a missing `window.matchMedia` (tests, odd embeds) counts as off. */
export function prefersReducedMotion(matchMedia: (query: string) => { matches: boolean } = defaultMatchMedia): boolean {
  return matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;
}

/**
 * ScrollBehavior honoring the preference: under reduced motion every scroll
 * becomes instant ("auto"), otherwise the caller's preference (default smooth)
 * applies.
 */
export function scrollBehaviorForMotion(
  preferred: ScrollBehavior = "smooth",
  matchMedia: (query: string) => { matches: boolean } = defaultMatchMedia,
): ScrollBehavior {
  return prefersReducedMotion(matchMedia) ? "auto" : preferred;
}

function defaultMatchMedia(query: string): { matches: boolean } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return { matches: false };
  return window.matchMedia(query);
}
