//! Server-side tool-calling agent loop.
//!
//! Drives a multi-turn conversation: stream a model turn, execute any tool calls
//! it makes (read tools in parallel, `execute_query` sequentially with a write
//! confirmation gate), feed results back, and repeat until the model stops
//! calling tools or [`MAX_AGENT_TURNS`] is reached. Every step is reported via
//! `on_event`; the Tauri/web layers forward those events to the frontend.
//!
//! Providers without native function calling (Ollama, and Gemini in this
//! codebase) fall back to a single schema-injected completion.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures::future::join_all;
use futures::FutureExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Notify;

use crate::agent_events::{AgentEvent, ToolCall, ToolDefinition, ToolResult};
use crate::agent_tools;
use crate::ai::{self, AiCompletionRequest, AiConfig, AiMessage, AiStreamChunk, TokenUsage, ToolCallRef};
use crate::connection::AppState;
use crate::database_capabilities;
use crate::models::connection::DatabaseType;
use crate::query_execution_sql::is_read_only_sql;
use crate::schema;

/// Maximum model turns before the loop stops regardless of tool activity.
const MAX_AGENT_TURNS: u32 = 10;
/// Tool results larger than this (chars) are head+tail compacted before being
/// fed back to the model. The frontend still receives the full result via the
/// `ToolCallEnd` event.
const MAX_TOOL_RESULT_CONTEXT_CHARS: usize = 12_000;
const TOOL_RESULT_HEAD_CHARS: usize = 8_000;
const TOOL_RESULT_TAIL_CHARS: usize = 3_000;

/// How the agent loop ended, so we can leave the user an explanatory note
/// before the terminal `AgentEnd` event. `Completed` (the model answered) needs
/// no note; the others would otherwise stop with no on-screen explanation.
enum LoopOutcome {
    Completed,
    Cancelled,
    Exhausted,
}

impl LoopOutcome {
    /// A short note to stream to the user, or `None` for a clean completion.
    fn note(&self, max_turns: u32) -> Option<String> {
        match self {
            LoopOutcome::Completed => None,
            LoopOutcome::Cancelled => Some("\n\n_Agent run cancelled._".to_string()),
            LoopOutcome::Exhausted => Some(format!(
                "\n\n_Agent stopped after the {max_turns}-turn safety limit. Send another message to let it keep working._"
            )),
        }
    }
}

/// Everything the tools need to reach the live connection.
#[derive(Clone)]
pub struct AgentLoopContext {
    pub state: Arc<AppState>,
    pub connection_id: String,
    pub database: String,
    pub db_type: DatabaseType,
}

/// Request payload shared by the Tauri command and the web SSE route, so both
/// transports deserialize the agent stream identically.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamRequest {
    pub config: AiConfig,
    pub system_prompt: String,
    pub messages: Vec<AiMessage>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    pub connection_id: String,
    pub database: String,
    pub db_type: DatabaseType,
    /// "agent" exposes execution tools; anything else (incl. absent) is Ask mode.
    #[serde(default)]
    pub mode: Option<String>,
}

impl AgentStreamRequest {
    pub fn is_agent_mode(&self) -> bool {
        self.mode.as_deref() == Some("agent")
    }

    pub fn loop_context(&self, state: Arc<AppState>) -> AgentLoopContext {
        AgentLoopContext {
            state,
            connection_id: self.connection_id.clone(),
            database: self.database.clone(),
            db_type: self.db_type,
        }
    }
}

