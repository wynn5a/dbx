use crate::connection::{AppState, PoolKind};
use crate::db::agent_driver::mongo_document_id_params;
use crate::db::elasticsearch_driver;
use crate::db::mongo_driver::{self, MongoDocumentResult};

fn sort_names(mut names: Vec<String>) -> Vec<String> {
    names.sort_by(|left, right| {
        let left_lower = left.to_lowercase();
        let right_lower = right.to_lowercase();
        left_lower.cmp(&right_lower).then_with(|| left.cmp(right))
    });
    names
}

pub async fn mongo_list_databases_core(state: &AppState, connection_id: &str) -> Result<Vec<String>, String> {
    let fallback_database = configured_mongo_database(state, connection_id).await;
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => match mongo_driver::list_databases(client).await {
            Ok(databases) => Ok(sort_names(databases)),
            Err(error) if mongo_list_databases_unauthorized(&error) => {
                fallback_mongo_database(&error, fallback_database)
            }
            Err(error) => Err(error),
        },
        PoolKind::Elasticsearch(_) => Ok(vec!["default".to_string()]),
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            match client.mongo_list_databases::<Vec<serde_json::Value>>().await {
                Ok(result) => {
                    Ok(sort_names(result.iter().filter_map(|v| v.get("name")?.as_str().map(String::from)).collect()))
                }
                Err(error) if mongo_list_databases_unauthorized(&error) => {
                    fallback_mongo_database(&error, fallback_database)
                }
                Err(error) => Err(error),
            }
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

async fn configured_mongo_database(state: &AppState, connection_id: &str) -> Option<String> {
    let configs = state.configs.read().await;
    configs.get(connection_id).and_then(|config| config.effective_database().map(str::to_string))
}

fn fallback_mongo_database(error: &str, fallback_database: Option<String>) -> Result<Vec<String>, String> {
    fallback_database.map(|database| vec![database]).ok_or_else(|| error.to_string())
}

fn mongo_list_databases_unauthorized(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("not authorized") && lower.contains("listdatabases")
}

pub async fn mongo_list_collections_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
) -> Result<Vec<String>, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::list_collections(client, database).await.map(sort_names),
        PoolKind::Elasticsearch(client) => elasticsearch_driver::list_indices(client).await.map(sort_names),
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            client.mongo_list_collections(database).await.map(sort_names)
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn mongo_find_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    skip: u64,
    limit: i64,
    filter: Option<&str>,
    sort: Option<&str>,
) -> Result<MongoDocumentResult, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::find_documents(client, database, collection, skip, limit, filter, sort).await
        }
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::find_documents(&client, collection, skip, limit).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            client
                .mongo_find_documents(serde_json::json!({
                    "database": database,
                    "collection": collection,
                    "skip": skip,
                    "limit": limit,
                    "filter": filter,
                    "sort": sort,
                }))
                .await
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_aggregate_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    pipeline_json: &str,
    max_rows: Option<usize>,
) -> Result<MongoDocumentResult, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::aggregate_documents(client, database, collection, pipeline_json, max_rows).await
        }
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support aggregate".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

pub async fn mongo_insert_document_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    doc_json: &str,
) -> Result<String, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::insert_document(client, database, collection, doc_json).await,
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::insert_document(&client, collection, doc_json).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: serde_json::Value = client
                .mongo_insert_document(serde_json::json!({
                    "database": database,
                    "collection": collection,
                    "doc_json": doc_json,
                }))
                .await?;
            Ok(result.get("inserted_id").and_then(|v| v.as_str()).unwrap_or("").to_string())
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_insert_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    docs_json: &str,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::insert_documents(client, database, collection, docs_json).await,
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support bulk insertMany/insertOne writes".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

