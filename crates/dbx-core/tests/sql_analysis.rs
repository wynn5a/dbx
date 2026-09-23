use dbx_core::sql_analysis::analyze_sql_references;

#[test]
fn extracts_tables_aliases_and_qualified_columns() {
    let analysis = analyze_sql_references("select u.missing from users u where u.id = 1", Some("postgres")).unwrap();

    assert_eq!(analysis.tables.len(), 1);
    assert_eq!(analysis.tables[0].name, "users");
    assert_eq!(analysis.tables[0].alias.as_deref(), Some("u"));

    let columns: Vec<_> =
        analysis.columns.iter().map(|column| (column.qualifier.as_deref(), column.name.as_str())).collect();
    assert_eq!(columns, vec![(Some("u"), "missing"), (Some("u"), "id")]);
}

#[test]
fn extracts_unqualified_columns_from_single_table_select() {
    let analysis = analyze_sql_references("select missing, id from users", Some("postgres")).unwrap();

    let columns: Vec<_> =
        analysis.columns.iter().map(|column| (column.qualifier.as_deref(), column.name.as_str())).collect();
    assert_eq!(columns, vec![(None, "missing"), (None, "id")]);
}

#[test]
fn extracts_unqualified_order_by_columns_for_sqlserver_queries() {
    let analysis =
        analyze_sql_references("SELECT * FROM Evt_GCM_Qop_Info ORDER BY PDReceiveDatePartInfo DESC", Some("sqlserver"))
            .unwrap();

    assert_eq!(analysis.tables.len(), 1);
    assert_eq!(analysis.tables[0].name, "Evt_GCM_Qop_Info");

    let columns: Vec<_> =
        analysis.columns.iter().map(|column| (column.qualifier.as_deref(), column.name.as_str())).collect();
    assert_eq!(columns, vec![(None, "PDReceiveDatePartInfo")]);
}

#[test]
fn bare_table_reference_has_no_schema() {
    // A bare name must not leak the table itself into the schema slot — the
    // confidence gate treats a schema-qualified reference as already resolved.
    let analysis = analyze_sql_references("select id from users", Some("postgres")).unwrap();
    assert_eq!(analysis.tables.len(), 1);
    assert_eq!(analysis.tables[0].name, "users");
    assert_eq!(analysis.tables[0].schema, None);
}

#[test]
fn qualified_table_references_keep_their_schema_parts() {
    let analysis = analyze_sql_references("select id from myschema.users", Some("postgres")).unwrap();
    assert_eq!(analysis.tables[0].schema.as_deref(), Some("myschema"));

    let analysis = analyze_sql_references("select id from db.myschema.users", Some("postgres")).unwrap();
    assert_eq!(analysis.tables[0].name, "users");
    assert_eq!(analysis.tables[0].schema.as_deref(), Some("myschema"));
}

#[test]
fn collects_select_list_aliases() {
    let analysis = analyze_sql_references(
        "select id as user_id, upper(name) uname, (select max(x) from t2) mx from users order by user_id",
        Some("postgres"),
    )
    .unwrap();
    assert_eq!(analysis.select_aliases, vec!["user_id".to_string(), "uname".to_string(), "mx".to_string()]);
}

