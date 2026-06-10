use std::time::Duration;

/// Regression test for network address types (`inet`, `cidr`, `macaddr`,
/// `macaddr8`) rendering as text instead of a raw binary blob. Uses literal
/// casts so it needs no seeded table — point the env var at any PostgreSQL.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a PostgreSQL database (e.g. xbase/xbase123@localhost/xbase_test)"]
async fn live_postgres_network_address_values_render_as_text() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let pool = dbx_core::db::postgres::connect(&url, Duration::from_secs(5)).await.expect("connect");
    let result = dbx_core::db::postgres::execute_query(
        &pool,
        "select \
            '192.168.1.0/24'::cidr        as cidr_v4, \
            '10.0.0.0/8'::cidr            as cidr_v4_8, \
            '2001:db8::/32'::cidr         as cidr_v6, \
            '192.168.1.1'::inet           as inet_full, \
            '192.168.1.0/24'::inet        as inet_masked, \
            '::1'::inet                   as inet_v6, \
            '08:00:2b:01:02:03'::macaddr  as mac6, \
            '08:00:2b:01:02:03:04:05'::macaddr8 as mac8, \
            null::cidr                    as cidr_null",
    )
    .await
    .expect("query network rows");

    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];
    assert_eq!(row[0], serde_json::json!("192.168.1.0/24"));
    assert_eq!(row[1], serde_json::json!("10.0.0.0/8"));
    assert_eq!(row[2], serde_json::json!("2001:db8::/32"));
    assert_eq!(row[3], serde_json::json!("192.168.1.1"));
    assert_eq!(row[4], serde_json::json!("192.168.1.0/24"));
    assert_eq!(row[5], serde_json::json!("::1"));
    assert_eq!(row[6], serde_json::json!("08:00:2b:01:02:03"));
    assert_eq!(row[7], serde_json::json!("08:00:2b:01:02:03:04:05"));
    assert_eq!(row[8], serde_json::Value::Null);
}

/// Regression test for `interval` rendering as PostgreSQL's `postgres`-style
/// text rather than a binary blob (chrono cannot represent month-aware spans).
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a PostgreSQL database"]
async fn live_postgres_interval_values_render_as_text() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let pool = dbx_core::db::postgres::connect(&url, Duration::from_secs(5)).await.expect("connect");
    let result = dbx_core::db::postgres::execute_query(
        &pool,
        "select \
            '1 year 2 mons 3 days 04:05:06'::interval as full_span, \
            '-1 years'::interval                      as neg_year, \
            '1.5 hours'::interval                     as hours, \
            '0.123456 seconds'::interval              as frac_sec, \
            '00:00:00'::interval                      as zero_span, \
            null::interval                            as interval_null",
    )
    .await
    .expect("query interval rows");

    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];
    assert_eq!(row[0], serde_json::json!("1 year 2 mons 3 days 04:05:06"));
    assert_eq!(row[1], serde_json::json!("-1 years"));
    assert_eq!(row[2], serde_json::json!("01:30:00"));
    assert_eq!(row[3], serde_json::json!("00:00:00.123456"));
    assert_eq!(row[4], serde_json::json!("00:00:00"));
    assert_eq!(row[5], serde_json::Value::Null);
}

/// Regression test for `timetz` rendering as ISO text rather than a binary
/// blob (chrono has no time-with-offset type tokio_postgres maps to `timetz`).
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a PostgreSQL database"]
async fn live_postgres_timetz_values_render_as_text() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let pool = dbx_core::db::postgres::connect(&url, Duration::from_secs(5)).await.expect("connect");
    let result = dbx_core::db::postgres::execute_query(
        &pool,
        "select \
            '14:30:00+05:30'::timetz     as east_half, \
            '12:00:00-05'::timetz        as west_whole, \
            '23:59:59.123456+00'::timetz as frac_utc, \
            null::timetz                 as timetz_null",
    )
    .await
    .expect("query timetz rows");

    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];
    assert_eq!(row[0], serde_json::json!("14:30:00+05:30"));
    assert_eq!(row[1], serde_json::json!("12:00:00-05"));
    assert_eq!(row[2], serde_json::json!("23:59:59.123456+00"));
    assert_eq!(row[3], serde_json::Value::Null);
}

/// Arrays of network types decode element-by-element too.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a PostgreSQL database"]
async fn live_postgres_network_address_arrays_render_as_text() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let pool = dbx_core::db::postgres::connect(&url, Duration::from_secs(5)).await.expect("connect");
    let result = dbx_core::db::postgres::execute_query(
        &pool,
        "select array['192.168.1.0/24'::cidr, null, '10.0.0.0/8'::cidr] as cidrs",
    )
    .await
    .expect("query cidr array");

    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0][0], serde_json::json!(["192.168.1.0/24", null, "10.0.0.0/8"]));
}
