import * as api from "@/lib/api";
import type { SqlReferenceAnalysis } from "@/types/database";
import { extractSqlReferencesFallback, type SqlStatementReferences } from "@/lib/sqlCompletion";

/**
 * Per-statement-text cache over the backend's AST reference analysis.
 *
 * Completion is a keystroke hot path and `getSqlCompletionContext` is a
 * synchronous pure function, so the async backend parse cannot be awaited
 * there. Instead the cache serves synchronously whatever is known:
 *
 * - exact statement text already analyzed → that result;
 * - otherwise the longest *successfully* analyzed prefix of the statement
 *   (stale-while-revalidate), merged with the regex fallback scan of the
 *   current text, while a debounced backend parse runs for the exact text.
 *
 * Mid-typing statements are usually unparseable exactly where column completion
 * matters (`WHERE u.`, `JOIN o ON `, `SET `, a trailing `AND `). A failed parse
 * therefore never resolves to "no tables": it stores the same prefix + regex
 * fallback merge, flagged as failed so it never serves as a prefix for later
 * statements (a negative verdict must not beat an older positive one).
 */

const CACHE_LIMIT = 256;
// Keys hold full statement texts; cap their total size too so a long statement
// typed character by character cannot pin hundreds of near-duplicate copies.
const CACHE_CHAR_LIMIT = 512 * 1024;
// Background parses are debounced like the completion flow itself: a burst of
// keystrokes collapses into one `analyze_sql_references` IPC for the text the
// user paused on. Explicit/awaited lookups (`ensureSqlStatementReferences`)
// bypass the debounce.
const BACKGROUND_PARSE_DELAY_MS = 120;
const EMPTY_REFERENCES: SqlStatementReferences = { referencedTables: [] };

interface CacheEntry {
  references: SqlStatementReferences;
  /** The backend could not parse the statement; `references` is the fallback. */
  failed: boolean;
}

export interface SqlReferencesSettledEvent {
  statement: string;
  dialect?: string;
  references: SqlStatementReferences;
}

// Insertion-ordered maps double as LRU: on hit, delete + re-set moves the
// entry to the back; eviction drops from the front.
const cache = new Map<string, CacheEntry>();
let cachedChars = 0;
const inFlight = new Map<string, Promise<SqlStatementReferences>>();
const listeners = new Set<(event: SqlReferencesSettledEvent) => void>();
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundKey: string | null = null;

type ReferencesFetcher = (statement: string, dialect?: string) => Promise<SqlReferenceAnalysis>;

let fetcher: ReferencesFetcher | null = (statement, dialect) => api.analyzeSqlReferences(statement, dialect);

function dialectPrefix(dialect?: string): string {
  return `${(dialect ?? "").toLowerCase()}\u0000`;
}

function cacheKey(statement: string, dialect?: string): string {
  return `${dialectPrefix(dialect)}${statement}`;
}

/** Backend AST analysis → the reference shape the completion pipeline consumes. */
export function sqlReferencesFromAnalysis(analysis: SqlReferenceAnalysis): SqlStatementReferences {
  const referencedTables: SqlStatementReferences["referencedTables"] = [];
  for (const table of analysis.tables ?? []) {
    referencedTables.push({
      name: table.name,
      schema: table.schema ?? undefined,
      alias: table.alias ?? undefined,
    });
  }
  // CTEs shadow same-named tables and carry the output columns completion
  // suggests; the AST emits CTE references as plain table entries, so enrich
  // them here (same merge the old regex path performed).
  for (const cte of analysis.cte_definitions ?? []) {
    const existing = referencedTables.find((table) => table.name.toLowerCase() === cte.name.toLowerCase());
    if (!existing) {
      referencedTables.push({ name: cte.name, columns: cte.columns });
    } else if (!existing.columns) {
      existing.columns = cte.columns;
    }
  }
  // Derived tables (`FROM (SELECT …) x`) are referenced by alias — the AST
  // emits them separately, so add the ones not already present.
  for (const derived of analysis.derived_tables ?? []) {
    if (referencedTables.some((table) => table.name.toLowerCase() === derived.alias.toLowerCase())) continue;
    referencedTables.push({ name: derived.alias, alias: derived.alias, columns: derived.columns });
  }
  return { referencedTables };
}

