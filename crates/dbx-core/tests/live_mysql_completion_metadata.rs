//! Live 对照 test for improvement-plan B1: the bulk completion-metadata
//! listing must return exactly what the per-schema `list_tables` /
//! `list_completion_objects` calls return, across multiple databases, using
//! one `TABLE_SCHEMA IN (...)` query per listing instead of one per schema.
//!
//! Run with a writable MySQL server (T02/T03 used a throwaway Docker mysql:8):
//!   DBX_TEST_MYSQL_URL=mysql://user:pass@host:port/db cargo test -p dbx-core \
//!     --test live_mysql_completion_metadata -- --ignored

use std::sync::Arc;
use std::time::Duration;

use dbx_core::connection::AppState;
use dbx_core::models::connection::{ConnectionConfig, DatabaseType};
use dbx_core::storage::Storage;

const CONNECTION_ID: &str = "live-mysql-bulk-meta";
const DATABASE_A: &str = "dbx_bulk_a";
const DATABASE_B: &str = "dbx_bulk_b";

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

async fn app_state(url: &str) -> Arc<AppState> {
    let dir = std::env::temp_dir().join(format!("dbx-live-mysql-bulk-meta-{}", uuid::Uuid::new_v4()));
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
#[ignore = "requires DBX_TEST_MYSQL_URL (mysql://user:pass@host:port/db) pointing at a MySQL server"]
async fn live_mysql_bulk_completion_metadata_matches_per_schema_queries() {
    let url = std::env::var("DBX_TEST_MYSQL_URL").expect("DBX_TEST_MYSQL_URL");
    let state = app_state(&url).await;
    let pool = dbx_core::db::mysql::connect(&url, Duration::from_secs(5)).await.expect("connect fixture pool");

    dbx_core::db::mysql::execute_query(
        &pool,
        &format!(
            "DROP DATABASE IF EXISTS {DATABASE_A};
             DROP DATABASE IF EXISTS {DATABASE_B};
             CREATE DATABASE {DATABASE_A};
             CREATE TABLE {DATABASE_A}.items (id INT PRIMARY KEY, label VARCHAR(64));
             CREATE TABLE {DATABASE_A}.item_tags (item_id INT, tag VARCHAR(64));
             CREATE VIEW {DATABASE_A}.active_items AS SELECT id, label FROM {DATABASE_A}.items;
             CREATE DATABASE {DATABASE_B};
             CREATE TABLE {DATABASE_B}.orders (id INT PRIMARY KEY, total DECIMAL(10,2));
             CREATE PROCEDURE {DATABASE_B}.refresh_order_totals() BEGIN END;"
        ),
        true,
    )
    .await
    .expect("create fixtures");

    let schemas = vec![DATABASE_A.to_string(), DATABASE_B.to_string()];

    // Unfiltered bulk vs per-schema calls.
    let bulk = dbx_core::schema::list_completion_metadata_core(&state, CONNECTION_ID, DATABASE_A, &schemas, None, None)
        .await
        .expect("bulk metadata");
    assert_eq!(bulk.len(), schemas.len(), "one group per requested schema, in request order");
    for (index, group) in bulk.iter().enumerate() {
        assert_eq!(group.schema, schemas[index]);
        let tables = dbx_core::schema::list_tables_core(&state, CONNECTION_ID, DATABASE_A, &schemas[index], None, None)
            .await
            .expect("per-schema tables");
        assert_eq!(json_of(&group.tables), json_of(&tables), "tables must match for {}", group.schema);
        // The core's per-schema objects arm is pool-database bound (it passes
        // `database`, not the requested schema — a pre-existing quirk for
        // cross-database listing), so compare the bulk group against the
        // driver's own per-database routines query instead.
        let objects = dbx_core::db::mysql::list_completion_objects(&pool, &schemas[index])
            .await
            .expect("per-database completion objects");
        assert_eq!(json_of(&group.objects), json_of(&objects), "objects must match for {}", group.schema);
    }

    let group_a = &bulk[0];
    assert!(group_a.tables.iter().any(|table| table.name == "items"));
    assert!(group_a.tables.iter().any(|table| table.name == "active_items" && table.table_type == "VIEW"));
    let group_b = &bulk[1];
    assert!(group_b.tables.iter().any(|table| table.name == "orders"));
    assert!(
        group_b.objects.iter().any(|object| object.name == "refresh_order_totals" && object.object_type == "PROCEDURE"),
        "routines must survive the bulk path"
    );

    // Filtered + limited bulk vs the same per-schema call: identical semantics.
    let filtered = dbx_core::schema::list_completion_metadata_core(
        &state,
        CONNECTION_ID,
        DATABASE_A,
        &schemas,
        Some("item"),
        Some(1),
    )
    .await
    .expect("filtered bulk metadata");
    for (index, group) in filtered.iter().enumerate() {
        let tables = dbx_core::schema::list_tables_core(
            &state,
            CONNECTION_ID,
            DATABASE_A,
            &schemas[index],
            Some("item"),
            Some(1),
        )
        .await
        .expect("filtered per-schema tables");
        assert_eq!(json_of(&group.tables), json_of(&tables), "filtered tables must match for {}", group.schema);
    }
    assert_eq!(filtered[0].tables.len(), 1, "limit applied per schema");

    dbx_core::db::mysql::execute_query(
        &pool,
        &format!("DROP DATABASE IF EXISTS {DATABASE_A}; DROP DATABASE IF EXISTS {DATABASE_B};"),
        true,
    )
    .await
    .expect("teardown fixtures");
    println!("live MySQL bulk completion metadata matches the per-schema queries");
}
