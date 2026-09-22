//! Env-gated live tests for Redis auto-reconnect (perf task T10): after the
//! Redis server restarts, the next commands on the *same* app-level connection
//! succeed on their own — no manual reconnect, no pool rebuild. The standalone
//! phase also pins the per-db isolation contract across a reconnect (a stale
//! tracked SELECT must never read another db).
//!
//! The restart is inherently external, so the test drives Docker itself when
//! told which throwaway container to restart:
//!
//! ```text
//! docker run -d --name dbx-t10-redis -p 6399:6379 redis:7
//! DBX_TEST_REDIS_URL='redis://127.0.0.1:6399/' \
//! DBX_TEST_REDIS_CONTAINER=dbx-t10-redis \
//!   cargo test -p dbx-core --test live_redis_reconnect live_standalone -- --ignored --nocapture
//!
//! # Sentinel: one container running a master (6379) + a sentinel (26379)
//! # monitoring it at 127.0.0.1:6379, which is exactly the address the
//! # published host port maps back to. The trap forwards SIGTERM to the
//! # master so its RDB save runs before the restart wipes the socket.
//! docker run -d --name dbx-t10-redis-sentinel -p 6379:6379 -p 26379:26379 redis:7 \
//!   sh -c 'printf "port 6379\n" > /tmp/redis.conf && redis-server /tmp/redis.conf & MASTER=$!; \
//!     printf "port 26379\nsentinel monitor mymaster 127.0.0.1 6379 1\ndir /tmp\n" > /tmp/sentinel.conf \
//!     && redis-sentinel /tmp/sentinel.conf & trap "kill -TERM $MASTER" TERM INT; \
//!     while kill -0 $MASTER 2>/dev/null; do wait $MASTER || true; done'
//! DBX_TEST_REDIS_SENTINEL_ADDR='127.0.0.1:26379' \
//! DBX_TEST_REDIS_SENTINEL_CONTAINER=dbx-t10-redis-sentinel \
//!   cargo test -p dbx-core --test live_redis_reconnect live_sentinel -- --ignored --nocapture
//! ```
//!
//! Cluster has no phase here by design: its pool is a `redis::cluster` client
//! whose `ClusterConnection` already re-routes and reconnects on its own, and
//! T10 deliberately leaves it untouched (locked by a unit test in
//! `redis_driver.rs`).

use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::redis_ops;
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-redis-reconnect";
const RECOVERY_WINDOW: Duration = Duration::from_secs(30);

fn redis_config(mode: Option<&str>, sentinel_master: &str, host: &str, port: u16) -> ConnectionConfig {
    ConnectionConfig {
        id: CONNECTION_ID.to_string(),
        name: CONNECTION_ID.to_string(),
        db_type: DatabaseType::Redis,
        driver_profile: None,
        driver_label: None,
        url_params: None,
        host: host.to_string(),
        port,
        username: String::new(),
        password: String::new(),
        database: None,
        visible_databases: None,
        attached_databases: Vec::new(),
        color: None,
        transport_layers: Vec::new(),
        connect_timeout_secs: 5,
        query_timeout_secs: 30,
        idle_timeout_secs: 60,
        ssl: false,
        ca_cert_path: String::new(),
        client_cert_path: String::new(),
        client_key_path: String::new(),
        sysdba: false,
        oracle_connection_type: None,
        connection_string: None,
        redis_connection_mode: mode.map(str::to_string),
        redis_sentinel_master: sentinel_master.to_string(),
        redis_sentinel_nodes: String::new(),
        redis_sentinel_username: String::new(),
        redis_sentinel_password: String::new(),
        redis_sentinel_tls: false,
        redis_cluster_nodes: String::new(),
        etcd_endpoints: String::new(),
        external_config: None,
        jdbc_driver_class: None,
        jdbc_driver_paths: Vec::new(),
        one_time: false,
    }
}

async fn app_state(config: ConnectionConfig) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("dbx-live-redis-reconnect-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config);
    state
}

/// Parses `redis://host:port/` (the shape `ConnectionConfig::connection_url`
/// builds for Redis).
fn parse_host_port(url: &str) -> (String, u16) {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let rest = rest.split(['/', '?']).next().unwrap_or(rest);
    let (host, port) = rest.rsplit_once(':').expect("redis host:port");
    (host.to_string(), port.parse().expect("redis port"))
}

