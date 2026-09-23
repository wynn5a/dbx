# Review — SQL completion track (T05, T06, T07, T09, T14, T24, T33, T36)

Back to [index](README.md).

Behaviour verified by building `sqlCompletion.ts` with esbuild and calling it from node at HEAD and at `fc95f900^`. Line numbers are HEAD.

| Task | Commit | Verdict |
|---|---|---|
| T05 Strip comments before context detection | fc95f900 | 2 medium, 1 low |
| T06 MySQL/SQL Server identifier quoting | db20604b | 1 medium |
| T07 One dialect map | fccd9dcd | 1 medium |
| T09 Superset completion cache | 4025a0cc | OK, 1 low |
| T14 Invalidate completion cache after DDL | 9b9e361f | 1 medium, 1 low |
| T24 Dialect function catalogs | 9a8178b2 | 1 medium, 1 low |
| T33 Keyword case follows input | b4588cba | 1 medium |
| T36 getSqlCompletionResultValidFor | ad03e069 | 1 high |

## T36 — validFor

- [ ] **HIGH — reused results never re-rank or narrow; Enter can insert the wrong item**
  - Where: `QueryEditor.buildCompletionResult` sets `filter: false`; with `validFor` CodeMirror keeps the original list/order while typing.
  - MySQL columns `updated_at`, `upper_bound`: at `WHERE up` top = `updated_at`; keep typing `upper_b` → popup reused, `updated_at` still selected, Enter replaces `upper_b` with `updated_at` (before T36 top was `upper_bound`).
  - Also: type `se`, backspace to `s` (allowed since CM `limit` is `from+1`), type `h` → `se` list (SELECT/SET…) shown for `sh`, `SHOW` missing.
  - Tests only exercise the regex, not reuse behaviour.
  - Fix (any): `filter: true` on reusable results (CM fuzzy + `boost` re-rank); add `result.update` that re-filters; or return `undefined` again with a comment (task allowed that).

## T05 — Comment stripping

- [ ] **MEDIUM (regression) — multi-line block comments cut the statement short**
  - Where: `stripSqlComments` (`sqlCompletion.ts:1892`, `blank`) turns inner comment lines into spaces; `currentLineBlockEnd` treats whitespace-only lines as statement end.
  - `SELECT u.|\n/*\n  old:\n  FROM archived a\n*/\nFROM users u` → `referencedTables=[]`, no columns for `u.` (before: `users:u` found).
  - Fix: non-blank placeholder (e.g. `*`) on inner comment lines, or check blank lines against the original text.
- [ ] **MEDIUM (regression) — backslash-escaped quotes (MySQL) make the cursor look like it's in a comment**
  - `skipQuotedSpan` only knows `''`. `SELECT 'it\'s -- x', u.| FROM users u` → string ends at `\'`, rest of line becomes "comment" → neutral context (before: `q=u`, `refs=[users:u]`).
  - Fix: treat `\` as escape inside `'…'`/`"…"` for the mysql family (or all dialects when followed by the quote).
- [ ] **LOW — MySQL `#` comments and PG nested comments not handled, no tests**
  - `FROM users u # FROM archived a\nWHERE u.` still references `archived`; `/* a /* b */ FROM archived x */` leaks `archived`.

## T06 — MySQL / SQL Server quoting

- [ ] **MEDIUM — bracket identifiers inserted by completion break the next completion**
  - Where: `parseTrailingIdentifierPart` (~`sqlCompletion.ts:2640`), `unquoteIdentifier` (`:2681`), qualified-name splitter, `extractReferencedTables` — only `"` and backticks understood.
  - `SELECT * FROM [Order Details] od WHERE od.|` → refs `[{name:"[Order", alias:"Details"}]`, `od` unresolved. `SELECT * FROM [order] WHERE [order].|` → no qualifier.
  - Fix: `[…]` handling (with `]]` escape) in all four places. Reserved-word sets/escaping otherwise correct.