#[test]
fn collects_table_alias_column_lists() {
    // UNNEST alias columns and table-valued function alias columns are visible
    // in scope but are not schema columns.
    let analysis = analyze_sql_references("select tag from tips, unnest(tags) as u(tag)", Some("duckdb")).unwrap();
    assert_eq!(analysis.alias_columns, vec!["tag".to_string()]);

    let analysis = analyze_sql_references("select n from generate_series(1, 3) as g(n)", Some("duckdb")).unwrap();
    assert_eq!(analysis.alias_columns, vec!["n".to_string()]);

    let analysis = analyze_sql_references("select a, b from my_table as t(a, b)", Some("postgres")).unwrap();
    assert_eq!(analysis.alias_columns, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn duckdb_parser_gap_queries_do_not_raise_syntax_errors() {
    for sql in ["FROM users;", "SUMMARIZE users;", "SUMMARISE users;"] {
        let analysis = analyze_sql_references(sql, Some("duckdb")).expect("duckdb parser gap query should analyze");
        assert!(analysis.tables.is_empty());
        assert!(analysis.columns.is_empty());
    }
}

#[test]
fn collects_cte_definitions_with_explicit_column_lists() {
    let analysis =
        analyze_sql_references("WITH cte (col1, col2) AS (SELECT 1, 2) SELECT * FROM cte", Some("postgres")).unwrap();

    assert_eq!(analysis.cte_definitions.len(), 1);
    assert_eq!(analysis.cte_definitions[0].name, "cte");
    assert_eq!(analysis.cte_definitions[0].columns, vec!["col1".to_string(), "col2".to_string()]);
    // The CTE reference itself is still a (shadowing) table reference.
    assert_eq!(analysis.tables.len(), 1);
    assert_eq!(analysis.tables[0].name, "cte");
}

#[test]
fn derives_cte_columns_from_the_body_select_list() {
    let analysis =
        analyze_sql_references("WITH cte AS (SELECT id, name, status FROM users) SELECT * FROM cte", Some("postgres"))
            .unwrap();

    assert_eq!(analysis.cte_definitions[0].name, "cte");
    assert_eq!(analysis.cte_definitions[0].columns, vec!["id".to_string(), "name".to_string(), "status".to_string()]);
}

#[test]
fn recursive_cte_columns_come_from_the_first_select_of_the_union() {
    let sql = "WITH RECURSIVE tree AS (SELECT id, parent_id FROM categories \
               UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN tree t ON c.parent_id = t.id) \
               SELECT * FROM tree";
    let analysis = analyze_sql_references(sql, Some("postgres")).unwrap();

    assert_eq!(analysis.cte_definitions.len(), 1);
    assert_eq!(analysis.cte_definitions[0].name, "tree");
    assert_eq!(analysis.cte_definitions[0].columns, vec!["id".to_string(), "parent_id".to_string()]);
}

#[test]
fn collects_multiple_cte_definitions_in_order() {
    let sql = "WITH first AS (SELECT id FROM users), second AS (SELECT id FROM orders) \
               SELECT * FROM first JOIN second";
    let analysis = analyze_sql_references(sql, Some("postgres")).unwrap();

    let names: Vec<_> = analysis.cte_definitions.iter().map(|cte| cte.name.as_str()).collect();
    assert_eq!(names, vec!["first", "second"]);
}

#[test]
fn collects_derived_table_aliases_with_output_columns() {
    let analysis =
        analyze_sql_references("SELECT * FROM (SELECT id, name FROM users) sub WHERE sub.id = 1", Some("postgres"))
            .unwrap();

    assert_eq!(analysis.derived_tables.len(), 1);
    assert_eq!(analysis.derived_tables[0].alias, "sub");
    assert_eq!(analysis.derived_tables[0].columns, vec!["id".to_string(), "name".to_string()]);
    // The derived table's inner source is still a table reference.
    assert_eq!(analysis.tables.len(), 1);
    assert_eq!(analysis.tables[0].name, "users");
}

#[test]
fn derived_table_explicit_column_lists_win_over_the_select_list() {
    let analysis = analyze_sql_references("SELECT a, b FROM (SELECT 1, 2) AS x(a, b)", Some("postgres")).unwrap();

    assert_eq!(analysis.derived_tables.len(), 1);
    assert_eq!(analysis.derived_tables[0].alias, "x");
    assert_eq!(analysis.derived_tables[0].columns, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn nested_subqueries_keep_every_table_reference() {
    let sql = "SELECT * FROM orders o WHERE o.id IN (SELECT order_id FROM items i \
               WHERE i.user_id IN (SELECT user_id FROM banned))";
    let analysis = analyze_sql_references(sql, Some("postgres")).unwrap();

    let names: Vec<_> = analysis.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["orders", "items", "banned"]);
}

#[test]
fn commented_out_references_are_not_extracted() {
    // The parser skips comments, so "table-like" text inside them is data.
    let analysis =
        analyze_sql_references("SELECT a FROM t1 -- , t2 FROM hidden JOIN t3\nWHERE a > 0", Some("postgres")).unwrap();
    let names: Vec<_> = analysis.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["t1"]);

    let analysis =
        analyze_sql_references("SELECT a FROM t1 /* , t2 FROM hidden */ WHERE a > 0", Some("postgres")).unwrap();
    let names: Vec<_> = analysis.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["t1"]);
}

#[test]
fn dollar_quoted_bodies_are_not_parsed_as_sql() {
    let analysis = analyze_sql_references(
        "SELECT x FROM logs WHERE tags = $$-- not a comment$$ AND logs.ok = true",
        Some("postgres"),
    )
    .unwrap();
    let names: Vec<_> = analysis.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["logs"]);
    // The dollar body must not leak identifier references either.
    assert!(analysis.columns.iter().all(|column| column.name != "not"));

    let analysis = analyze_sql_references(
        "SELECT x FROM logs WHERE tags = $note$/* still a string */$note$ AND logs.ok = true",
        Some("postgres"),
    )
    .unwrap();
    let names: Vec<_> = analysis.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["logs"]);
}

