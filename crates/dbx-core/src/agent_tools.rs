//! Tool registry and dispatch for the server-side agent loop.
//!
//! Each tool is a thin wrapper over an existing `dbx-core` primitive (schema
//! listing, query execution, explain-plan building). Tools return their result
//! as LLM-facing text; `explain_query` additionally attaches a structured
//! `QueryResult` (`explain_data`) for the frontend ExplainPlanViewer.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::agent_events::{ToolCall, ToolDefinition, ToolResult};
use crate::connection::AppState;
use crate::models::connection::DatabaseType;
use crate::query::{self, QueryExecutionOptions};
use crate::query_execution_sql::{build_explain_sql, supports_explain_plan, supports_sql_query, ExplainSqlOptions};
use crate::schema;
use crate::sql_dialect::{build_table_select_sql, TableSelectSqlOptions};
use crate::types::QueryResult;

/// Tables returned by `list_tables` (one extra is requested to detect overflow).
const LIST_TABLES_LIMIT: usize = 200;
/// Default row cap for `execute_query`.
const EXECUTE_QUERY_LIMIT: usize = 50;
/// Default row cap for `get_sample_data`.
const SAMPLE_DATA_LIMIT: usize = 20;
/// Hard cap on any model-supplied `limit`.
const MAX_ALLOWED_ROWS: usize = 100;
/// Per-cell character cap when rendering a result as text (char-safe truncation).
const MAX_CELL_CHARS: usize = 200;

/// Tools available in Ask mode (metadata only — never mutate, never execute SQL).
pub fn read_only_tools() -> Vec<ToolDefinition> {
    vec![list_tables_tool(), get_columns_tool()]
}

/// Tools available in Agent mode for the given database type. SQL execution tools
/// are gated to SQL stores; `explain_query` is gated to engines that support EXPLAIN.
pub fn all_tools(db_type: DatabaseType) -> Vec<ToolDefinition> {
    let mut tools = vec![list_tables_tool(), get_columns_tool()];
    if supports_sql_query(db_type) {
        tools.push(execute_query_tool());
        tools.push(get_sample_data_tool());
    }
    if supports_explain_plan(Some(db_type)) {
        tools.push(explain_query_tool());
    }
    tools
}

fn list_tables_tool() -> ToolDefinition {
    ToolDefinition {
        name: "list_tables",
        description: "List the tables and views in the current database (optionally within a specific schema).",
        parameters: json!({
            "type": "object",
            "properties": {
                "schema": { "type": "string", "description": "Schema to list (defaults to the current database/schema)" }
            },
            "required": []
        }),
        read_only: true,
        parallel_ok: true,
    }
}

fn get_columns_tool() -> ToolDefinition {
    ToolDefinition {
        name: "get_columns",
        description: "Get the columns of a table: name, type, nullability, primary key, default, and comment.",
        parameters: json!({
            "type": "object",
            "properties": {
                "table": { "type": "string", "description": "Table name" },
                "schema": { "type": "string", "description": "Schema (defaults to the current database/schema)" }
            },
            "required": ["table"]
        }),
        read_only: true,
        parallel_ok: true,
    }
}

fn execute_query_tool() -> ToolDefinition {
    ToolDefinition {
        name: "execute_query",
        description: "Execute a SQL query and return the rows. Read-only queries run immediately; statements that \
                      modify data or schema require the user's explicit confirmation before they run.",
        parameters: json!({
            "type": "object",
            "properties": {
                "sql": { "type": "string", "description": "The SQL statement to execute" },
                "limit": { "type": "integer", "description": "Max rows to return (capped at 100)" }
            },
            "required": ["sql"]
        }),
        read_only: false,
        parallel_ok: false,
    }
}

fn get_sample_data_tool() -> ToolDefinition {
    ToolDefinition {
        name: "get_sample_data",
        description: "Fetch a small sample of rows from a table to understand its data.",
        parameters: json!({
            "type": "object",
            "properties": {
                "table": { "type": "string", "description": "Table name" },
                "schema": { "type": "string", "description": "Schema (defaults to the current database/schema)" },
                "limit": { "type": "integer", "description": "Number of rows (capped at 100)" }
            },
            "required": ["table"]
        }),
        read_only: true,
        parallel_ok: true,
    }
}

