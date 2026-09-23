// Completion caches live at two levels: the connection store's shared
// listings, and each QueryEditor's own per-editor caches (tables merged from
// background refreshes, columns/foreign keys per referenced table). The store
// publishes every invalidation (e.g. after successful DDL, reconnect) as an
// event so the editors can drop their copies too — otherwise `ALTER TABLE …
// ADD COLUMN` stays invisible to an editor that had already loaded the columns,
// and a dropped table lingers in its merged table list.

export interface CompletionCacheInvalidation {
  /** Monotonic, so watchers see every event even when the scope repeats. */
  seq: number;
  connectionId: string;
  /** Absent: every database of the connection was invalidated. */
  database?: string;
}

/** Whether an editor bound to (connectionId, database) must drop its caches for `event`. */
export function completionCacheInvalidationAffects(
  event: CompletionCacheInvalidation | null | undefined,
  connectionId: string | undefined,
  database: string | null | undefined,
): boolean {
  if (!event || !connectionId || event.connectionId !== connectionId) return false;
  return event.database == null || database == null || event.database === database;
}
