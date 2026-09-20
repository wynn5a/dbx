use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;
const CONNECTION_ID: &str = "live-mssql-cancel";
const EXECUTION_ID: &str = "live-mssql-cancel-1";
const PROBE_SQL: &str = "WAITFOR DELAY '00:00:30'";

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

fn config_from_ado_string(id: &str, url: &str) -> ConnectionConfig {
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

/// Poll sys.dm_exec_requests from a dedicated session pool: the probe occupies
/// the main single-connection pool, so polling through it would serialize
/// behind WAITFOR. The LIKE fragments are split so the poll query never
/// matches itself.
async fn poll_probe(state: &AppState, database: &str) -> i64 {
    let check_sql = "SELECT COUNT(*) FROM sys.dm_exec_requests r \
         OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t \
         WHERE t.text LIKE CONCAT('%', 'WAITFOR', ' DELAY', '%')";
    let result = dbx_core::query::execute_sql_statement_with_options(
        state,
        CONNECTION_ID,
        database,
        check_sql,
        None,
        None,
        dbx_core::query::QueryExecutionOptions {
            client_session_id: Some("__dbx_test_probe".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("poll dm_exec_requests");
    result.rows[0][0].as_i64().unwrap_or(i64::MAX)
}

async fn wait_for_probe(state: &AppState, database: &str, present: bool, what: &str) {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let count = poll_probe(state, database).await;
        if (count > 0) == present {
            println!("probe state confirmed ({what}): {count} matching row(s)");
            return;
        }
        assert!(Instant::now() < deadline, "WAITFOR DELAY probe did not become {what}");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_cancel_kills_the_session_on_the_server() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let database = parse_ado_server(&url).4.unwrap_or_else(|| "master".to_string());

    let dir = std::env::temp_dir().join(format!("dbx-live-mssql-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config_from_ado_string(CONNECTION_ID, &url));

    let registered = state.running_queries.register(EXECUTION_ID.to_string());
    let cancel_token = registered.token();

    let query_state = Arc::clone(&state);
    let query_database = database.clone();
    let query_task = tokio::spawn(async move {
        dbx_core::query::execute_sql_statement_with_options(
            &query_state,
            CONNECTION_ID,
            &query_database,
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

    // The registration happens during the per-query health check (SELECT
    // @@SPID), so poll briefly instead of racing a fixed sleep.
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
    if !registered_ctx {
        // Surface why the query never reached its health check (connect error,
        // timeout, …) instead of failing with a bare assert.
        match query_task.await {
            Ok(Ok(_)) => println!("DIAG: query finished without registering a server-side kill"),
            Ok(Err(e)) => println!("DIAG: query failed before registration: {e}"),
            Err(join) => println!("DIAG: query task panicked: {join}"),
        }
        panic!("checkout must register a server-side kill for the running query");
    }
    // Confirm the statement is actually running server-side before cancelling.
    wait_for_probe(&state, &database, true, "running before cancel").await;

    let started = Instant::now();
    assert!(dbx_core::process::cancel_running_query(&state, EXECUTION_ID).await);

    let result = query_task.await.expect("query task should finish").expect_err("cancelled query must error");
    assert_eq!(result, dbx_core::query::QUERY_CANCELED);
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel took {:?}; the statement should stop server-side instead of running to completion",
        started.elapsed()
    );

    // KILL terminates the whole session, so the pool's connection is dead:
    // the poll goes through the product query path, whose health-check failure
    // triggers the transparent reconnect-and-retry instead of surfacing the
    // stale connection.
    wait_for_probe(&state, &database, false, "gone after cancel").await;
}
