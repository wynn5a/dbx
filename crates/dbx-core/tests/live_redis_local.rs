//! Live Redis tests that run against a `redis-server` process they spawn
//! themselves (no Docker), so they can control outage length precisely:
//!
//! ```text
//! # redis-server on PATH (brew install redis / apt install redis-server), or
//! # DBX_TEST_REDIS_SERVER=/path/to/redis-server
//! cargo test -p dbx-core --test live_redis_local -- --ignored --nocapture
//! ```
//!
//! - Outage longer than the first backoff window (review of T10): the next
//!   commands after the server returns must not stall for minutes on the
//!   ConnectionManager's reconnect future while holding the session mutex.
//! - Initial connect failures (refused, wrong password) must surface the real
//!   cause instead of a generic "timed out".
//! - The window-focus health sweep must not evict a healthy Redis pool just
//!   because a slow command holds its session mutex (review of T11).

use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::{AppState, PoolKind};
use dbx_core::db::redis_driver::RedisConnection;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::redis_ops;
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-redis-local";
/// Upper bound for any single command while the server is down or just came
/// back. The redis crate's default reconnect policy sleeps 60–120 s on its
/// second retry, which is exactly what this bound catches.
const COMMAND_BOUND: Duration = Duration::from_secs(15);

struct RedisServer {
    child: Child,
    port: u16,
    password: Option<String>,
}