/// Run the agent loop. Returns the model's final assistant text.
#[allow(clippy::too_many_arguments)]
pub async fn run_agent_loop(
    config: &AiConfig,
    system_prompt: &str,
    messages: &[AiMessage],
    ctx: &AgentLoopContext,
    session_id: &str,
    on_event: impl Fn(AgentEvent) + Send + Sync + Clone + 'static,
    cancelled: &Notify,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    is_agent_mode: bool,
) -> Result<String, String> {
    if !ai::provider_supports_function_calling(config) {
        return run_agent_loop_text_only(
            config,
            system_prompt,
            messages,
            ctx,
            session_id,
            on_event,
            cancelled,
            max_tokens,
            temperature,
        )
        .await;
    }

    let tools = if is_agent_mode { agent_tools::all_tools(ctx.db_type) } else { agent_tools::read_only_tools() };
    let mut convo: Vec<AiMessage> = messages.to_vec();
    let mut final_text = String::new();
    let mut total_usage = TokenUsage::default();
    // Default to Exhausted: only reached if the loop runs every turn without the
    // model giving a tool-free final answer or the user cancelling.
    let mut outcome = LoopOutcome::Exhausted;

    for turn in 0..MAX_AGENT_TURNS {
        if cancelled.notified().now_or_never().is_some() {
            outcome = LoopOutcome::Cancelled;
            break;
        }
        on_event(AgentEvent::TurnStart { turn });

        // Stream one model turn, accumulating assistant text and emitting deltas.
        let text_acc = Arc::new(Mutex::new(String::new()));
        let chunk_event = on_event.clone();
        let chunk_text = Arc::clone(&text_acc);
        let stream_request = ai::ToolStreamRequest {
            config,
            system_prompt,
            messages: &convo,
            session_id,
            tools: &tools,
            max_tokens,
            temperature,
            cancelled,
        };
        let stream_result = ai::stream_with_tools(&stream_request, move |chunk: AiStreamChunk| {
            if let Some(reasoning) = chunk.reasoning_delta.as_ref().filter(|r| !r.is_empty()) {
                chunk_event(AgentEvent::ReasoningDelta { delta: reasoning.clone() });
            }
            if !chunk.delta.is_empty() {
                chunk_text.lock().expect("text accumulator poisoned").push_str(&chunk.delta);
                chunk_event(AgentEvent::TextDelta { delta: chunk.delta });
            }
        })
        .await;

        let (tool_calls, usage) = match stream_result {
            Ok(value) => value,
            Err(err) => {
                on_event(AgentEvent::Error { message: err.clone() });
                ai::unregister_confirmations(session_id).await;
                return Err(err);
            }
        };

        accumulate_usage(&mut total_usage, usage);
        let turn_text = text_acc.lock().expect("text accumulator poisoned").clone();
        on_event(AgentEvent::TurnEnd { turn });

        // No tool calls => the model has answered; we're done.
        if tool_calls.is_empty() {
            final_text = turn_text;
            outcome = LoopOutcome::Completed;
            break;
        }

        // Record the assistant turn (text + its tool calls) so the provider sees
        // its own prior invocations on the next request.
        convo.push(AiMessage {
            role: "assistant".to_string(),
            content: turn_text,
            tool_call_id: None,
            tool_calls: tool_calls
                .iter()
                .map(|tc| ToolCallRef { id: tc.id.clone(), name: tc.name.clone(), arguments: tc.arguments.clone() })
                .collect(),
        });

        for tc in &tool_calls {
            on_event(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                tool_name: tc.name.clone(),
                args: tc.arguments.clone(),
            });
        }

        let results = execute_tool_calls(&tool_calls, &tools, ctx, session_id, &on_event, cancelled).await;

        for (tc, result) in tool_calls.iter().zip(results) {
            let result_json = match &result.explain_data {
                Some(explain) => json!({ "content": result.content, "explain_data": explain }),
                None => json!({ "content": result.content }),
            };
            on_event(AgentEvent::ToolCallEnd {
                tool_call_id: tc.id.clone(),
                tool_name: tc.name.clone(),
                result: result_json,
                is_error: result.is_error,
            });
            convo.push(AiMessage {
                role: "tool".to_string(),
                content: compact_tool_result(&result.content),
                tool_call_id: Some(tc.id.clone()),
                tool_calls: Vec::new(),
            });
        }
    }

    // Leave the user an explanation when the loop stopped without a clean answer
    // (turn-limit exhaustion or cancellation), so the conversation doesn't just
    // end mid-work. The UI renders the streamed text, so emit it as a TextDelta.
    if let Some(note) = outcome.note(MAX_AGENT_TURNS) {
        on_event(AgentEvent::TextDelta { delta: note.clone() });
        final_text.push_str(&note);
    }

    on_event(AgentEvent::AgentEnd { input_tokens: total_usage.input_tokens, output_tokens: total_usage.output_tokens });
    ai::unregister_confirmations(session_id).await;
    Ok(final_text)
}

/// Whether a tool call may run concurrently with the others in its turn.
///
/// A tool runs in parallel only when it is marked parallel-safe *and* the engine
/// has a real multi-connection pool. Single-connection drivers (SQLite, DuckDB,
/// Oracle, JDBC, …) serve every query from one pooled connection, so running a
/// turn's read tools concurrently there only contends for that one connection —
/// pointless at best, cascading "connection busy" tool errors at worst.
fn runs_in_parallel(db_type: &DatabaseType, tool_parallel_ok: bool) -> bool {
    tool_parallel_ok && !database_capabilities::is_single_connection_pool(db_type)
}

