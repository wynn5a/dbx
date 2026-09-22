//! Env-gated live tests for the connection health sweep (perf task T11):
//! `AppState::refresh_connections` — the sweep that runs when the window
//! regains focus — must notice a dead SQL Server / Redis pool and evict it so
//! the UI shows the connection offline, while a healthy pool passes untouched.
//!
//! Stopping the server is inherently external, so the tests drive Docker
//! themselves when told which throwaway container to stop. The container is
//! left stopped; use a throwaway:
//!
//! ```text
//! docker run -d --name dbx-t11-mssql -p 1433:1433 \
//!   -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='<pw>' mcr.microsoft.com/azure-sql-edge
//! DBX_TEST_SQLSERVER_URL='server=tcp://127.0.0.1,1433;user=sa;password=<pw>;database=master' \
//! DBX_TEST_SQLSERVER_CONTAINER=dbx-t11-mssql \
//!   cargo test -p dbx-core --test live_health_refresh live_sqlserver -- --ignored --nocapture
//!
//! docker run -d --name dbx-t11-redis -p 6399:6379 redis:7
//! DBX_TEST_REDIS_URL='redis://127.0.0.1:6399/' \
//! DBX_TEST_REDIS_CONTAINER=dbx-t11-redis \
//!   cargo test -p dbx-core --test live_health_refresh live_redis -- --ignored --nocapture
//! ```

use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;

async fn app_state(config: ConnectionConfig) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("dbx-live-health-refresh-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    let id = config.id.clone();
    state.configs.write().await.insert(id, config);
    state
}

async fn pool_present(state: &AppState, connection_id: &str) -> bool {
    state.connections.read().await.contains_key(connection_id)
}

fn stop_container(container: &str) {
    let status =
        std::process::Command::new("docker").args(["stop", "-t", "1", container]).status().expect("run docker stop");
    assert!(status.success(), "docker stop {container} failed");

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let running = std::process::Command::new("docker")
            .args(["inspect", "--format", "{{.State.Running}}", container])
            .output()
            .expect("docker inspect")
            .stdout;
        assert!(
            Instant::now() < deadline,
            "container {container} did not stop within 60s (docker stop still pending?)"
        );
        if String::from_utf8_lossy(&running).trim() == "false" {
            println!("container {container} is stopped");
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Shared contract for both drivers: a healthy pool survives the sweep, a pool
/// whose server just died is evicted by the sweep (so the UI shows the
/// connection offline), and the next access attempt fails against the stopped
/// server instead of silently succeeding. The sweep bounds each pool's check
/// at 5s, so eviction always resolves well inside 2x that here.
async fn refresh_marks_dead_pool_offline(state: Arc<AppState>, connection_id: &str, container_env: &str) {
    assert!(pool_present(&state, connection_id).await, "pool must be connected after get_or_create_pool");

    // Healthy path: the sweep must not evict a working pool.
    state.refresh_connections().await;
    assert!(pool_present(&state, connection_id).await, "a healthy pool must survive the refresh sweep");

    // Server goes away (window in background), then the window regains focus
    // and triggers the sweep.
    let container = std::env::var(container_env).expect(container_env);
    stop_container(&container);

    let started = Instant::now();
    state.refresh_connections().await;
    assert!(
        !pool_present(&state, connection_id).await,
        "the sweep must evict the pool of a stopped server so the UI shows the connection offline"
    );
    println!("sweep detected the dead pool in {:?}", started.elapsed());

    // Downstream of eviction, the next access re-connects — which must fail
    // while the server is down (offline) instead of reviving the old pool.
    let reconnect = state.get_or_create_pool(connection_id, None).await;
    assert!(reconnect.is_err(), "reconnect against the stopped server must fail (connection shows offline)");
}

// --- SQL Server ---

fn parse_ado_server(url: &str) -> (String, u16, String, String, Option<String>) {
    let mut host = String::new();
    let mut port: u16 = 1433;
    let mut username = String::new();
    let mut password = String::new();
    let mut database = None;
    for part in url.split(';') {
        let Some((key, value)) = part.split_once('=') else { continue };
        match key.trim().to_ascii_lowercase().as_str() {
            "server" | "data source" => {
                let server = value.trim().trim_start_matches("tcp://");
                match server.rsplit_once(',') {
                    Some((h, p)) => {
                        host = h.trim().to_string();
                        port = p.trim().parse().unwrap_or(1433);
                    }
                    None => host = server.to_string(),
                }
            }
            "user id" | "user" | "uid" => username = value.trim().to_string(),
            "password" | "pwd" => password = value.trim().to_string(),
            "database" | "initial catalog" => database = Some(value.trim().to_string()),
            _ => {}
        }
    }
    (host, port, username, password, database)
}

fn sqlserver_config(id: &str, url: &str) -> ConnectionConfig {
    let (host, port, username, password, database) = parse_ado_server(url);
    ConnectionConfig {
        id: id.to_string(),
        name: id.to_string(),
        db_type: DatabaseType::SqlServer,
        driver_profile: None,
        driver_label: None,
        url_params: None,
        host,
        port,
        username,
        password,
        database,
        visible_databases: None,
        attached_databases: Vec::new(),
        color: None,
        transport_layers: Vec::new(),
        connect_timeout_secs: 5,
        query_timeout_secs: 60,
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

/// The SQL Server sweep leases through the pool's checked checkout (`SELECT
/// @@SPID`, healthy sockets returned to the idle list) and evicts the pool
/// once the server stops answering.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL and DBX_TEST_SQLSERVER_CONTAINER pointing at a throwaway SQL Server container this test stops"]
async fn live_sqlserver_refresh_sweep_marks_dead_pool_offline() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = app_state(sqlserver_config("live-mssql-refresh", &url)).await;
    state.get_or_create_pool("live-mssql-refresh", None).await.expect("connect SQL Server");
    refresh_marks_dead_pool_offline(state, "live-mssql-refresh", "DBX_TEST_SQLSERVER_CONTAINER").await;
}

// --- Redis ---

fn parse_host_port(url: &str) -> (String, u16) {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let rest = rest.split(['/', '?']).next().unwrap_or(rest);
    let (host, port) = rest.rsplit_once(':').expect("redis host:port");
    (host.to_string(), port.parse().expect("redis port"))
}

#[allow(clippy::too_many_lines)]
fn redis_config(id: &str, host: &str, port: u16) -> ConnectionConfig {
    ConnectionConfig {
        id: id.to_string(),
        name: id.to_string(),
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

/// The Redis sweep PINGs the direct connection (ConnectionManager underneath)
/// and evicts the pool once the server stops answering — the PING fails or
/// runs into the sweep's per-pool deadline, either of which is unhealthy.
#[tokio::test]
#[ignore = "requires DBX_TEST_REDIS_URL and DBX_TEST_REDIS_CONTAINER pointing at a throwaway Redis container this test stops"]
async fn live_redis_refresh_sweep_marks_dead_pool_offline() {
    let url = std::env::var("DBX_TEST_REDIS_URL").expect("DBX_TEST_REDIS_URL (e.g. redis://127.0.0.1:6399/)");
    let (host, port) = parse_host_port(&url);
    let state = app_state(redis_config("live-redis-refresh", &host, port)).await;
    state.get_or_create_pool("live-redis-refresh", None).await.expect("connect Redis");
    refresh_marks_dead_pool_offline(state, "live-redis-refresh", "DBX_TEST_REDIS_CONTAINER").await;
}
