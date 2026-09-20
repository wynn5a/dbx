use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-pg-cancel";
const DATABASE: &str = "postgres";

fn config_from_url(id: &str, url: &str) -> ConnectionConfig {
    let parsed = tokio_postgres::Config::from_str(url).expect("parse PostgreSQL URL");
    ConnectionConfig {
        id: id.to_string(),
        name: id.to_string(),
        db_type: DatabaseType::Postgres,
        driver_profile: None,
        driver_label: None,
        url_params: None,
        host: parsed
            .get_hosts()
            .first()
            .and_then(|h| match h {
                tokio_postgres::config::Host::Tcp(host) => Some(host.clone()),
                _ => None,
            })
            .unwrap_or_else(|| "127.0.0.1".to_string()),
        port: parsed.get_ports().first().copied().unwrap_or(5432),
        username: parsed.get_user().unwrap_or("postgres").to_string(),
        password: parsed.get_password().map(|bytes| String::from_utf8_lossy(bytes).to_string()).unwrap_or_default(),
        database: Some(parsed.get_dbname().unwrap_or(DATABASE).to_string()),
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

async fn app_state(url: &str) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("dbx-live-pg-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config_from_url(CONNECTION_ID, url));
    state
}

/// The registration happens inside the driver right after pool checkout, so
/// poll briefly instead of racing a fixed sleep.
async fn wait_for_server_cancel_registration(state: &AppState, execution_id: &str) -> bool {
    for _ in 0..100 {
        if state.running_queries.peek_server_cancel(execution_id).is_some() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

/// Count pg_stat_activity evidence of the running pg_sleep probe. SELECTs run
/// through a server-side cursor, so while the sleep executes the backend's
/// current statement is the `FETCH ... FROM dbx_*_cursor_*`; the pg_sleep text
/// itself shows while the declaring transaction is between statements. Both
/// signal fragments are split so the poll query never matches itself.
async fn probe_activity_count(pool: &deadpool_postgres::Pool) -> i64 {
    let check_sql = "SELECT count(*) FROM pg_stat_activity \
         WHERE pid <> pg_backend_pid() AND ( \
           query LIKE CONCAT('%', 'pg_sleep', '(30)', '%') \
           OR (state = 'active' AND query LIKE CONCAT('FETCH', ' %FROM dbx', '%')) \
         )";
    let result = dbx_core::db::postgres::execute_query(pool, check_sql).await.expect("poll pg_stat_activity");
    result.rows[0][0].as_i64().unwrap_or(i64::MAX)
}

async fn wait_for_probe(pool: &deadpool_postgres::Pool, present: bool, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let count = probe_activity_count(pool).await;
        if (count > 0) == present {
            println!("probe state confirmed ({what}): {count} matching row(s)");
            return;
        }
        assert!(Instant::now() < deadline, "pg_sleep(30) probe did not become {what}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn probe_pool(url: &str) -> deadpool_postgres::Pool {
    dbx_core::db::postgres::connect(url, Duration::from_secs(5)).await.expect("connect probe pool")
}

/// Covers both cancellation triggers against the real user query path (SELECT
/// through the server-side cursor): an explicit cancel and the execution
/// timeout. Runs its phases serially so the two probes never overlap in
/// pg_stat_activity.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a writable PostgreSQL database"]
async fn live_postgres_cancel_and_timeout_stop_the_statement_on_the_server() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let state = app_state(&url).await;
    let pool = probe_pool(&url).await;

    // Phase 1 — explicit cancel.
    let registered = state.running_queries.register("live-pg-cancel-1".to_string());
    let cancel_token = registered.token();
    let query_state = Arc::clone(&state);
    let query_task = tokio::spawn(async move {
        dbx_core::query::execute_sql_statement_with_options(
            &query_state,
            CONNECTION_ID,
            DATABASE,
            "SELECT pg_sleep(30), 1 AS dbx_cancel_probe",
            None,
            Some(cancel_token),
            dbx_core::query::QueryExecutionOptions {
                execution_id: Some("live-pg-cancel-1".to_string()),
                timeout_secs: Some(20),
                ..Default::default()
            },
        )
        .await
    });

    assert!(
        wait_for_server_cancel_registration(&state, "live-pg-cancel-1").await,
        "checkout must register a server-side cancel for the running query"
    );
    wait_for_probe(&pool, true, "running before cancel").await;

    let started = Instant::now();
    assert!(dbx_core::process::cancel_running_query(&state, "live-pg-cancel-1").await);
    let result = query_task.await.expect("query task should finish").expect_err("cancelled query must error");
    assert_eq!(result, dbx_core::query::QUERY_CANCELED);
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel took {:?}; the statement should stop server-side instead of running to completion",
        started.elapsed()
    );
    wait_for_probe(&pool, false, "gone after cancel").await;
    println!("phase 1 (explicit cancel) ok");

    // Phase 2 — execution timeout fires the server-side cancel by itself.
    let query_state = Arc::clone(&state);
    let spawned_at = Instant::now();
    let query_task = tokio::spawn(async move {
        dbx_core::query::execute_sql_statement_with_options(
            &query_state,
            CONNECTION_ID,
            DATABASE,
            "SELECT pg_sleep(30), 2 AS dbx_timeout_probe",
            None,
            None,
            dbx_core::query::QueryExecutionOptions {
                execution_id: Some("live-pg-timeout-1".to_string()),
                timeout_secs: Some(2),
                ..Default::default()
            },
        )
        .await
    });

    assert!(
        wait_for_server_cancel_registration(&state, "live-pg-timeout-1").await,
        "checkout must register a server-side cancel for the running query"
    );
    wait_for_probe(&pool, true, "running before timeout").await;

    let result = query_task.await.expect("query task should finish").expect_err("query must time out");
    assert!(dbx_core::query::is_query_execution_timeout(&result), "unexpected error: {result}");
    assert!(spawned_at.elapsed() >= Duration::from_secs(2));
    wait_for_probe(&pool, false, "gone after timeout").await;
    println!("phase 2 (timeout) ok");
}
