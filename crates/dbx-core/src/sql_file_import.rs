use std::time::Instant;

use tokio_util::sync::CancellationToken;

use crate::connection::AppState;
use crate::models::connection::DatabaseType;
use crate::query::execute_sql_statement;
use crate::sql::{
    optimize_sql_file_import_statements, statement_summary, SqlFileImportStatement, SqlFileImportStatementKind,
    SqlFileProgress, SqlFileRequest, SqlFileStatus, SqlParsingOptions, SqlStatementSplitter,
};

#[derive(Debug, Clone)]
struct SqlFileImportTarget {
    db_type: DatabaseType,
    driver_profile: Option<String>,
}

#[derive(Debug)]
struct StatementErrorDecision {
    progress: Vec<SqlFileProgress>,
    failure_count: usize,
    result: Result<bool, String>,
}

/// Running state for a single SQL-file import: the execution identity plus the
/// counters every `SqlFileProgress` event reports. Bundling these avoids
/// threading the same five values through the import call chain positionally.
struct ProgressTracker {
    execution_id: String,
    started_at: Instant,
    success_count: usize,
    failure_count: usize,
    affected_rows: u64,
}

impl ProgressTracker {
    fn new(execution_id: &str, started_at: Instant) -> Self {
        Self {
            execution_id: execution_id.to_string(),
            started_at,
            success_count: 0,
            failure_count: 0,
            affected_rows: 0,
        }
    }

    /// Snapshot the current counters into a progress event.
    fn progress(
        &self,
        status: SqlFileStatus,
        statement_index: usize,
        summary: &str,
        error: Option<String>,
    ) -> SqlFileProgress {
        sql_file_progress(
            &self.execution_id,
            status,
            statement_index,
            self.success_count,
            self.failure_count,
            self.affected_rows,
            self.started_at,
            summary,
            error,
        )
    }
}

