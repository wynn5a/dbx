# DBX Improvement Plan — connections, latency, completion, AI, UX

> Date: 2026-09-20 · Branch: `app-only` @ `858116b0` · Status: proposal, no code changed.
> Related: [optimization-plan.md](optimization-plan.md) (18 perf items done), [desktop-excellence-assessment.md](desktop-excellence-assessment.md), [dom-density-audit.md](dom-density-audit.md).
> Method: four read-only code surveys (connections/latency, completion, AI agent, UX). Every P0 below was re-verified against source before it was written down.

## 1. Summary

The perf plan already fixed the big CPU and memory hot spots. What is left is different in kind: **correctness and resilience gaps** that users feel as "flaky", "slow to recover", or "why did it do that", plus a few features every DB GUI is expected to have.

Top five, in order:

| # | Track | Item | Why first |
|---|---|---|---|
| 1 | AI / security | MCP bridge `/data/execute-query` runs any SQL with no auth and ignores its own `allow_writes` flag | Any local process gets silent read+write access to every configured DB |
| 2 | Connections | Cancel / timeout never stops the query on the server (PG, MySQL, SQL Server) | Locks and CPU keep burning after the user clicks Cancel |
| 3 | Connections | SQL Server has no pool; one socket, one mutex | Tree, completion and every tab freeze behind one slow query |
| 4 | UX | Grid inline-edit commit runs UPDATE/DELETE with no SQL preview | One wrong multi-select deletes rows silently |
| 5 | Completion | Comments are not stripped; quoting only works for Postgres; 25 DB types collapse into 3 dialects | Wrong suggestions and invalid SQL inserted for most engines |

Rule for everything below: reuse what exists (`process.rs` kill SQL, `is_read_only_sql`, `aiSqlExecutionPolicy.ts`, danger-SQL dialog, `sql_analysis.rs`, `QueryChart.vue`). Nothing here needs a new dependency.

---

## 2. Track A — Stable connections

### A1. Real server-side query cancel — **P0, M**
- **Symptom**: Cancel or the 30 s timeout drops the Rust future; the statement keeps running on the server.
- **Root cause**: `query.rs:519-576` cancels with `tokio::select!` only. Only DuckDB has a real interrupt (`query.rs:626-631`).
- **Fix**: `process.rs:121-125` already builds `pg_cancel_backend(pid)` and `KILL QUERY id`. Capture the backend pid / connection id at checkout (PG: `cancel_token()` on the client, no extra connection; MySQL: `CONNECTION_ID()`; SQL Server: `@@SPID`), store it in `RunningQueries`, and call it on cancel and on timeout.
- **Verify**: integration test with `pg_sleep(30)` + cancel → `pg_stat_activity` no longer shows the query.

### A2. SQL Server pool — **P0, M**
- **Root cause**: `connection.rs:51` `PoolKind::SqlServer(Arc<Mutex<SqlServerClient>>)`; `check_conn_health` (`sqlserver.rs:21-39`) errors instead of redialing.
- **Fix**: small pool of 2-3 tiberius clients behind a semaphore, same `QUERY_POOL_MAX_SIZE = 3` as PG/MySQL. Health-check failure redials transparently like `mysql.rs:1448-1497`.

### A3. Redis auto-reconnect — **P1, S**
- **Root cause**: `redis_driver.rs:98` wraps `MultiplexedConnection`, which never reconnects.
- **Fix**: swap inner type to `redis::aio::ConnectionManager` (built-in backoff). Apply the same to Sentinel; cluster client already reconnects.

### A4. Health sweep covers all drivers — **P1, S**
- **Root cause**: `refresh_connections` (`connection.rs:854-873`) pings only MySQL/PG; others hit `_ => Ok(())`.
- **Fix**: add SQL Server (`check_conn_health`) and Redis (`PING`) arms. Triggered already on window focus and dock reopen.

### A5. SSH tunnel give-up must evict the pool — **P2, S**
- **Root cause**: `ssh_tunnel.rs:223-228` logs and returns after 10 attempts; the DB pool above it stays cached and returns "connection refused".
- **Fix**: on give-up call `discard_pool` and emit one event; frontend shows "SSH tunnel lost, reconnect".

### A6. TCP keepalive on raw DB sockets — **P2, S**
- Set `SO_KEEPALIVE` at connect for PG/MySQL/SQL Server (only the SSH session has it today, `ssh_tunnel.rs:51`). Detects half-open sockets before the app-level probe.

### A7. Idle-timeout setting is honest — **P2, S**
- `idle_timeout_secs` only reaches Mongo (`connection.rs:451`). PG (`postgres.rs:1119`) and MySQL (`mysql.rs:371`, hardcoded 300 s) ignore it.
- **Fix (lazy)**: hide the control for engines that ignore it. Wire it through later only if asked.