fn explain_query_tool() -> ToolDefinition {
    ToolDefinition {
        name: "explain_query",
        description: "Get the execution plan for a read-only SQL query using EXPLAIN (scan type, indexes, cost). \
                      Use this to analyze query performance and suggest index optimizations.",
        parameters: json!({
            "type": "object",
            "properties": {
                "sql": { "type": "string", "description": "The read-only SQL query to explain" }
            },
            "required": ["sql"]
        }),
        read_only: true,
        parallel_ok: true,
    }
}

/// Execute a single tool call and return its result. Errors are converted to a
/// non-panicking `ToolResult { is_error: true }` so the model can recover.
pub async fn execute_tool(
    tool_call: &ToolCall,
    state: &Arc<AppState>,
    connection_id: &str,
    database: &str,
    db_type: &DatabaseType,
) -> ToolResult {
    if tool_call.name == "explain_query" {
        let (text, explain_data) = execute_explain_query(tool_call, state, connection_id, database, db_type).await;
        return match text {
            Ok(content) => ToolResult { explain_data, ..ToolResult::ok(tool_call, content) },
            Err(err) => ToolResult::error(tool_call, err),
        };
    }

    let result = match tool_call.name.as_str() {
        "list_tables" => execute_list_tables(tool_call, state, connection_id, database).await,
        "get_columns" => execute_get_columns(tool_call, state, connection_id, database).await,
        "execute_query" => execute_execute_query(tool_call, state, connection_id, database).await,
        "get_sample_data" => execute_get_sample_data(tool_call, state, connection_id, database, db_type).await,
        other => Err(format!("Unknown tool: {other}")),
    };

    match result {
        Ok(content) => ToolResult::ok(tool_call, content),
        Err(err) => ToolResult::error(tool_call, err),
    }
}

fn arg_str<'a>(tool_call: &'a ToolCall, key: &str) -> Option<&'a str> {
    tool_call.arguments.get(key).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())
}

fn requested_limit(tool_call: &ToolCall, default: usize) -> usize {
    tool_call
        .arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|v| (v as usize).min(MAX_ALLOWED_ROWS))
        .filter(|v| *v > 0)
        .unwrap_or(default)
}

fn validate_table_name(table: &str) -> Result<(), String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("table name cannot be empty".to_string());
    }
    if table.len() > 256 {
        return Err("table name is too long".to_string());
    }
    if table.contains([';', '\'', '"', '`']) {
        return Err("table name contains illegal characters".to_string());
    }
    Ok(())
}

async fn execute_list_tables(
    tool_call: &ToolCall,
    state: &Arc<AppState>,
    connection_id: &str,
    database: &str,
) -> Result<String, String> {
    let schema = arg_str(tool_call, "schema").unwrap_or(database);
    let tables =
        schema::list_tables_core(state, connection_id, database, schema, None, Some(LIST_TABLES_LIMIT + 1)).await?;
    if tables.is_empty() {
        return Ok("(no tables found)".to_string());
    }

    let overflow = tables.len() > LIST_TABLES_LIMIT;
    let mut lines: Vec<String> = tables
        .iter()
        .take(LIST_TABLES_LIMIT)
        .map(|t| {
            let mut line = format!("- {} ({})", t.name, t.table_type);
            if let Some(comment) = t.comment.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
                line.push_str(&format!(" -- {comment}"));
            }
            line
        })
        .collect();
    if overflow {
        lines.push(format!("... (truncated to first {LIST_TABLES_LIMIT})"));
    }
    Ok(lines.join("\n"))
}

