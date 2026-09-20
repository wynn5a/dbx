use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-mysql-cancel";
const EXECUTION_ID: &str = "live-mysql-cancel-1";
const PROBE_SQL: &str = "SELECT SLEEP(30), 1 AS dbx_cancel_probe";

fn config_from_url(id: &str, url: &str) -> ConnectionConfig {
    let opts = mysql_async::Opts::from_url(url).expect("parse MySQL URL");
    ConnectionConfig {
        id: id.to_string(),
        name: id.to_string(),
        db_type: DatabaseType::Mysql,
        driver_profile: None,
        driver_label: None,
        url_params: None,
        host: opts.ip_or_hostname().to_string(),
        port: opts.tcp_port(),
        username: opts.user().unwrap_or_default().to_string(),
        password: opts.pass().unwrap_or_default().to_string(),
        database: opts.db_name().map(str::to_string),
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

/// Wait until the slow probe statement is visible in the server's processlist.
/// The LIKE fragments are split so the wait/poll query never matches itself.
/// Wait until the slow probe statement is visible in (or gone from) the
/// server's processlist. The LIKE fragments are split so the poll query never
/// matches itself.
async fn assert_server_query_gone(pool: &dbx_core::db::mysql::MySqlPool) {
    wait_for_probe(pool, false, "gone after cancel").await;
}

async fn wait_for_probe(pool: &dbx_core::db::mysql::MySqlPool, present: bool, what: &str) {
    let check_sql = "SELECT ID, INFO FROM information_schema.PROCESSLIST \
         WHERE COMMAND IN ('Query', 'Execute') AND INFO LIKE CONCAT('%', 'SLEEP', '(30)', '%')";
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let result = dbx_core::db::mysql::execute_query(pool, check_sql, true).await.expect("poll PROCESSLIST");
        if result.rows.is_empty() != present {
            println!("probe state confirmed ({what}): {} matching row(s)", result.rows.len());
            return;
        }
        for row in &result.rows {
            println!("PROCESSLIST MATCH ({what}): id={:?} info={:?}", row.first(), row.get(1));
        }
        assert!(Instant::now() < deadline, "server-side SLEEP(30) query did not become {what}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tokio::test]
#[ignore = "requires DBX_TEST_MYSQL_URL (mysql://user:pass@host:port/db) pointing at a MySQL server"]
async fn live_mysql_cancel_kills_the_statement_on_the_server() {
    let url = std::env::var("DBX_TEST_MYSQL_URL").expect("DBX_TEST_MYSQL_URL");
    let database = mysql_async::Opts::from_url(&url).expect("parse MySQL URL").db_name().unwrap_or("mysql").to_string();

    let dir = std::env::temp_dir().join(format!("dbx-live-mysql-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config_from_url(CONNECTION_ID, &url));

    let registered = state.running_queries.register(EXECUTION_ID.to_string());
    let cancel_token = registered.token();

    let query_state = Arc::clone(&state);
    let query_task = tokio::spawn(async move {
        dbx_core::query::execute_sql_statement_with_options(
            &query_state,
            CONNECTION_ID,
            &database,
            PROBE_SQL,
            None,
            Some(cancel_token),
            dbx_core::query::QueryExecutionOptions {
                execution_id: Some(EXECUTION_ID.to_string()),
                timeout_secs: Some(20),
                ..Default::default()
            },
        )
        .await
    });

    // The registration happens inside the driver right after pool checkout, so
    // poll briefly instead of racing a fixed sleep.
    let registered_ctx = {
        let mut found = false;
        for _ in 0..100 {
            if state.running_queries.peek_server_cancel(EXECUTION_ID).is_some() {
                found = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        found
    };
    assert!(registered_ctx, "checkout must register a server-side kill for the running query");

    let probe_pool = dbx_core::db::mysql::connect_with_ca_cert_and_pool_limit(&url, None, Duration::from_secs(5), 2)
        .await
        .expect("connect probe pool");
    // Confirm the statement is actually running server-side before cancelling.
    wait_for_probe(&probe_pool, true, "running before cancel").await;

    let started = Instant::now();
    assert!(dbx_core::process::cancel_running_query(&state, EXECUTION_ID).await);

    let result = query_task.await.expect("query task should finish").expect_err("cancelled query must error");
    assert_eq!(result, dbx_core::query::QUERY_CANCELED);
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel took {:?}; the statement should stop server-side instead of running to completion",
        started.elapsed()
    );

    assert_server_query_gone(&probe_pool).await;
}
