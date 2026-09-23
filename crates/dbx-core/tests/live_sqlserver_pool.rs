//! Env-gated live tests for the SQL Server connection pool (perf task T03):
//! two slow statements on one pool run in parallel, schema metadata loads do
//! not queue behind a slow query, a server-side-killed session is shed
//! transparently at the next checkout, released sockets are reused (idle list
//! capped), grid-save transactions stay on one session, and a SQL error on the
//! transfer path keeps the healthy socket.
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

    // The lease returns its socket to the idle list synchronously on drop, so
    // the KILL below targets the idle pooled socket.

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

async fn pool_handle(state: &AppState) -> (String, Arc<db::sqlserver::SqlServerPool>) {
    let pool_key = state.get_or_create_pool(CONNECTION_ID, Some("master")).await.expect("pool");
    let connections = state.connections.read().await;
    match connections.get(&pool_key) {
        Some(dbx_core::connection::PoolKind::SqlServer(pool)) => (pool_key.clone(), Arc::clone(pool)),
        _ => panic!("expected a SQL Server pool"),
    }
}

/// Identifies the physical connection: SPIDs are reused as soon as a session
/// closes, the connection GUID is not.
const CONNECTION_IDENTITY_SQL: &str =
    "SELECT CONVERT(varchar(36), connection_id) FROM sys.dm_exec_connections WHERE session_id = @@SPID";

fn cell_string(result: &db::QueryResult) -> String {
    let cell = &result.rows[0][0];
    cell.as_str().map(str::to_string).or_else(|| cell.as_i64().map(|v| v.to_string())).expect("scalar cell")
}

/// Back-to-back statements must reuse the returned socket (same session)
/// instead of racing its return and logging in on a fresh one, and the idle
/// list must never outgrow the pool size — even after a burst.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_pool_reuses_returned_session_and_caps_idle() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = open_state(&url).await;

    let first = cell_string(&run_query(&state, CONNECTION_IDENTITY_SQL).await.expect("connection id"));
    for _ in 0..5 {
        let current = cell_string(&run_query(&state, CONNECTION_IDENTITY_SQL).await.expect("connection id"));
        assert_eq!(current, first, "sequential statements must land on the returned connection");
    }

    let (_, pool) = pool_handle(&state).await;
    let burst: Vec<_> = (0..8)
        .map(|_| {
            let state = Arc::clone(&state);
            tokio::spawn(async move { run_query(&state, "WAITFOR DELAY '00:00:00.200'").await })
        })
        .collect();
    for task in burst {
        task.await.expect("join").expect("burst query");
    }
    assert!(
        pool.idle_count() <= pool.max_size(),
        "idle list grew to {} (limit {})",
        pool.idle_count(),
        pool.max_size()
    );
}

/// A grid save (executeInTransaction) must be atomic: when a later statement
/// fails, earlier ones are rolled back, and no pooled session is left holding
/// an open transaction afterwards.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_transaction_is_atomic_on_one_session() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = open_state(&url).await;
    let table = format!("dbx_tx_{}", uuid::Uuid::new_v4().simple());
    run_query(&state, &format!("CREATE TABLE dbo.{table} (id INT PRIMARY KEY)")).await.expect("create table");

    // Second insert violates the primary key: the whole save must roll back.
    let failing =
        vec![format!("INSERT INTO dbo.{table} (id) VALUES (1)"), format!("INSERT INTO dbo.{table} (id) VALUES (1)")];
    let err = dbx_core::query::execute_statements_in_transaction(&state, CONNECTION_ID, "master", &failing, None)
        .await
        .expect_err("duplicate key must fail the transaction");
    assert!(err.starts_with("Statement 2 failed"), "unexpected error: {err}");
    let count = run_query(&state, &format!("SELECT COUNT(*) FROM dbo.{table}")).await.expect("count");
    assert_eq!(cell_string(&count), "0", "the first insert must have been rolled back with the failed save");

    // A clean save commits every statement.
    let ok =
        vec![format!("INSERT INTO dbo.{table} (id) VALUES (1)"), format!("INSERT INTO dbo.{table} (id) VALUES (2)")];
    let result = dbx_core::query::execute_statements_in_transaction(&state, CONNECTION_ID, "master", &ok, None)
        .await
        .expect("clean save commits");
    assert_eq!(result.affected_rows, 2);
    let count = run_query(&state, &format!("SELECT COUNT(*) FROM dbo.{table}")).await.expect("count");
    assert_eq!(cell_string(&count), "2");

    // No pooled session may be left inside a transaction: check every socket
    // the pool can hand out by holding all of them at once.
    let (_, pool) = pool_handle(&state).await;
    let mut leases = Vec::new();
    for _ in 0..pool.max_size() {
        let (mut lease, _) = pool.lease_checked().await.expect("lease");
        let trancount = db::sqlserver::execute_query(lease.conn(), "SELECT @@TRANCOUNT").await.expect("trancount");
        assert_eq!(cell_string(&trancount), "0", "a pooled session was left with an open transaction");
        lease.keep();
        leases.push(lease);
    }
    drop(leases);

    run_query(&state, &format!("DROP TABLE dbo.{table}")).await.expect("drop table");
}

/// A plain SQL error on the transfer path round-trips cleanly; the healthy
/// socket must go back to the pool instead of being closed.
#[tokio::test]
#[ignore = "requires DBX_TEST_SQLSERVER_URL (ADO string, e.g. server=tcp://127.0.0.1,1433;user=sa;password=...;database=master)"]
async fn live_sqlserver_transfer_keeps_socket_after_sql_error() {
    let url = std::env::var("DBX_TEST_SQLSERVER_URL").expect("DBX_TEST_SQLSERVER_URL");
    let state = open_state(&url).await;
    let (pool_key, _) = pool_handle(&state).await;

    let before = dbx_core::transfer::execute_on_pool_with_max_rows(&state, &pool_key, CONNECTION_IDENTITY_SQL, None)
        .await
        .expect("connection id");
    // Settle pauses keep the check independent of how fast a released socket
    // lands back in the idle list.
    tokio::time::sleep(Duration::from_millis(100)).await;
    dbx_core::transfer::execute_on_pool_with_max_rows(&state, &pool_key, "SELECT * FROM dbo.dbx_no_such_table", None)
        .await
        .expect_err("missing table must fail");
    tokio::time::sleep(Duration::from_millis(100)).await;
    let after = dbx_core::transfer::execute_on_pool_with_max_rows(&state, &pool_key, CONNECTION_IDENTITY_SQL, None)
        .await
        .expect("connection id");
    assert_eq!(cell_string(&before), cell_string(&after), "the SQL error must not cost the pooled connection");
}
