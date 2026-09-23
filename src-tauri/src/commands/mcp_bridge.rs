use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::connection::AppState;

const BIND_ADDR: &str = "127.0.0.1:0";
/// Shared secret written next to `mcp-bridge-port`; the npm MCP server reads it
/// (see node-core `readBridgeToken`) and sends it as `Authorization: Bearer`.
const TOKEN_FILE_NAME: &str = "mcp-bridge-token";

#[derive(Deserialize)]
struct OpenTableRequest {
    connection_name: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
}

#[derive(Deserialize)]
struct ExecuteQueryRequest {
    connection_name: String,
    database: Option<String>,
    sql: String,
    schema: Option<String>,
    allow_writes: Option<bool>,
    allow_dangerous: Option<bool>,
}

#[derive(Deserialize)]
struct ListTablesRequest {
    connection_name: String,
    database: Option<String>,
    schema: Option<String>,
}

#[derive(Deserialize)]
struct DescribeTableRequest {
    connection_name: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
}

#[derive(Deserialize)]
struct MongoFindDocumentsRequest {
    connection_name: String,
    database: Option<String>,
    collection: String,
    skip: Option<u64>,
    limit: Option<i64>,
    filter: Option<String>,
    sort: Option<String>,
}

#[derive(Deserialize)]
struct MongoAggregateDocumentsRequest {
    connection_name: String,
    database: Option<String>,
    collection: String,
    pipeline_json: String,
    max_rows: Option<usize>,
    /// Caller-declared policy, enforced server-side (defense in depth on top
    /// of the MCP server's own check). Read-only by default.
    allow_writes: Option<bool>,
    allow_dangerous: Option<bool>,
}

#[derive(Deserialize)]
struct MongoInsertDocumentsRequest {
    connection_name: String,
    database: Option<String>,
    collection: String,
    docs_json: String,
    /// Caller-declared policy, enforced server-side (defense in depth on top
    /// of the MCP server's own check). Read-only by default.
    allow_writes: Option<bool>,
    allow_dangerous: Option<bool>,
}

#[derive(Deserialize)]
struct MongoUpdateDocumentsRequest {
    connection_name: String,
    database: Option<String>,
    collection: String,
    filter_json: String,
    update_json: String,
    many: bool,
    /// Caller-declared policy, enforced server-side (defense in depth on top
    /// of the MCP server's own check). Read-only by default.
    allow_writes: Option<bool>,
    allow_dangerous: Option<bool>,
}

#[derive(Deserialize)]
struct MongoDeleteDocumentsRequest {
    connection_name: String,
    database: Option<String>,
    collection: String,
    filter_json: String,
    many: bool,
    /// Caller-declared policy, enforced server-side (defense in depth on top
    /// of the MCP server's own check). Read-only by default.
    allow_writes: Option<bool>,
    allow_dangerous: Option<bool>,
}

#[derive(Clone, Serialize)]
pub struct McpOpenTableEvent {
    pub connection_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub table: String,
}

#[derive(Clone, Serialize)]
pub struct McpExecuteQueryEvent {
    pub connection_id: String,
    pub database: String,
    pub sql: String,
    pub allow_writes: bool,
    pub allow_dangerous: bool,
}

/// Everything a single bridge connection needs: the shared token for auth, the
/// app state for data routes, and the app handle for event routes. `app` is
/// `None` in tests, where only the token- and state-only routes are exercised.
struct BridgeContext<'a> {
    app: Option<&'a AppHandle>,
    state: &'a Arc<AppState>,
    token: &'a str,
}