/** Structural equality of two reference sets (order-sensitive, as served). */
export function sqlStatementReferencesEqual(a: SqlStatementReferences, b: SqlStatementReferences): boolean {
  if (a === b) return true;
  if (a.referencedTables.length !== b.referencedTables.length) return false;
  return JSON.stringify(a.referencedTables) === JSON.stringify(b.referencedTables);
}

// Name + alias: the regex scan often lacks the schema the AST resolved, so the
// schema is not part of the identity (`users u` is the same reference either way).
function referenceIdentity(table: SqlStatementReferences["referencedTables"][number]): string {
  return `${table.name.toLowerCase()}\u0000${table.alias?.toLowerCase() ?? ""}`;
}

// The last good AST analysis of a prefix, plus whatever the regex scan of the
// current text finds beyond it (tables/aliases typed after that prefix).
function mergeReferences(
  base: SqlStatementReferences | undefined,
  fallback: SqlStatementReferences,
): SqlStatementReferences {
  if (!base || base.referencedTables.length === 0) return fallback;
  const seen = new Set(base.referencedTables.map(referenceIdentity));
  const extra = fallback.referencedTables.filter((table) => !seen.has(referenceIdentity(table)));
  if (extra.length === 0) return base;
  return { referencedTables: [...base.referencedTables, ...extra] };
}

function longestAnalyzedPrefix(statement: string, dialect?: string): SqlStatementReferences | undefined {
  const prefix = dialectPrefix(dialect);
  let best: SqlStatementReferences | undefined;
  let bestLength = -1;
  for (const [candidateKey, entry] of cache) {
    // Failed parses hold fallback guesses, not analyses: never let them win
    // the prefix lookup over an older successful analysis.
    if (entry.failed) continue;
    if (!candidateKey.startsWith(prefix)) continue;
    const candidateLength = candidateKey.length - prefix.length;
    if (candidateLength <= bestLength || candidateLength > statement.length) continue;
    if (!statement.startsWith(candidateKey.slice(prefix.length))) continue;
    best = entry.references;
    bestLength = candidateLength;
  }
  return best;
}

function provisionalReferences(statement: string, dialect?: string): SqlStatementReferences {
  return mergeReferences(longestAnalyzedPrefix(statement, dialect), extractSqlReferencesFallback(statement));
}

function evict(key: string) {
  if (cache.delete(key)) cachedChars -= key.length;
}

function store(key: string, statement: string, dialect: string | undefined, entry: CacheEntry) {
  evict(key);
  cache.set(key, entry);
  cachedChars += key.length;
  while (cache.size > CACHE_LIMIT || (cachedChars > CACHE_CHAR_LIMIT && cache.size > 1)) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    evict(oldest);
  }
  const event: SqlReferencesSettledEvent = { statement, dialect, references: entry.references };
  for (const listener of listeners) listener(event);
}

function cancelBackgroundParse(key?: string) {
  if (!backgroundTimer) return;
  if (key !== undefined && backgroundKey !== key) return;
  clearTimeout(backgroundTimer);
  backgroundTimer = null;
  backgroundKey = null;
}

function request(statement: string, dialect?: string): Promise<SqlStatementReferences> {
  const key = cacheKey(statement, dialect);
  cancelBackgroundParse(key);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    let entry: CacheEntry;
    try {
      const analysis = await (fetcher ? fetcher(statement, dialect) : Promise.reject(new Error("no fetcher")));
      entry = { references: sqlReferencesFromAnalysis(analysis), failed: false };
    } catch {
      // Parse errors are a normal mid-typing state. Same text fails the same
      // way, so cache the verdict (no re-parse per keystroke) — but as the
      // fallback references, not an empty set.
      entry = { references: provisionalReferences(statement, dialect), failed: true };
    }
    inFlight.delete(key);
    store(key, statement, dialect, entry);
    return entry.references;
  })();
  inFlight.set(key, promise);
  return promise;
}