pub async fn mongo_update_document_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    id: &str,
    doc_json: &str,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::update_document(client, database, collection, id, doc_json).await,
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::update_document(&client, collection, id, doc_json).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: serde_json::Value = client
                .mongo_update_document(serde_json::json!({
                    "database": database,
                    "collection": collection,
                    "id": id,
                    "doc_json": doc_json,
                }))
                .await?;
            Ok(result.get("modified_count").and_then(|v| v.as_u64()).unwrap_or(0))
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_update_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter_json: &str,
    update_json: &str,
    many: bool,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::update_documents(client, database, collection, filter_json, update_json, many).await
        }
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support bulk updateOne/updateMany writes".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

pub async fn mongo_delete_document_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    id: &str,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => mongo_driver::delete_document(client, database, collection, id).await,
        PoolKind::Elasticsearch(client) => {
            let client = client.clone();
            drop(connections);
            elasticsearch_driver::delete_document(&client, collection, id).await
        }
        PoolKind::Agent(client) => {
            let mut client = client.lock().await;
            let result: serde_json::Value =
                client.mongo_delete_document(mongo_document_id_params(database, collection, id)).await?;
            Ok(result.get("deleted_count").and_then(|v| v.as_u64()).unwrap_or(0))
        }
        _ => Err("Not a MongoDB/Elasticsearch connection".to_string()),
    }
}

pub async fn mongo_delete_documents_core(
    state: &AppState,
    connection_id: &str,
    database: &str,
    collection: &str,
    filter_json: &str,
    many: bool,
) -> Result<u64, String> {
    let connections = state.connections.read().await;
    match connections.get(connection_id).ok_or("Not found")? {
        PoolKind::MongoDb(client) => {
            mongo_driver::delete_documents(client, database, collection, filter_json, many).await
        }
        PoolKind::Agent(_) => Err("MongoDB legacy agent does not support bulk deleteOne/deleteMany writes".to_string()),
        _ => Err("Not a MongoDB connection".to_string()),
    }
}

/// Which MongoDB write a caller without an interactive confirmation (the MCP
/// bridge) is about to run; see [ensure_mongo_write_allowed].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MongoWriteKind {
    Insert,
    /// Update/delete carry the filter they apply to.
    Update,
    Delete,
}

fn is_empty_json_object(json: &str) -> bool {
    matches!(serde_json::from_str::<serde_json::Value>(json), Ok(serde_json::Value::Object(map)) if map.is_empty())
}

/// Server-side write gate for MongoDB writes, mirroring node-core's
/// `evaluateMongoWriteSafety`: writes need `allow_writes`; an update/delete
/// with an empty filter (touches every document) additionally needs
/// `allow_dangerous`. The `Err` payload is a user-facing reason string.
pub fn ensure_mongo_write_allowed(
    kind: MongoWriteKind,
    filter_json: Option<&str>,
    allow_writes: bool,
    allow_dangerous: bool,
) -> Result<(), String> {
    if !allow_writes {
        return Err(
            "MongoDB write is blocked. Re-send the request with allow_writes=true to run it; the bridge is read-only by default."
                .to_string(),
        );
    }
    let unfiltered = matches!(kind, MongoWriteKind::Update | MongoWriteKind::Delete)
        && filter_json.is_some_and(is_empty_json_object);
    if unfiltered && !allow_dangerous {
        return Err(
            "MongoDB update/delete with an empty filter is blocked. Re-send the request with allow_dangerous=true to run it."
                .to_string(),
        );
    }
    Ok(())
}

/// The first `$out`/`$merge` stage of an aggregate pipeline, if any — those
/// stages write data.
pub fn mongo_aggregate_write_stage(pipeline_json: &str) -> Option<&'static str> {
    let Ok(serde_json::Value::Array(stages)) = serde_json::from_str::<serde_json::Value>(pipeline_json) else {
        return None;
    };
    stages.iter().filter_map(serde_json::Value::as_object).find_map(|stage| {
        if stage.contains_key("$out") {
            Some("$out")
        } else if stage.contains_key("$merge") {
            Some("$merge")
        } else {
            None
        }
    })
}

