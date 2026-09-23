//! Live check (improvement-plan §5 D2): a SQL statement sent by an agent tool
//! is visible in `RunningQueries` and stops on the server when the run is
//! cancelled — via the run's tool-cancellation token (the Chat Cancel path) and
//! via the standard `cancel_running_query` registry path. T02 supplies the
//! server-side stop (`pg_cancel_backend`); this drives the agent tool layer the
//! same way `run_agent_loop` does, without needing an LLM. A second test checks
//! the metadata tools' default schema scope on PostgreSQL.
//!
//! Run with: DBX_TEST_POSTGRES_URL=postgres://... cargo test -p dbx-core \
//!   --test live_agent_tool_query_cancel -- --ignored

use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dbx_core::agent_events::ToolCall;
use dbx_core::agent_tools;
use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;
use tokio_util::sync::CancellationToken;

const CONNECTION_ID: &str = "live-agent-cancel";
const DATABASE: &str = "postgres";
const SESSION: &str = "live-agent-session";

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
    let dir = std::env::temp_dir().join(format!("dbx-live-agent-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config_from_url(CONNECTION_ID, url));
    state
}

fn execute_query_tool_call(id: &str, marker: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: "execute_query".to_string(),
        arguments: serde_json::json!({ "sql": format!("SELECT pg_sleep(30), '{marker}' AS dbx_agent_probe") }),
        thought_signature: None,
    }
}

/// The execution id scheme is `agent-{session}-{tool_call_id}` (sanitized); the
/// ids used here are already clean, so they can be spelled out directly.
fn execution_id_for(tool_call_id: &str) -> String {
    format!("agent-{SESSION}-{tool_call_id}")
}

/// The server-side cancel is registered inside the driver right after pool
/// checkout, so poll briefly instead of racing a fixed sleep.
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
/// itself shows while the declaring transaction is between statements. The
/// phases run serially, so one shared predicate never overlaps itself.
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

/// Phase 1 — the Chat Cancel path: `ai::cancel_stream` flips the run's
/// tool-cancellation token; the in-flight tool SQL must abort and be stopped on
/// the server. Phase 2 — the registry path: the agent query sits in
/// `RunningQueries` and `cancel_running_query` (the `cancel_query` command
/// entry) stops it the same way it stops editor queries. Phases run serially so
/// the probes never overlap in pg_stat_activity.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a writable PostgreSQL database"]
async fn live_agent_tool_query_cancel_stops_the_statement_on_the_server() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let state = app_state(&url).await;
    let pool = probe_pool(&url).await;

    // Phase 1 — cancel via the run's tool-cancellation token.
    let tc = execute_query_tool_call("live-call-1", "dbx_cancel_probe");
    let run_cancel = CancellationToken::new();
    let tool_state = Arc::clone(&state);
    let tool_cancel = run_cancel.clone();
    let tool_task = tokio::spawn(async move {
        agent_tools::execute_tool(
            &tc,
            &tool_state,
            CONNECTION_ID,
            DATABASE,
            None,
            &DatabaseType::Postgres,
            SESSION,
            &tool_cancel,
        )
        .await
    });

    let execution_id = execution_id_for("live-call-1");
    assert!(
        wait_for_server_cancel_registration(&state, &execution_id).await,
        "agent tool query must register a server-side cancel under its execution id"
    );
    wait_for_probe(&pool, true, "running before cancel").await;

    let started = Instant::now();
    run_cancel.cancel(); // what ai::cancel_stream does on Chat Cancel
    let result = tool_task.await.expect("tool task should finish");
    assert!(result.is_error, "cancelled tool call must be an error: {}", result.content);
    assert_eq!(result.content, format!("Error: {}", dbx_core::query::QUERY_CANCELED));
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel took {:?}; the statement should stop server-side instead of running to completion",
        started.elapsed()
    );
    wait_for_probe(&pool, false, "gone after run cancel").await;
    println!("phase 1 (tool-cancellation token) ok");

    // Phase 2 — the agent query is cancellable through RunningQueries.
    let tc = execute_query_tool_call("live-call-2", "dbx_registry_probe");
    let tool_state = Arc::clone(&state);
    let run_cancel = CancellationToken::new();
    let tool_cancel = run_cancel.clone();
    let tool_task = tokio::spawn(async move {
        agent_tools::execute_tool(
            &tc,
            &tool_state,
            CONNECTION_ID,
            DATABASE,
            None,
            &DatabaseType::Postgres,
            SESSION,
            &tool_cancel,
        )
        .await
    });

    let execution_id = execution_id_for("live-call-2");
    assert!(
        wait_for_server_cancel_registration(&state, &execution_id).await,
        "agent tool query must register a server-side cancel under its execution id"
    );
    wait_for_probe(&pool, true, "running before registry cancel").await;

    let started = Instant::now();
    assert!(
        dbx_core::process::cancel_running_query(&state, &execution_id).await,
        "the agent query must be registered in RunningQueries and cancellable"
    );
    let result = tool_task.await.expect("tool task should finish");
    assert!(result.is_error, "cancelled tool call must be an error: {}", result.content);
    assert_eq!(result.content, format!("Error: {}", dbx_core::query::QUERY_CANCELED));
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel took {:?}; the statement should stop server-side instead of running to completion",
        started.elapsed()
    );
    wait_for_probe(&pool, false, "gone after registry cancel").await;
    println!("phase 2 (RunningQueries cancel_running_query) ok");
}