impl RedisServer {
    fn start(port: u16, password: Option<&str>) -> Self {
        let bin = std::env::var("DBX_TEST_REDIS_SERVER").unwrap_or_else(|_| "redis-server".to_string());
        let mut cmd = Command::new(bin);
        cmd.args(["--port", &port.to_string(), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"]);
        if let Some(password) = password {
            cmd.args(["--requirepass", password]);
        }
        let child = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("spawn redis-server");
        let server = Self { child, port, password: password.map(str::to_string) };
        server.wait_until_listening();
        server
    }

    fn wait_until_listening(&self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while std::net::TcpStream::connect(("127.0.0.1", self.port)).is_err() {
            assert!(Instant::now() < deadline, "redis-server did not start listening on {}", self.port);
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    /// Restart on the same port (the app-level connection keeps dialing it).
    fn restart(&mut self) {
        self.stop();
        *self = Self::start(self.port, self.password.as_deref());
    }
}

impl Drop for RedisServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn free_port() -> u16 {
    portpicker::pick_unused_port().expect("free port")
}

fn redis_config(port: u16, password: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: CONNECTION_ID.to_string(),
        name: CONNECTION_ID.to_string(),
        db_type: DatabaseType::Redis,
        driver_profile: None,
        driver_label: None,
        url_params: None,
        host: "127.0.0.1".to_string(),
        port,
        username: String::new(),
        password: password.to_string(),
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
        redis_connection_mode: None,
        redis_sentinel_master: String::new(),
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

async fn app_state(config: ConnectionConfig) -> (Arc<AppState>, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("dbx-live-redis-local-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config);
    (state, dir)
}

fn raw_key(key: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(key)
}

/// One app-path read, bounded so a stalled reconnect fails the test instead of
/// hanging it. Returns the command's own outcome and how long it took.
async fn bounded_read(state: &AppState, key_raw: &str) -> (Result<serde_json::Value, String>, Duration) {
    let started = Instant::now();
    let outcome =
        tokio::time::timeout(COMMAND_BOUND, redis_ops::redis_get_value_in_db_core(state, CONNECTION_ID, 0, key_raw))
            .await;
    let elapsed = started.elapsed();
    match outcome {
        Ok(result) => (result.map(|value| value.value), elapsed),
        Err(_) => panic!("a Redis command stalled for more than {COMMAND_BOUND:?} around an outage"),
    }
}

#[tokio::test]
#[ignore = "spawns a local redis-server (DBX_TEST_REDIS_SERVER or redis-server on PATH)"]
async fn outage_longer_than_first_backoff_does_not_stall_commands() {
    let mut server = RedisServer::start(free_port(), None);
    let (state, dir) = app_state(redis_config(server.port, "")).await;
    state.get_or_create_pool(CONNECTION_ID, None).await.expect("connect local redis");

    let key = raw_key("t10:long-outage");
    redis_ops::redis_set_string_in_db_core(&state, CONNECTION_ID, 0, &key, "before", None).await.expect("seed");

    // Server dies; a command during the outage fails (and arms the reconnect).
    server.stop();
    let (during, took) = bounded_read(&state, &key).await;
    assert!(during.is_err(), "a command against a dead server must fail, got {during:?}");
    println!("command during outage failed in {took:?}: {}", during.unwrap_err());

    // Keep the server away well past the first 1–2 s backoff window, which is
    // what `docker restart` in the older live test never exceeded.
    tokio::time::sleep(Duration::from_secs(5)).await;
    server.restart();
    let restarted = Instant::now();

    // The same pool must heal by itself, with every command bounded. The
    // server restarted without persistence, so the key is gone (null).
    let mut attempts = 0;
    loop {
        attempts += 1;
        let (outcome, took) = bounded_read(&state, &key).await;
        match outcome {
            Ok(value) => {
                assert_eq!(value, serde_json::Value::Null, "fresh server has no data");
                println!("recovered on command #{attempts} ({took:?}), {:?} after restart", restarted.elapsed());
                break;
            }
            Err(error) => {
                println!("command #{attempts} after restart failed in {took:?}: {error}");
                assert!(restarted.elapsed() < Duration::from_secs(20), "did not recover within 20s: {error}");
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
#[ignore = "spawns a local redis-server (DBX_TEST_REDIS_SERVER or redis-server on PATH)"]
async fn initial_connect_errors_surface_their_real_cause() {
    // Refused: nothing listens on this port.
    let port = free_port();
    let started = Instant::now();
    let refused = dbx_core::db::redis_driver::connect(&format!("redis://127.0.0.1:{port}/"), Duration::from_secs(5))
        .await
        .err()
        .expect("connect to a closed port must fail");
    assert!(started.elapsed() < Duration::from_secs(2), "refused must fail fast, took {:?}", started.elapsed());
    assert!(!refused.contains("timed out"), "refused must not be masked as a timeout: {refused}");
    assert!(refused.to_lowercase().contains("refused"), "the OS error must reach the user: {refused}");

    // Wrong password against a real server, through the pool-build path.
    let _server = RedisServer::start(free_port(), Some("right-secret"));
    let (state, dir) = app_state(redis_config(_server.port, "wrong-secret")).await;
    let started = Instant::now();
    let wrong = state.get_or_create_pool(CONNECTION_ID, None).await.err().expect("wrong password must fail");
    assert!(started.elapsed() < Duration::from_secs(2), "auth failure must fail fast, took {:?}", started.elapsed());
    assert!(!wrong.contains("timed out"), "auth failure must not be masked as a timeout: {wrong}");
    let lower = wrong.to_lowercase();
    assert!(
        lower.contains("password") || lower.contains("auth"),
        "the authentication error must reach the user: {wrong}"
    );
    println!("refused: {refused}\nwrong password: {wrong}");

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
#[ignore = "spawns a local redis-server (DBX_TEST_REDIS_SERVER or redis-server on PATH)"]
async fn health_sweep_keeps_a_busy_redis_pool() {
    let server = RedisServer::start(free_port(), None);
    let (state, dir) = app_state(redis_config(server.port, "")).await;
    state.get_or_create_pool(CONNECTION_ID, None).await.expect("connect local redis");

    let direct = match state.connections.read().await.get(CONNECTION_ID) {
        Some(PoolKind::Redis(RedisConnection::Direct(direct))) => direct.clone(),
        _ => panic!("standalone Redis must build a direct pool"),
    };

    // A slow command (SCAN over a big keyspace, a console command) holds the
    // session mutex for longer than the sweep's 5 s per-pool deadline.
    let guard = direct.lock().await;
    let started = Instant::now();
    state.refresh_connections().await;
    assert!(started.elapsed() < Duration::from_secs(2), "the sweep must not queue behind a busy session");
    assert!(
        state.connections.read().await.contains_key(CONNECTION_ID),
        "a healthy-but-busy Redis pool must survive the sweep"
    );
    drop(guard);

    // Idle again: the sweep really probes — a live server keeps the pool…
    state.refresh_connections().await;
    assert!(state.connections.read().await.contains_key(CONNECTION_ID), "a healthy idle pool survives");

    // …and a dead one is evicted.
    drop(server);
    state.refresh_connections().await;
    assert!(!state.connections.read().await.contains_key(CONNECTION_ID), "an idle pool on a dead server is evicted");

    let _ = std::fs::remove_dir_all(dir);
}
