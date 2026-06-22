//! Listing and killing server-side database processes.
//!
//! When a query times out client-side, the backend process can keep running and
//! continue to load the server. This module lets the UI list the running
//! processes that DBX originated on a connection and cancel/terminate a chosen
//! one. Supported engines: PostgreSQL, MySQL, SQL Server.
//!
//! All SQL runs over a **dedicated helper pool** (a reserved session-scoped pool)
//! rather than the editor's own pool, because the timed-out query's connection is
//! busy (or was discarded on timeout). Each engine's listing query excludes that
//! helper connection via its inline self-identifier (`pg_backend_pid()` /
//! `CONNECTION_ID()` / `@@SPID`).

use serde::{Deserialize, Serialize};

use crate::connection::AppState;
use crate::models::connection::DatabaseType;
use crate::types::QueryResult;

/// Reserved `client_session_id` for the shared helper pool used to run the
/// listing/kill statements. Distinct from any editor tab's session id so it is
/// reused across calls and never collides with a user query pool.
const PROC_ADMIN_SESSION: &str = "__dbx_proc_admin";

const UNSUPPORTED_ERR: &str = "Process management is only supported for PostgreSQL, MySQL and SQL Server connections.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbProcess {
    /// Backend identifier: Postgres `pid`, MySQL connection id, SQL Server spid.
    pub pid: String,
    #[serde(default)]
    pub state: Option<String>,
    /// The SQL text currently executing, when the server exposes it.
    #[serde(default)]
    pub query: Option<String>,
    /// Seconds the statement has been running, when available.
    #[serde(default)]
    pub duration_secs: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KillMode {
    /// Cancel the running statement, keeping the connection alive where possible.
    Cancel,
    /// Terminate the whole backend connection/session.
    Terminate,
}

impl KillMode {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "terminate" => KillMode::Terminate,
            _ => KillMode::Cancel,
        }
    }
}

// Listing statements. Columns are aliased to fixed names that `rows_to_processes`
// maps by (case-insensitive) name, so column order is not load-bearing. The
// `'dbx%'` filter matches the `crate::db::CONNECTION_APP_NAME` tag set in connect().
const POSTGRES_LIST_SQL: &str = "SELECT pid::text AS pid, state, query, \
     EXTRACT(EPOCH FROM (now() - query_start)) AS duration_secs \
     FROM pg_stat_activity \
     WHERE application_name LIKE 'dbx%' \
       AND datname = current_database() \
       AND state = 'active' \
       AND pid <> pg_backend_pid()";

const MYSQL_LIST_SQL: &str = "SELECT ID AS pid, STATE AS state, INFO AS query, `TIME` AS duration_secs \
     FROM information_schema.PROCESSLIST \
     WHERE DB = DATABASE() \
       AND USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1) \
       AND COMMAND <> 'Sleep' \
       AND INFO IS NOT NULL \
       AND ID <> CONNECTION_ID()";

const SQLSERVER_LIST_SQL: &str = "SELECT CAST(s.session_id AS varchar(16)) AS pid, r.status AS state, \
     SUBSTRING(t.text, (r.statement_start_offset/2)+1, \
       ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) \
         ELSE r.statement_end_offset END - r.statement_start_offset)/2)+1) AS query, \
     DATEDIFF(SECOND, r.start_time, GETDATE()) AS duration_secs \
     FROM sys.dm_exec_sessions s \
     JOIN sys.dm_exec_requests r ON s.session_id = r.session_id \
     OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t \
     WHERE s.program_name LIKE 'dbx%' \
       AND s.database_id = DB_ID() \
       AND s.session_id <> @@SPID";

/// List the DBX-originated server processes running on `connection_id` /
/// `database`, sorted by longest-running first.
pub async fn list_processes(state: &AppState, connection_id: &str, database: &str) -> Result<Vec<DbProcess>, String> {
    let db_type = resolve_db_type(state, connection_id).await?;
    let sql = match db_type {
        DatabaseType::Postgres => POSTGRES_LIST_SQL,
        DatabaseType::Mysql => MYSQL_LIST_SQL,
        DatabaseType::SqlServer => SQLSERVER_LIST_SQL,
        _ => return Err(UNSUPPORTED_ERR.to_string()),
    };

    let result = run_admin_sql(state, connection_id, database, sql).await?;
    let mut processes = rows_to_processes(&result);
    processes.sort_by(|a, b| b.duration_secs.partial_cmp(&a.duration_secs).unwrap_or(std::cmp::Ordering::Equal));
    Ok(processes)
}