pub fn start(app_handle: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        // Fail closed: without the shared secret the bridge serves nothing.
        let token = match state.storage.load_or_create_local_device_secret().await {
            Ok(token) if !token.is_empty() => token,
            _ => {
                log::error!("MCP bridge disabled: failed to load the local device secret");
                return;
            }
        };
        let listener = match TcpListener::bind(BIND_ADDR).await {
            Ok(l) => l,
            Err(e) => {
                log::warn!("MCP bridge failed to bind {BIND_ADDR}: {e}");
                return;
            }
        };
        log::info!("MCP bridge listening on {BIND_ADDR}");
        let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        log::info!("MCP bridge assigned port {actual_port}");
        if let Ok(dir) = app_handle.path().app_data_dir() {
            let _ = std::fs::write(dir.join("mcp-bridge-port"), actual_port.to_string());
            write_token_file(&dir, &token);
        }
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(s) => s,
                Err(_) => continue,
            };
            let app = app_handle.clone();
            let st = state.clone();
            let token = token.clone();
            tokio::spawn(async move {
                let ctx = BridgeContext { app: Some(&app), state: &st, token: &token };
                serve_connection(stream, ctx).await;
            });
        }
    });
}

/// Writes the bridge token with owner-only permissions so the npm MCP server on
/// the same machine can authenticate, while other local users cannot read it.
fn write_token_file(dir: &std::path::Path, token: &str) {
    let path = dir.join(TOKEN_FILE_NAME);
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path)?;
        std::io::Write::write_all(&mut file, token.as_bytes())
    })();
    if let Err(e) = result {
        log::warn!("MCP bridge failed to write {}: {e}", path.display());
    }
}

/// Extracts the token from an `Authorization: Bearer <token>` header.
fn bearer_token(head: &str) -> Option<&str> {
    for line in head.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else { continue };
        if !name.trim().eq_ignore_ascii_case("authorization") {
            continue;
        }
        let mut parts = value.trim().splitn(2, char::is_whitespace);
        let scheme = parts.next().unwrap_or("");
        let token = parts.next().unwrap_or("").trim();
        return if scheme.eq_ignore_ascii_case("bearer") && !token.is_empty() { Some(token) } else { None };
    }
    None
}

/// Length-checked, constant-time comparison so request timing does not leak
/// how much of the token matched.
fn tokens_match(provided: &str, expected: &str) -> bool {
    let (a, b) = (provided.as_bytes(), expected.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn request_is_authorized(head: &str, expected_token: &str) -> bool {
    bearer_token(head).is_some_and(|provided| tokens_match(provided, expected_token))
}

/// Reads one request and serves it: bearer-token auth first (every route),
/// then dispatch. One request per connection, as before.
async fn serve_connection(mut stream: tokio::net::TcpStream, ctx: BridgeContext<'_>) {
    let mut buf = vec![0u8; 65536];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]).into_owned();
    let (head, body) = match request.split_once("\r\n\r\n") {
        Some((head, body)) => (head, body),
        None => (request.as_str(), ""),
    };
    if !request_is_authorized(head, ctx.token) {
        respond_error(&mut stream, "401 Unauthorized", "Missing or invalid bridge token").await;
        return;
    }
    let first_line = head.lines().next().unwrap_or("");

    if first_line.starts_with("POST /open-table") {
        match ctx.app {
            Some(app) => handle_open_table(app, ctx.state, body, &mut stream).await,
            None => respond_error(&mut stream, "503 Service Unavailable", "Desktop event routes are unavailable").await,
        }
    } else if first_line.starts_with("POST /data/list-tables") {
        handle_list_tables_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/describe-table") {
        handle_describe_table_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/mongo/list-collections") {
        handle_mongo_list_collections_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/mongo/find-documents") {
        handle_mongo_find_documents_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/mongo/aggregate-documents") {
        handle_mongo_aggregate_documents_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/mongo/insert-documents") {
        handle_mongo_insert_documents_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/mongo/update-documents") {
        handle_mongo_update_documents_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/mongo/delete-documents") {
        handle_mongo_delete_documents_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /data/execute-query") {
        handle_execute_query_data(ctx.state, body, &mut stream).await;
    } else if first_line.starts_with("POST /execute-query") {
        match ctx.app {
            Some(app) => handle_execute_query(app, ctx.state, body, &mut stream).await,
            None => respond_error(&mut stream, "503 Service Unavailable", "Desktop event routes are unavailable").await,
        }
    } else if first_line.starts_with("POST /reload-connections") {
        if let Some(app) = ctx.app {
            let _ = app.emit("mcp-reload-connections", ());
        }
        respond(&mut stream, "200 OK", "ok").await;
    } else {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
    }
}

