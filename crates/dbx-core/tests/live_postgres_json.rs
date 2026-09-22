use std::time::Duration;

// Regression coverage for the B4 json/jsonb passthrough: cells must reach the
// result set exactly as the server renders them, with no parse→Value→to_string
// round trip in between (the round trip re-formatted values — whitespace,
// number literals — and rewrote numbers outside f64 precision, e.g. a 30-digit
// integer surfaced as 1.2345678901234568e+29). The oracle is the server's own
// `::text` output read through the driver's plain-text path, plus a few exact
// tripwires that would fail again if the parse path were ever reintroduced.
#[tokio::test]
#[ignore = "requires DBX_TEST_POSTGRES_URL pointing at a PostgreSQL database (e.g. xbase/xbase123@localhost/xbase_test)"]
async fn live_postgres_json_values_pass_through_as_server_text() {
    let url = std::env::var("DBX_TEST_POSTGRES_URL").expect("DBX_TEST_POSTGRES_URL");
    let pool = dbx_core::db::postgres::connect(&url, Duration::from_secs(5)).await.expect("connect");

    // The json-typed column keeps the input verbatim (whitespace, duplicate
    // keys, escapes); the jsonb-typed column holds the same documents so the
    // canonicalized server output is covered too. One statement per call —
    // the prepared path rejects multi-command strings.
    let rich = r#"{ "b" : 1.000, "a": [1, 2.50, 1e2], "u": "\u00e9\u4e2d", "nested": {"y": 1, "x": {"z": true}}, "dup": 1, "dup": 2 }"#;
    let numbers = r#"{ "big": 123456789012345678901234567890, "neg": -0.0, "exp": 1.5e300, "prec": 1.23456789012345678901234567890123456789 }"#;
    let big: String = format!("[{}]", (0..5000).map(|i| format!(r#"{{"key{i}": {i}}}"#)).collect::<Vec<_>>().join(","));
    assert!(big.len() > 50_000, "large-object case must stay large");
    for sql in [
        "drop table if exists live_postgres_json_values".to_string(),
        "create table live_postgres_json_values (id int primary key, j json, jb jsonb)".to_string(),
        format!("insert into live_postgres_json_values values (1, '{rich}', '{rich}')"),
        format!("insert into live_postgres_json_values values (2, '{numbers}', '{numbers}')"),
        "insert into live_postgres_json_values values (3, 'null', 'null')".to_string(),
        "insert into live_postgres_json_values values (4, 'true', 'true')".to_string(),
        "insert into live_postgres_json_values values (5, '123', '123')".to_string(),
        r#"insert into live_postgres_json_values values (6, '"simple string"', '"simple string"')"#.to_string(),
        "insert into live_postgres_json_values values (7, '{}', '{}')".to_string(),
        "insert into live_postgres_json_values values (8, '[]', '[]')".to_string(),
        r#"insert into live_postgres_json_values values (9, '{"b": 1, "ab": 2, "a": 3}', '{"b": 1, "ab": 2, "a": 3}')"#
            .to_string(),
        "insert into live_postgres_json_values values (10, null, null)".to_string(),
        format!("insert into live_postgres_json_values values (11, '{big}', '{big}')"),
    ] {
        dbx_core::db::postgres::execute_query(&pool, &sql).await.expect("seed");
    }

    // The app path (json/jsonb columns) and the server's own rendering of the
    // same cells (plain text columns) must agree row for row, byte for byte.
    let app =
        dbx_core::db::postgres::execute_query(&pool, "select id, j, jb from live_postgres_json_values order by id")
            .await
            .expect("query json rows");
    let oracle = dbx_core::db::postgres::execute_query(
        &pool,
        "select id, j::text as j_text, jb::text as jb_text from live_postgres_json_values order by id",
    )
    .await
    .expect("query text oracle");
    assert_eq!(app.rows.len(), 11);
    for (app_row, oracle_row) in app.rows.iter().zip(&oracle.rows) {
        assert_eq!(app_row[0], oracle_row[0], "row order must match");
        assert_eq!(app_row[1], oracle_row[1], "json cell must equal the server text");
        assert_eq!(app_row[2], oracle_row[2], "jsonb cell must equal the server text");
    }

    let cell = |row: usize, col: usize| -> &str { app.rows[row][col].as_str().expect("cell is a JSON string") };

    // json stores the input verbatim: whitespace, duplicate keys and unicode
    // escapes survive exactly as inserted (the old path compacted to
    // {"b":1.0,...}, decoded the escapes and kept only the last "dup").
    assert_eq!(cell(0, 1), rich);
    // jsonb canonicalizes: escapes are decoded and the output is the server's
    // canonical text with key order by (length, bytes) and the number scale
    // (1.000, 2.50) preserved — what psql displays.
    assert_eq!(
        cell(0, 2),
        r#"{"a": [1, 2.50, 100], "b": 1.000, "u": "é中", "dup": 2, "nested": {"x": {"z": true}, "y": 1}}"#
    );

    // Full numeric precision: the 30-digit integer and 38-digit decimal keep
    // every digit (old path: 1.2345678901234568e+29 / 1.2345678901234567).
    assert!(cell(1, 1).contains("123456789012345678901234567890"));
    assert!(cell(1, 2).contains("123456789012345678901234567890"));
    assert!(cell(1, 1).contains("1.23456789012345678901234567890123456789"));

    // jsonb orders keys by length then bytes ("a", "b", then "ab").
    assert_eq!(cell(8, 2), r#"{"a": 3, "b": 1, "ab": 2}"#);

    // NULL cells stay null through the passthrough.
    assert_eq!(app.rows[9][1], serde_json::Value::Null);
    assert_eq!(app.rows[9][2], serde_json::Value::Null);

    // The large object arrives whole: the json cell byte-for-byte with the
    // inserted text; the jsonb cell is re-rendered by the server (separators,
    // key order) so the oracle equality above pins it — just check the size
    // survived the transfer.
    assert_eq!(cell(10, 1).len(), big.len());
    assert!(cell(10, 2).len() > big.len());

    let _ = dbx_core::db::postgres::execute_query(&pool, "drop table live_postgres_json_values").await;
}