---

## 3. Track B — Less latency

### B1. One IPC call for all schemas — **P1, M**
- **Root cause**: `connectionStore.ts:2277-2358` `listCompletionTables` fans out one `listTables` invoke per schema (5 at a time); `listCompletionObjects` does the same.
- **Fix**: backend command taking a schema list (PG: `table_schema = ANY($1)`), returns grouped tables. One invoke, one pool checkout.

### B2. Completion cache keyed by superset, not by keystroke — **P1, M**
- **Root cause**: cache key includes the typed filter (`connectionStore.ts:2269`), so `u`, `us`, `use` are three entries and three round trips; `COMPLETION_CACHE_MAX = 50` then thrashes.
- **Fix**: cache the unfiltered (schema, limit) result; filter and rank client-side when it was not truncated. Fall back to server filter only when capped.

### B3. Startup loads in parallel, with a loading state — **P1, S**
- **Root cause**: `initFromDisk` (`connectionStore.ts:2872-2889`) awaits three independent IPC calls in series; `WelcomeScreen.vue:171` shows "no connections" until they finish.
- **Fix**: `Promise.all`, plus a `connectionsLoading` flag so the empty state waits for the first load.

### B4. PG JSON columns: no parse-then-reserialize — **P2, S**
- `postgres.rs:709-716` reads `serde_json::Value` then `.to_string()`. Read as `String` first; keep `Value` only as fallback.

### B5. Leaflet loads only when a geometry column exists — **P2, S**
- `DataGrid.vue:133` statically imports `geometryMapPreview`, which statically imports the Leaflet dialog. Make the dialog import dynamic inside `execute()`.

### B6. Result-set IPC path — **P2, L, defer**
- Up to 10 000 rows arrive as one JSON string and parse on the JS thread. Pagination already exists end to end. Only revisit with `tauri::ipc::Channel` if profiling shows first-page stalls after B1-B5.

---

## 4. Track C — Better auto-completion

Current design: a 3 300-line regex engine (`sqlCompletion.ts`) with a good two-tier local-instant + 150 ms async pipeline, FK-aware JOIN suggestions, and fuzzy ranking. The backend already has a real AST via `sqlparser` 0.62 (`sql_analysis.rs`) that completion does not use.

### C1. Strip comments before context detection — **P0, M**
- **Root cause**: `getSqlCompletionContext` (`sqlCompletion.ts:1350`) and all helpers strip string literals but never `--` or `/* */`. Commented-out SQL poisons `referencedTables` and statement kind.
- **Fix**: one `stripSqlComments()` pass at the top, replacing comment bodies with same-length spaces so every offset stays valid. Tests: cursor inside comment, code after comment, `$$` bodies.

### C2. Quote identifiers for MySQL and SQL Server — **P0, S**
- **Root cause**: `quoteSqlIdentifier` (`sqlCompletion.ts:2080`) returns unquoted for anything not Postgres.
- **Fix**: backtick and `[...]` branches with per-dialect reserved-word sets.

### C3. One dialect truth for frontend and backend — **P0, M**
- **Root cause**: `ContentArea.vue:181-186` maps 25+ `DatabaseType`s into `mysql | postgres | sqlserver`, default `mysql`. Backend `normalize_dialect` (`sql_analysis.rs:91-100`) groups them differently (Redshift, GaussDB, openGauss are PG-family).
- **Fix**: expose the backend grouping (or copy it into one shared TS map) and widen the frontend union with `oracle` and `generic`. Also gate DuckDB-only keywords (`QueryEditor.vue:1947-1964`) on `databaseType === "duckdb"` instead of adding them everywhere.

### C4. Invalidate completion cache after DDL — **P1, S**
- `invalidateCompletionCache` (`connectionStore.ts:796`) is called only on disconnect/update. After a successful `CREATE|ALTER|DROP|TRUNCATE` in the editor, call it for that connection and database.

### C5. Confidence-gated unknown-column diagnostics — **P1, L**
- Disabled on purpose (`QueryEditor.vue:818-822`) because the schema cache is partial. Re-enable only when the table resolves unambiguously and its full column list is loaded. Reuse the spans from `sql_analysis.rs`.

### C6. Dialect function catalogs — **P1, M per dialect**
- `DATABASE_FUNCTION_SIGNATURES` (`sqlCompletion.ts:848`) covers 5 of 25+ engines. Add ClickHouse, DuckDB, Oracle first (highest usage). Later: stored-procedure parameter hints from `information_schema.parameters` / `pg_proc`.

### C7. Small parity items — **P2, S each**
- Keyword case follows the typed prefix (or a setting); keywords are hardcoded upper.
- `getSqlCompletionResultValidFor` (`sqlCompletion.ts:1249`) is a stub returning `undefined`. Implement a prefix regex or document why not.