/// Cancel or terminate the process identified by `pid`.
pub async fn kill_process(
    state: &AppState,
    connection_id: &str,
    database: &str,
    pid: &str,
    mode: KillMode,
) -> Result<bool, String> {
    // The pid is inlined into the kill statement, so it must be a plain integer.
    let pid_num: i64 = pid.trim().parse().map_err(|_| format!("Invalid process id: {pid}"))?;

    let db_type = resolve_db_type(state, connection_id).await?;
    let sql = match db_type {
        DatabaseType::Postgres => match mode {
            KillMode::Cancel => format!("SELECT pg_cancel_backend({pid_num})"),
            KillMode::Terminate => format!("SELECT pg_terminate_backend({pid_num})"),
        },
        DatabaseType::Mysql => match mode {
            KillMode::Cancel => format!("KILL QUERY {pid_num}"),
            KillMode::Terminate => format!("KILL {pid_num}"),
        },
        // SQL Server has no query-only cancel; KILL terminates the session.
        DatabaseType::SqlServer => format!("KILL {pid_num}"),
        _ => return Err(UNSUPPORTED_ERR.to_string()),
    };

    let result = run_admin_sql(state, connection_id, database, &sql).await?;

    // pg_cancel_backend / pg_terminate_backend return whether a signal was actually
    // sent (false for an already-gone pid), so surface that honestly. MySQL and SQL
    // Server raise an error for an unknown id, which propagates as Err above.
    if db_type == DatabaseType::Postgres {
        if let Some(sent) = result.rows.first().and_then(|row| row.first()).and_then(serde_json::Value::as_bool) {
            return Ok(sent);
        }
    }
    Ok(true)
}

async fn resolve_db_type(state: &AppState, connection_id: &str) -> Result<DatabaseType, String> {
    let configs = state.configs.read().await;
    configs.get(connection_id).map(|c| c.db_type).ok_or_else(|| "Connection config not found".to_string())
}

/// Run a listing/kill statement on the reserved helper pool. Routes through the
/// canonical query path so pool acquisition, per-engine dispatch, timeout and a
/// reconnect-once-on-drop are all handled the same way as normal queries — the
/// helper just runs on its own `PROC_ADMIN_SESSION`-scoped connection.
async fn run_admin_sql(
    state: &AppState,
    connection_id: &str,
    database: &str,
    sql: &str,
) -> Result<QueryResult, String> {
    crate::query::execute_sql_statement_with_options(
        state,
        connection_id,
        database,
        sql,
        None,
        None,
        crate::query::QueryExecutionOptions {
            client_session_id: Some(PROC_ADMIN_SESSION.to_string()),
            ..Default::default()
        },
    )
    .await
}

fn rows_to_processes(result: &QueryResult) -> Vec<DbProcess> {
    let index_of = |name: &str| result.columns.iter().position(|c| c.eq_ignore_ascii_case(name));
    let pid_i = index_of("pid");
    let state_i = index_of("state");
    let query_i = index_of("query");
    let dur_i = index_of("duration_secs");

    result
        .rows
        .iter()
        .filter_map(|row| {
            let cell = |i: Option<usize>| i.and_then(|i| row.get(i));
            Some(DbProcess {
                pid: cell_to_string(cell(pid_i))?,
                state: cell_to_string(cell(state_i)),
                query: cell_to_string(cell(query_i)),
                duration_secs: cell_to_f64(cell(dur_i)),
            })
        })
        .collect()
}

fn cell_to_string(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        Some(serde_json::Value::Number(n)) => Some(n.to_string()),
        Some(serde_json::Value::Bool(b)) => Some(b.to_string()),
        Some(serde_json::Value::String(_) | serde_json::Value::Null) | None => None,
        Some(other) => Some(other.to_string()),
    }
}

fn cell_to_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn result(columns: &[&str], rows: Vec<Vec<serde_json::Value>>) -> QueryResult {
        QueryResult {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            column_types: Vec::new(),
            rows,
            affected_rows: 0,
            execution_time_ms: 0,
            truncated: false,
            session_id: None,
            has_more: false,
        }
    }

    #[test]
    fn maps_rows_by_column_name() {
        let r = result(
            &["pid", "state", "query", "duration_secs"],
            vec![vec![json!("123"), json!("active"), json!("SELECT pg_sleep(99)"), json!(42.5)]],
        );
        let procs = rows_to_processes(&r);
        assert_eq!(procs.len(), 1);
        assert_eq!(procs[0].pid, "123");
        assert_eq!(procs[0].state.as_deref(), Some("active"));
        assert_eq!(procs[0].query.as_deref(), Some("SELECT pg_sleep(99)"));
        assert_eq!(procs[0].duration_secs, Some(42.5));
    }

    #[test]
    fn coerces_numeric_pid_and_string_duration() {
        let r = result(&["pid", "duration_secs"], vec![vec![json!(456), json!("12.0")]]);
        let procs = rows_to_processes(&r);
        assert_eq!(procs[0].pid, "456");
        assert_eq!(procs[0].duration_secs, Some(12.0));
    }

    #[test]
    fn skips_rows_without_pid() {
        let r = result(&["pid", "state"], vec![vec![json!(null), json!("active")]]);
        assert!(rows_to_processes(&r).is_empty());
    }

    #[test]
    fn kill_mode_parses_case_insensitively() {
        assert_eq!(KillMode::parse("TERMINATE"), KillMode::Terminate);
        assert_eq!(KillMode::parse("cancel"), KillMode::Cancel);
        assert_eq!(KillMode::parse("anything-else"), KillMode::Cancel);
    }

    #[test]
    fn dbx_originated_list_filters_use_app_name_tag() {
        // Guards against CONNECTION_APP_NAME drifting away from the hardcoded
        // `'dbx%'` literals written by postgres::connect / sqlserver::try_connect.
        let needle = format!("'{}%'", crate::db::CONNECTION_APP_NAME);
        for sql in [POSTGRES_LIST_SQL, SQLSERVER_LIST_SQL] {
            assert!(sql.contains(&needle), "list SQL must filter on the app-name tag: {sql}");
        }
    }
}
