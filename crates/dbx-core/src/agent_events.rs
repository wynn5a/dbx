//! Wire contract for the server-side tool-calling agent loop.
//!
//! `AgentEvent` is the single stream the loop emits; the Tauri command layer
//! forwards each event as a `ai-agent-event` window event and the web layer
//! forwards it as an SSE `data:` line, so desktop and web stay at parity.
//! Events are `#[serde(tag = "type", rename_all = "snake_case")]` so the
//! frontend can switch on `event.type` (matching the snake_case field style of
//! [`crate::ai::AiStreamChunk`]).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Streaming events emitted by the agent loop, in emission order.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// A new model turn is starting (0-based).
    TurnStart { turn: u32 },
    /// Assistant text delta.
    TextDelta { delta: String },
    /// Assistant reasoning/thinking delta.
    ReasoningDelta { delta: String },
    /// The model requested a tool call; arguments are the parsed JSON object.
    ToolCallStart { tool_call_id: String, tool_name: String, args: Value },
    /// A tool finished. `result` is `{ "content": <text>, "explain_data"?: <QueryResult> }`.
    ToolCallEnd { tool_call_id: String, tool_name: String, result: Value, is_error: bool },
    /// The model wants to run a mutating (non read-only) statement. The loop
    /// pauses until the frontend calls `resolve_confirmation` for this
    /// `tool_call_id` (approve runs it, reject feeds a rejection back to the model).
    ToolConfirmRequest { tool_call_id: String, tool_name: String, sql: String },
    /// A model turn finished.
    TurnEnd { turn: u32 },
    /// The agent loop finished; carries best-effort token usage.
    AgentEnd {
        #[serde(skip_serializing_if = "Option::is_none")]
        input_tokens: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_tokens: Option<u32>,
    },
    /// A fatal error ended the loop.
    Error { message: String },
}

/// A normalized tool call, produced after parsing a provider's streamed response.
/// The provider-specific shape is collapsed into this by
/// [`crate::ai::StreamingToolCallAccumulator`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// Result of executing a tool. `content` is the text fed back to the model;
/// `explain_data` is an optional structured side-channel for the frontend
/// (only `explain_query` sets it — a serialized `QueryResult` for the
/// ExplainPlanViewer).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub tool_name: String,
    pub content: String,
    pub is_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explain_data: Option<Value>,
}

impl ToolResult {
    pub fn ok(tool_call: &ToolCall, content: String) -> Self {
        Self {
            tool_call_id: tool_call.id.clone(),
            tool_name: tool_call.name.clone(),
            content,
            is_error: false,
            explain_data: None,
        }
    }

    pub fn error(tool_call: &ToolCall, message: impl Into<String>) -> Self {
        Self {
            tool_call_id: tool_call.id.clone(),
            tool_name: tool_call.name.clone(),
            content: format!("Error: {}", message.into()),
            is_error: true,
            explain_data: None,
        }
    }
}

/// Definition of a tool exposed to the model. Definitions are compile-time
/// constants, hence `&'static str`. `read_only` documents intent; `parallel_ok`
/// drives the loop's parallel-vs-sequential execution split.
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
    pub read_only: bool,
    pub parallel_ok: bool,
}

impl ToolDefinition {
    /// OpenAI / OpenAI-compatible `tools[]` entry.
    pub fn to_openai_tool(&self) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        })
    }

    /// Anthropic `tools[]` entry.
    pub fn to_anthropic_tool(&self) -> Value {
        json!({
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        })
    }

    /// Gemini `functionDeclarations[]` entry (reserved for future Gemini tool support).
    pub fn to_gemini_tool(&self) -> Value {
        json!({
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_event_serializes_with_type_tag() {
        let ev = AgentEvent::TextDelta { delta: "hi".into() };
        assert_eq!(serde_json::to_value(&ev).unwrap(), json!({ "type": "text_delta", "delta": "hi" }));

        let ev =
            AgentEvent::ToolCallStart { tool_call_id: "c1".into(), tool_name: "list_tables".into(), args: json!({}) };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "tool_call_start");
        assert_eq!(v["tool_name"], "list_tables");
    }

    #[test]
    fn tool_definition_provider_shapes() {
        let def = ToolDefinition {
            name: "list_tables",
            description: "List tables",
            parameters: json!({ "type": "object", "properties": {} }),
            read_only: true,
            parallel_ok: true,
        };
        assert_eq!(def.to_openai_tool()["function"]["name"], "list_tables");
        assert_eq!(def.to_anthropic_tool()["input_schema"]["type"], "object");
        assert_eq!(def.to_gemini_tool()["name"], "list_tables");
    }
}
