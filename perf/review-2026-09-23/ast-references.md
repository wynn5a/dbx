# Review — AST-backed reference extraction (T45)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T45 AST-backed reference extraction | d78655b6 | 2 high, 2 medium, 1 low |

## How I checked

- Read `lib/sqlReferences.ts`, the `getSqlCompletionContext` references plumbing (`sqlCompletion.ts:1398-1407`, `:1983-2010`, `extractSqlStatementAt` `:1865`), the `QueryEditor.vue` diff, and the Rust `sql_analysis.rs` diff.
- `analyze_sql_references` (`sql_analysis.rs:93-133`) is a plain `Parser::parse_sql(...)?` with no error recovery. I ran sqlparser 0.62 (the same version) on typical cursor-time statements to see which ones parse.

Results (✗ = parse error, so the cache gets an empty verdict):

| Statement at the cursor | pg | mysql | generic |
|---|---|---|---|
| `SELECT * FROM users u WHERE u.` | ✗ | ✗ | ✗ |
| `SELECT u. FROM users u` | ✗ | ✗ | ✗ |
| `SELECT * FROM users u WHERE ` | ✗ | ✗ | ✗ |
| `SELECT * FROM users u JOIN orders o ON ` | ✗ | ✗ | ✗ |
| `SELECT * FROM users u JOIN orders o ON o.` | ✗ | ✗ | ✗ |
| `SELECT * FROM users u ORDER BY ` | ✗ | ✗ | ✗ |
| `SELECT * FROM users u WHERE u.name = 'x' AND ` | ✗ | ✗ | ✗ |
| `UPDATE users SET  WHERE id = 1` | ✗ | ✗ | ✗ |
| `SELECT id,  FROM users` | ✗ | ✗ | ok |
| `SELECT  FROM users u` | ok | ✗ | ok |
| `SELECT * FROM users u WHERE u` | ok | ok | ok |

Almost every position where column completion matters is a statement that doesn't parse. The commit message's premise ("statements that do not parse (mid-typing) resolve to no references, same as the old regex behavior on broken SQL") is false: the deleted regex extractor found `users u` in all of these.

## Findings

- [x] **HIGH — column, alias and JOIN completion loses its tables at the positions where it's needed**
  - **Fixed in 01087009**: options (a)+(b). The regex scanner is back as a parse-failure fallback only (`extractSqlReferencesFallback`, string/`$$` bodies masked); a failed parse caches the last good prefix analysis merged with the fallback scan, and a cold miss serves the same merge synchronously, so Ctrl+Space, hover and ctrl+click keep their tables. `packages/app-tests/fixtures/unparseable-cursor-statements.json` lists the statements above; the dbx-core test `cursor_time_statements_do_not_parse` pins that they fail in pg/mysql/generic, and `sqlReferences.test.ts` runs each through `ensureSqlStatementReferences` → `getSqlCompletionContext` (plus the keystroke → failed-settle sequence for `WHERE u.`).
  - Where: `sqlReferences.ts` `request()` (catch → `EMPTY_REFERENCES`, cached), `getSqlStatementReferences` (an exact hit returns the cached empty result), `QueryEditor.vue` `subscribeSqlReferences(() => retriggerCompletionAfterMetadata(...))`.
  - Flow for `SELECT * FROM users u WHERE u.|`:
    1. The keystroke misses the cache, so the stale-prefix fallback serves the refs from `…WHERE u`. The popup briefly shows `u`'s columns.
    2. The IPC call fails to parse and stores `EMPTY`.
    3. The subscription retriggers completion, which now hits `EMPTY` exactly. `u` no longer resolves and the columns vanish.
  - Explicit Ctrl+Space awaits `ensureSqlStatementReferences` and gets `EMPTY` straight away. So Ctrl+Space in `SELECT | FROM users` (MySQL), `…JOIN orders o ON |` (the FK-aware JOIN suggestions), `ORDER BY |`, `UPDATE users SET |` and `WHERE … AND |` offers no table columns.
  - Editing in the middle of an existing statement has no analyzed prefix to fall back on, so it goes straight to `EMPTY`.
  - Hover and ctrl+click on a statement with a syntax error also stop resolving tables.
  - Why tests missed it: the completion tests now feed `references` fixtures explicitly, and `sqlReferences.test.ts` uses a fake fetcher. So "既有补全回归全过" only shows that consumers still read references, not that references still reach them. The 2500-table perf test uses fixtures too.
  - Fix options:
    - (a) When the AST parse fails, fall back to the old regex extractor (restore it as a fallback only). This is the minimal safe fix.
    - (b) Never replace a positive result with a negative one: on parse failure, keep serving the last successful analysis for that statement's prefix or neighbour, and don't store negative verdicts where the prefix lookup can find them.
    - (c) Repair the text before sending it, e.g. replace the token at the cursor with a placeholder identifier and append `1` after a dangling `WHERE`/`ON`/`AND`/`,`/`SET`. This is brittle.
    - Recommendation: (a) plus (b). Add an integration-style test that runs the real Rust analyzer output for the statements above through `getSqlCompletionContext`, or a vitest fixture captured from `analyze_sql_references`.
