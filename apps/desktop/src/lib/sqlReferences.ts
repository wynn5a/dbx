import * as api from "@/lib/api";
import type { SqlReferenceAnalysis } from "@/types/database";
import type { SqlStatementReferences } from "@/lib/sqlCompletion";

/**
 * Per-statement-text cache over the backend's AST reference analysis.
 *
 * Completion is a keystroke hot path and `getSqlCompletionContext` is a
 * synchronous pure function, so the async backend parse cannot be awaited
 * there. Instead the cache serves synchronously whatever is known:
 *
 * - exact statement text already analyzed → that result (the common case —
 *   a statement is re-analyzed only once);
 * - a previously analyzed prefix of the current statement → that stale result
 *   (stale-while-revalidate: while typing, every keystroke immediately sees
 *   the references of the statement one character earlier, which are the same
 *   tables in practice);
 * - nothing → an empty set for this keystroke, while the backend parse runs.
 *   When it settles, subscribers (the editor) re-run the completion pass, the
 *   same retrigger mechanism used for late-loading column metadata.
 *
 * The backend parse failure (mid-typing syntax errors are normal) resolves to
 * an empty set, matching the old regex behavior of finding nothing in broken
 * SQL — but without the false positives on comments, dollar-quoted bodies and
 * string literals that made the regex path wrong.
 */

const CACHE_LIMIT = 256;
const EMPTY_REFERENCES: SqlStatementReferences = { referencedTables: [] };

// Insertion-ordered maps double as LRU: on hit, delete + re-set moves the
// entry to the back; eviction drops from the front.
const cache = new Map<string, SqlStatementReferences>();
const inFlight = new Map<string, Promise<SqlStatementReferences>>();
const listeners = new Set<() => void>();

type ReferencesFetcher = (statement: string, dialect?: string) => Promise<SqlReferenceAnalysis>;

let fetcher: ReferencesFetcher | null = (statement, dialect) => api.analyzeSqlReferences(statement, dialect);

function cacheKey(statement: string, dialect?: string): string {
  return `${(dialect ?? "").toLowerCase()}\u0000${statement}`;
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

function store(key: string, references: SqlStatementReferences) {
  cache.delete(key);
  cache.set(key, references);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  for (const listener of listeners) listener();
}

function request(statement: string, dialect?: string): Promise<SqlStatementReferences> {
  const key = cacheKey(statement, dialect);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    let resolved: SqlStatementReferences;
    try {
      const analysis = await (fetcher ? fetcher(statement, dialect) : Promise.reject(new Error("no fetcher")));
      resolved = sqlReferencesFromAnalysis(analysis);
    } catch {
      // Parse errors are a normal mid-typing state; same text fails the same
      // way, so cache the empty verdict instead of re-parsing per keystroke.
      resolved = EMPTY_REFERENCES;
    }
    inFlight.delete(key);
    store(key, resolved);
    return resolved;
  })();
  inFlight.set(key, promise);
  return promise;
}

/**
 * Synchronous cache lookup for the completion hot path. Returns the exact
 * entry when present, the closest analyzed prefix while typing (revalidating
 * the exact key in the background), or an empty set — and always makes sure a
 * backend parse is in flight for the exact statement text.
 */
export function getSqlStatementReferences(statement: string, dialect?: string): SqlStatementReferences {
  if (!statement.trim()) return EMPTY_REFERENCES;
  const key = cacheKey(statement, dialect);
  const exact = cache.get(key);
  if (exact) {
    cache.delete(key);
    cache.set(key, exact);
    return exact;
  }
  void request(statement, dialect);

  // Stale-while-revalidate: the longest analyzed prefix of the current
  // statement is the previous keystroke's verdict — serve it now, the exact
  // analysis lands a moment later and subscribers retrigger.
  const dialectPrefix = `${(dialect ?? "").toLowerCase()}\u0000`;
  let stale: SqlStatementReferences | undefined;
  let staleLength = -1;
  for (const [candidateKey, candidate] of cache) {
    if (!candidateKey.startsWith(dialectPrefix)) continue;
    const candidateStatement = candidateKey.slice(dialectPrefix.length);
    if (candidateStatement.length <= staleLength) continue;
    if (!statement.startsWith(candidateStatement)) continue;
    stale = candidate;
    staleLength = candidateStatement.length;
  }
  return stale ?? EMPTY_REFERENCES;
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
  return request(statement, dialect);
}

/**
 * Notified whenever a background analysis settles. The editor uses this to
 * re-run the completion pass so references that arrived mid-typing show up
 * without waiting for the next keystroke.
 */
export function subscribeSqlReferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearSqlReferencesCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Test seam: inject a synchronous-backend fake, or pass null to restore the real IPC. */
export function setSqlReferencesFetcherForTests(next: ReferencesFetcher | null): void {
  fetcher = next;
  clearSqlReferencesCache();
}
