//! Env-gated live tests for the SQL Server connection pool (perf task T03):
//! two slow statements on one pool run in parallel, schema metadata loads do
//! not queue behind a slow query, and a server-side-killed session is shed
//! transparently at the next checkout.
//!
//! Run against a throwaway instance:
//! `DBX_TEST_SQLSERVER_URL='server=tcp://127.0.0.1,1433;user=sa;password=<pw>;database=master' \
//!  cargo test -p dbx-core --test live_sqlserver_pool -- --ignored`

use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::connection::AppState;
use dbx_core::db;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-mssql-pool";

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

async fn open_state(url: &str) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("dbx-live-mssql-pool-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config_from_ado_string(CONNECTION_ID, url));
    state
}

async fn run_query(state: &AppState, sql: &str) -> Result<db::QueryResult, String> {
    dbx_core::query::execute_sql_statement_with_options(
        state,
        CONNECTION_ID,
        "master",
        sql,
        None,
        None,
        Default::default(),
    )
    .await
}

/// Two slow statements checked out from the same pool must execute on
/// separate connections instead of serializing behind one socket.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_pool_runs_slow_queries_in_parallel() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = open_state(&url).await;

    let first = tokio::spawn({
        let state = Arc::clone(&state);
        async move { run_query(&state, "WAITFOR DELAY '00:00:02'").await }
    });
    let second = tokio::spawn({
        let state = Arc::clone(&state);
        async move { run_query(&state, "WAITFOR DELAY '00:00:02'").await }
    });

    let started = Instant::now();
    first.await.expect("join").expect("first slow query");
    second.await.expect("join").expect("second slow query");
    let elapsed = started.elapsed();

    // Serialized, two 2s WAITFORs need >= 4s plus overhead; pooled checkout
    // runs them side by side.
    assert!(
        elapsed < Duration::from_secs(3),
        "two 2s WAITFOR queries took {elapsed:?}; they must run in parallel on separate pool connections"
    );
}

/// A slow query occupying one pool connection must not block the schema tree
/// from loading tables on another connection.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_pool_schema_load_not_blocked_by_slow_query() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = open_state(&url).await;

    let slow = tokio::spawn({
        let state = Arc::clone(&state);
        async move { run_query(&state, "WAITFOR DELAY '00:00:5'").await }
    });
    // Give the slow query a moment to grab its lease, then load the tree.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let started = Instant::now();
    let tables = dbx_core::schema::list_tables_core(&state, CONNECTION_ID, "master", "dbo", None, Some(100))
        .await
        .expect("list_tables_core must not queue behind the slow query");
    let elapsed = started.elapsed();

    assert!(
        elapsed < Duration::from_secs(3),
        "tree load took {elapsed:?} while a slow query was running; metadata must use a second pool connection"
    );
    println!("tree load returned {} table(s) in {elapsed:?} while WAITFOR was running", tables.len());

    slow.await.expect("join").expect("slow query completes normally");
}

/// KILLing the pooled session from a second connection must be healed
/// transparently: the next checkout health-checks the dead socket, sheds it,
/// and redials instead of surfacing a broken-pipe error.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_pool_recovers_after_killed_session() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = open_state(&url).await;

    let result = run_query(&state, "SELECT @@SPID AS spid").await.expect("first query seeds the pool");
    let cell = &result.rows[0][0];
    let spid = cell
        .as_str()
        .map(str::to_string)
        .or_else(|| cell.as_i64().map(|v| v.to_string()))
        .expect("spid is a string or number");
    println!("pooled session spid = {spid}");

    // Let the lease's return-to-idle task land so the KILL targets an idle
    // pooled socket.
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Kill the pooled session from an independent connection.
    let (host, port, username, password, database) = parse_ado_server(&url);
    let mut killer =
        db::sqlserver::connect(&host, port, &username, &password, database.as_deref(), Duration::from_secs(5))
            .await
            .expect("killer connection");
    let stream = killer.simple_query(&format!("KILL {spid}")).await.expect("KILL must succeed");
    let _ = stream.into_results().await;

    // The next statement must transparently redial: the pool sheds the dead
    // socket at checkout and returns a fresh, healthy connection.
    let started = Instant::now();
    let after = run_query(&state, "SELECT 1 AS ok").await;
    let elapsed = started.elapsed();
    let after = after.expect("query after KILL must recover transparently via pool redial");
    println!("recovered in {elapsed:?}");
    assert_eq!(after.rows[0][0].as_i64(), Some(1));
    assert!(elapsed < Duration::from_secs(5), "recovery took {elapsed:?}; redial should be immediate");
}