### C8. Long-term: AST-backed reference extraction — **P2, L**
- Replace `extractReferencedTables` / `extractCteDefinitions` / `extractSubqueryReferences` with the existing Rust `analyze_sql_references` (async, cached per statement text). Keep the regex path only for "which keyword class am I in". Removes a whole class of edge cases and the dual-parser duplication.

---

## 5. Track D — Better AI agent

Current design: providers Claude, OpenAI-compatible (OpenAI, Deepseek, Qwen, Ollama, custom), Gemini, Responses API. Real SSE streaming, a 10-turn tool loop with `list_tables`, `get_columns`, `execute_query`, `get_sample_data`, `explain_query`, parallel read-only tools, Claude prompt caching done correctly, write confirmation gate. Naming clash: `agent_catalog/manager/runtime/service/kv.rs` and `db/agent_driver.rs` are the JDBC out-of-process driver, not AI.

### D1. Lock down the MCP bridge — **P0 security, S**
- **Root cause**: `mcp_bridge.rs:482-494` `handle_execute_query_data` calls `execute_sql_statement` with no auth and never reads `req.allow_writes` / `allow_dangerous` (they are honored only in the sibling `/execute-query` at line 336). The bridge is a plaintext HTTP listener on `127.0.0.1:<random>`.
- **Fix**: require a shared token in every request (reuse `load_or_create_local_device_secret`, `storage.rs:476`), pass it to the npm MCP server at spawn; gate writes with `is_read_only_sql` unless `allow_writes` is set.

### D2. Agent tool queries are cancellable and visible — **P1, M**
- `agent_tools.rs:271,297,328` pass `cancel_token = None` and no `execution_id`. Chat Cancel stops the stream; the SQL runs to the 30 s timeout. Thread the loop's `cancelled` Notify into `QueryExecutionOptions` and register it in `RunningQueries` like `commands/query.rs:38-40`. Combine with A1 for real server-side cancel.

### D3. Risk tiers add friction — **P1, S**
- `aiSqlExecutionPolicy.ts` classifies 5 tiers but the Agent confirm card (`AiAssistant.vue:1170-1178`) shows the same one-click Run for `dangerous` and `low_risk_write`. Require a checkbox or typed table name for `dangerous` and `schema_change`.

### D4. `search_tables` tool — **P1, S**
- Schema context is the first 50 tables in listing order (`ai.ts:375, 413-455`), then a `truncated` flag. Add a name/comment substring search tool so the agent self-serves on 5 000-table schemas instead of guessing names.

### D5. Tool use for Gemini and capable Ollama models — **P1, M**
- `provider_supports_function_calling` (`ai.rs:1146-1156`) hardcodes both to `false`. `ToolDefinition::to_gemini_tool()` (`agent_events.rs:125`) exists but is dead. Implement the Gemini `functionCall` / `functionResponse` turn format; make Ollama tool use an opt-in per model.

### D6. One retry on connect — **P2, S**
- Zero retry logic in `ai.rs` / `agent_loop.rs`. One retry with backoff on the initial request (429 / 5xx / connect error), never mid-stream.

### D7. Show tokens and cost — **P2, S**
- `AgentEvent::AgentEnd` carries real usage (`agent_loop.rs:244`); the frontend drops it (`AiAssistant.vue:795` `case "agent_end": break`). Persist on the message, render a footer, optional static price table.

### D8. "Chart this result" from chat — **P2, S**
- `QueryChart.vue` exists; nothing links a tool result to it. Add one action on the result card. No new chart code.

### D9. Structured output for the "final SQL" — **P2, M**
- The first ```sql block is the answer by prompt instruction only (`ai.ts:278`), parsed by a fence scanner. Use JSON schema / tool-shaped output where the provider supports it.

### D10. End-to-end loop test — **P2, M**
- Unit tests cover helpers; nothing drives `run_agent_loop` against a mock SSE server across a multi-turn tool exchange. Add one with a tiny hyper test server (no new crate if hyper is already transitively present; otherwise `wiremock`).

---

## 6. Track E — Better UX

### E1. Grid save shows the SQL first — **P0, M**
- `useDataGridEditor.ts:766-834` executes the prepared statements right away; the only preview is `console.info` at line 825. Reuse the editor's danger-SQL dialog to list `stmts` / `rollbackStmts`, gated by the existing confirm setting.

### E2. No dark-mode flash on launch — **P1, S**
- `index.html` has no theme bootstrap; `applyTheme()` runs in `App.vue:940` `onMounted`. Add a 5-line inline script that reads the same localStorage key and sets the root class before first paint; give `#root:empty` a `prefers-color-scheme: dark` background.

