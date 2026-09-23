# Review — connection stability (T10, T11, T26, T27, T28, T29)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T10 Redis auto-reconnect | 4c8c98e2 | 1 high, 1 medium — fixed `574e71d4` |
| T11 Health sweep covers all drivers | fe4c270c | OK, 1 low — fixed `842cb961` |
| T26 PG JSON passthrough | 057fa533 | OK |
| T27 SSH give-up evicts pools | 43e5c824 | 1 medium, 1 low — fixed `cd33551e` |
| T28 TCP keepalive on native sockets | 7ffeb3ad | OK |
| T29 Honest idle_timeout setting | ed3c4bae | OK (informational) |

## T10 — Redis auto-reconnect

- [x] **HIGH — outage > ~2 s makes the next command hang for minutes while holding the session mutex**
  - Where: `crates/dbx-core/src/db/redis_driver.rs` `connect()` (~L171) and `connect_client()` (~L402) use `ConnectionManager::new(client)` (default config).
  - redis 0.32.7 default: `ExponentialBuilder::default().with_factor(100).with_max_times(6)`, backon `min_delay` 1 s / `max_delay` 60 s → sleeps 1–2 s, then 60–120 s…; no connection/response timeout. Every command awaits the shared reconnect future while redis_ops holds `con.lock()` with no timeout.
  - Reproduced (same crate, local redis-server, killed + restarted after 4 s): cmd0 "broken pipe", cmd1 PONG after **118.4 s**. Live test missed it because `docker restart` returns inside the first 1–2 s window.
  - Fix: `ConnectionManager::new_with_config(ConnectionManagerConfig::new().set_factor(..).set_max_delay(2–5 s).set_number_of_retries(small).set_connection_timeout(..).set_response_timeout(..))`; consider a per-command timeout in redis_ops. Add a live test with an outage longer than 2 s.
  - **Fixed in `574e71d4`**: `connection_manager_config()` (growth 2, 1 s delay cap + jitter, 3 retries, per-dial connection timeout, 60 s response timeout — the per-command bound for half-open sockets). Live test `live_redis_local::outage_longer_than_first_backoff_does_not_stall_commands` spawns its own redis-server, keeps it down 5 s and bounds every command at 15 s (stalls on the old code; now recovers on the 2nd command, ~0.2 s after restart).
- [x] **MEDIUM — real initial-connect errors hidden behind a generic 5 s timeout**
  - Manager's first connect goes through `.retry(backoff)` with no `.when` filter (retries auth/refused/DNS/TLS); outer `tokio::time::timeout(5s)` fires first.
  - Reproduced: `127.0.0.1:1` → `Elapsed` after 5.0 s (before: instant "Connection refused (os error 61)"); wrong password → `Elapsed` instead of "Password authentication failed".
  - Hits "Test connection" (`src-tauri/src/commands/connection.rs:315/527`) and every pool rebuild (incl. after T11 eviction). Users see "Redis connection timed out (5s)" instead of the cause.
  - Fix: probe once with `client.get_multiplexed_async_connection()` to surface the real error, then build the manager (or a retries=0 config for the initial connect).
  - **Fixed in `574e71d4`**: `connect_manager()` dials once without retries, drops the probe, then builds the manager (standalone and Sentinel). Tests: `live_redis_local::initial_connect_errors_surface_their_real_cause` (refused → "Connection refused (os error 61)" instantly; wrong password → "Password authentication failed"; both timed out on the old code) and unit `refused_initial_connect_reports_the_os_error_fast`.
- Tracked-db invalidation is correct; URL is always RESP2 (`models/connection.rs:631`), no push-triggered reconnect bypass.

## T27 — SSH give-up evicts pools

