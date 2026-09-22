//! Live 对照 test for improvement-plan B1: the bulk completion-metadata
//! listing must return exactly what the per-schema `list_tables` /
//! `list_completion_objects` calls return, across multiple schemas, using one
//! `n.nspname = ANY($1)` query per listing instead of one query per schema.
//!
//! Run with a writable PostgreSQL (T02/T03 used a throwaway Docker PG16):
//!   DBX_TEST_POSTGRES_URL=postgres://... cargo test -p dbx-core \
//!     --test live_postgres_completion_metadata -- --ignored

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-pg-bulk-meta";
const DATABASE: &str = "postgres";
const SCHEMA_A: &str = "dbx_bulk_a";
const SCHEMA_B: &str = "dbx_bulk_b";

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
    let dir = std::env::temp_dir().join(format!("dbx-live-pg-bulk-meta-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let storage = Storage::open(&dir.join("storage.db")).await.unwrap();
    let state = Arc::new(AppState::new(storage));
    state.configs.write().await.insert(CONNECTION_ID.to_string(), config_from_url(CONNECTION_ID, url));
    state
}

fn json_of<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).expect("serialize for comparison")
}

#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a writable PostgreSQL database"]
async fn live_postgres_bulk_completion_metadata_matches_per_schema_queries() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let state = app_state(&url).await;
    let pool = dbx_core::db::postgres::connect(&url, Duration::from_secs(5)).await.expect("connect fixture pool");

    {
        let client = pool.get().await.expect("fixture client");
        client
            .batch_execute(&format!(
                "DROP SCHEMA IF EXISTS {SCHEMA_A} CASCADE;
                 DROP SCHEMA IF EXISTS {SCHEMA_B} CASCADE;
                 CREATE SCHEMA {SCHEMA_A};
                 CREATE TABLE {SCHEMA_A}.items (id INT PRIMARY KEY, label TEXT);
                 CREATE TABLE {SCHEMA_A}.item_tags (item_id INT, tag TEXT);
                 CREATE VIEW {SCHEMA_A}.active_items AS SELECT id, label FROM {SCHEMA_A}.items;
                 CREATE SCHEMA {SCHEMA_B};
                 CREATE TABLE {SCHEMA_B}.orders (id INT PRIMARY KEY, total NUMERIC);
                 CREATE FUNCTION {SCHEMA_B}.next_order_no() RETURNS INT AS $$ SELECT 1 $$ LANGUAGE SQL;"
            ))
            .await
            .expect("create fixtures");
    }

    let schemas = vec![SCHEMA_A.to_string(), SCHEMA_B.to_string()];

    // Unfiltered bulk vs per-schema calls.
    let bulk = dbx_core::schema::list_completion_metadata_core(&state, CONNECTION_ID, DATABASE, &schemas, None, None)
        .await
        .expect("bulk metadata");
    assert_eq!(bulk.len(), schemas.len(), "one group per requested schema, in request order");
    for (index, group) in bulk.iter().enumerate() {
        assert_eq!(group.schema, schemas[index]);
        let tables = dbx_core::schema::list_tables_core(&state, CONNECTION_ID, DATABASE, &schemas[index], None, None)
            .await
            .expect("per-schema tables");
        let objects = dbx_core::schema::list_completion_objects_core(&state, CONNECTION_ID, DATABASE, &schemas[index])
            .await
            .expect("per-schema objects");
        assert_eq!(json_of(&group.tables), json_of(&tables), "tables must match for {}", group.schema);
        assert_eq!(json_of(&group.objects), json_of(&objects), "objects must match for {}", group.schema);
    }

    let group_a = &bulk[0];
    assert!(group_a.tables.iter().any(|table| table.name == "items" && table.table_type == "BASE TABLE"));
    assert!(group_a.tables.iter().any(|table| table.name == "active_items" && table.table_type == "VIEW"));
    let group_b = &bulk[1];
    assert!(group_b.tables.iter().any(|table| table.name == "orders"));
    assert!(
        group_b.objects.iter().any(|object| object.name == "next_order_no" && object.object_type == "FUNCTION"),
        "routines must survive the bulk path"
    );

    // Filtered + limited bulk vs the same per-schema call: identical semantics.
    let filtered = dbx_core::schema::list_completion_metadata_core(
        &state,
        CONNECTION_ID,
        DATABASE,
        &schemas,
        Some("ITEM"),
        Some(1),
    )
    .await
    .expect("filtered bulk metadata");
    for (index, group) in filtered.iter().enumerate() {
        let tables =
            dbx_core::schema::list_tables_core(&state, CONNECTION_ID, DATABASE, &schemas[index], Some("ITEM"), Some(1))
                .await
                .expect("filtered per-schema tables");
        assert_eq!(json_of(&group.tables), json_of(&tables), "filtered tables must match for {}", group.schema);
    }
    assert_eq!(filtered[0].tables.len(), 1, "limit applied per schema");

    {
        let client = pool.get().await.expect("teardown client");
        client
            .batch_execute(&format!(
                "DROP SCHEMA IF EXISTS {SCHEMA_A} CASCADE; DROP SCHEMA IF EXISTS {SCHEMA_B} CASCADE;"
            ))
            .await
            .expect("teardown fixtures");
    }
    println!("live PostgreSQL bulk completion metadata matches the per-schema queries");
}
