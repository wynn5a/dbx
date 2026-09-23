# Review — MCP bridge / server-side cancel / SQL Server pool (T01, T02, T03)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T01 Lock down MCP bridge | a0849b48 | OK, 1 low — fixed |
| T02 Real server-side query cancel | d4485b14 | 1 medium-high, 2 low — fixed |
| T03 SQL Server pool | b523ab5a | 1 high, 1 medium, 1 low — fixed |

## T03 — SQL Server pool

- [x] **HIGH — SQL Server grid saves are no longer atomic**
  - Where: `crates/dbx-core/src/query.rs` `execute_statements_in_transaction` (`PoolKind::SqlServer` → `TxPath::Explicit`, ~line 1494) and `exec_tx_explicit_inner` (1654-1716).
  - `BEGIN TRANSACTION`, each statement, `COMMIT`/`ROLLBACK` are separate `do_execute` calls; since T03 each takes its own lease. Simulated pool `Drop`: back-to-back leases alternate sockets (1,2,1,2…).
  - Result: `BEGIN` on A, statement autocommits on B, `COMMIT` fails "no corresponding BEGIN TRANSACTION", B's writes not rolled back; A returns to the pool with an open transaction holding locks, later tree/completion queries run inside it.
  - Trigger: every grid save on SQL Server (`executeInTransaction` from `useDataGridEditor.ts`).
  - Fix: dedicated SQL Server tx path holding one `SqlServerLease` from BEGIN through COMMIT/ROLLBACK (like PG/MySQL/SQLite). Add a live test.
  - Fixed in `d481b8ae`: `TxPath::SqlServer` → `db::sqlserver::execute_statements_in_transaction` holds one lease from `BEGIN TRANSACTION` through `COMMIT`/`IF @@TRANCOUNT > 0 ROLLBACK` (tx control as plain batches); uncertain tx state poisons the lease. Live test `live_sqlserver_transaction_is_atomic_on_one_session` (rollback of earlier statements + no pooled session left with `@@TRANCOUNT > 0`).
- [x] **MEDIUM — connection return races permit release; idle list uncapped**
  - Where: `crates/dbx-core/src/db/sqlserver.rs:195-209` (`Drop for SqlServerLease` spawns `idle.lock().await.push(conn)`, `_permit` released immediately).
  - Sequential leases find idle empty → full TDS login each time, and consecutive statements hit different sessions (root cause of the HIGH above). Idle sockets aren't counted by the semaphore and never trimmed — simulation grew idle to 7 vs limit 3.
  - Fix: `std::sync::Mutex` for `idle`, push synchronously in `Drop` before the permit drops; cap idle at `SQLSERVER_POOL_MAX_SIZE`.
  - Fixed in `d481b8ae`: `idle` is a `std::sync::Mutex`, `Drop` pushes synchronously before `_permit` drops, `push_idle` caps at `SQLSERVER_POOL_MAX_SIZE`. Live test `live_sqlserver_pool_reuses_returned_session_and_caps_idle` (same `connection_id` GUID across sequential statements; idle ≤ max after a burst).
- [x] **LOW — transfer drops a healthy socket on SQL error**
  - Where: `crates/dbx-core/src/transfer.rs` SQL Server arm of `execute_on_pool_with_max_rows` — `?` returns before `keep()`.
  - Fix: follow `do_execute`: `keep()` unless `is_connection_error`.
  - Fixed in `d481b8ae`: new `SqlServerLease::settle` (keep unless abandoned wire / `is_connection_error`) used by transfer; same `?`-before-`keep()` bug fixed in `schema.rs` object-source lookup. Live test `live_sqlserver_transfer_keeps_socket_after_sql_error`.

## T02 — Real server-side cancel

- [x] **MEDIUM-HIGH — PG cancel never works on TLS-required connections**
  - Where: `crates/dbx-core/src/process.rs:173` `token.cancel_query(tokio_postgres::NoTls)`; `postgres_connection_url` maps require/verify-ca/verify-full to `sslmode=require` (`postgres.rs:1275-1284`).
  - CancelToken keeps `ssl_mode=Require` → SSLRequest → server 'S' → NoTls fails. On RDS/Azure/Supabase/Neon every cancel/timeout only logs "PostgreSQL cancel request failed"; the statement keeps running (the A1 symptom). Live test used plain PG on `prefer`.
  - Fix: pass the pool's `MakeRustlsConnect` (from `postgres_tls_config`) to `cancel_query`. Add a live test with `sslmode=require`.
  - Fixed in `209e41b1`: `postgres::connect` remembers each pool's `MakeRustlsConnect` (weak-pool registry); `register_server_cancel` attaches it and `fire_server_cancel` calls `cancel_query(tls)`. Live test `live_postgres_cancel_and_timeout_work_over_tls` (`DBX_TEST_POSTGRES_TLS_URL`, `sslmode=require`; fails on the old code).
- [x] **LOW — cancel can poison a waiter on the same pool**
  - Where: `process.rs:316-321`, `query.rs` discard block (~887).
  - Token flips first → dropped future returns its client (still in `BEGIN…DECLARE`, `pg_sleep` running) to the pool (Fast recycle) → then cancel fires → then `discard_pool`/`close()`. A queued waiter on a saturated pool gets the dirty client and fails with "current transaction is aborted" or `PoolError::Closed`.
  - Fix: poison that specific client (flag checked in `recycle`) instead of closing the whole pool.
  - Fixed in `209e41b1`: `StatementClient` guard — a checked-out client whose statement future is dropped before `finish()` is `Object::take`n and closed instead of recycled; the whole-pool `discard_pool` after PG cancel/timeout is removed. Live test `live_postgres_dropped_statement_does_not_poison_a_queued_waiter` (old code: waiter fails with "current transaction is aborted").
- [x] **LOW — timeouts without `execution_id` still don't stop the server query**
  - Where: `query.rs:603`, `peek_server_cancel` guard; `ServerCancelRegistrar` is a no-op without an id. MCP bridge `/data/execute-query` (`execute_sql_statement(..., None)`) only drops the future on timeout.
  - Fix: local registrar on the timeout path independent of `RunningQueries`.
  - Fixed in `209e41b1`: `do_execute` registers into a private `RunningQueries` when no execution id is given (process-helper kill statements excluded), and the timeout path fires from there. Covered by phase 3 of the PG live cancel tests.

## T01 — MCP bridge

- [x] **LOW — Mongo write routes have no server-side `allow_writes` gate**
  - Where: `src-tauri/src/commands/mcp_bridge.rs` `/data/mongo/insert-documents`, `update-documents`, `delete-documents`. Only node-side `parseMongoWriteCommand` enforces policy; inconsistent with the new SQL gate (defense in depth).
  - Fix: accept `allow_writes`, 403 without it; `executeMongoWrite` forwards the flag.
  - Fixed in `bb3c381d`: insert/update/delete routes 403 without `allow_writes`; empty-filter update/delete also needs `allow_dangerous`; aggregate with `$out`/`$merge` needs both (gates in `dbx_core::mongo_ops`). node-core forwards the policy. Tests: bridge socket test `gates_mongo_writes_behind_flags`, `mongo_ops` unit tests, node `bridge-auth.test.ts`.
- Verified OK: constant-time bearer check on every route, fail-closed if secret can't load, 0600 token file, `ensure_sql_execution_allowed` on `/data/execute-query`, node-core sends the token on both callers, socket tests cover 401/200/403. Token file + `DBX_BRIDGE_TOKEN` is a reasonable substitute for "pass at spawn" (DBX doesn't spawn the npm server).