pub async fn execute_sql_file_content(
    state: &AppState,
    request: &SqlFileRequest,
    file_content: &str,
    token: CancellationToken,
    started_at: Instant,
    mut emit: impl FnMut(SqlFileProgress),
) -> Result<(), String> {
    let mut statement_index = 0;
    let mut tracker = ProgressTracker::new(&request.execution_id, started_at);

    let import_target = sql_file_import_target(state, &request.connection_id).await;
    let options =
        import_target.as_ref().map(|target| SqlParsingOptions::for_database_type(target.db_type)).unwrap_or_default();
    let mut splitter = SqlStatementSplitter::with_options(options);
    let mut statements = splitter.push_chunk(file_content);
    statements.extend(splitter.finish());

    let planned_statements = optimize_sql_file_import_statements(
        &statements,
        import_target.as_ref().map(|target| target.db_type),
        import_target.as_ref().and_then(|target| target.driver_profile.as_deref()),
    );

    for planned_statement in planned_statements {
        if token.is_cancelled() {
            emit(tracker.progress(SqlFileStatus::Cancelled, statement_index, "", None));
            return Ok(());
        }

        let next_statement_index = statement_index + planned_statement.source_statement_count;
        if execute_statement_with_progress(
            state,
            request,
            &token,
            &mut tracker,
            next_statement_index,
            &planned_statement,
            &mut emit,
        )
        .await?
        {
            return Ok(());
        }
        statement_index = next_statement_index;
    }

    emit(tracker.progress(SqlFileStatus::Done, statement_index, "", None));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn sql_file_progress(
    execution_id: &str,
    status: SqlFileStatus,
    statement_index: usize,
    success_count: usize,
    failure_count: usize,
    affected_rows: u64,
    started_at: Instant,
    statement_summary: &str,
    error: Option<String>,
) -> SqlFileProgress {
    SqlFileProgress {
        execution_id: execution_id.to_string(),
        status,
        statement_index,
        success_count,
        failure_count,
        affected_rows,
        elapsed_ms: started_at.elapsed().as_millis(),
        statement_summary: statement_summary.to_string(),
        error,
    }
}

pub fn sql_file_error_progress(execution_id: &str, started_at: Instant, error: String) -> SqlFileProgress {
    sql_file_progress(execution_id, SqlFileStatus::Error, 0, 0, 0, 0, started_at, "", Some(error))
}

async fn sql_file_import_target(state: &AppState, connection_id: &str) -> Option<SqlFileImportTarget> {
    let configs = state.configs.read().await;
    configs
        .get(connection_id)
        .map(|config| SqlFileImportTarget { db_type: config.db_type, driver_profile: config.driver_profile.clone() })
}

async fn execute_statement_with_progress(
    state: &AppState,
    request: &SqlFileRequest,
    token: &CancellationToken,
    tracker: &mut ProgressTracker,
    statement_index: usize,
    statement: &SqlFileImportStatement,
    emit: &mut impl FnMut(SqlFileProgress),
) -> Result<bool, String> {
    if token.is_cancelled() {
        let summary = statement_summary(&statement.sql);
        emit(tracker.progress(SqlFileStatus::Cancelled, statement_index, &summary, None));
        return Ok(true);
    }

    if statement.kind == SqlFileImportStatementKind::Skip {
        let summary = statement_summary(&statement.sql);
        emit(tracker.progress(SqlFileStatus::Running, statement_index, &summary, None));
        tracker.success_count += statement.source_statement_count;
        emit(tracker.progress(SqlFileStatus::StatementDone, statement_index, &summary, None));
        return Ok(false);
    }

    let summary = statement_summary(&statement.sql);
    emit(tracker.progress(SqlFileStatus::Running, statement_index, &summary, None));

    match execute_sql_statement(
        state,
        &request.connection_id,
        &request.database,
        &statement.sql,
        None,
        Some(token.clone()),
    )
    .await
    {
        Ok(result) => {
            tracker.success_count += statement.source_statement_count;
            tracker.affected_rows += result.affected_rows;
            emit(tracker.progress(SqlFileStatus::StatementDone, statement_index, &summary, None));
            Ok(false)
        }
        Err(error) => {
            if statement.source_statement_count > 1 && !token.is_cancelled() {
                return execute_merged_statement_fallback_with_progress(
                    state,
                    request,
                    token,
                    tracker,
                    statement_index + 1 - statement.source_statement_count,
                    statement,
                    emit,
                )
                .await;
            }

            let decision =
                statement_error_decision(tracker, token, request.continue_on_error, statement_index, &summary, error);

            tracker.failure_count = decision.failure_count;
            for progress in decision.progress {
                emit(progress);
            }
            decision.result
        }
    }
}

async fn execute_merged_statement_fallback_with_progress(
    state: &AppState,
    request: &SqlFileRequest,
    token: &CancellationToken,
    tracker: &mut ProgressTracker,
    first_statement_index: usize,
    statement: &SqlFileImportStatement,
    emit: &mut impl FnMut(SqlFileProgress),
) -> Result<bool, String> {
    for (offset, source_sql) in statement.source_sqls.iter().enumerate() {
        let statement_index = first_statement_index + offset;
        if token.is_cancelled() {
            emit(tracker.progress(SqlFileStatus::Cancelled, statement_index, &statement_summary(source_sql), None));
            return Ok(true);
        }

        let summary = statement_summary(source_sql);
        emit(tracker.progress(SqlFileStatus::Running, statement_index, &summary, None));

        match execute_sql_statement(
            state,
            &request.connection_id,
            &request.database,
            source_sql,
            None,
            Some(token.clone()),
        )
        .await
        {
            Ok(result) => {
                tracker.success_count += 1;
                tracker.affected_rows += result.affected_rows;
                emit(tracker.progress(SqlFileStatus::StatementDone, statement_index, &summary, None));
            }
            Err(error) => {
                let decision = statement_error_decision(
                    tracker,
                    token,
                    request.continue_on_error,
                    statement_index,
                    &summary,
                    error,
                );

                tracker.failure_count = decision.failure_count;
                for progress in decision.progress {
                    emit(progress);
                }
                if decision.result? {
                    return Ok(true);
                }
            }
        }
    }

    Ok(false)
}

fn statement_error_decision(
    tracker: &ProgressTracker,
    token: &CancellationToken,
    continue_on_error: bool,
    statement_index: usize,
    summary: &str,
    error: String,
) -> StatementErrorDecision {
    if token.is_cancelled() {
        return StatementErrorDecision {
            progress: vec![tracker.progress(SqlFileStatus::Cancelled, statement_index, summary, None)],
            failure_count: tracker.failure_count,
            result: Ok(true),
        };
    }

    let failure_count = tracker.failure_count + 1;
    let statement_failed = sql_file_progress(
        &tracker.execution_id,
        SqlFileStatus::StatementFailed,
        statement_index,
        tracker.success_count,
        failure_count,
        tracker.affected_rows,
        tracker.started_at,
        summary,
        Some(error.clone()),
    );

    if continue_on_error {
        return StatementErrorDecision { progress: vec![statement_failed], failure_count, result: Ok(false) };
    }

    let terminal_error = sql_file_progress(
        &tracker.execution_id,
        SqlFileStatus::Error,
        statement_index,
        tracker.success_count,
        failure_count,
        tracker.affected_rows,
        tracker.started_at,
        summary,
        Some(error.clone()),
    );

    StatementErrorDecision { progress: vec![statement_failed, terminal_error], failure_count, result: Err(error) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_on_error_returns_err_with_terminal_error_progress() {
        let tracker = ProgressTracker {
            execution_id: "exec-1".to_string(),
            started_at: Instant::now(),
            success_count: 1,
            failure_count: 0,
            affected_rows: 5,
        };
        let decision = statement_error_decision(
            &tracker,
            &CancellationToken::new(),
            false,
            3,
            "bad statement",
            "syntax error".to_string(),
        );

        assert_eq!(decision.failure_count, 1);
        assert_eq!(decision.result, Err("syntax error".to_string()));
        assert_eq!(decision.progress.len(), 2);
        assert_eq!(decision.progress[0].status, SqlFileStatus::StatementFailed);
        assert_eq!(decision.progress[1].status, SqlFileStatus::Error);
        assert_eq!(decision.progress[1].error, Some("syntax error".to_string()));
    }

    #[test]
    fn cancelled_in_flight_error_does_not_increment_failure_count() {
        let token = CancellationToken::new();
        token.cancel();

        let tracker = ProgressTracker {
            execution_id: "exec-1".to_string(),
            started_at: Instant::now(),
            success_count: 1,
            failure_count: 4,
            affected_rows: 9,
        };
        let decision =
            statement_error_decision(&tracker, &token, false, 2, "slow statement", "Query canceled".to_string());

        assert_eq!(decision.failure_count, 4);
        assert_eq!(decision.result, Ok(true));
        assert_eq!(decision.progress.len(), 1);
        assert_eq!(decision.progress[0].status, SqlFileStatus::Cancelled);
        assert_eq!(decision.progress[0].failure_count, 4);
        assert_eq!(decision.progress[0].error, None);
    }

    #[test]
    fn progress_payload_serializes_camel_case_status() {
        let progress =
            sql_file_progress("exec-1", SqlFileStatus::StatementDone, 1, 1, 0, 3, Instant::now(), "select 1", None);

        let value = serde_json::to_value(progress).unwrap();

        assert_eq!(value["executionId"], "exec-1");
        assert_eq!(value["statementIndex"], 1);
        assert_eq!(value["successCount"], 1);
        assert_eq!(value["failureCount"], 0);
        assert_eq!(value["affectedRows"], 3);
        assert_eq!(value["statementSummary"], "select 1");
        assert_eq!(value["status"], "statementDone");
        assert!(value.get("execution_id").is_none());
    }
}
