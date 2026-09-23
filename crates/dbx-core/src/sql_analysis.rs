use serde::{Deserialize, Serialize};
use sqlparser::ast::{
    Delete, Expr, FunctionArg, FunctionArgExpr, FunctionArguments, GroupByExpr, Ident, Insert, JoinConstraint,
    JoinOperator, ObjectName, ObjectNamePart, OrderByKind, Query, Select, SelectItem, SetExpr, Statement, TableAlias,
    TableFactor, TableObject, TableWithJoins, Update,
};
use sqlparser::dialect::{
    ClickHouseDialect, DuckDbDialect, GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::Parser;
use sqlparser::tokenizer::Span;

use crate::sql::{starts_with_duckdb_result_sql_keyword, starts_with_executable_sql_keyword};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlReferenceAnalysis {
    pub tables: Vec<SqlTableReference>,
    pub columns: Vec<SqlColumnReference>,
    /// Select-list aliases (`SELECT x AS name`): identifiers visible in the
    /// result scope that are not schema columns. Consumers gating semantic
    /// diagnostics on the schema must not flag them as unknown columns.
    pub select_aliases: Vec<String>,
    /// Column names from table-alias column lists
    /// (`FROM generate_series(1,3) AS g(n)`, `UNNEST(...) AS u(tag)`): the
    /// same "visible but not a schema column" class as `select_aliases`.
    pub alias_columns: Vec<String>,
    /// CTE definitions (`WITH name (a, b) AS (SELECT …)`): the name plus the
    /// output column list — explicit when given, otherwise derived from the
    /// body's top-level select list. Completion uses these as completable
    /// "tables"; the confidence gate uses the names as schema-table shadows.
    pub cte_definitions: Vec<SqlCteDefinition>,
    /// Derived tables (`FROM (SELECT id, name FROM t) x`): the alias plus the
    /// same output column derivation as CTEs.
    pub derived_tables: Vec<SqlDerivedTable>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlCteDefinition {
    pub name: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlDerivedTable {
    pub alias: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlTableReference {
    pub name: String,
    pub schema: Option<String>,
    pub alias: Option<String>,
    pub span: SqlTextSpan,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlColumnReference {
    pub name: String,
    pub qualifier: Option<String>,
    pub span: SqlTextSpan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlTextSpan {
    pub start_line: usize,
    pub start_column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

impl From<Span> for SqlTextSpan {
    fn from(span: Span) -> Self {
        Self {
            start_line: span.start.line as usize,
            start_column: span.start.column as usize,
            end_line: span.end.line as usize,
            end_column: span.end.column as usize,
        }
    }
}

#[derive(Default)]
struct Analyzer {
    tables: Vec<SqlTableReference>,
    columns: Vec<SqlColumnReference>,
    select_aliases: Vec<String>,
    alias_columns: Vec<String>,
    cte_definitions: Vec<SqlCteDefinition>,
    derived_tables: Vec<SqlDerivedTable>,
}

pub fn analyze_sql_references(sql: &str, dialect: Option<&str>) -> Result<SqlReferenceAnalysis, String> {
    let normalized_dialect = normalize_dialect(dialect);
    if normalized_dialect == "duckdb" && starts_with_duckdb_parser_gap_sql(sql) {
        return Ok(SqlReferenceAnalysis {
            tables: vec![],
            columns: vec![],
            select_aliases: vec![],
            alias_columns: vec![],
            cte_definitions: vec![],
            derived_tables: vec![],
        });
    }

    let statements = match normalized_dialect.as_str() {
        "postgres" => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        "mysql" => Parser::parse_sql(&MySqlDialect {}, sql),
        "sqlite" => Parser::parse_sql(&SQLiteDialect {}, sql),
        "sqlserver" => Parser::parse_sql(&MsSqlDialect {}, sql),
        "clickhouse" => Parser::parse_sql(&ClickHouseDialect {}, sql),
        "duckdb" => Parser::parse_sql(&DuckDbDialect {}, sql),
        // sqlparser has no Oracle dialect; Oracle-family syntax parses with the
        // generic dialect (best effort, same as before the oracle alias existed).
        "oracle" => Parser::parse_sql(&GenericDialect {}, sql),
        _ => Parser::parse_sql(&GenericDialect {}, sql),
    }
    .map_err(|err| err.to_string())?;

    let mut analyzer = Analyzer::default();
    for statement in statements {
        analyzer.visit_statement(&statement);
    }

    Ok(SqlReferenceAnalysis {
        tables: analyzer.tables,
        columns: analyzer.columns,
        select_aliases: analyzer.select_aliases,
        alias_columns: analyzer.alias_columns,
        cte_definitions: analyzer.cte_definitions,
        derived_tables: analyzer.derived_tables,
    })
}

fn starts_with_duckdb_parser_gap_sql(sql: &str) -> bool {
    starts_with_duckdb_result_sql_keyword(sql)
        && starts_with_executable_sql_keyword(sql, &["FROM", "SUMMARIZE", "SUMMARISE", "PIVOT", "UNPIVOT"])
}

// The dialect grouping shared with the frontend's editor/completion dialects.
// apps/desktop/src/lib/sqlDialect.ts mirrors this table — keep both in sync
// (locked by the test below and by packages/app-tests/sqlDialect.test.ts).
fn normalize_dialect(dialect: Option<&str>) -> String {
    match dialect.unwrap_or("generic").to_ascii_lowercase().as_str() {
        "postgres" | "postgresql" | "redshift" | "opengauss" | "gaussdb" | "highgo" | "kingbase" | "vastbase"
        | "kwdb" => "postgres".to_string(),
        "mysql" | "mariadb" | "doris" | "starrocks" | "oceanbase" | "goldendb" | "databend" => "mysql".to_string(),
        "sqlite" | "rqlite" => "sqlite".to_string(),
        "sqlserver" | "mssql" => "sqlserver".to_string(),
        "clickhouse" => "clickhouse".to_string(),
        "duckdb" => "duckdb".to_string(),
        "oracle" | "dameng" | "oceanbase-oracle" | "yashandb" => "oracle".to_string(),
        _ => "generic".to_string(),
    }
}

impl Analyzer {
    fn visit_statement(&mut self, statement: &Statement) {
        match statement {
            Statement::Query(query) => self.visit_query(query),
            Statement::Insert(insert) => self.visit_insert(insert),
            Statement::Update(update) => self.visit_update(update),
            Statement::Delete(delete) => self.visit_delete(delete),
            _ => {}
        }
    }

    // DML targets are table references too: completion suggests the target's
    // columns in `INSERT INTO t (…)`, `UPDATE t SET …` and `DELETE FROM t …`.
    fn visit_insert(&mut self, insert: &Insert) {
        if let TableObject::TableName(name) = &insert.table {
            let alias = insert.table_alias.as_ref().map(|table_alias| table_alias.alias.value.clone());
            self.push_table_reference(name, alias);
        }
        for assignment in &insert.assignments {
            self.visit_assignment(assignment);
        }
        if let Some(source) = &insert.source {
            self.visit_query(source);
        }
        self.visit_returning(insert.returning.as_ref());
    }

    fn visit_update(&mut self, update: &Update) {
        self.visit_table_with_joins(&update.table);
        if let Some(from) = &update.from {
            let tables = match from {
                sqlparser::ast::UpdateTableFromKind::BeforeSet(tables)
                | sqlparser::ast::UpdateTableFromKind::AfterSet(tables) => tables,
            };
            for table in tables {
                self.visit_table_with_joins(table);
            }
        }
        for assignment in &update.assignments {
            self.visit_assignment(assignment);
        }
        if let Some(selection) = &update.selection {
            self.visit_expr(selection);
        }
        self.visit_returning(update.returning.as_ref());
    }

    fn visit_delete(&mut self, delete: &Delete) {
        // MySQL multi-table delete names the targets before FROM.
        for name in &delete.tables {
            self.push_table_reference(name, None);
        }
        let from_tables = match &delete.from {
            sqlparser::ast::FromTable::WithFromKeyword(tables) | sqlparser::ast::FromTable::WithoutKeyword(tables) => {
                tables
            }
        };
        for table in from_tables {
            self.visit_table_with_joins(table);
        }
        if let Some(using) = &delete.using {
            for table in using {
                self.visit_table_with_joins(table);
            }
        }
        if let Some(selection) = &delete.selection {
            self.visit_expr(selection);
        }
        self.visit_returning(delete.returning.as_ref());
    }

    fn visit_assignment(&mut self, assignment: &sqlparser::ast::Assignment) {
        // The SET target is a column reference (and the one users most often
        // typo), unlike a select-list item it has no alias indirection.
        match &assignment.target {
            sqlparser::ast::AssignmentTarget::ColumnName(name) => {
                if let Some(ident) = object_name_last_ident(name) {
                    let qualifier = name
                        .0
                        .len()
                        .checked_sub(2)
                        .and_then(|index| name.0.get(index))
                        .and_then(object_name_part_ident)
                        .map(|ident| ident.value.clone());
                    self.push_column(qualifier, ident);
                }
            }
            sqlparser::ast::AssignmentTarget::Tuple(names) => {
                for name in names {
                    if let Some(ident) = object_name_last_ident(name) {
                        self.push_column(None, ident);
                    }
                }
            }
        }
        self.visit_expr(&assignment.value);
    }

    fn visit_returning(&mut self, items: Option<&Vec<SelectItem>>) {
        for item in items.into_iter().flatten() {
            if let SelectItem::UnnamedExpr(expr) = item {
                self.visit_expr(expr);
            }
        }
    }

    fn visit_query(&mut self, query: &Query) {
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                self.cte_definitions
                    .push(SqlCteDefinition { name: cte.alias.name.value.clone(), columns: cte_output_columns(cte) });
                self.visit_query(&cte.query);
            }
        }
        self.visit_set_expr(&query.body);
        if let Some(order_by) = &query.order_by {
            if let OrderByKind::Expressions(exprs) = &order_by.kind {
                for expr in exprs {
                    self.visit_expr(&expr.expr);
                }
            }
        }
    }

    fn visit_set_expr(&mut self, set_expr: &SetExpr) {
        match set_expr {
            SetExpr::Select(select) => self.visit_select(select),
            SetExpr::Query(query) => self.visit_query(query),
            SetExpr::SetOperation { left, right, .. } => {
                self.visit_set_expr(left);
                self.visit_set_expr(right);
            }
            _ => {}
        }
    }

    fn visit_select(&mut self, select: &Select) {
        for table in &select.from {
            self.visit_table_with_joins(table);
        }

        for item in &select.projection {
            match item {
                SelectItem::UnnamedExpr(expr) => self.visit_expr(expr),
                SelectItem::ExprWithAlias { expr, alias } => {
                    self.visit_expr(expr);
                    self.select_aliases.push(alias.value.clone());
                }
                SelectItem::ExprWithAliases { expr, aliases } => {
                    self.visit_expr(expr);
                    for alias in aliases {
                        self.select_aliases.push(alias.value.clone());
                    }
                }
                _ => {}
            }
        }

        if let Some(expr) = &select.prewhere {
            self.visit_expr(expr);
        }
        if let Some(expr) = &select.selection {
            self.visit_expr(expr);
        }
        if let GroupByExpr::Expressions(exprs, _) = &select.group_by {
            for expr in exprs {
                self.visit_expr(expr);
            }
        }
        for expr in &select.cluster_by {
            self.visit_expr(expr);
        }
        for expr in &select.distribute_by {
            self.visit_expr(expr);
        }
        for expr in &select.sort_by {
            self.visit_expr(&expr.expr);
        }
        if let Some(expr) = &select.having {
            self.visit_expr(expr);
        }
        if let Some(expr) = &select.qualify {
            self.visit_expr(expr);
        }
    }

    fn visit_table_with_joins(&mut self, table: &TableWithJoins) {
        self.visit_table_factor(&table.relation);
        for join in &table.joins {
            self.visit_table_factor(&join.relation);
            self.visit_join_operator(&join.join_operator);
        }
    }

    fn visit_join_operator(&mut self, operator: &JoinOperator) {
        match operator {
            JoinOperator::Join(constraint)
            | JoinOperator::Inner(constraint)
            | JoinOperator::Left(constraint)
            | JoinOperator::LeftOuter(constraint)
            | JoinOperator::Right(constraint)
            | JoinOperator::RightOuter(constraint)
            | JoinOperator::FullOuter(constraint)
            | JoinOperator::CrossJoin(constraint)
            | JoinOperator::Semi(constraint)
            | JoinOperator::LeftSemi(constraint)
            | JoinOperator::RightSemi(constraint)
            | JoinOperator::Anti(constraint)
            | JoinOperator::LeftAnti(constraint)
            | JoinOperator::RightAnti(constraint)
            | JoinOperator::StraightJoin(constraint) => self.visit_join_constraint(constraint),
            JoinOperator::AsOf { match_condition, constraint } => {
                self.visit_expr(match_condition);
                self.visit_join_constraint(constraint);
            }
            _ => {}
        }
    }

    fn visit_join_constraint(&mut self, constraint: &JoinConstraint) {
        match constraint {
            JoinConstraint::On(expr) => self.visit_expr(expr),
            JoinConstraint::Using(names) => {
                for name in names {
                    if let Some(ident) = object_name_last_ident(name) {
                        self.push_column(None, ident);
                    }
                }
            }
            _ => {}
        }
    }

    fn visit_table_factor(&mut self, factor: &TableFactor) {
        match factor {
            TableFactor::Table { name, alias, args, .. } => {
                self.push_alias_columns(alias.as_ref());
                if args.is_none() {
                    if let Some(table) = table_reference_from_name(name, alias.as_ref().map(|a| a.name.value.clone())) {
                        self.tables.push(table);
                    }
                }
            }
            TableFactor::Derived { subquery, alias, .. } => {
                self.push_alias_columns(alias.as_ref());
                // A derived table is referenced by its alias, and its output
                // columns are what completion should suggest for that alias.
                if let Some(alias) = alias {
                    let columns = if alias.columns.is_empty() {
                        query_output_columns(subquery)
                    } else {
                        alias.columns.iter().map(|column| column.name.value.clone()).collect()
                    };
                    self.derived_tables.push(SqlDerivedTable { alias: alias.name.value.clone(), columns });
                }
                self.visit_query(subquery);
            }
            TableFactor::NestedJoin { table_with_joins, .. } => self.visit_table_with_joins(table_with_joins),
            TableFactor::TableFunction { expr, alias, .. } => {
                self.push_alias_columns(alias.as_ref());
                self.visit_expr(expr);
            }
            TableFactor::Function { args, alias, .. } => {
                self.push_alias_columns(alias.as_ref());
                for arg in args {
                    self.visit_function_arg(arg);
                }
            }
            TableFactor::UNNEST { array_exprs, alias, .. } => {
                self.push_alias_columns(alias.as_ref());
                for expr in array_exprs {
                    self.visit_expr(expr);
                }
            }
            _ => {}
        }
    }

    // `FROM t AS t(a, b)`-style column lists expose names that are not schema
    // columns; record them so confidence-gated consumers can skip them.
    fn push_alias_columns(&mut self, alias: Option<&TableAlias>) {
        if let Some(alias) = alias {
            for column in &alias.columns {
                self.alias_columns.push(column.name.value.clone());
            }
        }
    }

    fn visit_expr(&mut self, expr: &Expr) {
        match expr {
            Expr::Identifier(ident) => self.push_column(None, ident),
            Expr::CompoundIdentifier(idents) => {
                if idents.len() >= 2 {
                    let column = idents.last().expect("checked length");
                    let qualifier = idents.get(idents.len() - 2).map(|ident| ident.value.clone());
                    self.push_column(qualifier, column);
                }
            }
            Expr::CompoundFieldAccess { root, .. } | Expr::JsonAccess { value: root, .. } => self.visit_expr(root),
            Expr::IsFalse(expr)
            | Expr::IsNotFalse(expr)
            | Expr::IsTrue(expr)
            | Expr::IsNotTrue(expr)
            | Expr::IsNull(expr)
            | Expr::IsNotNull(expr)
            | Expr::IsUnknown(expr)
            | Expr::IsNotUnknown(expr)
            | Expr::UnaryOp { expr, .. }
            | Expr::Nested(expr) => self.visit_expr(expr),
            Expr::IsDistinctFrom(left, right)
            | Expr::IsNotDistinctFrom(left, right)
            | Expr::BinaryOp { left, right, .. }
            | Expr::AnyOp { left, right, .. }
            | Expr::AllOp { left, right, .. } => {
                self.visit_expr(left);
                self.visit_expr(right);
            }
            Expr::InList { expr, list, .. } => {
                self.visit_expr(expr);
                for item in list {
                    self.visit_expr(item);
                }
            }
            Expr::InSubquery { expr, subquery, .. } => {
                self.visit_expr(expr);
                self.visit_query(subquery);
            }
            Expr::InUnnest { expr, array_expr, .. } => {
                self.visit_expr(expr);
                self.visit_expr(array_expr);
            }
            Expr::Between { expr, low, high, .. } => {
                self.visit_expr(expr);
                self.visit_expr(low);
                self.visit_expr(high);
            }
            Expr::Like { expr, pattern, .. }
            | Expr::ILike { expr, pattern, .. }
            | Expr::SimilarTo { expr, pattern, .. }
            | Expr::RLike { expr, pattern, .. } => {
                self.visit_expr(expr);
                self.visit_expr(pattern);
            }
            Expr::Cast { expr, .. }
            | Expr::Extract { expr, .. }
            | Expr::Ceil { expr, .. }
            | Expr::Floor { expr, .. } => self.visit_expr(expr),
            Expr::AtTimeZone { timestamp, time_zone } => {
                self.visit_expr(timestamp);
                self.visit_expr(time_zone);
            }
            Expr::Position { expr, r#in } => {
                self.visit_expr(expr);
                self.visit_expr(r#in);
            }
            Expr::Function(function) => {
                self.visit_function_args(&function.parameters);
                self.visit_function_args(&function.args);
                if let Some(filter) = &function.filter {
                    self.visit_expr(filter);
                }
                for order in &function.within_group {
                    self.visit_expr(&order.expr);
                }
            }
            Expr::Case { operand, conditions, else_result, .. } => {
                if let Some(operand) = operand {
                    self.visit_expr(operand);
                }
                for condition in conditions {
                    self.visit_expr(&condition.condition);
                    self.visit_expr(&condition.result);
                }
                if let Some(else_result) = else_result {
                    self.visit_expr(else_result);
                }
            }
            Expr::Subquery(query) | Expr::Exists { subquery: query, .. } => self.visit_query(query),
            _ => {}
        }
    }

    fn visit_function_args(&mut self, args: &FunctionArguments) {
        match args {
            FunctionArguments::Subquery(query) => self.visit_query(query),
            FunctionArguments::List(list) => {
                for arg in &list.args {
                    self.visit_function_arg(arg);
                }
                for clause in &list.clauses {
                    if let sqlparser::ast::FunctionArgumentClause::OrderBy(items) = clause {
                        for item in items {
                            self.visit_expr(&item.expr);
                        }
                    }
                }
            }
            FunctionArguments::None => {}
        }
    }

    fn visit_function_arg(&mut self, arg: &FunctionArg) {
        match arg {
            FunctionArg::Named { arg, .. } | FunctionArg::ExprNamed { arg, .. } | FunctionArg::Unnamed(arg) => {
                if let FunctionArgExpr::Expr(expr) = arg {
                    self.visit_expr(expr);
                }
            }
        }
    }

    fn push_column(&mut self, qualifier: Option<String>, ident: &Ident) {
        self.columns.push(SqlColumnReference { name: ident.value.clone(), qualifier, span: ident.span.into() });
    }

    fn push_table_reference(&mut self, name: &ObjectName, alias: Option<String>) {
        if let Some(table) = table_reference_from_name(name, alias) {
            self.tables.push(table);
        }
    }
}

/// Output columns of a CTE: the explicit column list when given, otherwise
/// derived from the body's top-level select list.
fn cte_output_columns(cte: &sqlparser::ast::Cte) -> Vec<String> {
    if !cte.alias.columns.is_empty() {
        return cte.alias.columns.iter().map(|column| column.name.value.clone()).collect();
    }
    query_output_columns(&cte.query)
}

fn query_output_columns(query: &Query) -> Vec<String> {
    set_expr_output_columns(&query.body)
}

// UNION/INTERSECT/EXCEPT bodies expose the left side's columns; follow it down
// to the first select (this is what `WITH RECURSIVE … AS (SELECT … UNION ALL
// SELECT …)` needs).
fn set_expr_output_columns(set_expr: &SetExpr) -> Vec<String> {
    match set_expr {
        SetExpr::Select(select) => select_output_columns(select),
        SetExpr::Query(query) => query_output_columns(query),
        SetExpr::SetOperation { left, .. } => set_expr_output_columns(left),
        _ => vec![],
    }
}

// Visible output names of a select list: bare and compound identifiers, plus
// aliases. Stars and computed expressions have no single name to expose.
fn select_output_columns(select: &Select) -> Vec<String> {
    let mut columns = Vec::new();
    for item in &select.projection {
        match item {
            SelectItem::UnnamedExpr(Expr::Identifier(ident)) => columns.push(ident.value.clone()),
            SelectItem::UnnamedExpr(Expr::CompoundIdentifier(idents)) => {
                if let Some(last) = idents.last() {
                    columns.push(last.value.clone());
                }
            }
            SelectItem::ExprWithAlias { alias, .. } => columns.push(alias.value.clone()),
            SelectItem::ExprWithAliases { aliases, .. } => {
                for alias in aliases {
                    columns.push(alias.value.clone());
                }
            }
            _ => {}
        }
    }
    columns
}

fn table_reference_from_name(name: &ObjectName, alias: Option<String>) -> Option<SqlTableReference> {
    let parts: Vec<&Ident> = name.0.iter().filter_map(ObjectNamePart::as_ident).collect();
    let table = parts.last()?;
    // `schema.table` and `db.schema.table` carry a schema; a bare table name
    // must not leak its own name into the schema slot.
    let schema = parts.len().checked_sub(2).and_then(|index| parts.get(index)).map(|ident| ident.value.clone());

    Some(SqlTableReference { name: table.value.clone(), schema, alias, span: table.span.into() })
}

fn object_name_last_ident(name: &ObjectName) -> Option<&Ident> {
    name.0.iter().rev().find_map(ObjectNamePart::as_ident)
}

fn object_name_part_ident(part: &ObjectNamePart) -> Option<&Ident> {
    match part {
        ObjectNamePart::Identifier(ident) => Some(ident),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_dialect_groups_engines_like_the_frontend_map() {
        // Locked table — mirrors SQL_DIALECT_ALIASES in
        // apps/desktop/src/lib/sqlDialect.ts. Change both together.
        let expected: &[(&str, &str)] = &[
            ("postgres", "postgres"),
            ("postgresql", "postgres"),
            ("redshift", "postgres"),
            ("opengauss", "postgres"),
            ("gaussdb", "postgres"),
            ("highgo", "postgres"),
            ("kingbase", "postgres"),
            ("vastbase", "postgres"),
            ("kwdb", "postgres"),
            ("mysql", "mysql"),
            ("mariadb", "mysql"),
            ("doris", "mysql"),
            ("starrocks", "mysql"),
            ("oceanbase", "mysql"),
            ("goldendb", "mysql"),
            ("databend", "mysql"),
            ("sqlite", "sqlite"),
            ("rqlite", "sqlite"),
            ("sqlserver", "sqlserver"),
            ("mssql", "sqlserver"),
            ("clickhouse", "clickhouse"),
            ("duckdb", "duckdb"),
            ("oracle", "oracle"),
            ("dameng", "oracle"),
            ("oceanbase-oracle", "oracle"),
            ("yashandb", "oracle"),
        ];
        for (input, want) in expected {
            assert_eq!(&normalize_dialect(Some(input)), want, "alias {input}");
        }

        // Case-insensitive, like the frontend lookup.
        assert_eq!(normalize_dialect(Some("Postgres")), "postgres");
        assert_eq!(normalize_dialect(Some("OCEANBASE-ORACLE")), "oracle");

        // Missing and unknown inputs fall back to generic, never to a family.
        assert_eq!(normalize_dialect(None), "generic");
        assert_eq!(normalize_dialect(Some("h2")), "generic");
        assert_eq!(normalize_dialect(Some("gbase")), "generic");
        assert_eq!(normalize_dialect(Some("jdbc")), "generic");
    }
}