- [x] **MEDIUM — multi-layer transports: other layers' tunnels survive, chain never heals**
  - Where: `crates/dbx-core/src/connection.rs` `evict_pools_for_tunnel` (~L1027) only calls `remove_connection_pools`, never `reset_connection_transport`. Layers `{id}:transport:{n}` start separately (`transport_layer_tunnel.rs:53`); layer n+1 dials layer n's local port fixed at spawn.
  - Layer 0 gives up → pools evicted; layer 1 still in its own backoff and `get_active_port` returns it → layer 0 rebuilt on a new port, cached layer 1 points at the dead old port → DB connect hangs until DB timeout (no clear SSH error), never heals after sshd returns. Later layer 1 gives up too → second eviction and second toast (if > 10 s apart).
  - Smaller race (single layer): `give_ups.send` runs before the task returns, so a rebuild at that moment can still see the entry as active.
  - Fix: call `self.reset_connection_transport(connection_id)` inside `evict_pools_for_tunnel`, like `reconnect_pool_for_session` (~L726).
  - **Fixed in `cd33551e`**: the transport (every layer) is reset *before* the pools are evicted, which also covers the single-layer race (a rebuild between the notice and the task exit only lands on pools/tunnels the eviction then drops). Tests: unit `tunnel_give_up_tears_down_every_transport_layer_of_the_connection` (real two-layer chain, layer 1 stopped and its listener closed); live `live_multi_layer_give_up_names_the_hop_and_rebuilds_the_whole_chain` (two SSH layers via Docker sshd, SSH banner read end to end through the rebuilt chain; fails on the old code with a surviving layer). Two near-simultaneous give-ups from both layers can still both be queued before the first eviction aborts the other — the frontend's 10 s toast dedupe covers that.
- [x] **LOW — toast names the wrong host for inner hops**
  - `ssh_tunnel.rs` give-up send: for layer ≥ 1, `connect_host`/`connect_port` is the previous layer's local forward, so `tunnelLostHint` says "Reconnect attempts to 127.0.0.1:54321 failed". Fix: include the configured hop endpoint in `TunnelGiveUp`.
  - **Fixed in `cd33551e`**: `TunnelGiveUp` gained `ssh_host`/`ssh_port` (configured hop, passed through `start_tunnel`'s new `hop_endpoint`); the `ssh-tunnel-lost` relay emits those. Live test `live_inner_hop_give_up_names_the_configured_hop` (bastion + a second sshd reachable only from it; stopping the inner one yields a layer-1 notice naming `dbx-t27-sshd-b:22` while `connect_*` is the 127.0.0.1 forward).

## T11 — Health sweep

- [x] **LOW — sweep can evict healthy-but-busy Redis / SQL Server pools**
  - Where: `crates/dbx-core/src/connection.rs` ~L928–948. Redis arm `direct.lock().await` on the single session mutex; SQL Server arm `lease_checked()` waits on the 3-permit semaphore. A slow SCAN/HGETALL/console command or 3 busy leases > 5 s at window focus → marked unhealthy → needless reconnect (MySQL/PG share the pattern but a single Redis mutex makes it far easier to hit).
  - Fix: Redis `try_lock()`, busy = healthy; SQL Server skip the probe when no permit is available.
  - **Fixed in `842cb961`**: `redis_driver::probe_health` (try_lock, direct + cluster) and `SqlServerPool::probe_health` (try_acquire; otherwise the same checked-lease path). Tests: `live_redis_local::health_sweep_keeps_a_busy_redis_pool` (session mutex held across the sweep; fails on the old code; idle live pool kept, dead one evicted) and unit tests for the SQL Server saturated / free-slot paths. MySQL/PG not changed (pooled, no single mutex).

## OK tasks (notes)

- T26: `PgJsonText` handles json (verbatim) and jsonb (version byte stripped), fallback kept.
- T28: PG `apply_tcp_keepalive` on the single connect path, MySQL `tcp_keepalive` in `create_pool`, SQL Server via socket2 in `try_connect`; URL params take precedence; Linux-only half-open live test labelled.
- T29: the control was already `v-show="form.db_type === 'mongodb'"` before the commit (`ed3c4bae^`, ConnectionDialog.vue ~L3164), so there was no user-visible bug; the commit moves the gate into a capability predicate + contract tests. Matches the requirement; consider noting in tasks.md that the plan's premise didn't hold in the UI.