## T07 — One dialect map

- [ ] **MEDIUM (regression) — identifiers needing quotes inserted bare for sqlite/duckdb/clickhouse/oracle/generic**
  - Where: `quoteSqlIdentifier` default branch (`sqlCompletion.ts:2691`). Before T07, sqlite/clickhouse mapped to mysql and got backticks (both accept them).
  - `quoteSqlIdentifier("my table","sqlite")` → `my table` (invalid SQL on all five).
  - Fix: default branch wraps non-`^[A-Za-z_][A-Za-z0-9_$]*$` identifiers in ANSI `"…"` (double inner `"`). Also fixes the T41 column-drop finding in [grid-sidebar.md](grid-sidebar.md).
  - Frontend/backend tables match and are test-locked; DuckDB keyword gate correct.

## T14 — Invalidate after DDL

- [ ] **MEDIUM — QueryEditor component caches never invalidated**
  - Where: `cachedColumnsByTable` / `cachedTables` (`QueryEditor.vue:226-230`, read at `:1265`, `:538`) reset only on connection/database/schema change.
  - `ALTER TABLE users ADD COLUMN age int` after `users` columns loaded → `SELECT u.| FROM users u` still lacks `age`. `DROP TABLE` leaves the table in `cachedTables` (`mergeCompletionTables` only adds). Test is store-level only.
  - Fix: after successful DDL call the editor's `refreshCompletionCache()` (e.g. `refreshMetadataAfterExecution` bumps a store epoch that QueryEditor watches).
- [ ] **LOW — `OBJECT_DDL_RE` (`sqlMetadataRefresh.ts`) misses common DDL forms**
  - Missed: `CREATE UNLOGGED TABLE`, MySQL `CREATE DEFINER=… PROCEDURE/VIEW`, `CREATE ALGORITHM=… VIEW`, `CREATE VIRTUAL/FOREIGN/EXTERNAL TABLE`. Its `#.*$` stripping also eats PG `#>` operators and the rest of the line.

## T24 — Dialect function catalogs

- [ ] **MEDIUM — Oracle niladic pseudo-functions inserted with `()`**
  - Where: `sqlCompletion.ts:1046-1052` — `SYSDATE`, `SYSTIMESTAMP`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `LOCALTIMESTAMP`, `SESSIONTIMEZONE`, `DBTIMEZONE` with `[]` params; builder always emits `name()`. `SELECT sysd` → `SYSDATE()` → ORA-00923.
  - Fix: mark as no-parens; insert bare name; signature card skips them.
- [ ] **LOW — Oracle-family engines (dameng, yashandb, oceanbase-oracle) don't get the Oracle catalog** (keyed by `databaseType`, not by T07 dialect). Gap, not a bug.

## T33 — Keyword case follows input

- [ ] **MEDIUM — snippet recasing touches quoted identifiers and string literals, including user snippets**
  - Where: `applySnippetBodyCasing` / `SNIPPET_BODY_TOKEN_PATTERN` (`sqlCompletion.ts:4042`), applied to `settingsStore.editorSettings.snippets`.
  - Body `SELECT * FROM "User" WHERE "Date" > {since} AND kind = 'TABLE'` + prefix `sel` → `select * from "User" where "date" > {since} and kind = 'table'` — PG `"Date"`→`"date"` is a different identifier; `'TABLE'`→`'table'` changes data.
  - Fix: pass-through alternatives for `'…'`, `"…"`, backticks, `[…]` in the token regex; optionally recase only built-in snippets.

## T09 — Superset cache (OK)

- [ ] **LOW (perf) — truncated superset + typed filter isn't cached** (`connectionStore.ts:2659`, in-flight dedupe only). Very large schemas pay one IPC per keystroke incl. backspace/retype (before B2 each filter string was cached). Fix: small LRU keyed by filter on this fallback path.
- Client filter matches `filter_table_infos` semantics; keys scoped by schema+limit; invalidation covers the new cache.
