# Review of finished tasks — 2026-09-23

> Scope: the 43 ✅ tasks (T01–T43) in [tasks.md](../tasks.md), checked against [improvement-plan-2026-09.md](../improvement-plan-2026-09.md) and the process in [optimization-plan.md](../optimization-plan.md). T44/T45 (unfinished) and the uncommitted T44 working tree are out of scope.
> Method: each task's commit diff and current HEAD code were read against its 内容/验收; many findings were reproduced (esbuild/node probes of `sqlCompletion.ts`, vitest probes, a tokio pool-drop simulation, local redis-server, sqlparser 0.62 parse shapes). Line numbers are HEAD at `9456fa41`.
> Status: ✅ all findings addressed (2026-09-23), `c923ae29..71505484`. Each track file lists per-finding fix commits and notes. Exceptions: T08 "MySQL/SQLite bulk paths unreachable" was documented, not changed (ticked with reason, see [schema-startup.md](schema-startup.md)). Known leftovers outside scope (the Elasticsearch `validFor` + `filter:false` stale-order leftover was fixed afterwards with the same `update`-hook approach as T36): `retriggerCompletionAfterMetadata` still calls explicit `startCompletion`; the T13 save-guard message is not yet localized; `live_postgres_keepalive` / `live_postgres_transfer` not run.

## Track files

| File | Tasks |
|---|---|
| [security-cancel-pool.md](security-cancel-pool.md) | T01, T02, T03 |
| [connections.md](connections.md) | T10, T11, T26, T27, T28, T29 |
| [ai-agent.md](ai-agent.md) | T12, T20, T21, T31, T42, T43 |
| [completion.md](completion.md) | T05, T06, T07, T09, T14, T24, T33, T36 |
| [schema-startup.md](schema-startup.md) | T08, T13, T18, T22 |
| [grid-sidebar.md](grid-sidebar.md) | T04, T23, T25, T40, T41 |
| [ux.md](ux.md) | T15, T16, T17, T19, T30, T32, T34, T35, T37, T38, T39 |
| [command-palette.md](command-palette.md) | T44 (reviewed separately after it landed as `909b8f4f`) |
| [ast-references.md](ast-references.md) | T45 (reviewed separately after it landed as `d78655b6`) |

## Clean (no findings, or notes only)

T04, T12, T15, T25, T26, T28, T29, T35, T37, T38, T39, T43.

## Fix priority

### High

| # | Task | Finding | File |
|---|---|---|---|
| 1 | T03 | SQL Server grid saves not atomic — BEGIN/stmts/COMMIT land on different pooled sessions; open tx with locks leaks into the pool | [security-cancel-pool.md](security-cancel-pool.md) |
| 2 | T13 | Corrupt sidebar layout → connections not loaded → next save deletes all saved connections + secrets (rare, data loss) | [schema-startup.md](schema-startup.md) |
| 3 | T10 | Redis outage > 2 s → next command hangs ~2 min holding the session mutex (reproduced: 118 s) | [connections.md](connections.md) |
| 4 | T21 | Gemini 3 `thoughtSignature` dropped → turn 2 of every tool loop fails with 400 | [ai-agent.md](ai-agent.md) |
| 5 | T02 | PG server cancel never works on `sslmode=require` connections (NoTls cancel) | [security-cancel-pool.md](security-cancel-pool.md) |
| 6 | T36 | Completion validFor reuse with `filter:false` → Enter inserts the wrong item | [completion.md](completion.md) |
| 7 | T18 | Cancel on sidebar expand doesn't stop the dial; cancelled attempt still marks connected / records error | [schema-startup.md](schema-startup.md) |
| 8 | T22 | Unknown-column false positives on `DATEADD(day, …)` / `TIMESTAMPDIFF(DAY, …)` | [schema-startup.md](schema-startup.md) |
| 9 | T19 | Multi-statement SQL (e.g. two CREATEs) bypasses the high-risk acknowledgment | [ux.md](ux.md) |

| 10 | T45 | Completion references now come only from the AST; unparseable cursor-time statements (`WHERE u.`, `ON `, `SET `…) resolve to no tables → column/alias/JOIN completion lost | [ast-references.md](ast-references.md) |
| 11 | T45 | Background parse settle calls explicit `startCompletion` → popup reopens after nearly every keystroke, even after Esc / in strings | [ast-references.md](ast-references.md) |

