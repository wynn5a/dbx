use serde::{Deserialize, Serialize};

use crate::models::connection::DatabaseType;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainSqlOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database_type: Option<DatabaseType>,
    pub sql: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainSqlBuildResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFilePreviewSqlOptions {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

pub fn build_explain_sql(options: ExplainSqlOptions) -> ExplainSqlBuildResult {
    if !supports_explain_plan(options.database_type) {
        return explain_err("unsupported");
    }

    let source = strip_trailing_semicolons(options.sql.trim());
    if source.is_empty() {
        return explain_err("empty");
    }
    if !is_safe_explain_source(&source) {
        return explain_err("unsafe");
    }

    let sql = if options.database_type == Some(DatabaseType::Postgres) {
        format!("EXPLAIN (FORMAT JSON) {source}")
    } else if options.database_type == Some(DatabaseType::Dameng) {
        format!("EXPLAIN {source}")
    } else if options.database_type == Some(DatabaseType::SqlServer) {
        // SQL Server has no EXPLAIN. `SET SHOWPLAN_ALL ON` returns the estimated
        // plan as a flat NodeId/Parent rowset (without executing the query) and
        // must be the only statement in its batch. The native SQL Server driver
        // recognises this wrapper (see db::sqlserver::is_showplan_explain_batch)
        // and runs ON -> query -> OFF across three batches on one connection.
        format!("SET SHOWPLAN_ALL ON;\n{source};\nSET SHOWPLAN_ALL OFF;")
    } else {
        format!("EXPLAIN FORMAT=JSON {source}")
    };
    ExplainSqlBuildResult { ok: true, sql: Some(sql), reason: None }
}

pub fn build_dropped_file_preview_sql(options: DroppedFilePreviewSqlOptions) -> Option<String> {
    let lower = options.path.to_lowercase();
    let escaped = options.path.replace('\'', "''");
    let limit = options.limit.unwrap_or(1000).max(1);
    if lower.ends_with(".parquet") {
        return Some(format!("SELECT * FROM read_parquet('{escaped}') LIMIT {limit}"));
    }
    if lower.ends_with(".csv") {
        return Some(format!("SELECT * FROM read_csv('{escaped}') LIMIT {limit}"));
    }
    if lower.ends_with(".tsv") {
        return Some(format!("SELECT * FROM read_csv('{escaped}', delim='\\t') LIMIT {limit}"));
    }
    if lower.ends_with(".json") {
        return Some(format!("SELECT * FROM read_json('{escaped}') LIMIT {limit}"));
    }
    None
}

pub fn supports_explain_plan(database_type: Option<DatabaseType>) -> bool {
    matches!(
        database_type,
        Some(DatabaseType::Mysql | DatabaseType::Postgres | DatabaseType::Dameng | DatabaseType::SqlServer)
    )
}

/// Databases that accept SQL query execution via the `execute_query` /
/// `get_sample_data` agent tools. Non-SQL stores are excluded so the agent never
/// offers a SQL tool it cannot honor.
pub fn supports_sql_query(database_type: DatabaseType) -> bool {
    !matches!(
        database_type,
        DatabaseType::Redis
            | DatabaseType::MongoDb
            | DatabaseType::Elasticsearch
            | DatabaseType::Neo4j
            | DatabaseType::Etcd
    )
}

/// Whether `sql` is a single read-only statement safe to auto-execute without
/// user confirmation. Anything that mutates data/schema, materializes rows
/// (`SELECT ... INTO`), or chains a second statement returns false — the agent
/// loop then pauses and asks the user to confirm before running it.
pub fn is_read_only_sql(sql: &str, _database_type: DatabaseType) -> bool {
    let source = strip_trailing_semicolons(sql.trim());
    if source.is_empty() || has_extra_statement_after_semicolon(&source) {
        return false;
    }
    if !starts_with_read_only_keyword(&source) || contains_dangerous_sql_keyword(&source) {
        return false;
    }
    // `SELECT ... INTO <table>` (SQL Server / Postgres) materializes data; the
    // dangerous-keyword list above does not cover it, so reject it explicitly.
    let literal_free = strip_sql_comments_and_literals(&source).to_lowercase();
    !contains_word(&literal_free, "into")
}

fn starts_with_read_only_keyword(sql: &str) -> bool {
    let source = strip_sql_comments(sql).trim_start().to_lowercase();
    ["select", "with", "show", "describe", "desc", "explain", "pragma", "values", "table"].iter().any(|keyword| {
        source == *keyword || source.starts_with(&format!("{keyword} ")) || source.starts_with(&format!("{keyword}\n"))
    })
}

pub fn is_safe_dameng_autotrace_sql(sql: &str) -> bool {
    let source = strip_trailing_semicolons(sql.trim());
    if source.is_empty() || has_extra_statement_after_semicolon(&source) {
        return false;
    }
    is_safe_explain_source(&source) && !contains_dangerous_sql_keyword(&source)
}

fn explain_err(reason: &str) -> ExplainSqlBuildResult {
    ExplainSqlBuildResult { ok: false, sql: None, reason: Some(reason.to_string()) }
}

fn strip_trailing_semicolons(sql: &str) -> String {
    sql.trim_end().trim_end_matches(';').trim_end().to_string()
}

fn is_safe_explain_source(sql: &str) -> bool {
    let source = strip_sql_comments(sql).trim_start().to_lowercase();
    ["select", "with", "table", "values"].iter().any(|keyword| {
        source == *keyword || source.starts_with(&format!("{keyword} ")) || source.starts_with(&format!("{keyword}\n"))
    })
}

fn contains_dangerous_sql_keyword(sql: &str) -> bool {
    let source = strip_sql_comments_and_literals(sql).to_lowercase();
    ["drop", "delete", "truncate", "alter", "update", "merge", "replace", "insert", "create"]
        .iter()
        .any(|keyword| contains_word(&source, keyword))
}

fn contains_word(source: &str, word: &str) -> bool {
    let bytes = source.as_bytes();
    let word_bytes = word.as_bytes();
    if word_bytes.is_empty() || bytes.len() < word_bytes.len() {
        return false;
    }

    for idx in 0..=bytes.len() - word_bytes.len() {
        if &bytes[idx..idx + word_bytes.len()] != word_bytes {
            continue;
        }
        let before = idx.checked_sub(1).and_then(|i| bytes.get(i)).copied();
        let after = bytes.get(idx + word_bytes.len()).copied();
        if !is_identifier_byte(before) && !is_identifier_byte(after) {
            return true;
        }
    }
    false
}

fn is_identifier_byte(byte: Option<u8>) -> bool {
    byte.is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn has_extra_statement_after_semicolon(sql: &str) -> bool {
    let stripped = strip_sql_comments_and_literals(sql);
    stripped.split(';').skip(1).any(|part| !part.trim().is_empty())
}

fn strip_sql_comments(sql: &str) -> String {
    let mut output = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(ch) = chars.next() {
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
                output.push(' ');
            }
            continue;
        }

        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
                output.push(' ');
            }
            continue;
        }

        if ch == '-' && chars.peek() == Some(&'-') {
            chars.next();
            in_line_comment = true;
            continue;
        }
        if ch == '#' {
            in_line_comment = true;
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            in_block_comment = true;
            continue;
        }

        output.push(ch);
    }

    output
}