fn find_config_by_name<'a>(
    configs: &'a [dbx_core::models::connection::ConnectionConfig],
    name: &str,
) -> Option<&'a dbx_core::models::connection::ConnectionConfig> {
    configs.iter().find(|c| c.name.eq_ignore_ascii_case(name))
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let resp = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    let _ = stream.write_all(resp.as_bytes()).await;
}

async fn respond_json<T: Serialize>(stream: &mut tokio::net::TcpStream, data: &T) {
    let body = serde_json::to_string(data).unwrap_or_else(|_| "null".to_string());
    let resp =
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    let _ = stream.write_all(resp.as_bytes()).await;
}

async fn respond_error(stream: &mut tokio::net::TcpStream, status: &str, message: &str) {
    let body = serde_json::json!({ "error": message }).to_string();
    let resp =
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
    let _ = stream.write_all(resp.as_bytes()).await;
}

async fn resolve_connection(
    state: &Arc<AppState>,
    connection_name: &str,
) -> Result<dbx_core::models::connection::ConnectionConfig, String> {
    let configs = state.storage.load_connections().await.map_err(|e| e.to_string())?;
    let config =
        find_config_by_name(&configs, connection_name).ok_or_else(|| "Connection not found".to_string())?.clone();
    let mut state_configs = state.configs.write().await;
    if !state_configs.contains_key(&config.id) {
        state_configs.insert(config.id.clone(), config.clone());
    }
    drop(state_configs);
    Ok(config)
}

fn check_visible_database(
    config: &dbx_core::models::connection::ConnectionConfig,
    database: &str,
) -> Result<(), String> {
    if let Some(ref visible) = config.visible_databases {
        if !visible.is_empty() && !visible.iter().any(|v| v == database) {
            return Err(format!("Database '{}' is not in the visible databases list for this connection", database));
        }
    }
    Ok(())
}

/// Parses a request body, responding `400 Bad Request` and returning `None` on failure.
async fn parse_request<T: serde::de::DeserializeOwned>(body: &str, stream: &mut tokio::net::TcpStream) -> Option<T> {
    match serde_json::from_str(body) {
        Ok(req) => Some(req),
        Err(_) => {
            respond_error(stream, "400 Bad Request", "Invalid JSON").await;
            None
        }
    }
}

/// Resolves a connection plus its effective database, responding `404`/`403`
/// and returning `None` when the connection is unknown or the database is hidden.
async fn resolve_visible_connection(
    state: &Arc<AppState>,
    connection_name: &str,
    database: Option<String>,
    stream: &mut tokio::net::TcpStream,
) -> Option<(dbx_core::models::connection::ConnectionConfig, String)> {
    let config = match resolve_connection(state, connection_name).await {
        Ok(c) => c,
        Err(e) => {
            respond_error(stream, "404 Not Found", &e).await;
            return None;
        }
    };
    let database = database.unwrap_or_else(|| config.database.clone().unwrap_or_default());
    if let Err(e) = check_visible_database(&config, &database) {
        respond_error(stream, "403 Forbidden", &e).await;
        return None;
    }
    Some((config, database))
}

async fn resolve_mongo_pool_key(
    state: &Arc<AppState>,
    connection_name: &str,
    database: Option<String>,
    stream: &mut tokio::net::TcpStream,
) -> Option<(String, String)> {
    let config = match resolve_connection(state, connection_name).await {
        Ok(c) => c,
        Err(e) => {
            respond_error(stream, "404 Not Found", &e).await;
            return None;
        }
    };
    let database = database.unwrap_or_else(|| config.database.clone().unwrap_or_default());
    let pool_key = match state.get_or_create_pool(&config.id, Some(&database)).await {
        Ok(key) => key,
        Err(e) => {
            respond_error(stream, "500 Internal Server Error", &e).await;
            return None;
        }
    };
    Some((pool_key, database))
}

