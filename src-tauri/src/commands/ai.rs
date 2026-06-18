use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use super::connection::AppState;
use dbx_core::agent_events::AgentEvent;
use dbx_core::agent_loop::AgentStreamRequest;
pub use dbx_core::ai::*;

/// Envelope for agent events on the shared Tauri event bus: the frontend filters
/// by `session_id` and dispatches on `event.type`.
#[derive(Clone, serde::Serialize)]
struct AgentEventEnvelope {
    session_id: String,
    event: AgentEvent,
}

#[tauri::command]
pub async fn ai_test_connection(config: AiConfig) -> Result<String, String> {
    dbx_core::ai::test_connection_core(&config).await
}

#[tauri::command]
pub async fn ai_list_models(config: AiConfig) -> Result<Vec<AiModelInfo>, String> {
    dbx_core::ai::list_models_core(&config).await
}

#[tauri::command]
pub async fn save_ai_config(state: State<'_, Arc<AppState>>, config: AiConfig) -> Result<(), String> {
    state.storage.save_ai_config(&config).await
}

#[tauri::command]
pub async fn load_ai_config(state: State<'_, Arc<AppState>>) -> Result<Option<AiConfig>, String> {
    state.storage.load_ai_config().await
}

#[tauri::command]
pub async fn ai_complete(request: AiCompletionRequest) -> Result<String, String> {
    dbx_core::ai::complete(&request).await
}

#[tauri::command]
pub async fn ai_stream(app: AppHandle, session_id: String, request: AiCompletionRequest) -> Result<(), String> {
    let cancelled = dbx_core::ai::register_stream(&session_id).await;

    let result = dbx_core::ai::stream(&session_id, &request, &cancelled, |chunk| {
        let _ = app.emit("ai-stream-chunk", &chunk);
    })
    .await;

    dbx_core::ai::unregister_stream(&session_id).await;
    result
}

#[tauri::command]
pub async fn ai_cancel_stream(session_id: String) -> Result<bool, String> {
    Ok(dbx_core::ai::cancel_stream(&session_id).await)
}

#[tauri::command]
pub async fn ai_agent_stream(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    request: AgentStreamRequest,
) -> Result<(), String> {
    let cancelled = dbx_core::ai::register_stream(&session_id).await;
    let ctx = request.loop_context(state.inner().clone());
    let is_agent_mode = request.is_agent_mode();

    let emit_session = session_id.clone();
    let result = dbx_core::agent_loop::run_agent_loop(
        &request.config,
        &request.system_prompt,
        &request.messages,
        &ctx,
        &session_id,
        move |event| {
            let _ = app.emit("ai-agent-event", AgentEventEnvelope { session_id: emit_session.clone(), event });
        },
        &cancelled,
        request.max_tokens,
        request.temperature,
        is_agent_mode,
    )
    .await;

    dbx_core::ai::unregister_stream(&session_id).await;
    result.map(|_| ())
}

#[tauri::command]
pub async fn ai_agent_confirm_tool(session_id: String, tool_call_id: String, approved: bool) -> Result<bool, String> {
    Ok(dbx_core::ai::resolve_confirmation(&session_id, &tool_call_id, approved).await)
}

#[tauri::command]
pub async fn save_ai_conversation(state: State<'_, Arc<AppState>>, conversation: AiConversation) -> Result<(), String> {
    state.storage.save_ai_conversation(&conversation).await
}

#[tauri::command]
pub async fn load_ai_conversations(state: State<'_, Arc<AppState>>) -> Result<Vec<AiConversation>, String> {
    state.storage.load_ai_conversations().await
}

#[tauri::command]
pub async fn delete_ai_conversation(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    state.storage.delete_ai_conversation(&id).await
}
