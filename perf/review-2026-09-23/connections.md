# Review — connection stability (T10, T11, T26, T27, T28, T29)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T10 Redis auto-reconnect | 4c8c98e2 | 1 high, 1 medium |
| T11 Health sweep covers all drivers | fe4c270c | OK, 1 low |
| T26 PG JSON passthrough | 057fa533 | OK |
| T27 SSH give-up evicts pools | 43e5c824 | 1 medium, 1 low |
| T28 TCP keepalive on native sockets | 7ffeb3ad | OK |
| T29 Honest idle_timeout setting | ed3c4bae | OK (informational) |

## T10 — Redis auto-reconnect

- [ ] **HIGH — outage > ~2 s makes the next command hang for minutes while holding the session mutex**
  - Where: `crates/dbx-core/src/db/redis_driver.rs` `connect()` (~L171) and `connect_client()` (~L402) use `ConnectionManager::new(client)` (default config).
  - redis 0.32.7 default: `ExponentialBuilder::default().with_factor(100).with_max_times(6)`, backon `min_delay` 1 s / `max_delay` 60 s → sleeps 1–2 s, then 60–120 s…; no connection/response timeout. Every command awaits the shared reconnect future while redis_ops holds `con.lock()` with no timeout.
  - Reproduced (same crate, local redis-server, killed + restarted after 4 s): cmd0 "broken pipe", cmd1 PONG after **118.4 s**. Live test missed it because `docker restart` returns inside the first 1–2 s window.
  - Fix: `ConnectionManager::new_with_config(ConnectionManagerConfig::new().set_factor(..).set_max_delay(2–5 s).set_number_of_retries(small).set_connection_timeout(..).set_response_timeout(..))`; consider a per-command timeout in redis_ops. Add a live test with an outage longer than 2 s.
- [ ] **MEDIUM — real initial-connect errors hidden behind a generic 5 s timeout**
  - Manager's first connect goes through `.retry(backoff)` with no `.when` filter (retries auth/refused/DNS/TLS); outer `tokio::time::timeout(5s)` fires first.
  - Reproduced: `127.0.0.1:1` → `Elapsed` after 5.0 s (before: instant "Connection refused (os error 61)"); wrong password → `Elapsed` instead of "Password authentication failed".
  - Hits "Test connection" (`src-tauri/src/commands/connection.rs:315/527`) and every pool rebuild (incl. after T11 eviction). Users see "Redis connection timed out (5s)" instead of the cause.
  - Fix: probe once with `client.get_multiplexed_async_connection()` to surface the real error, then build the manager (or a retries=0 config for the initial connect).
- Tracked-db invalidation is correct; URL is always RESP2 (`models/connection.rs:631`), no push-triggered reconnect bypass.

## T27 — SSH give-up evicts pools

- [ ] **MEDIUM — multi-layer transports: other layers' tunnels survive, chain never heals**
  - Where: `crates/dbx-core/src/connection.rs` `evict_pools_for_tunnel` (~L1027) only calls `remove_connection_pools`, never `reset_connection_transport`. Layers `{id}:transport:{n}` start separately (`transport_layer_tunnel.rs:53`); layer n+1 dials layer n's local port fixed at spawn.
  - Layer 0 gives up → pools evicted; layer 1 still in its own backoff and `get_active_port` returns it → layer 0 rebuilt on a new port, cached layer 1 points at the dead old port → DB connect hangs until DB timeout (no clear SSH error), never heals after sshd returns. Later layer 1 gives up too → second eviction and second toast (if > 10 s apart).
  - Smaller race (single layer): `give_ups.send` runs before the task returns, so a rebuild at that moment can still see the entry as active.
  - Fix: call `self.reset_connection_transport(connection_id)` inside `evict_pools_for_tunnel`, like `reconnect_pool_for_session` (~L726).
- [ ] **LOW — toast names the wrong host for inner hops**
  - `ssh_tunnel.rs` give-up send: for layer ≥ 1, `connect_host`/`connect_port` is the previous layer's local forward, so `tunnelLostHint` says "Reconnect attempts to 127.0.0.1:54321 failed". Fix: include the configured hop endpoint in `TunnelGiveUp`.

## T11 — Health sweep

- [ ] **LOW — sweep can evict healthy-but-busy Redis / SQL Server pools**
  - Where: `crates/dbx-core/src/connection.rs` ~L928–948. Redis arm `direct.lock().await` on the single session mutex; SQL Server arm `lease_checked()` waits on the 3-permit semaphore. A slow SCAN/HGETALL/console command or 3 busy leases > 5 s at window focus → marked unhealthy → needless reconnect (MySQL/PG share the pattern but a single Redis mutex makes it far easier to hit).
  - Fix: Redis `try_lock()`, busy = healthy; SQL Server skip the probe when no permit is available.

## OK tasks (notes)

- T26: `PgJsonText` handles json (verbatim) and jsonb (version byte stripped), fallback kept.
- T28: PG `apply_tcp_keepalive` on the single connect path, MySQL `tcp_keepalive` in `create_pool`, SQL Server via socket2 in `try_connect`; URL params take precedence; Linux-only half-open live test labelled.
- T29: the control was already `v-show="form.db_type === 'mongodb'"` before the commit (`ed3c4bae^`, ConnectionDialog.vue ~L3164), so there was no user-visible bug; the commit moves the gate into a capability predicate + contract tests. Matches the requirement; consider noting in tasks.md that the plan's premise didn't hold in the UI.
