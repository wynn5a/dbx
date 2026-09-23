# Review — schema IPC / startup / cancellable loads / diagnostics (T08, T13, T18, T22)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T08 One IPC for all schemas | 879d2673 | OK, 2 low |
| T13 Parallel startup + loading state | 014307e0 | 2 medium |
| T18 Cancellable connect & schema load | 58f1c843 | 1 high, 1 medium |
| T22 Confidence-gated unknown-column diagnostics | 4d08758a | 1 high, 3 medium |

## T18 — Cancellable connect and schema load

- [ ] **HIGH — Cancel on sidebar expand of an unconnected connection doesn't stop the dial, and the cancelled attempt still mutates state**
  - Where: `TreeItem.vue:408` → `loadDatabases` (`connectionStore.ts:~1194-1200`, attempt kind `"load"`) → `ensureConnected` (`:1167-1189`) calls `api.connectDb(config)` with no attempt id.
  - Clicking X sends no backend cancel; dial completes, then `connectedIds.add`, `activeConnectionId` set, error cleared (or `recordConnectionError` on failure). Row turns "connected" with no children, or an error appears — breaks "cancel is silent, back to idle".
  - `connectionStoreCancel.test.ts` only drives `store.connect()`; the most common path is untested, so acceptance item 1 isn't really met.
  - Fix: pass the load attempt into `ensureConnected`, mint an `attemptId` for its `connectDb`, switch the attempt to connect kind, guard state writes with `attemptIsActive`. Add a test on the `loadDatabases` path.
- [ ] **MEDIUM — superseded attempt's `finally` clears the new attempt's spinner**
  - Where: every loader + `connect()` ends with `endNodeAttempt(attempt)` then unconditional `commitTreeNode(..., isLoading=false)` (e.g. `:1103`, `:1287`, `:1343`, `:1448`).
  - Cancel slow `loadTables` (A), expand again (B). A settles later → isLoading=false while B runs; spinner and X disappear, B can't be cancelled.
  - Fix: clear `isLoading` only when `nodeAttempts.get(nodeId)` is unset or still `attempt`.

## T22 — Unknown-column diagnostics (false positives)

The gate trusts every unqualified `Identifier` the Rust analyzer collects; single-resolved-table statements (`sqlUnknownColumns.ts:87`) get flagged. Parse shapes confirmed with sqlparser 0.62. Tests feed hand-built analyses, so real parser output never reaches the gate — add analyzer→gate tests for every case below.

- [ ] **HIGH — date-part keywords in function args flagged**
  - `SELECT DATEADD(day, 1, created_at) FROM orders` (MsSql) flags `day`; also `DATEDIFF`, `DATEPART`. MySQL `TIMESTAMPDIFF(DAY, created_at, NOW())` flags `DAY`.
  - Cause: `visit_function_arg` → `visit_expr` records the first arg as a column.
  - Fix: skip first arg of known date-part functions, or skip unquoted date-part keywords.
- [ ] **MEDIUM — table alias used as a whole-row value flagged (PG)**
  - `SELECT row_to_json(u) FROM users u`, `json_agg(t)`, `SELECT u FROM users u`.
  - Fix: skip unqualified names equal to any table reference alias/name.
- [ ] **MEDIUM — scalar table function aliased without column list flagged**
  - `SELECT n FROM users, generate_series(1,3) n`, `unnest(tags) AS u` → `TableFactor::Table { args: Some, alias, columns: [] }` not added to `tables` (`sql_analysis.rs:265`), statement looks single-table.
  - Fix: when `args.is_some()` / UNNEST / Function factors, record the alias in `alias_columns` or mark the statement not attributable.
- [ ] **MEDIUM — engine pseudo-columns flagged**
  - Oracle `ROWNUM`, `SYSDATE`; PG `ctid`, `xmin` (not returned by `get_columns`).
  - Fix: per-dialect pseudo-column skip list.

## T13 — Parallel startup + loading state

- [ ] **MEDIUM (rare, data loss) — corrupt sidebar layout drops connections; next save wipes them all**
  - Where: `connectionStore.ts:3169-3180` (`Promise.all`), `storage.rs:1027` (serde error on corrupt `layout_json`), `storage.rs:635` (`save_connections` does `DELETE FROM connections`).
  - `loadSidebarLayout` rejects → nothing committed → `connections=[]` → user saves a new connection → every stored connection and its secrets deleted.
  - Fix: `api.loadSidebarLayout().catch(() => null)` or `Promise.allSettled` (`reconcileLayout` already accepts `null`).
- [ ] **MEDIUM — `connectionsLoading` can stay true forever**
  - `connectionsLoading` starts `true` (`:138`), cleared only in `initFromDisk`'s `finally`; `App.vue:979-983` only calls `initFromDisk` after `savedSqlStore.initFromStorage()` resolves. If `loadSavedSqlLibrary` rejects, Welcome/sidebar show "Loading connections…" permanently.
  - Fix: run `initFromDisk` independently (or in `finally`), or clear the flag in App's `catch`.

## T08 — One IPC for all schemas

- [ ] **LOW — MySQL/SQLite bulk paths are unreachable**
  - Frontend only calls bulk when `isSchemaAwareDatabase` (`connectionStore.ts:2618`); `SCHEMA_AWARE_TYPES` (`lib/databaseCapabilitySets.ts:3-35`) has neither. New code in `db/mysql.rs` / `db/sqlite.rs` and the "PG/MySQL/SQLite one test each" acceptance item cover dead paths.
  - Fix: note it in tasks.md, or route MySQL multi-database completion through bulk.
- [ ] **LOW/MEDIUM — SQL Server fallback is fully serial**
  - `schema.rs:612` loops `list_tables_core` + `list_completion_objects_core` per schema sequentially; old frontend did 5 at a time. 30 schemas ⇒ 60 serial round trips in one invoke.
  - Fix: bounded concurrency (`futures::stream::iter(..).buffered(5)`).