function scheduleBackgroundParse(statement: string, dialect?: string) {
  const key = cacheKey(statement, dialect);
  if (inFlight.has(key) || backgroundKey === key) return;
  cancelBackgroundParse();
  backgroundKey = key;
  backgroundTimer = setTimeout(() => {
    backgroundTimer = null;
    backgroundKey = null;
    if (!cache.has(key)) void request(statement, dialect);
  }, BACKGROUND_PARSE_DELAY_MS);
}

/**
 * Synchronous cache lookup for the completion hot path. Returns the exact
 * entry when present; otherwise the longest successfully analyzed prefix merged
 * with the regex fallback of the current text, and schedules a (debounced)
 * backend parse for the exact statement text.
 */
export function getSqlStatementReferences(statement: string, dialect?: string): SqlStatementReferences {
  if (!statement.trim()) return EMPTY_REFERENCES;
  const key = cacheKey(statement, dialect);
  const exact = cache.get(key);
  if (exact) {
    cache.delete(key);
    cache.set(key, exact);
    return exact.references;
  }
  scheduleBackgroundParse(statement, dialect);
  return provisionalReferences(statement, dialect);
}

/**
 * Awaited variant for non-hot paths (explicit Ctrl+Space completion, hover,
 * ctrl+click): waits for the backend parse of this exact statement text.
 */
export async function ensureSqlStatementReferences(
  statement: string,
  dialect?: string,
): Promise<SqlStatementReferences> {
  if (!statement.trim()) return EMPTY_REFERENCES;
  const exact = cache.get(cacheKey(statement, dialect));
  if (exact) return exact.references;
  return request(statement, dialect);
}

/**
 * Notified whenever a backend analysis settles, with the statement it was for
 * and the references now cached for it. The editor uses this to refresh an
 * open completion popup (see `shouldRefreshCompletionForSettledReferences`).
 */
export function subscribeSqlReferences(listener: (event: SqlReferencesSettledEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the last implicit (typing-triggered) completion pass saw. */
export interface SqlReferencesCompletionPass {
  epoch: number;
  position: number;
  statement: string;
  dialect?: string;
  /** The references that pass was served (possibly provisional). */
  served: SqlStatementReferences;
  /** Whether that pass produced a popup. */
  returnedResult: boolean;
}

/**
 * Whether a settled background analysis should re-run the completion pass.
 * Only for the statement the latest implicit pass was served for, with no
 * newer pass and the cursor unmoved, when the settled references differ from
 * what was served — and then only to refresh an open popup, or to open one the
 * missing references suppressed at a position where typing auto-opens it. A
 * popup dismissed with Esc (closed, but that pass returned a result), a cursor
 * inside a string, or after a space/`;` never reopens by itself.
 */
export function shouldRefreshCompletionForSettledReferences(input: {
  pass: SqlReferencesCompletionPass | null;
  settled: SqlReferencesSettledEvent;
  currentEpoch: number;
  currentPosition: number;
  popupActive: boolean;
  currentStatement: () => string;
  autoOpenAllowed: () => boolean;
}): boolean {
  const { pass, settled } = input;
  if (!pass) return false;
  if (pass.epoch !== input.currentEpoch || pass.position !== input.currentPosition) return false;
  if (pass.statement !== settled.statement) return false;
  if ((pass.dialect ?? "").toLowerCase() !== (settled.dialect ?? "").toLowerCase()) return false;
  if (sqlStatementReferencesEqual(pass.served, settled.references)) return false;
  if (input.currentStatement() !== settled.statement) return false;
  if (input.popupActive) return true;
  return !pass.returnedResult && input.autoOpenAllowed();
}

export function clearSqlReferencesCache(): void {
  cancelBackgroundParse();
  cache.clear();
  cachedChars = 0;
  inFlight.clear();
}

/** Test seam: inject a synchronous-backend fake, or pass null to restore the real IPC. */
export function setSqlReferencesFetcherForTests(next: ReferencesFetcher | null): void {
  fetcher = next;
  clearSqlReferencesCache();
}

export const SQL_REFERENCES_BACKGROUND_PARSE_DELAY_MS = BACKGROUND_PARSE_DELAY_MS;
