import type { SqlCompletionContext } from "@/lib/sqlCompletion";

// Popup reuse for SQL completion results (CodeMirror `CompletionResult.update`).
//
// Results are built with `filter: false` — the item order is our own ranking
// (match score + per-kind base + history boost), which CodeMirror's fuzzy
// filter would override. A plain `validFor` would therefore keep the ORIGINAL
// list and order while the user keeps typing: at `WHERE up` the top item is
// `updated_at`, and after typing on to `upper_b` it would still be selected, so
// Enter replaced `upper_b` with `updated_at`. Instead, a typed continuation of
// the same identifier re-runs only the synchronous, IPC-free part of the source:
// the context captured when the popup opened, with the grown prefix, fed through
// the same item builder over the metadata that result was built from. Items are
// re-narrowed and re-ranked exactly as a fresh request would rank them, while the
// statement scan, reference analysis and metadata lookups are skipped.
//
// Reuse is only valid while the typed token EXTENDS the prefix the result was
// built for:
// - The metadata behind a result was looked up with that prefix as its filter
//   (a case-insensitive contains/subsequence filter), so it is a superset of the
//   candidates for any extension of it — but not for a different or shorter
//   token. Backspacing below the original prefix (e.g. `se` -> `s`, then `sh`)
//   recomputes, so `SHOW` is not missing from a list built for `se`.
// - Results for prefixes shorter than 2 characters never reuse: routine
//   suggestions switch on at exactly 2 characters (`suggestRoutines` in
//   getSqlCompletionContext), and the objects they need were not loaded for the
//   shorter prefix.
// - Only identifier characters extend the token. `.` switches to qualified
//   columns, whitespace/operators/quotes end the token, and `@` (SQL Server
//   variables) starts outside the identifier charset — all of those recompute.
const REUSABLE_TOKEN = /^[A-Za-z0-9_$]*$/;
const MIN_REUSABLE_PREFIX = 2;

/** Whether a result built for `originalPrefix` may be rebuilt for the typed token `typed`. */
export function canReuseSqlCompletionResult(originalPrefix: string, typed: string): boolean {
  if (originalPrefix.length < MIN_REUSABLE_PREFIX) return false;
  if (!REUSABLE_TOKEN.test(originalPrefix) || !REUSABLE_TOKEN.test(typed)) return false;
  return typed.length >= originalPrefix.length && typed.toLowerCase().startsWith(originalPrefix.toLowerCase());
}

export interface SqlCompletionReuse<Item> {
  /** The context the result was built from (its `prefix` is the original token). */
  context: SqlCompletionContext;
  /** The item builder of the original request, over the metadata it used. */
  build: (context: SqlCompletionContext) => Item[];
}

/** The subset of CodeMirror's `CompletionContext` the update hook reads. */
export interface SqlCompletionUpdateContext {
  pos: number;
  state: { sliceDoc(from?: number, to?: number): string };
}

export interface ReusableSqlCompletionResult<Option> {
  from: number;
  filter: false;
  options: Option[];
  update?: (
    current: unknown,
    from: number,
    to: number,
    context: SqlCompletionUpdateContext,
  ) => ReusableSqlCompletionResult<Option> | null;
}

/**
 * Build a `filter: false` completion result; with `reuse`, it carries an
 * `update` hook that rebuilds the ranked items for typed continuations of the
 * token (see above) and returns null — CodeMirror then re-runs the source —
 * for anything else, or when nothing matches any more.
 */
export function buildReusableSqlCompletionResult<Item, Option>(
  items: Item[],
  from: number,
  toOption: (item: Item) => Option,
  reuse?: SqlCompletionReuse<Item>,
): ReusableSqlCompletionResult<Option> | null {
  if (items.length === 0) return null;
  const result: ReusableSqlCompletionResult<Option> = {
    from,
    filter: false,
    options: items.map(toOption),
  };
  if (reuse && canReuseSqlCompletionResult(reuse.context.prefix, reuse.context.prefix)) {
    result.update = (_current, updatedFrom, _to, context) => {
      if (context.pos < updatedFrom) return null;
      const typed = context.state.sliceDoc(updatedFrom, context.pos);
      if (!canReuseSqlCompletionResult(reuse.context.prefix, typed)) return null;
      const rebuilt = reuse.build({ ...reuse.context, prefix: typed });
      // Keep `reuse` (and so the ORIGINAL prefix): the metadata is a superset
      // for extensions of the original token only.
      return buildReusableSqlCompletionResult(rebuilt, updatedFrom, toOption, reuse);
    };
  }
  return result;
}