#[test]
fn extracts_dml_target_tables() {
    let insert =
        analyze_sql_references("INSERT INTO public.users (id, name) SELECT id, name FROM staging_users", None).unwrap();
    let names: Vec<_> = insert.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["users", "staging_users"]);
    assert_eq!(insert.tables[0].schema.as_deref(), Some("public"));

    let update =
        analyze_sql_references("UPDATE users AS u SET name = 'x' FROM accounts a WHERE u.id = a.user_id", None)
            .unwrap();
    let names: Vec<_> = update.tables.iter().map(|table| (table.name.as_str(), table.alias.as_deref())).collect();
    assert_eq!(names, vec![("users", Some("u")), ("accounts", Some("a"))]);

    let delete = analyze_sql_references("DELETE FROM users WHERE id = 1", None).unwrap();
    let names: Vec<_> = delete.tables.iter().map(|table| table.name.as_str()).collect();
    assert_eq!(names, vec!["users"]);
}

#[test]
fn update_set_targets_count_as_column_references() {
    let analysis = analyze_sql_references("UPDATE users SET name = 'x', age = 2 WHERE id = 1", None).unwrap();
    let names: Vec<_> = analysis.columns.iter().map(|column| column.name.as_str()).collect();
    assert!(names.contains(&"name"));
    assert!(names.contains(&"age"));
    assert!(names.contains(&"id"));
}

// The unknown-column gate (apps/desktop/src/lib/sqlUnknownColumns.ts) is fed
// the analyzer's real output for each case in this fixture by
// packages/app-tests/sqlUnknownColumnsFixture.test.ts. This test keeps the
// stored `analysis` in sync with the parser; regenerate with
// `DBX_UPDATE_FIXTURES=1 cargo test -p dbx-core --test sql_analysis unknown_column_gate_fixture`.
#[test]
fn unknown_column_gate_fixture_is_current() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/app-tests/fixtures/unknown-column-gate-cases.json");
    let text = std::fs::read_to_string(&path).expect("read fixture");
    let mut fixture: serde_json::Value = serde_json::from_str(&text).expect("parse fixture");
    let update = std::env::var_os("DBX_UPDATE_FIXTURES").is_some();
    let mut stale = Vec::new();
    for case in fixture["cases"].as_array_mut().expect("cases array") {
        let sql = case["sql"].as_str().expect("sql").to_string();
        let dialect = case["dialect"].as_str().expect("dialect").to_string();
        let analysis = analyze_sql_references(&sql, Some(&dialect)).unwrap_or_else(|err| panic!("{sql}: {err}"));
        let analysis = serde_json::to_value(&analysis).expect("serialize analysis");
        if case["analysis"] != analysis {
            stale.push(case["name"].as_str().unwrap_or(&sql).to_string());
            case["analysis"] = analysis;
        }
    }
    if update {
        std::fs::write(&path, serde_json::to_string_pretty(&fixture).expect("serialize fixture") + "\n")
            .expect("write fixture");
        return;
    }
    assert!(stale.is_empty(), "stale analysis in {}: {stale:?} — rerun with DBX_UPDATE_FIXTURES=1", path.display());
}

#[test]
fn table_functions_without_column_lists_are_opaque_sources() {
    let analysis = analyze_sql_references("SELECT n FROM users, generate_series(1,3) n", Some("postgres")).unwrap();
    assert_eq!(analysis.opaque_sources, vec!["n".to_string()]);
    assert_eq!(analysis.tables.len(), 1, "the function is not a schema table");

    // An explicit column list makes the output known: not opaque.
    let analysis =
        analyze_sql_references("SELECT n FROM users, generate_series(1,3) AS g(n)", Some("postgres")).unwrap();
    assert!(analysis.opaque_sources.is_empty());
    assert_eq!(analysis.alias_columns, vec!["n".to_string()]);
}

#[test]
fn date_part_keywords_and_pseudo_columns_are_not_column_references() {
    let names = |sql: &str, dialect: &str| -> Vec<String> {
        analyze_sql_references(sql, Some(dialect)).unwrap().columns.into_iter().map(|column| column.name).collect()
    };
    assert_eq!(names("SELECT DATEADD(day, 1, created_at) FROM orders", "sqlserver"), vec!["created_at"]);
    assert_eq!(names("SELECT TIMESTAMPDIFF(DAY, a, b) FROM orders", "mysql"), vec!["a", "b"]);
    // A quoted first argument is an identifier, not a keyword.
    assert_eq!(names("SELECT DATEADD(\"day\", 1, created_at) FROM orders", "sqlserver"), vec!["day", "created_at"]);
    assert!(names("SELECT ROWNUM, SYSDATE FROM users", "oracle").is_empty());
    assert!(names("SELECT ctid, xmin FROM users", "postgres").is_empty());
    // Pseudo-columns are per dialect: `level` is an ordinary column on PG.
    assert_eq!(names("SELECT level FROM users", "postgres"), vec!["level"]);
}