(T13 is rated medium by likelihood but ranked high here because the outcome is silent data loss.)

### Medium

| Task | Finding | File |
|---|---|---|
| T03 | Lease return races permit release; idle list uncapped (grew to 7 vs 3) | [security-cancel-pool.md](security-cancel-pool.md) |
| T10 | Initial-connect errors (refused, bad password) masked as "timed out (5s)" | [connections.md](connections.md) |
| T27 | Multi-layer SSH: eviction leaves other layers running; chain never heals | [connections.md](connections.md) |
| T18 | Superseded attempt's `finally` clears the new attempt's spinner | [schema-startup.md](schema-startup.md) |
| T13 | `connectionsLoading` stuck true if saved-SQL load rejects | [schema-startup.md](schema-startup.md) |
| T22 | False positives: whole-row alias, aliased table function without column list, pseudo-columns | [schema-startup.md](schema-startup.md) |
| T20 | `search_tables` defaults to schema = database name on PG/SQL Server/Oracle → false "no match" | [ai-agent.md](ai-agent.md) |
| T21 | Gemini tool-call index per chunk → calls in separate chunks merged/lost | [ai-agent.md](ai-agent.md) |
| T31 | Retries on timeout (double billing / double wait) | [ai-agent.md](ai-agent.md) |
| T42 | Prompt-compliant reply renders SQL twice; `json_object` mode forced on every OpenAI Ask action | [ai-agent.md](ai-agent.md) |
| T05 | Multi-line block comment ends the statement; `\'` escapes misread (both regressions) | [completion.md](completion.md) |
| T06 | `[…]` identifiers not parsed back → alias/qualifier resolution breaks | [completion.md](completion.md) |
| T07 | sqlite/duckdb/clickhouse/oracle/generic identifiers inserted unquoted (regression; also T41) | [completion.md](completion.md) |
| T14 | QueryEditor's own column/table caches not cleared after DDL | [completion.md](completion.md) |
| T24 | Oracle niladic functions inserted as `SYSDATE()` | [completion.md](completion.md) |
| T33 | Snippet recasing changes quoted identifiers and string literals | [completion.md](completion.md) |
| T23 | FK navigation filter not in WHERE bar → dropped on page/sort/refresh | [grid-sidebar.md](grid-sidebar.md) |
| T40 | Scroll-into-view hides column under pinned area; layout leaks across queries in a tab | [grid-sidebar.md](grid-sidebar.md) |
| T17 | "Connection failed:" framing removed from connect toasts | [ux.md](ux.md) |
| T32 | Chart X/Y choices reset on every keystroke/stream delta | [ux.md](ux.md) |
| T34 | Tab shortcuts don't dismiss Driver Store | [ux.md](ux.md) |
| T45 | Negative parse verdicts win the stale-prefix lookup; one backend parse per keystroke, unmeasured | [ast-references.md](ast-references.md) |
| T44 | Palette runs actions the toolbar disables (no connections → Transfer/Diff/Compare/SQL file open; New Query silently no-ops) | [command-palette.md](command-palette.md) |

### Low

T01 Mongo write routes ungated server-side · T02 cancel can poison a pool waiter; no-`execution_id` timeouts not server-cancelled · T03 transfer drops healthy socket on SQL error · T05 `#` / nested comments · T08 MySQL/SQLite bulk paths unreachable; SQL Server fallback serial · T09 no cache on truncated+filtered fallback · T11 sweep evicts busy pools · T14 DDL regex misses forms · T16 errors logged twice · T17 auth hint on permission errors · T24 Oracle-family engines lack catalog · T27 toast host for inner hops · T30 cancelled-run usage not persisted · T31 backoff ignores cancel · T40 duplicate-name reorder, hidden-column order/pin guard · T41 unquoted generic column drops (fixed by T07 fix) · T44 separate registry from shortcut registry (no key hints, shortcut actions missing), Mod+K stacks over other modals, dead `watch(open)`.

## Cross-cutting notes

- **Tests that don't exercise the real path**: T22 (hand-built analyses), T36 (regex only), T14 (store level only), T18 (`connect()` only), T10/T02 live tests (short outage / no TLS). Each fix should add a test on the real path.
- **One fix, two findings**: the `quoteSqlIdentifier` default-branch fix covers T07 and T41.