### E3. Global error handler — **P1, S**
- No `app.config.errorHandler` or `onErrorCaptured` anywhere. Register one in `main.ts` that writes to the debug-log buffer and shows a toast pointing to Export Debug Logs.

### E4. Actionable connection errors — **P1, M**
- `i18n/backend-errors.ts` maps 4 installer patterns only. Add cross-driver classifiers: refused/timeout → host/port/VPN; auth keywords → credentials; TLS → SSL settings. Raw text stays as fallback.

### E5. Cancellable connect and schema load — **P1, M**
- `connect()` and tree loaders use `withConnectionAttemptTimeout` only. Thread an abort per attempt and put a Cancel affordance on the spinner, same as query cancel.

### E6. Keyboard parity — **P2, S each**
- `shortcutRegistry.ts` lacks next/prev tab, `Cmd+1-9`, and Format SQL (`formatActiveSql` is toolbar-only).

### E7. Grid features users expect — **P2, M each**
- FK click-to-navigate: FK metadata is already fetched (`DataGrid.vue:5571`); `useNavigationTargets.ts:18` already accepts a `whereInput`. Needs one click handler.
- Column pin / freeze and drag reorder (`useDataGridColumnResize` covers resize only).
- Drag table or column from the sidebar into the editor (no `dragstart` anywhere in `sidebar/`).

### E8. Command palette — **P2, L**
- None exists. Worth it given the feature count (transfer, diff, compare, driver store, SQL library). Build after E6 so the action registry exists.

### E9. Polish — **P2, S**
- `prefers-reduced-motion` media query (zero hits in `styles/`).
- `performance.mark` for startup phases into the debug log (today: ad-hoc `console.log(performance.now())`).
- CodeMirror loads at boot through `App.vue → ContentArea.vue → QueryEditor.vue:17`. Wrap `QueryEditor` in `defineAsyncComponent` like `DataGrid`; only matters for browse-only sessions.

---

## 7. Sequencing

Each item is one Conventional Commit with problem / fix / verification, per the process in `optimization-plan.md`.

| Phase | Weeks | Items | Theme |
|---|---|---|---|
| 0 | 1 | D1, E2, E3, C2, B3, B5, C4 | Security fix plus all the S-effort wins |
| 1 | 2-3 | A1, A2, A3, A4, D2 | Connections stop lying: real cancel, SQL Server pool, Redis reconnect |
| 2 | 4-5 | C1, C3, B1, B2, E1, D3, D4 | Completion correctness, completion latency, grid safety, agent basics |
| 3 | 6-8 | E4, E5, C6, D5, D7, D8, A5, A6, B4, E6 | Error UX, dialect catalogs, Gemini/Ollama tools, polish |
| 4 | later | C5, C8, D9, D10, E7, E8, B6 | AST-backed completion, structured output, grid features, palette |

Regression gates per commit: `cargo fmt --check && cargo test -p dbx-core`; `pnpm check`. Track C changes add cases to `packages/app-tests/sqlCompletion*.test.ts`. Track A changes add one live-DB test each behind an env-gated feature.

---

## 8. Not doing, and why

- **No new SQL parser on the frontend.** The backend already has `sqlparser`; C8 reuses it. Adding node-sql-parser would be a second AST and a big chunk.
- **No new charting, dialog, or confirmation components.** `QueryChart.vue`, the danger-SQL dialog, and `aiSqlExecutionPolicy.ts` already exist; every item above wires them.
- **No streaming IPC rewrite yet (B6).** Pagination exists; measure first.
- **No `idle_timeout` plumbing through three drivers (A7).** Hide the control where it is a no-op. Cheaper and honest.
- **No embedding-based schema retrieval for AI.** D4's substring `search_tables` covers the 5 000-table case at zero infra cost. Revisit only if users ask for semantic search.
- **No key-ring for the AI API key.** Consistent with the rest of the app's local storage model; out of scope for this plan.

---

## 9. Already good — do not redo

- SSH tunnel reconnect with backoff and keepalive; proxy tunnels are stateless.
- MySQL health-check with retry; PG retry-once; JVM daemon kill-and-respawn; pool discard on timeout.
- Completion: two-tier local + async pipeline with epoch cancel, server-side LIMIT, lazy per-table columns, FK-aware JOIN, fuzzy ranking with memo, perf regression test on 2 500 tables.
- AI: Claude prompt cache done right (stable system block, volatile state in the user turn), throttled shiki-free streaming render, capability-aware parallel tools, fragmented tool-call accumulator with tests, per-dialect quoting rules in the prompt.
- UX: sidebar search and type filter, pinned nodes, stale-while-revalidate tree cache, cancellable queries, history search, lazy chunks for every heavy panel except the editor, local fonts with `swap`, reka-ui focus traps.
- Everything under "已完成" and "已有良好实践" in `optimization-plan.md`.