async fn execute_get_columns(
    tool_call: &ToolCall,
    state: &Arc<AppState>,
    connection_id: &str,
    database: &str,
) -> Result<String, String> {
    let table = arg_str(tool_call, "table").ok_or("Missing required parameter: table")?;
    validate_table_name(table)?;
    let schema = arg_str(tool_call, "schema").unwrap_or(database);

    let columns = schema::get_columns_core(state, connection_id, database, schema, table).await?;
    if columns.is_empty() {
        return Ok(format!("(no columns found for {table})"));
    }

    let lines: Vec<String> = columns
        .iter()
        .map(|c| {
            let mut flags = Vec::new();
            if c.is_primary_key {
                flags.push("PK".to_string());
            }
            flags.push(if c.is_nullable { "nullable".to_string() } else { "NOT NULL".to_string() });
            if let Some(default) = c.column_default.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                flags.push(format!("default {default}"));
            }
            let mut line = format!("- {}: {} ({})", c.name, c.data_type, flags.join(", "));
            if let Some(comment) = c.comment.as_deref().map(str::trim).filter(|cm| !cm.is_empty()) {
                line.push_str(&format!(" -- {comment}"));
            }
            line
        })
        .collect();
    Ok(lines.join("\n"))
}

async fn execute_execute_query(
    tool_call: &ToolCall,
    state: &Arc<AppState>,
    connection_id: &str,
    database: &str,
) -> Result<String, String> {
    let sql = arg_str(tool_call, "sql").ok_or("Missing required parameter: sql")?;
    let limit = requested_limit(tool_call, EXECUTE_QUERY_LIMIT);
    let options = QueryExecutionOptions { max_rows: Some(limit), timeout_secs: Some(30), ..Default::default() };
    let result =
        query::execute_sql_statement_with_options(state, connection_id, database, sql, None, None, options).await?;
    Ok(format_query_result_as_text(&result, limit))
}

async fn execute_get_sample_data(
    tool_call: &ToolCall,
    state: &Arc<AppState>,
    connection_id: &str,
    database: &str,
    db_type: &DatabaseType,
) -> Result<String, String> {
    let table = arg_str(tool_call, "table").ok_or("Missing required parameter: table")?;
    validate_table_name(table)?;
    let schema = arg_str(tool_call, "schema").or(Some(database));
    let limit = requested_limit(tool_call, SAMPLE_DATA_LIMIT);

    let sql = build_table_select_sql(TableSelectSqlOptions {
        database_type: Some(*db_type),
        schema,
        table_name: table,
        columns: &[],
        order_columns: &[],
        limit,
    });
    let options = QueryExecutionOptions { max_rows: Some(limit), timeout_secs: Some(30), ..Default::default() };
    let result =
        query::execute_sql_statement_with_options(state, connection_id, database, &sql, None, None, options).await?;
    Ok(format_query_result_as_text(&result, limit))
}

/// Returns `(text_for_llm, explain_data_for_frontend)`.
async fn execute_explain_query(
    tool_call: &ToolCall,
    state: &Arc<AppState>,
    connection_id: &str,
    database: &str,
    db_type: &DatabaseType,
) -> (Result<String, String>, Option<Value>) {
    let Some(sql) = arg_str(tool_call, "sql") else {
        return (Err("Missing required parameter: sql".to_string()), None);
    };

    // build_explain_sql validates that `sql` is a safe read-only statement.
    let built = build_explain_sql(ExplainSqlOptions { database_type: Some(*db_type), sql: sql.to_string() });
    let explain_sql = match (built.ok, built.sql) {
        (true, Some(s)) => s,
        _ => {
            let reason = built.reason.unwrap_or_else(|| "unsupported".to_string());
            return (
                Err(format!("Cannot explain this query: {reason}. Only read-only queries can be analyzed.")),
                None,
            );
        }
    };

    let options =
        QueryExecutionOptions { max_rows: Some(MAX_ALLOWED_ROWS), timeout_secs: Some(30), ..Default::default() };
    let result = match query::execute_sql_statement_with_options(
        state,
        connection_id,
        database,
        &explain_sql,
        None,
        None,
        options,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return (Err(e), None),
    };

    let explain_data = serde_json::to_value(&result).ok();
    (Ok(format_query_result_as_text(&result, MAX_ALLOWED_ROWS)), explain_data)
}