async fn handle_open_table(app: &AppHandle, state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let req: OpenTableRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(_) => {
            respond(stream, "400 Bad Request", "").await;
            return;
        }
    };
    let configs = match state.storage.load_connections().await {
        Ok(c) => c,
        Err(_) => {
            respond(stream, "500 Internal Server Error", "").await;
            return;
        }
    };
    let Some(config) = find_config_by_name(&configs, &req.connection_name) else {
        respond(stream, "404 Not Found", "Connection not found").await;
        return;
    };
    let event = McpOpenTableEvent {
        connection_id: config.id.clone(),
        database: req.database.unwrap_or_else(|| config.database.clone().unwrap_or_default()),
        schema: req.schema,
        table: req.table,
    };
    let _ = app.emit("mcp-open-table", &event);
    respond(stream, "200 OK", "ok").await;
}

async fn handle_execute_query(app: &AppHandle, state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let req: ExecuteQueryRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(_) => {
            respond(stream, "400 Bad Request", "").await;
            return;
        }
    };
    let configs = match state.storage.load_connections().await {
        Ok(c) => c,
        Err(_) => {
            respond(stream, "500 Internal Server Error", "").await;
            return;
        }
    };
    let Some(config) = find_config_by_name(&configs, &req.connection_name) else {
        respond(stream, "404 Not Found", "Connection not found").await;
        return;
    };
    let event = McpExecuteQueryEvent {
        connection_id: config.id.clone(),
        database: req.database.unwrap_or_else(|| config.database.clone().unwrap_or_default()),
        sql: req.sql,
        allow_writes: req.allow_writes.unwrap_or(false),
        allow_dangerous: req.allow_dangerous.unwrap_or(false),
    };
    let _ = app.emit("mcp-execute-query", &event);
    respond(stream, "200 OK", "ok").await;
}