fn strip_sql_comments_and_literals(sql: &str) -> String {
    let mut output = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    while let Some(ch) = chars.next() {
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
                output.push(' ');
            }
            continue;
        }

        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                in_block_comment = false;
                output.push(' ');
            }
            continue;
        }

        if in_single_quote {
            if ch == '\'' {
                if chars.peek() == Some(&'\'') {
                    chars.next();
                } else {
                    in_single_quote = false;
                }
            }
            output.push(' ');
            continue;
        }

        if in_double_quote {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                } else {
                    in_double_quote = false;
                }
            }
            output.push(' ');
            continue;
        }

        if ch == '-' && chars.peek() == Some(&'-') {
            chars.next();
            in_line_comment = true;
            continue;
        }
        if ch == '#' {
            in_line_comment = true;
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            in_block_comment = true;
            continue;
        }
        if ch == '\'' {
            in_single_quote = true;
            output.push(' ');
            continue;
        }
        if ch == '"' {
            in_double_quote = true;
            output.push(' ');
            continue;
        }

        output.push(ch);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_postgres_json_explain_sql() {
        let result = build_explain_sql(ExplainSqlOptions {
            database_type: Some(DatabaseType::Postgres),
            sql: " select * from users where id = 1; ".to_string(),
        });

        assert_eq!(
            result,
            ExplainSqlBuildResult {
                ok: true,
                sql: Some("EXPLAIN (FORMAT JSON) select * from users where id = 1".to_string()),
                reason: None,
            }
        );
    }

    #[test]
    fn builds_dameng_explain_sql() {
        let result = build_explain_sql(ExplainSqlOptions {
            database_type: Some(DatabaseType::Dameng),
            sql: "SELECT * FROM t1 WHERE id = 1".to_string(),
        });

        assert_eq!(
            result,
            ExplainSqlBuildResult {
                ok: true,
                sql: Some("EXPLAIN SELECT * FROM t1 WHERE id = 1".to_string()),
                reason: None,
            }
        );
    }

    #[test]
    fn builds_sqlserver_showplan_all_explain_sql() {
        let result = build_explain_sql(ExplainSqlOptions {
            database_type: Some(DatabaseType::SqlServer),
            sql: " SELECT * FROM dbo.t WHERE id = 1; ".to_string(),
        });

        assert_eq!(
            result,
            ExplainSqlBuildResult {
                ok: true,
                sql: Some("SET SHOWPLAN_ALL ON;\nSELECT * FROM dbo.t WHERE id = 1;\nSET SHOWPLAN_ALL OFF;".to_string()),
                reason: None,
            }
        );
    }

    #[test]
    fn read_only_sql_accepts_reads_and_rejects_writes() {
        let db = DatabaseType::Postgres;
        // reads
        assert!(is_read_only_sql("SELECT * FROM users WHERE id = 1", db));
        assert!(is_read_only_sql("  with q as (select 1) select * from q ", db));
        assert!(is_read_only_sql("SHOW TABLES", db));
        assert!(is_read_only_sql("EXPLAIN SELECT 1", db));
        assert!(is_read_only_sql("SELECT * FROM t WHERE name = 'delete';", db)); // literal, not a write
                                                                                 // writes / unsafe
        assert!(!is_read_only_sql("INSERT INTO t VALUES (1)", db));
        assert!(!is_read_only_sql("UPDATE t SET x = 1 WHERE id = 2", db));
        assert!(!is_read_only_sql("DELETE FROM t WHERE id = 1", db));
        assert!(!is_read_only_sql("DROP TABLE t", db));
        assert!(!is_read_only_sql("WITH x AS (SELECT 1) DELETE FROM t", db)); // CTE that mutates
        assert!(!is_read_only_sql("SELECT * INTO backup FROM users", db)); // materializes data
        assert!(!is_read_only_sql("SELECT 1; DROP TABLE t", db)); // chained statement
        assert!(!is_read_only_sql("", db));
    }

    #[test]
    fn sql_query_support_gates_non_sql_stores() {
        assert!(supports_sql_query(DatabaseType::Mysql));
        assert!(supports_sql_query(DatabaseType::Sqlite));
        assert!(!supports_sql_query(DatabaseType::Redis));
        assert!(!supports_sql_query(DatabaseType::MongoDb));
        assert!(!supports_sql_query(DatabaseType::Elasticsearch));
        assert!(!supports_sql_query(DatabaseType::Neo4j));
        assert!(!supports_sql_query(DatabaseType::Etcd));
    }

    #[test]
    fn validates_dameng_autotrace_sql_safety() {
        assert!(is_safe_dameng_autotrace_sql("SELECT * FROM t WHERE name = 'delete';"));
        assert!(is_safe_dameng_autotrace_sql("/* comment */ WITH q AS (SELECT 1) SELECT * FROM q"));
        assert!(!is_safe_dameng_autotrace_sql("SELECT * FROM t; DELETE FROM t"));
        assert!(!is_safe_dameng_autotrace_sql("UPDATE t SET name = 'x'"));
        assert!(!is_safe_dameng_autotrace_sql("SELECT * FROM t; /* hidden */ DROP TABLE t"));
        assert!(!is_safe_dameng_autotrace_sql(""));
    }

    #[test]
    fn builds_mysql_json_explain_and_rejects_unsafe_sql() {
        assert_eq!(
            build_explain_sql(ExplainSqlOptions {
                database_type: Some(DatabaseType::Mysql),
                sql: "SELECT * FROM users;".to_string(),
            }),
            ExplainSqlBuildResult {
                ok: true,
                sql: Some("EXPLAIN FORMAT=JSON SELECT * FROM users".to_string()),
                reason: None,
            }
        );

        assert_eq!(
            build_explain_sql(ExplainSqlOptions {
                database_type: Some(DatabaseType::Mysql),
                sql: "delete from users".to_string(),
            }),
            ExplainSqlBuildResult { ok: false, sql: None, reason: Some("unsafe".to_string()) }
        );
    }

    #[test]
    fn builds_dropped_file_preview_sql() {
        assert_eq!(
            build_dropped_file_preview_sql(DroppedFilePreviewSqlOptions {
                path: "/tmp/O'Hara.csv".to_string(),
                limit: Some(25),
            }),
            Some("SELECT * FROM read_csv('/tmp/O''Hara.csv') LIMIT 25".to_string())
        );
        assert_eq!(
            build_dropped_file_preview_sql(DroppedFilePreviewSqlOptions {
                path: "/tmp/data.tsv".to_string(),
                limit: None,
            }),
            Some("SELECT * FROM read_csv('/tmp/data.tsv', delim='\\t') LIMIT 1000".to_string())
        );
        assert_eq!(
            build_dropped_file_preview_sql(DroppedFilePreviewSqlOptions {
                path: "/tmp/data.txt".to_string(),
                limit: None,
            }),
            None
        );
    }
}