/// Render a `QueryResult` as a compact Markdown table for the model.
fn format_query_result_as_text(result: &QueryResult, max_rows: usize) -> String {
    if result.columns.is_empty() {
        return format!(
            "(no columns returned; {} affected rows, {}ms)",
            result.affected_rows, result.execution_time_ms
        );
    }

    let mut out = String::new();
    out.push_str(&format!("| {} |\n", result.columns.join(" | ")));
    out.push_str(&format!("|{}|\n", result.columns.iter().map(|_| " --- ").collect::<String>()));

    let shown = result.rows.len().min(max_rows);
    for row in result.rows.iter().take(shown) {
        let cells: Vec<String> = (0..result.columns.len())
            .map(|i| truncate_cell(&value_to_cell(row.get(i).unwrap_or(&Value::Null))))
            .collect();
        out.push_str(&format!("| {} |\n", cells.join(" | ")));
    }

    let mut footer = format!("({} rows", result.rows.len());
    if result.rows.len() > shown {
        footer.push_str(&format!(", showing first {shown}"));
    }
    footer.push_str(&format!(", {}ms)", result.execution_time_ms));
    out.push_str(&footer);
    out
}

fn value_to_cell(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn truncate_cell(text: &str) -> String {
    let cleaned = text.replace('\n', " ").replace('|', "\\|");
    if cleaned.chars().count() <= MAX_CELL_CHARS {
        return cleaned;
    }
    let mut truncated: String = cleaned.chars().take(MAX_CELL_CHARS).collect();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ask_mode_tools_are_metadata_only() {
        let names: Vec<&str> = read_only_tools().iter().map(|t| t.name).collect();
        assert_eq!(names, vec!["list_tables", "get_columns"]);
    }

    #[test]
    fn agent_tools_gated_by_database_type() {
        let mysql: Vec<&str> = all_tools(DatabaseType::Mysql).iter().map(|t| t.name).collect();
        assert_eq!(mysql, vec!["list_tables", "get_columns", "execute_query", "get_sample_data", "explain_query"]);

        // SQLite supports SQL but not EXPLAIN-plan parsing here.
        let sqlite: Vec<&str> = all_tools(DatabaseType::Sqlite).iter().map(|t| t.name).collect();
        assert_eq!(sqlite, vec!["list_tables", "get_columns", "execute_query", "get_sample_data"]);

        // Redis is non-SQL: only metadata tools.
        let redis: Vec<&str> = all_tools(DatabaseType::Redis).iter().map(|t| t.name).collect();
        assert_eq!(redis, vec!["list_tables", "get_columns"]);
    }

    #[test]
    fn execute_query_is_the_only_sequential_tool() {
        for tool in all_tools(DatabaseType::Mysql) {
            let expected_parallel = tool.name != "execute_query";
            assert_eq!(tool.parallel_ok, expected_parallel, "tool {}", tool.name);
        }
    }

    #[test]
    fn table_name_validation_rejects_injection() {
        assert!(validate_table_name("users").is_ok());
        assert!(validate_table_name("").is_err());
        assert!(validate_table_name("users; DROP TABLE x").is_err());
        assert!(validate_table_name("a\"b").is_err());
    }

    #[test]
    fn renders_result_as_markdown_table_with_footer() {
        let result = QueryResult {
            columns: vec!["id".to_string(), "name".to_string()],
            column_types: vec![],
            rows: vec![vec![json!(1), json!("alice")], vec![json!(2), json!(null)]],
            affected_rows: 0,
            execution_time_ms: 5,
            truncated: false,
            session_id: None,
            has_more: false,
        };
        let text = format_query_result_as_text(&result, 10);
        assert!(text.contains("| id | name |"));
        assert!(text.contains("| 1 | alice |"));
        assert!(text.contains("| 2 | NULL |"));
        assert!(text.contains("(2 rows, 5ms)"));
    }

    #[test]
    fn truncates_long_cells_char_safely() {
        let long = "字".repeat(MAX_CELL_CHARS + 50);
        let out = truncate_cell(&long);
        assert_eq!(out.chars().count(), MAX_CELL_CHARS + 1); // +1 for the ellipsis
        assert!(out.ends_with('…'));
    }
}