fn metadata_tool_call(id: &str, name: &str, arguments: serde_json::Value) -> ToolCall {
    ToolCall { id: id.to_string(), name: name.to_string(), arguments, thought_signature: None }
}

/// The metadata tools' default scope on PostgreSQL (review finding T20): with
/// no `schema` argument they must not look in a schema named after the
/// database. `search_tables` spans every schema, the others use `public` (or
/// the tab's schema when the frontend sends one).
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a writable PostgreSQL database"]
async fn live_agent_metadata_tools_default_to_real_postgres_schemas() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let database = tokio_postgres::Config::from_str(&url)
        .expect("parse PostgreSQL URL")
        .get_dbname()
        .unwrap_or(DATABASE)
        .to_string();
    let state = app_state(&url).await;
    let pool = probe_pool(&url).await;
    let setup = "DROP SCHEMA IF EXISTS dbx_t20 CASCADE; DROP TABLE IF EXISTS public.dbx_t20_orders; \
                 CREATE SCHEMA dbx_t20; \
                 CREATE TABLE public.dbx_t20_orders (id int); \
                 CREATE TABLE dbx_t20.dbx_t20_orders_archive (archived_id int);";
    pool.get().await.expect("setup connection").batch_execute(setup).await.expect("seed schemas");

    let run = |call: ToolCall, hint: Option<&'static str>| {
        let state = Arc::clone(&state);
        let database = database.clone();
        async move {
            let cancel = CancellationToken::new();
            agent_tools::execute_tool(
                &call,
                &state,
                CONNECTION_ID,
                &database,
                hint,
                &DatabaseType::Postgres,
                SESSION,
                &cancel,
            )
            .await
        }
    };

    let found =
        run(metadata_tool_call("s1", "search_tables", serde_json::json!({ "search": "dbx_t20_orders" })), None).await;
    assert!(!found.is_error, "{}", found.content);
    assert!(found.content.contains("- public.dbx_t20_orders ("), "{}", found.content);
    assert!(found.content.contains("- dbx_t20.dbx_t20_orders_archive ("), "{}", found.content);

    let listed = run(metadata_tool_call("l1", "list_tables", serde_json::json!({})), None).await;
    assert!(listed.content.contains("- dbx_t20_orders ("), "{}", listed.content);
    assert!(!listed.content.contains("dbx_t20_orders_archive"), "{}", listed.content);

    let columns =
        run(metadata_tool_call("c1", "get_columns", serde_json::json!({ "table": "dbx_t20_orders" })), None).await;
    assert!(columns.content.contains("id"), "{}", columns.content);

    // The tab's schema, when sent, is the default scope instead.
    let hinted = run(metadata_tool_call("l2", "list_tables", serde_json::json!({})), Some("dbx_t20")).await;
    assert!(hinted.content.contains("dbx_t20_orders_archive"), "{}", hinted.content);

    pool.get()
        .await
        .expect("cleanup connection")
        .batch_execute("DROP SCHEMA dbx_t20 CASCADE; DROP TABLE public.dbx_t20_orders;")
        .await
        .expect("cleanup");
}