/// Execute a turn's tool calls: parallel-safe tools concurrently, the rest
/// (`execute_query`, plus everything on single-connection engines) sequentially
/// with a write confirmation gate. Results are returned in the original call order.
async fn execute_tool_calls(
    tool_calls: &[ToolCall],
    tools: &[ToolDefinition],
    ctx: &AgentLoopContext,
    session_id: &str,
    on_event: &(impl Fn(AgentEvent) + Clone),
    cancelled: &Notify,
) -> Vec<ToolResult> {
    let parallel_ok: HashMap<&str, bool> = tools.iter().map(|t| (t.name, t.parallel_ok)).collect();
    let (parallel_idx, sequential_idx): (Vec<usize>, Vec<usize>) = (0..tool_calls.len()).partition(|&i| {
        runs_in_parallel(&ctx.db_type, *parallel_ok.get(tool_calls[i].name.as_str()).unwrap_or(&false))
    });

    let parallel_futures = parallel_idx.iter().map(|&i| {
        let tc = tool_calls[i].clone();
        let state = Arc::clone(&ctx.state);
        let connection_id = ctx.connection_id.clone();
        let database = ctx.database.clone();
        let db_type = ctx.db_type;
        async move { agent_tools::execute_tool(&tc, &state, &connection_id, &database, &db_type).await }
    });
    let parallel_results = join_all(parallel_futures).await;

    let mut sequential_results = Vec::with_capacity(sequential_idx.len());
    for &i in &sequential_idx {
        sequential_results.push(run_with_confirmation(&tool_calls[i], ctx, session_id, on_event, cancelled).await);
    }

    let mut merged: Vec<Option<ToolResult>> = (0..tool_calls.len()).map(|_| None).collect();
    for (pos, &i) in parallel_idx.iter().enumerate() {
        merged[i] = Some(parallel_results[pos].clone());
    }
    for (pos, &i) in sequential_idx.iter().enumerate() {
        merged[i] = Some(sequential_results[pos].clone());
    }
    merged.into_iter().map(|r| r.expect("every tool call produces a result")).collect()
}

/// Run a (sequential) tool call, pausing for user confirmation first if it is a
/// mutating `execute_query`.
async fn run_with_confirmation(
    tc: &ToolCall,
    ctx: &AgentLoopContext,
    session_id: &str,
    on_event: &impl Fn(AgentEvent),
    cancelled: &Notify,
) -> ToolResult {
    if tc.name == "execute_query" {
        let sql = tc.arguments.get("sql").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if !sql.is_empty() && !is_read_only_sql(&sql, ctx.db_type) {
            on_event(AgentEvent::ToolConfirmRequest { tool_call_id: tc.id.clone(), tool_name: tc.name.clone(), sql });
            if !ai::await_confirmation(session_id, &tc.id, cancelled).await {
                return ToolResult::error(tc, "User rejected execution of this statement.");
            }
        }
    }
    agent_tools::execute_tool(tc, &ctx.state, &ctx.connection_id, &ctx.database, &ctx.db_type).await
}

/// Fallback for providers without native function calling: a single completion
/// with the database schema injected into the system prompt.
#[allow(clippy::too_many_arguments)]
async fn run_agent_loop_text_only(
    config: &AiConfig,
    system_prompt: &str,
    messages: &[AiMessage],
    ctx: &AgentLoopContext,
    session_id: &str,
    on_event: impl Fn(AgentEvent) + Clone,
    cancelled: &Notify,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
) -> Result<String, String> {
    let enriched_system = build_schema_prompt(ctx, system_prompt).await;
    on_event(AgentEvent::TurnStart { turn: 0 });

    let text_acc = Arc::new(Mutex::new(String::new()));
    let chunk_event = on_event.clone();
    let chunk_text = Arc::clone(&text_acc);
    let request = AiCompletionRequest {
        config: config.clone(),
        system_prompt: enriched_system,
        messages: messages.to_vec(),
        max_tokens,
        temperature,
    };

    let result = ai::stream(session_id, &request, cancelled, move |chunk| {
        if let Some(reasoning) = chunk.reasoning_delta.as_ref().filter(|r| !r.is_empty()) {
            chunk_event(AgentEvent::ReasoningDelta { delta: reasoning.clone() });
        }
        if !chunk.delta.is_empty() {
            chunk_text.lock().expect("text accumulator poisoned").push_str(&chunk.delta);
            chunk_event(AgentEvent::TextDelta { delta: chunk.delta });
        }
    })
    .await;

    on_event(AgentEvent::TurnEnd { turn: 0 });
    match result {
        Ok(()) => {
            on_event(AgentEvent::AgentEnd { input_tokens: None, output_tokens: None });
            Ok(text_acc.lock().expect("text accumulator poisoned").clone())
        }
        Err(err) => {
            on_event(AgentEvent::Error { message: err.clone() });
            Err(err)
        }
    }
}

