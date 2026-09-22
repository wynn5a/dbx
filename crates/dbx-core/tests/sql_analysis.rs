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
