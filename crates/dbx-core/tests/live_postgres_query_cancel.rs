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
        // The TLS switch maps to sslmode=require on the app's connection URL.
        ssl: url.contains("sslmode=require"),
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

async fn run_query(
    state: &Arc<AppState>,
    sql: &'static str,
    cancel_token: Option<tokio_util::sync::CancellationToken>,
    execution_id: Option<&str>,
    timeout_secs: u64,
) -> tokio::task::JoinHandle<Result<dbx_core::db::QueryResult, String>> {
    let query_state = Arc::clone(state);
    let execution_id = execution_id.map(str::to_string);
    tokio::spawn(async move {
        dbx_core::query::execute_sql_statement_with_options(
            &query_state,
            CONNECTION_ID,
            DATABASE,
            sql,
            None,
            cancel_token,
            dbx_core::query::QueryExecutionOptions {
                execution_id,
                timeout_secs: Some(timeout_secs),
                ..Default::default()
            },
        )
        .await
    })
}

/// Covers both cancellation triggers against the real user query path (SELECT
/// through the server-side cursor): an explicit cancel and the execution
/// timeout — plus a timeout on a query that carries no execution id (MCP
/// bridge, AI tools), which must still stop the statement server-side. Runs
/// its phases serially so the probes never overlap in pg_stat_activity.
async fn cancel_and_timeout_stop_the_statement_on_the_server(url: &str) {
    let state = app_state(url).await;
    let pool = probe_pool(url).await;

    // Phase 1 — explicit cancel.
    let registered = state.running_queries.register("live-pg-cancel-1".to_string());
    let query_task = run_query(
        &state,
        "SELECT pg_sleep(30), 1 AS dbx_cancel_probe",
        Some(registered.token()),
        Some("live-pg-cancel-1"),
        20,
    )
    .await;

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
    drop(registered);
    println!("phase 1 (explicit cancel) ok");

    // Phase 2 — execution timeout fires the server-side cancel by itself.
    let spawned_at = Instant::now();
    let query_task =
        run_query(&state, "SELECT pg_sleep(30), 2 AS dbx_timeout_probe", None, Some("live-pg-timeout-1"), 2).await;

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

    // Phase 3 — timeout without an execution id still stops the statement.
    let query_task = run_query(&state, "SELECT pg_sleep(30), 3 AS dbx_noid_probe", None, None, 2).await;
    wait_for_probe(&pool, true, "running before id-less timeout").await;
    let result = query_task.await.expect("query task should finish").expect_err("query must time out");
    assert!(dbx_core::query::is_query_execution_timeout(&result), "unexpected error: {result}");
    wait_for_probe(&pool, false, "gone after id-less timeout").await;
    println!("phase 3 (timeout without execution id) ok");
}

#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a writable PostgreSQL database"]
async fn live_postgres_cancel_and_timeout_stop_the_statement_on_the_server() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    cancel_and_timeout_stop_the_statement_on_the_server(&url).await;
}

/// Same scenarios over TLS: the cancel request must be sent through the
/// pool's TLS connector — with `sslmode=require` the server answers the
/// cancel's SSLRequest with 'S' and a plain-text cancel never gets through.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_TLS_URL: a PostgreSQL URL with sslmode=require against a TLS-enabled server"]
async fn live_postgres_cancel_and_timeout_work_over_tls() {
    let url = std::env::var("DBX_TEST_POSTGRES_TLS_URL").expect("DBX_TEST_POSTGRES_TLS_URL");
    assert!(url.contains("sslmode=require"), "DBX_TEST_POSTGRES_TLS_URL must set sslmode=require");
    cancel_and_timeout_stop_the_statement_on_the_server(&url).await;
}

/// A statement future dropped mid-flight (cancel/timeout) on a saturated pool
/// must not hand its dirty session — still inside BEGIN…DECLARE with the
/// statement running server-side — to a queued waiter. Drives the driver
/// directly (no app-level pool discard/retry to mask it): the waiter must get
/// a clean connection and succeed even while the dropped statement's cancel
/// is still in flight.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a writable PostgreSQL database"]
async fn live_postgres_dropped_statement_does_not_poison_a_queued_waiter() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let state = app_state(&url).await;
    let pool = probe_pool(&url).await; // max 3 connections
    let observer = probe_pool(&url).await;
    let running = dbx_core::query_cancel::RunningQueries::default();

    // Saturate the pool with slow statements, each registering its cancel.
    let ids = ["live-pg-sat-1", "live-pg-sat-2", "live-pg-sat-3"];
    let mut slow = Vec::new();
    for id in ids {
        let pool = pool.clone();
        let registrar = dbx_core::query_cancel::ServerCancelRegistrar::new(Some(id), &running, None);
        slow.push(tokio::spawn(async move {
            dbx_core::db::postgres::execute_query_with_max_rows(
                &pool,
                "SELECT pg_sleep(30), 4 AS dbx_saturate_probe",
                None,
                &registrar,
            )
            .await
        }));
    }
    for id in ids {
        let mut registered = false;
        for _ in 0..100 {
            if running.peek_server_cancel(id).is_some() {
                registered = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(registered, "{id} must check out a connection");
    }

    // A waiter queues behind the saturated pool.
    let waiter = tokio::spawn({
        let pool = pool.clone();
        async move { dbx_core::db::postgres::execute_query(&pool, "SELECT 42 AS answer").await }
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!waiter.is_finished(), "the waiter should be queued behind the saturated pool");

    // Drop the first statement mid-flight (what cancel/timeout do), and fire
    // its server-side cancel a little later, as cancel_running_query does.
    slow[0].abort();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let first = running.take_server_cancel(ids[0]).expect("cancel context");
    dbx_core::process::fire_server_cancel(&state, &first).await;

    let waited = tokio::time::timeout(Duration::from_secs(10), waiter)
        .await
        .expect("waiter must finish once a slot frees up")
        .expect("join")
        .expect("waiter must succeed on a clean connection");
    assert_eq!(waited.rows[0][0].as_i64(), Some(42));
    assert!(!pool.is_closed(), "the pool must stay open; only the dirty connection is shed");

    for id in &ids[1..] {
        if let Some(context) = running.take_server_cancel(id) {
            dbx_core::process::fire_server_cancel(&state, &context).await;
        }
    }
    for task in slow {
        let _ = task.await;
    }
    let probe_sql = "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() \
         AND query LIKE CONCAT('%', 'dbx_saturate', '_probe', '%') AND state = 'active'";
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let result = dbx_core::db::postgres::execute_query(&observer, probe_sql).await.expect("poll");
        if result.rows[0][0].as_i64() == Some(0) {
            break;
        }
        assert!(Instant::now() < deadline, "saturating statements must all be stopped server-side");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