async fn build_schema_prompt(ctx: &AgentLoopContext, system_prompt: &str) -> String {
    let mut enriched = system_prompt.to_string();
    if let Ok(tables) =
        schema::list_tables_core(&ctx.state, &ctx.connection_id, &ctx.database, &ctx.database, None, Some(50)).await
    {
        if !tables.is_empty() {
            enriched.push_str("\n\n## Database Schema (for context — no tools available)\n");
            enriched.push_str(&format!("Database: {}\n", ctx.database));
            enriched.push_str("Tables:\n");
            for t in &tables {
                enriched.push_str(&format!("  - {} ({})", t.name, t.table_type));
                if let Some(comment) = t.comment.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
                    enriched.push_str(&format!(" — {comment}"));
                }
                enriched.push('\n');
            }
        }
    }
    enriched
}

fn accumulate_usage(total: &mut TokenUsage, usage: TokenUsage) {
    if let Some(input) = usage.input_tokens {
        total.input_tokens = Some(total.input_tokens.unwrap_or(0) + input);
    }
    if let Some(output) = usage.output_tokens {
        total.output_tokens = Some(total.output_tokens.unwrap_or(0) + output);
    }
}

/// Keep large tool results within the context budget (char-safe head+tail).
fn compact_tool_result(content: &str) -> String {
    let total = content.chars().count();
    if total <= MAX_TOOL_RESULT_CONTEXT_CHARS {
        return content.to_string();
    }
    let head: String = content.chars().take(TOOL_RESULT_HEAD_CHARS).collect();
    let tail: String = content.chars().skip(total - TOOL_RESULT_TAIL_CHARS).collect();
    format!("{head}\n... (result truncated, {total} chars total) ...\n{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_tool_result_is_a_noop_when_small() {
        assert_eq!(compact_tool_result("short"), "short");
    }

    #[test]
    fn compact_tool_result_keeps_head_and_tail() {
        let content = "x".repeat(MAX_TOOL_RESULT_CONTEXT_CHARS + 5_000);
        let out = compact_tool_result(&content);
        assert!(out.len() < content.len());
        assert!(out.contains("result truncated"));
    }

    #[test]
    fn parallel_tools_serialize_on_single_connection_engines() {
        // Multi-connection engines keep the parallel speedup for parallel-safe tools.
        assert!(runs_in_parallel(&DatabaseType::Postgres, true));
        // Single-connection engines force every tool sequential, even parallel-safe ones.
        assert!(!runs_in_parallel(&DatabaseType::Sqlite, true));
        assert!(!runs_in_parallel(&DatabaseType::DuckDb, true));
        // A non-parallel tool (e.g. execute_query) is never parallelized anywhere.
        assert!(!runs_in_parallel(&DatabaseType::Postgres, false));
    }

    #[test]
    fn loop_outcome_notes() {
        // A clean completion adds nothing.
        assert!(LoopOutcome::Completed.note(MAX_AGENT_TURNS).is_none());
        // Cancellation and exhaustion both leave an explanatory note.
        assert!(LoopOutcome::Cancelled.note(MAX_AGENT_TURNS).unwrap().contains("cancelled"));
        let exhausted = LoopOutcome::Exhausted.note(MAX_AGENT_TURNS).unwrap();
        assert!(exhausted.contains(&MAX_AGENT_TURNS.to_string()));
        assert!(exhausted.contains("keep working"));
    }

    #[test]
    fn usage_accumulates_across_turns() {
        let mut total = TokenUsage::default();
        accumulate_usage(&mut total, TokenUsage { input_tokens: Some(10), output_tokens: Some(5) });
        accumulate_usage(&mut total, TokenUsage { input_tokens: Some(3), output_tokens: None });
        assert_eq!(total.input_tokens, Some(13));
        assert_eq!(total.output_tokens, Some(5));
    }
}