/// Restarts the throwaway container and waits until Docker reports it running
/// again. The remaining downtime is absorbed by the recovery window below.
fn restart_container(container: &str) {
    let status =
        std::process::Command::new("docker").args(["restart", container]).status().expect("run docker restart");
    assert!(status.success(), "docker restart {container} failed");

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let running = std::process::Command::new("docker")
            .args(["inspect", "--format", "{{.State.Running}}", container])
            .output()
            .expect("docker inspect")
            .stdout;
        if String::from_utf8_lossy(&running).trim() == "true" {
            println!("container {container} is running again");
            return;
        }
        assert!(Instant::now() < deadline, "container {container} did not come back");
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Reads `key_raw` from `db` through the real app path until it returns
/// `expected`. The caller holds the *same* pool the whole time — every retry
/// exercises the driver's self-recovery, never a reconnect. Returns the number
/// of attempts (1 = the very first post-restart command already succeeded).
async fn wait_for_string_value(state: &AppState, db: u32, key_raw: &str, expected: &str, what: &str) -> usize {
    let deadline = Instant::now() + RECOVERY_WINDOW;
    let mut attempts = 0;
    loop {
        attempts += 1;
        match redis_ops::redis_get_value_in_db_core(state, CONNECTION_ID, db, key_raw).await {
            Ok(value) => {
                assert_eq!(
                    value.value,
                    serde_json::json!(expected),
                    "reconnected, but db {db} holds the wrong value for {what}"
                );
                return attempts;
            }
            Err(error) => {
                assert!(
                    Instant::now() < deadline,
                    "connection did not recover by itself within {RECOVERY_WINDOW:?} ({what}): {error}"
                );
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

fn raw_key(key: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(key)
}

/// Standalone path: a restart kills the socket; the same pool must keep
/// serving (ConnectionManager backoff reconnection), including the tracked
/// session-db bookkeeping for db 0 vs db 3.
#[tokio::test]
#[ignore = "requires DBX_TEST_REDIS_URL and DBX_TEST_REDIS_CONTAINER pointing at a throwaway Redis container this test restarts"]
async fn live_standalone_redis_recovers_after_restart() {
    let url = std::env::var("DBX_TEST_REDIS_URL").expect("DBX_TEST_REDIS_URL (e.g. redis://127.0.0.1:6399/)");
    let container = std::env::var("DBX_TEST_REDIS_CONTAINER").expect("DBX_TEST_REDIS_CONTAINER");
    let (host, port) = parse_host_port(&url);
    let state = app_state(redis_config(None, "", &host, port)).await;

    state.get_or_create_pool(CONNECTION_ID, None).await.expect("connect standalone Redis");
    redis_ops::redis_list_databases_core(&state, CONNECTION_ID).await.expect("baseline list_databases");

    let key_db0 = raw_key("t10:restart:db0");
    let key_db3 = raw_key("t10:restart:db3");
    redis_ops::redis_set_string_in_db_core(&state, CONNECTION_ID, 0, &key_db0, "v0", None).await.expect("seed db0");
    redis_ops::redis_set_string_in_db_core(&state, CONNECTION_ID, 3, &key_db3, "v3", None).await.expect("seed db3");
    println!("standalone connection up, seeds in db0 and db3");

    restart_container(&container);

    // No get_or_create_pool / reconnect call anywhere — the same pool must
    // heal by itself. The first post-restart command may surface the
    // connection-drop error that arms the reconnection; recovery must follow
    // without any user action.
    let attempts = wait_for_string_value(&state, 3, &key_db3, "v3", "db3 value after restart").await;
    println!("standalone: recovered on command #{attempts} after restart");

    // The reconnect must also restore per-db isolation: the session starts on
    // the configured db again, so a stale tracked SELECT would silently read
    // the wrong db. db 0 sees its key, db 3 sees its own — and nothing of db0.
    let db0 = redis_ops::redis_get_value_in_db_core(&state, CONNECTION_ID, 0, &key_db0)
        .await
        .expect("read db0 after reconnect");
    assert_eq!(db0.value, serde_json::json!("v0"), "db0 key must be readable from db 0 after reconnect");

    let cross = redis_ops::redis_get_value_in_db_core(&state, CONNECTION_ID, 3, &key_db0)
        .await
        .expect("probe db0 key from db 3");
    assert_eq!(cross.value, serde_json::Value::Null, "db0 key must not leak into db 3 after reconnect");

    let scan = redis_ops::redis_scan_keys_core(&state, CONNECTION_ID, 3, 0, "t10:restart:db0*", 10, true)
        .await
        .expect("scan db3 after reconnect");
    assert!(scan.keys.is_empty(), "scan on db 3 must not return the db0 key after reconnect");
    println!("standalone: per-db isolation intact after reconnect");
}

/// Sentinel path: same contract, with the master resolved through Sentinel at
/// connect time and the reconnect dialed straight to that master address.
#[tokio::test]
#[ignore = "requires DBX_TEST_REDIS_SENTINEL_ADDR and DBX_TEST_REDIS_SENTINEL_CONTAINER pointing at a throwaway sentinel container this test restarts"]
async fn live_sentinel_redis_recovers_after_restart() {
    let addr =
        std::env::var("DBX_TEST_REDIS_SENTINEL_ADDR").expect("DBX_TEST_REDIS_SENTINEL_ADDR (e.g. 127.0.0.1:26379)");
    let container = std::env::var("DBX_TEST_REDIS_SENTINEL_CONTAINER").expect("DBX_TEST_REDIS_SENTINEL_CONTAINER");
    let (host, port) = parse_host_port(&format!("redis://{addr}"));
    let state = app_state(redis_config(Some("sentinel"), "mymaster", &host, port)).await;

    state.get_or_create_pool(CONNECTION_ID, None).await.expect("connect via Sentinel");
    redis_ops::redis_list_databases_core(&state, CONNECTION_ID).await.expect("baseline list_databases");

    let key = raw_key("t10:sentinel:restart");
    redis_ops::redis_set_string_in_db_core(&state, CONNECTION_ID, 0, &key, "sv", None)
        .await
        .expect("seed via Sentinel master");
    println!("sentinel connection up, seed on master");

    restart_container(&container);

    let attempts = wait_for_string_value(&state, 0, &key, "sv", "value after restart").await;
    println!("sentinel: recovered on command #{attempts} after restart");
}