async fn handle_list_tables_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<ListTablesRequest>(body, stream).await else { return };
    let Some((config, database)) = resolve_visible_connection(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    let schema = req.schema.unwrap_or_default();
    match dbx_core::schema::list_tables_core(state, &config.id, &database, &schema, None, None).await {
        Ok(tables) => respond_json(stream, &tables).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_describe_table_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<DescribeTableRequest>(body, stream).await else { return };
    let Some((config, database)) = resolve_visible_connection(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    let schema = req.schema.unwrap_or_default();
    match dbx_core::schema::get_columns_core(state, &config.id, &database, &schema, &req.table).await {
        Ok(columns) => respond_json(stream, &columns).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_mongo_list_collections_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<ListTablesRequest>(body, stream).await else { return };
    let Some((pool_key, database)) = resolve_mongo_pool_key(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    match dbx_core::mongo_ops::mongo_list_collections_core(state, &pool_key, &database).await {
        Ok(collections) => respond_json(stream, &collections).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_mongo_find_documents_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<MongoFindDocumentsRequest>(body, stream).await else { return };
    let Some((pool_key, database)) = resolve_mongo_pool_key(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    match dbx_core::mongo_ops::mongo_find_documents_core(
        state,
        &pool_key,
        &database,
        &req.collection,
        req.skip.unwrap_or(0),
        req.limit.unwrap_or(100),
        req.filter.as_deref(),
        req.sort.as_deref(),
    )
    .await
    {
        Ok(result) => respond_json(stream, &result).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_mongo_aggregate_documents_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<MongoAggregateDocumentsRequest>(body, stream).await else { return };
    if let Err(reason) = dbx_core::mongo_ops::ensure_mongo_aggregate_allowed(
        &req.pipeline_json,
        req.allow_writes.unwrap_or(false),
        req.allow_dangerous.unwrap_or(false),
    ) {
        respond_error(stream, "403 Forbidden", &reason).await;
        return;
    }
    let Some((pool_key, database)) = resolve_mongo_pool_key(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    match dbx_core::mongo_ops::mongo_aggregate_documents_core(
        state,
        &pool_key,
        &database,
        &req.collection,
        &req.pipeline_json,
        req.max_rows,
    )
    .await
    {
        Ok(result) => respond_json(stream, &result).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_mongo_insert_documents_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<MongoInsertDocumentsRequest>(body, stream).await else { return };
    if let Err(reason) = dbx_core::mongo_ops::ensure_mongo_write_allowed(
        dbx_core::mongo_ops::MongoWriteKind::Insert,
        None,
        req.allow_writes.unwrap_or(false),
        req.allow_dangerous.unwrap_or(false),
    ) {
        respond_error(stream, "403 Forbidden", &reason).await;
        return;
    }
    let Some((pool_key, database)) = resolve_mongo_pool_key(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    match dbx_core::mongo_ops::mongo_insert_documents_core(state, &pool_key, &database, &req.collection, &req.docs_json)
        .await
    {
        Ok(inserted) => respond_json(stream, &serde_json::json!({ "affected_rows": inserted })).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_mongo_update_documents_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<MongoUpdateDocumentsRequest>(body, stream).await else { return };
    if let Err(reason) = dbx_core::mongo_ops::ensure_mongo_write_allowed(
        dbx_core::mongo_ops::MongoWriteKind::Update,
        Some(&req.filter_json),
        req.allow_writes.unwrap_or(false),
        req.allow_dangerous.unwrap_or(false),
    ) {
        respond_error(stream, "403 Forbidden", &reason).await;
        return;
    }
    let Some((pool_key, database)) = resolve_mongo_pool_key(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    match dbx_core::mongo_ops::mongo_update_documents_core(
        state,
        &pool_key,
        &database,
        &req.collection,
        &req.filter_json,
        &req.update_json,
        req.many,
    )
    .await
    {
        Ok(modified) => respond_json(stream, &serde_json::json!({ "affected_rows": modified })).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_mongo_delete_documents_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<MongoDeleteDocumentsRequest>(body, stream).await else { return };
    if let Err(reason) = dbx_core::mongo_ops::ensure_mongo_write_allowed(
        dbx_core::mongo_ops::MongoWriteKind::Delete,
        Some(&req.filter_json),
        req.allow_writes.unwrap_or(false),
        req.allow_dangerous.unwrap_or(false),
    ) {
        respond_error(stream, "403 Forbidden", &reason).await;
        return;
    }
    let Some((pool_key, database)) = resolve_mongo_pool_key(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    match dbx_core::mongo_ops::mongo_delete_documents_core(
        state,
        &pool_key,
        &database,
        &req.collection,
        &req.filter_json,
        req.many,
    )
    .await
    {
        Ok(deleted) => respond_json(stream, &serde_json::json!({ "affected_rows": deleted })).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

async fn handle_execute_query_data(state: &Arc<AppState>, body: &str, stream: &mut tokio::net::TcpStream) {
    let Some(req) = parse_request::<ExecuteQueryRequest>(body, stream).await else { return };
    let Some((config, database)) = resolve_visible_connection(state, &req.connection_name, req.database, stream).await
    else {
        return;
    };
    // Honor the caller-declared policy the same way the sibling `/execute-query`
    // does: read-only by default, writes and schema-destructive statements only
    // when the request explicitly opts in.
    let allow_writes = req.allow_writes.unwrap_or(false);
    let allow_dangerous = req.allow_dangerous.unwrap_or(false);
    if let Err(reason) = dbx_core::query_execution_sql::ensure_sql_execution_allowed(
        &req.sql,
        config.db_type,
        allow_writes,
        allow_dangerous,
    ) {
        respond_error(stream, "403 Forbidden", &reason).await;
        return;
    }
    match dbx_core::query::execute_sql_statement(state, &config.id, &database, &req.sql, req.schema.as_deref(), None)
        .await
    {
        Ok(result) => respond_json(stream, &result).await,
        Err(e) => respond_error(stream, "500 Internal Server Error", &e).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dbx_core::models::connection::ConnectionConfig;
    use dbx_core::storage::Storage;

    const TOKEN: &str = "bridge-test-token";

    async fn test_bridge() -> (std::net::SocketAddr, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("dbx-bridge-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
        let state = Arc::new(AppState::new(storage));

        let db_path = dir.join("bridge-test.db");
        std::fs::File::create(&db_path).unwrap();
        let config: ConnectionConfig = serde_json::from_value(serde_json::json!({
            "id": "bridge-test-conn",
            "name": "bridge-test",
            "db_type": "sqlite",
            "host": db_path.to_str().unwrap(),
            "port": 0,
            "username": "",
            "password": ""
        }))
        .unwrap();
        state.storage.save_connections(&[config]).await.unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let token = Arc::new(TOKEN.to_string());
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let ctx = BridgeContext { app: None, state: &state, token: &token };
                serve_connection(stream, ctx).await;
            }
        });
        (addr, dir)
    }

    async fn post(addr: std::net::SocketAddr, path: &str, token: Option<&str>, body: &str) -> String {
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
        let request =
            format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n{auth}\r\n{body}");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.unwrap();
        String::from_utf8_lossy(&buf).into_owned()
    }

    #[test]
    fn bearer_token_parses_authorization_header() {
        assert_eq!(
            bearer_token("POST /data/execute-query HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc"),
            Some("abc")
        );
        assert_eq!(bearer_token("POST /p HTTP/1.1\r\nauthorization: bearer abc"), Some("abc"));
        assert_eq!(bearer_token("POST /p HTTP/1.1\r\nAuthorization: Bearer   spaced-token  "), Some("spaced-token"));
        assert_eq!(bearer_token("POST /p HTTP/1.1"), None);
        assert_eq!(bearer_token("POST /p HTTP/1.1\r\nAuthorization: Basic abc"), None);
        assert_eq!(bearer_token("POST /p HTTP/1.1\r\nAuthorization: Bearer "), None);
    }

    #[test]
    fn tokens_match_is_exact_and_length_safe() {
        assert!(tokens_match("abc", "abc"));
        assert!(!tokens_match("abc", "abd"));
        assert!(!tokens_match("abc", "abcd"));
        assert!(!tokens_match("", "abc"));
    }

    #[test]
    fn write_token_file_persists_owner_only_secret() {
        let dir = std::env::temp_dir().join(format!("dbx-bridge-token-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        write_token_file(&dir, "secret-token");
        assert_eq!(std::fs::read_to_string(dir.join(TOKEN_FILE_NAME)).unwrap(), "secret-token");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(TOKEN_FILE_NAME)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rejects_requests_without_or_with_wrong_token() {
        let (addr, dir) = test_bridge().await;
        let body = r#"{"connection_name":"bridge-test","sql":"SELECT 1"}"#;
        let missing = post(addr, "/data/execute-query", None, body).await;
        assert!(missing.starts_with("HTTP/1.1 401"), "missing token: {missing}");
        let wrong = post(addr, "/data/execute-query", Some("not-the-token"), body).await;
        assert!(wrong.starts_with("HTTP/1.1 401"), "wrong token: {wrong}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn executes_read_only_sql_with_valid_token() {
        let (addr, dir) = test_bridge().await;
        let body = r#"{"connection_name":"bridge-test","sql":"SELECT 1 AS one"}"#;
        let response = post(addr, "/data/execute-query", Some(TOKEN), body).await;
        assert!(response.starts_with("HTTP/1.1 200"), "read-only with token: {response}");
        assert!(response.contains("\"columns\""), "should return a query result: {response}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn gates_writes_and_dangerous_sql_behind_flags() {
        let (addr, dir) = test_bridge().await;

        // CREATE is a write: blocked without allow_writes, allowed with it.
        let create = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"CREATE TABLE bridge_t (id INTEGER)"}"#,
        )
        .await;
        assert!(create.starts_with("HTTP/1.1 403"), "create without allow_writes: {create}");
        let create_ok = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"CREATE TABLE bridge_t (id INTEGER)","allow_writes":true}"#,
        )
        .await;
        assert!(create_ok.starts_with("HTTP/1.1 200"), "create with allow_writes: {create_ok}");

        // INSERT follows the same gate; read-back of written data stays open.
        let insert = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"INSERT INTO bridge_t VALUES (1)"}"#,
        )
        .await;
        assert!(insert.starts_with("HTTP/1.1 403"), "insert without allow_writes: {insert}");
        let insert_ok = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"INSERT INTO bridge_t VALUES (1)","allow_writes":true}"#,
        )
        .await;
        assert!(insert_ok.starts_with("HTTP/1.1 200"), "insert with allow_writes: {insert_ok}");
        let select = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"SELECT id FROM bridge_t"}"#,
        )
        .await;
        assert!(select.starts_with("HTTP/1.1 200"), "select after writes: {select}");

        // DROP is dangerous: needs allow_writes AND allow_dangerous.
        let drop = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"DROP TABLE bridge_t","allow_writes":true}"#,
        )
        .await;
        assert!(drop.starts_with("HTTP/1.1 403"), "drop without allow_dangerous: {drop}");
        let drop_ok = post(
            addr,
            "/data/execute-query",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","sql":"DROP TABLE bridge_t","allow_writes":true,"allow_dangerous":true}"#,
        )
        .await;
        assert!(drop_ok.starts_with("HTTP/1.1 200"), "drop with both flags: {drop_ok}");
        let _ = std::fs::remove_dir_all(dir);
    }
    #[tokio::test]
    async fn gates_mongo_writes_behind_flags() {
        let (addr, dir) = test_bridge().await;
        let cases = [
            ("/data/mongo/insert-documents", r#""collection":"c","docs_json":"[{\"a\":1}]""#),
            (
                "/data/mongo/update-documents",
                r#""collection":"c","filter_json":"{\"a\":1}","update_json":"{\"$set\":{\"a\":2}}","many":false"#,
            ),
            ("/data/mongo/delete-documents", r#""collection":"c","filter_json":"{\"a\":1}","many":false"#),
        ];
        for (path, fields) in cases {
            let blocked =
                post(addr, path, Some(TOKEN), &format!(r#"{{"connection_name":"bridge-test",{fields}}}"#)).await;
            assert!(blocked.starts_with("HTTP/1.1 403"), "{path} without allow_writes: {blocked}");
            // With the flag the gate passes; the (SQLite) test connection then
            // fails as "not a MongoDB connection", which is not a 403.
            let allowed = post(
                addr,
                path,
                Some(TOKEN),
                &format!(r#"{{"connection_name":"bridge-test",{fields},"allow_writes":true}}"#),
            )
            .await;
            assert!(!allowed.starts_with("HTTP/1.1 403"), "{path} with allow_writes: {allowed}");
        }

        // An unfiltered delete also needs allow_dangerous.
        let unfiltered = post(
            addr,
            "/data/mongo/delete-documents",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","collection":"c","filter_json":"{}","many":true,"allow_writes":true}"#,
        )
        .await;
        assert!(unfiltered.starts_with("HTTP/1.1 403"), "unfiltered delete without allow_dangerous: {unfiltered}");

        // Aggregates writing via $out need both flags; plain pipelines stay open.
        let out = post(
            addr,
            "/data/mongo/aggregate-documents",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","collection":"c","pipeline_json":"[{\"$out\":\"copy\"}]","allow_writes":true}"#,
        )
        .await;
        assert!(out.starts_with("HTTP/1.1 403"), "$out without allow_dangerous: {out}");
        let read = post(
            addr,
            "/data/mongo/aggregate-documents",
            Some(TOKEN),
            r#"{"connection_name":"bridge-test","collection":"c","pipeline_json":"[{\"$match\":{}}]"}"#,
        )
        .await;
        assert!(!read.starts_with("HTTP/1.1 403"), "read-only aggregate: {read}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