/// Server-side gate for aggregates, mirroring node-core's
/// `evaluateMongoAggregateSafety`: read-only pipelines always pass; a
/// `$out`/`$merge` stage needs both `allow_writes` and `allow_dangerous`.
pub fn ensure_mongo_aggregate_allowed(
    pipeline_json: &str,
    allow_writes: bool,
    allow_dangerous: bool,
) -> Result<(), String> {
    let Some(stage) = mongo_aggregate_write_stage(pipeline_json) else {
        return Ok(());
    };
    if !allow_writes || !allow_dangerous {
        return Err(format!(
            "MongoDB aggregate stage \"{stage}\" writes data. Re-send the request with allow_writes=true and allow_dangerous=true to run it."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{fallback_mongo_database, mongo_list_databases_unauthorized, sort_names};

    #[test]
    fn sorts_names_case_insensitively() {
        let sorted = sort_names(vec![
            "movies".to_string(),
            "Comments".to_string(),
            "users".to_string(),
            "embedded_movies".to_string(),
        ]);

        assert_eq!(sorted, vec!["Comments", "embedded_movies", "movies", "users"]);
    }

    #[test]
    fn detects_mongo_list_databases_unauthorized_errors() {
        assert!(mongo_list_databases_unauthorized(
            "Command failed with error 13 (Unauthorized): not authorized on admin to execute command { listDatabases: 1 }",
        ));
        assert!(!mongo_list_databases_unauthorized("not authorized to execute command { find: \"orders\" }"));
    }

    #[test]
    fn falls_back_to_configured_mongo_database() {
        assert_eq!(
            fallback_mongo_database("not authorized", Some("app".to_string())).unwrap(),
            vec!["app".to_string()],
        );
        assert_eq!(fallback_mongo_database("not authorized", None).unwrap_err(), "not authorized");
    }

    #[test]
    fn mongo_writes_need_allow_writes_and_unfiltered_ones_allow_dangerous() {
        use super::{ensure_mongo_write_allowed, MongoWriteKind};
        assert!(ensure_mongo_write_allowed(MongoWriteKind::Insert, None, false, false).is_err());
        assert!(ensure_mongo_write_allowed(MongoWriteKind::Insert, None, true, false).is_ok());
        assert!(ensure_mongo_write_allowed(MongoWriteKind::Update, Some(r#"{"a":1}"#), false, true).is_err());
        assert!(ensure_mongo_write_allowed(MongoWriteKind::Update, Some(r#"{"a":1}"#), true, false).is_ok());
        assert!(ensure_mongo_write_allowed(MongoWriteKind::Delete, Some("{}"), true, false).is_err());
        assert!(ensure_mongo_write_allowed(MongoWriteKind::Delete, Some(" { } "), true, true).is_ok());
    }

    #[test]
    fn mongo_aggregate_write_stages_need_both_flags() {
        use super::{ensure_mongo_aggregate_allowed, mongo_aggregate_write_stage};
        assert_eq!(mongo_aggregate_write_stage(r#"[{"$match":{}},{"$out":"copy"}]"#), Some("$out"));
        assert_eq!(mongo_aggregate_write_stage(r#"[{"$merge":{"into":"x"}}]"#), Some("$merge"));
        assert_eq!(mongo_aggregate_write_stage(r#"[{"$match":{"$out":1}}]"#), None);
        assert_eq!(mongo_aggregate_write_stage("not json"), None);
        assert!(ensure_mongo_aggregate_allowed(r#"[{"$match":{}}]"#, false, false).is_ok());
        assert!(ensure_mongo_aggregate_allowed(r#"[{"$out":"copy"}]"#, true, false).is_err());
        assert!(ensure_mongo_aggregate_allowed(r#"[{"$out":"copy"}]"#, true, true).is_ok());
    }
}