- [x] **HIGH — the popup reopens by itself after every keystroke, even where auto-open would not fire**
  - **Fixed in 01087009**: the editor records the latest implicit pass (epoch, cursor, statement, served references, whether it produced a popup). A settle refreshes only if it is for that statement, the epoch and cursor are unchanged, the references differ, and the popup is open, or it was suppressed at a position where the auto-open gate passes. The refresh runs as an implicit pass (no explicit debounce / second await). The decision is `shouldRefreshCompletionForSettledReferences`, tested for Esc, strings/gate-closed, stale epoch, moved cursor and unchanged references.
  - Where: `QueryEditor.vue` (subscription) → `retriggerCompletionAfterMetadata` (`:1343-1348`) → `codeMirrorStartCompletion(view)`.
  - Each keystroke changes the statement text and starts an IPC call. When it settles, `store()` notifies the listeners and `startCompletion` runs.
  - CodeMirror marks `startCompletion` as explicit, and the explicit path skips the `shouldAutoOpenSqlCompletion` gate (`if (!explicit && !shouldAutoOpenSqlCompletion(...)) return null`).
  - Result: shortly after you type a space, a `;`, a character inside a string literal, or press Esc to dismiss, the popup opens with keyword or snippet items. Each retrigger also goes through the 150 ms explicit debounce and a second `ensureSqlStatementReferences`.
  - The epoch guard is a no-op: the listener reads `completionEpoch` at call time, so `epoch !== completionEpoch` is never true.
  - Before T45 this retrigger fired only for late column metadata, which is rare. Now it fires on nearly every keystroke.
  - Fix: retrigger only when a completion popup is currently open (`completionStatus(view.state) === "active"`) and the settled key equals the current statement at the cursor. Capture the epoch when the request starts, not when the listener runs. Use a non-explicit refresh, or re-apply the auto-open gate.
- [x] **MEDIUM — negative verdicts take part in the stale-prefix fallback**
  - **Fixed in 01087009**: failed entries are flagged and skipped by the prefix lookup (test: `…WHERE u.` failed, `…WHERE u` analyzed → `…WHERE u.n` gets the analyzed entry).
  - Where: `getSqlStatementReferences` longest-prefix loop. `EMPTY` entries are stored in the same map and match as prefixes.
  - `…WHERE u.` (cached `EMPTY`) is a longer prefix of `…WHERE u.n` than `…WHERE u`, so the next keystroke is served `EMPTY` instead of the last good analysis. The popup flickers to no columns until `u.n` settles.
  - Fix: keep negative verdicts in a separate set (or flag them) and skip them in the prefix search.
- [x] **MEDIUM — one backend parse per keystroke, with no measurement**
  - **Fixed in 01087009**: background parses are debounced (120 ms, latest text wins); awaited lookups bypass it. The cache is also capped at 512 KB of statement text. Measured: parse + JSON encode of a 13 KB, 20-join statement is ~1.0 ms median in release (~10 ms debug), via the ignored dbx-core test `large_statement_analysis_cost`; the frontend miss path (prefix scan + fallback scan) costs ~0.2 ms on the same text.
  - The old path did no IPC. Now every keystroke that changes the statement sends an `analyze_sql_references` invoke with the full statement text. There is no debounce, and each invoke then triggers the second completion pass above.
  - The cache holds up to 256 full statement texts; for long statements that's 256 near-duplicate copies.
  - "性能不劣化" was only shown with the fixture-fed 2500-table test, which does no IPC.
  - Fix: debounce the background parse (e.g. 100–150 ms, in line with the existing completion debounce), and measure the per-keystroke IPC cost on a large statement. Optionally cap the cache by total characters.
- [x] **LOW — unknown-column diagnostics now also cover INSERT/UPDATE/DELETE, with no gate tests**
  - **Fixed in 01087009**: eight UPDATE/DELETE cases added to the analyzer→gate fixture (`unknown-column-gate-cases.json`): known columns, SET-target and WHERE typos (flagged), PG system columns, Oracle ROWNUM, SQL Server DATEDIFF date part, and `UPDATE … FROM` with a second table. All pass without analyzer changes.
  - `visit_statement` now visits DML, and `visit_assignment` records SET targets as column references. A single-table `UPDATE users SET …` / `DELETE FROM users WHERE …` now goes through the T22 confidence gate.
  - This widens the reach of the T22 false positives listed in [schema-startup.md](schema-startup.md) (date-part args, pseudo-columns and similar) to DML.
  - It's probably intended (SET-target typos are real), but no gate test covers DML.
  - Fix: add analyzer→gate tests for UPDATE/DELETE when fixing T22.

## Acceptance items vs reality

- "既有补全回归全过": the tests pass, but only with injected references, which hides the high-severity finding above.
- "性能不劣化": measured without the new IPC path.
- "双解析器重复逻辑删除": done (about 370 lines removed). But the regex extractor was the only thing that handled unparseable statements, and nothing replaced it for that case.
- Known and documented: unquoted ES index patterns (`FROM logs-2024-*`) no longer register as tables.
