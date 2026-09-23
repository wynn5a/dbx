//! Mock-SSE tests for the tool-calling stream (perf tasks T21 / plan §5 D5),
//! the initial-request retry (perf task T31 / plan §5 D6), structured output
//! for the final SQL (perf task T42 / plan §5 D9), and the agent loop end to
//! end (perf task T43 / plan §5 D10).
//!
//! A tiny HTTP server on a loopback port answers each request with the next
//! canned response, so Gemini and Ollama provider streams are driven across a
//! real multi-turn tool exchange: turn 1 streams a function call, the test
//! replays the result the same way `agent_loop` does, turn 2 streams the final
//! text — and the recorded request bodies assert what went back over the wire.
//! The T31 section reuses the same server to pin the retry contract: exactly
//! one retry for 429/5xx/connect failures before the response head, never
//! after the stream started. The T42 section pins the structured-output
//! contract: the `structured_output` opt-in must leave every non-OpenAI and
//! custom-endpoint request byte-identical (the fence fallback keeps the legacy
//! traffic), while the native `response_format: json_object` attach for the
//! official OpenAI API is a pure body-builder check (`openai_stream_body`)
//! because a loopback mock can never masquerade as the official host. The T43
//! section drives `run_agent_loop` itself across three model turns: two tool
//! rounds whose calls execute against a real SQLite database (not a stub) plus
//! the final text answer, and the write-confirmation pause with one approve
//! and one reject run.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dbx_core::agent_events::{AgentEvent, ToolCall, ToolDefinition};
use dbx_core::agent_loop::{run_agent_loop, AgentLoopContext};
use dbx_core::ai::{
    self, AiApiStyle, AiCompletionRequest, AiConfig, AiMessage, AiProvider, AiStreamChunk, TokenUsage, ToolCallRef,
    ToolStreamRequest,
};
use dbx_core::connection::{AppState, PoolKind};
use dbx_core::db;
use dbx_core::models::connection::DatabaseType;
use dbx_core::storage::Storage;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

// ---------------------------------------------------------------------------
// Mock provider server
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct MockRequest {
    path: String,
    body: String,
}

struct MockProvider {
    base_url: String,
    requests: Arc<Mutex<Vec<MockRequest>>>,
}

impl MockProvider {
    /// Start serving `responses` — one canned raw HTTP response per incoming
    /// connection (each turn is one request; unexpected extra requests get a 500).
    async fn start(responses: Vec<String>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind mock provider");
        let base_url = format!("http://{}", listener.local_addr().expect("mock provider addr"));
        let requests: Arc<Mutex<Vec<MockRequest>>> = Arc::new(Mutex::new(Vec::new()));
        let pending: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(responses.into()));
        let request_registry = Arc::clone(&requests);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                serve_connection(stream, Arc::clone(&request_registry), Arc::clone(&pending)).await;
            }
        });
        MockProvider { base_url, requests }
    }

    fn requests(&self) -> Vec<MockRequest> {
        self.requests.lock().expect("mock request registry").clone()
    }
}

async fn serve_connection(
    mut stream: TcpStream,
    requests: Arc<Mutex<Vec<MockRequest>>>,
    pending: Arc<Mutex<VecDeque<String>>>,
) {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        if let Some(pos) = find(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        let n = match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let content_length = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    while buf.len() < header_end + content_length {
        let n = match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
    }

    let path = head
        .lines()
        .next()
        .and_then(|request_line| request_line.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_string();
    requests
        .lock()
        .expect("mock request registry")
        .push(MockRequest { path, body: String::from_utf8_lossy(&buf[header_end..]).to_string() });

    let response =
        pending.lock().expect("mock response queue").pop_front().unwrap_or_else(|| {
            http_response(500, "Internal Server Error", "text/plain", "unexpected request".to_string())
        });
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn http_response(status: u16, reason: &str, content_type: &str, body: String) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// A Gemini `streamGenerateContent` SSE response: one `data:` payload per array
/// element (CRLF-delimited, as the real endpoint sends them).
fn gemini_sse(events: &[Value]) -> String {
    sse_response(events.iter().map(|e| format!("data: {e}\r\n\r\n")).collect())
}

fn sse_response(data_lines: Vec<String>) -> String {
    http_response(200, "OK", "text/event-stream", data_lines.concat())
}

/// An OpenAI-compatible (Ollama) chat-completions SSE response, terminated by `[DONE]`.
fn openai_sse(events: &[Value]) -> String {
    let mut lines: Vec<String> = events.iter().map(|e| format!("data: {e}\r\n\r\n")).collect();
    lines.push("data: [DONE]\r\n\r\n".to_string());
    sse_response(lines)
}

fn json_response(body: Value) -> String {
    http_response(200, "OK", "application/json", body.to_string())
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

fn gemini_config(base_url: &str) -> AiConfig {
    AiConfig {
        provider: AiProvider::Gemini,
        api_key: "test-key".to_string(),
        endpoint: base_url.to_string(),
        model: "gemini-test".to_string(),
        api_style: AiApiStyle::Completions,
        proxy_enabled: false,
        proxy_url: String::new(),
        enable_thinking: true,
    }
}

fn openai_config(base_url: &str) -> AiConfig {
    AiConfig {
        provider: AiProvider::Openai,
        api_key: "test-key".to_string(),
        endpoint: base_url.to_string(),
        model: "gpt-test".to_string(),
        api_style: AiApiStyle::Completions,
        proxy_enabled: false,
        proxy_url: String::new(),
        enable_thinking: true,
    }
}

fn ollama_config(base_url: &str, model: &str) -> AiConfig {
    AiConfig {
        provider: AiProvider::Ollama,
        api_key: String::new(),
        endpoint: format!("{base_url}/v1"),
        model: model.to_string(),
        api_style: AiApiStyle::Completions,
        proxy_enabled: false,
        proxy_url: String::new(),
        enable_thinking: true,
    }
}

fn list_tables_tool() -> ToolDefinition {
    ToolDefinition {
        name: "list_tables",
        description: "List the tables and views in the current database.",
        parameters: json!({ "type": "object", "properties": {} }),
        read_only: true,
        parallel_ok: true,
    }
}

/// Stream one tool-enabled turn the way the agent loop does: text deltas
/// accumulate, tool calls come back finalized.
async fn stream_turn(
    config: &AiConfig,
    messages: &[AiMessage],
    tools: &[ToolDefinition],
    cancelled: &Notify,
) -> (String, Vec<ToolCall>, TokenUsage) {
    let text = Arc::new(Mutex::new(String::new()));
    let request = ToolStreamRequest {
        config,
        system_prompt: "You are DBX's assistant.",
        messages,
        session_id: "t21-test",
        tools,
        max_tokens: Some(512),
        temperature: Some(0.2),
        cancelled,
    };
    let text_sink = Arc::clone(&text);
    let (calls, usage) = ai::stream_with_tools(&request, move |chunk: AiStreamChunk| {
        text_sink.lock().expect("text sink").push_str(&chunk.delta);
    })
    .await
    .expect("stream_with_tools succeeds");
    let turn_text = text.lock().expect("text sink").clone();
    (turn_text, calls, usage)
}

/// The agent loop's post-turn message plumbing (agent_loop.rs): the assistant
/// turn records its tool calls, each result follows as a `tool` message.
fn replay_turn(convo: &mut Vec<AiMessage>, turn_text: String, calls: &[ToolCall], results: &[&str]) {
    convo.push(AiMessage {
        role: "assistant".to_string(),
        content: turn_text,
        tool_call_id: None,
        tool_calls: calls
            .iter()
            .map(|tc| ToolCallRef { id: tc.id.clone(), name: tc.name.clone(), arguments: tc.arguments.clone() })
            .collect(),
    });
    for (tc, result) in calls.iter().zip(results) {
        convo.push(AiMessage {
            role: "tool".to_string(),
            content: (*result).to_string(),
            tool_call_id: Some(tc.id.clone()),
            tool_calls: vec![],
        });
    }
}

// ---------------------------------------------------------------------------
// Gemini: multi-turn functionCall / functionResponse exchange
// ---------------------------------------------------------------------------

#[tokio::test]
async fn gemini_tool_loop_round_trips_function_call_and_response_across_turns() {
    let turn1 = gemini_sse(&[
        json!({
            "candidates": [{ "content": { "role": "model", "parts": [{ "text": "Let me check the schema." }] } }],
            "usageMetadata": { "promptTokenCount": 11 }
        }),
        json!({
            "candidates": [{ "content": { "role": "model", "parts": [
                { "functionCall": { "name": "list_tables", "args": {} } }
            ] } }],
            "usageMetadata": { "promptTokenCount": 11, "candidatesTokenCount": 6 }
        }),
    ]);
    let turn2 = gemini_sse(&[json!({
        "candidates": [{ "content": { "role": "model", "parts": [
            { "text": "Your database has users and orders." }
        ] } }],
        "usageMetadata": { "promptTokenCount": 30, "candidatesTokenCount": 9 }
    })]);
    let server = MockProvider::start(vec![turn1, turn2]).await;
    let config = gemini_config(&server.base_url);

    assert!(ai::provider_supports_function_calling(&config).await);

    let tools = vec![list_tables_tool()];
    let mut convo = vec![AiMessage::text("user", "What tables do I have?")];
    let cancelled = Notify::new();

    // Turn 1: streamed text plus one complete functionCall part.
    let (text1, calls1, usage1) = stream_turn(&config, &convo, &tools, &cancelled).await;
    assert_eq!(text1, "Let me check the schema.");
    assert_eq!(calls1.len(), 1);
    assert_eq!(calls1[0].id, "call_0");
    assert_eq!(calls1[0].name, "list_tables");
    assert_eq!(calls1[0].arguments, json!({}));
    assert_eq!(usage1.input_tokens, Some(11));
    assert_eq!(usage1.output_tokens, Some(6));

    replay_turn(&mut convo, text1, &calls1, &["users\norders"]);

    // Turn 2: with the functionResponse replayed, the model answers with text.
    let (text2, calls2, _) = stream_turn(&config, &convo, &tools, &cancelled).await;
    assert!(calls2.is_empty());
    assert_eq!(text2, "Your database has users and orders.");

    let requests = server.requests();
    assert_eq!(requests.len(), 2);

    // Turn-1 request carries the tool declarations in Gemini's shape.
    let body1: Value = serde_json::from_str(&requests[0].body).expect("turn 1 body is JSON");
    let declaration = &body1["tools"][0]["functionDeclarations"][0];
    assert_eq!(declaration["name"], "list_tables");
    assert_eq!(declaration["description"], "List the tables and views in the current database.");
    assert_eq!(declaration["parameters"]["type"], "object");
    assert_eq!(body1["contents"].as_array().expect("contents").len(), 1);

    // Turn-2 request replays the model's functionCall and our functionResponse.
    let body2: Value = serde_json::from_str(&requests[1].body).expect("turn 2 body is JSON");
    let contents = body2["contents"].as_array().expect("contents");
    assert_eq!(contents.len(), 3);
    assert_eq!(contents[0]["role"], "user");
    assert_eq!(contents[1]["role"], "model");
    assert_eq!(contents[1]["parts"][0]["text"], "Let me check the schema.");
    assert_eq!(contents[1]["parts"][1]["functionCall"]["name"], "list_tables");
    assert_eq!(contents[2]["role"], "user");
    assert_eq!(contents[2]["parts"][0]["functionResponse"]["name"], "list_tables");
    assert_eq!(contents[2]["parts"][0]["functionResponse"]["response"]["result"], "users\norders");
}

// ---------------------------------------------------------------------------
// Ollama: per-model opt-in
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ollama_tool_capable_model_opts_in_and_round_trips_tool_calls() {
    let probe = json_response(json!({ "model": "qwen3:8b", "capabilities": ["completion", "tools"] }));
    let turn1 = openai_sse(&[
        json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "id": "call_a1", "function": { "name": "list_tables", "arguments": "" } }
        ] } }] }),
        json!({ "choices": [{ "delta": { "tool_calls": [
            { "index": 0, "function": { "arguments": "{}" } }
        ] } }] }),
    ]);
    let turn2 =
        openai_sse(&[json!({ "choices": [{ "delta": { "content": "Your database has users and orders." } }] })]);
    let server = MockProvider::start(vec![probe, turn1, turn2]).await;
    let config = ollama_config(&server.base_url, "qwen3:8b");

    // The opt-in decision probes /api/show once for the model.
    assert!(ai::provider_supports_function_calling(&config).await);

    let tools = vec![list_tables_tool()];
    let mut convo = vec![AiMessage::text("user", "What tables do I have?")];
    let cancelled = Notify::new();

    let (text1, calls1, _) = stream_turn(&config, &convo, &tools, &cancelled).await;
    assert!(text1.is_empty());
    assert_eq!(calls1.len(), 1);
    assert_eq!(calls1[0].id, "call_a1");
    assert_eq!(calls1[0].name, "list_tables");
    assert_eq!(calls1[0].arguments, json!({}));

    replay_turn(&mut convo, text1, &calls1, &["users\norders"]);

    let (text2, calls2, _) = stream_turn(&config, &convo, &tools, &cancelled).await;
    assert!(calls2.is_empty());
    assert_eq!(text2, "Your database has users and orders.");

    let requests = server.requests();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].path, "/api/show");
    let probe_body: Value = serde_json::from_str(&requests[0].body).expect("probe body is JSON");
    assert_eq!(probe_body["model"], "qwen3:8b");

    // The chat requests go out in the OpenAI tools shape Ollama serves at /v1.
    assert_eq!(requests[1].path, "/v1/chat/completions");
    let body1: Value = serde_json::from_str(&requests[1].body).expect("turn 1 body is JSON");
    assert_eq!(body1["tools"][0]["function"]["name"], "list_tables");
    assert_eq!(body1["tool_choice"], "auto");

    let body2: Value = serde_json::from_str(&requests[2].body).expect("turn 2 body is JSON");
    let messages = body2["messages"].as_array().expect("messages");
    // [system, user, assistant(tool_calls), tool(result)]
    assert_eq!(messages.len(), 4);
    assert_eq!(messages[2]["role"], "assistant");
    assert_eq!(messages[2]["tool_calls"][0]["id"], "call_a1");
    assert_eq!(messages[2]["tool_calls"][0]["function"]["name"], "list_tables");
    assert_eq!(messages[3]["role"], "tool");
    assert_eq!(messages[3]["tool_call_id"], "call_a1");
    assert_eq!(messages[3]["content"], "users\norders");
}

#[tokio::test]
async fn ollama_model_without_tools_capability_keeps_text_only_traffic() {
    let probe = json_response(json!({ "capabilities": ["completion"] }));
    let chat = openai_sse(&[json!({ "choices": [{ "delta": { "content": "Your tables: users, orders." } }] })]);
    let server = MockProvider::start(vec![probe, chat]).await;
    let config = ollama_config(&server.base_url, "llama3:8b");

    // No `tools` capability: the loop keeps the text-only fallback.
    assert!(!ai::provider_supports_function_calling(&config).await);

    // The text-only fallback rides the unchanged plain `stream` path.
    let request = AiCompletionRequest {
        config: config.clone(),
        system_prompt: "You are DBX's assistant.".to_string(),
        messages: vec![AiMessage::text("user", "What tables do I have?")],
        max_tokens: Some(512),
        temperature: Some(0.2),
        structured_output: false,
    };
    let text = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&text);
    ai::stream("t21-text-only", &request, &Notify::new(), move |chunk: AiStreamChunk| {
        sink.lock().expect("text sink").push_str(&chunk.delta);
    })
    .await
    .expect("plain stream succeeds");
    assert_eq!(text.lock().expect("text sink").as_str(), "Your tables: users, orders.");

    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].path, "/api/show");

    // The chat request body is the exact pre-T21 shape: no tools, no tool_choice.
    let body: Value = serde_json::from_str(&requests[1].body).expect("chat body is JSON");
    assert!(body.get("tools").is_none());
    assert!(body.get("tool_choice").is_none());
    assert_eq!(body["model"], "llama3:8b");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"][0]["role"], "system");
}

#[tokio::test]
async fn ollama_probe_failure_keeps_the_text_only_fallback() {
    // An older Ollama server without /api/show (or any probe error) is a safe "no".
    let not_found = http_response(404, "Not Found", "application/json", "{\"error\": \"model not found\"}".to_string());
    let server = MockProvider::start(vec![not_found]).await;
    let config = ollama_config(&server.base_url, "some-model");

    assert!(!ai::provider_supports_function_calling(&config).await);
    assert_eq!(server.requests().len(), 1);
}

// ---------------------------------------------------------------------------
// T31: one retry on the initial request — 429/5xx/connect, never mid-stream
// ---------------------------------------------------------------------------

/// Drive the plain `ai::stream` path and collect the text deltas.
async fn stream_plain(config: &AiConfig, cancelled: &Notify) -> Result<String, String> {
    let request = AiCompletionRequest {
        config: config.clone(),
        system_prompt: "You are DBX's assistant.".to_string(),
        messages: vec![AiMessage::text("user", "hi")],
        max_tokens: Some(16),
        temperature: Some(0.0),
        structured_output: false,
    };
    let text = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&text);
    let result = ai::stream("t31-retry", &request, cancelled, move |chunk: AiStreamChunk| {
        sink.lock().expect("text sink").push_str(&chunk.delta);
    })
    .await;
    result.map(|_| text.lock().expect("text sink").clone())
}

#[tokio::test]
async fn stream_retries_once_on_429_and_replays_the_identical_request() {
    let limited = http_response(
        429,
        "Too Many Requests",
        "application/json",
        "{\"error\":{\"message\":\"rate limited\"}}".to_string(),
    );
    let answer = openai_sse(&[json!({ "choices": [{ "delta": { "content": "Recovered." } }] })]);
    let server = MockProvider::start(vec![limited, answer]).await;
    let config = openai_config(&server.base_url);

    let text = stream_plain(&config, &Notify::new()).await.expect("the retry after the 429 succeeds");

    assert_eq!(text, "Recovered.");
    let requests = server.requests();
    assert_eq!(requests.len(), 2, "exactly one retry");
    assert_eq!(requests[0].path, "/chat/completions");
    assert_eq!(requests[0].body, requests[1].body, "the retry replays the identical request");
}

#[tokio::test]
async fn tool_stream_retries_once_on_503() {
    let overloaded = http_response(
        503,
        "Service Unavailable",
        "application/json",
        "{\"error\":{\"message\":\"overloaded\"}}".to_string(),
    );
    let answer = gemini_sse(&[json!({
        "candidates": [{ "content": { "role": "model", "parts": [{ "text": "Recovered." }] } }]
    })]);
    let server = MockProvider::start(vec![overloaded, answer]).await;
    let config = gemini_config(&server.base_url);

    let (text, calls, _) =
        stream_turn(&config, &[AiMessage::text("user", "hi")], &[list_tables_tool()], &Notify::new()).await;

    assert_eq!(text, "Recovered.");
    assert!(calls.is_empty());
    assert_eq!(server.requests().len(), 2);
}

#[tokio::test]
async fn complete_retries_once_on_502() {
    let bad_gateway =
        http_response(502, "Bad Gateway", "application/json", "{\"error\":{\"message\":\"bad gateway\"}}".to_string());
    let answer = json_response(json!({ "choices": [{ "message": { "content": "Recovered." } }] }));
    let server = MockProvider::start(vec![bad_gateway, answer]).await;
    let config = openai_config(&server.base_url);

    let request = AiCompletionRequest {
        config,
        system_prompt: String::new(),
        messages: vec![AiMessage::text("user", "hi")],
        max_tokens: Some(16),
        temperature: Some(0.0),
        structured_output: false,
    };
    let text = ai::complete(&request).await.expect("the retry after the 502 succeeds");

    assert_eq!(text, "Recovered.");
    assert_eq!(server.requests().len(), 2);
}

#[tokio::test]
async fn stream_errors_after_a_mid_stream_drop_without_retrying() {
    // 200 + SSE headers, one delta, then the socket closes with the body far
    // short of its Content-Length — an in-flight drop, not a refused request.
    // Re-sending could duplicate the (billed) partial answer, so the error must
    // propagate with no second request.
    let partial = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 400\r\nConnection: close\r\n\r\n{}",
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\r\n\r\n"
    );
    let server = MockProvider::start(vec![partial]).await;
    let config = openai_config(&server.base_url);

    let result = stream_plain(&config, &Notify::new()).await;

    assert!(result.is_err(), "the mid-stream drop surfaces as an error");
    assert_eq!(server.requests().len(), 1, "never retried once the stream started");
}

#[tokio::test]
async fn stream_does_not_retry_client_errors() {
    let bad_request = http_response(
        400,
        "Bad Request",
        "application/json",
        "{\"error\":{\"message\":\"model not found\"}}".to_string(),
    );
    let server = MockProvider::start(vec![bad_request]).await;
    let config = openai_config(&server.base_url);

    let err = stream_plain(&config, &Notify::new()).await.expect_err("a 400 is a dead end");

    assert!(err.contains("model not found"), "the provider's error message is surfaced: {err}");
    assert_eq!(server.requests().len(), 1, "deterministic client errors get no second request");
}

// ---------------------------------------------------------------------------
// T42: structured output for the final SQL — the `structured_output` opt-in
// must keep every request that cannot safely carry native `response_format`
// byte-identical to the legacy shape (fence fallback keeps the legacy traffic),
// and stream the contract JSON through untouched.
// ---------------------------------------------------------------------------

/// Drive the plain `ai::stream` path with the structured-output opt-in set and
/// collect the text deltas.
async fn stream_structured(config: &AiConfig, cancelled: &Notify) -> Result<String, String> {
    let request = AiCompletionRequest {
        config: config.clone(),
        system_prompt: "You are DBX's assistant.".to_string(),
        messages: vec![AiMessage::text("user", "List the users.")],
        max_tokens: Some(256),
        temperature: Some(0.15),
        structured_output: true,
    };
    let text = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&text);
    let result = ai::stream("t42-structured", &request, cancelled, move |chunk: AiStreamChunk| {
        sink.lock().expect("text sink").push_str(&chunk.delta);
    })
    .await;
    result.map(|_| text.lock().expect("text sink").clone())
}

#[tokio::test]
async fn structured_opt_in_on_a_custom_openai_endpoint_keeps_the_legacy_request_body() {
    // A loopback endpoint is never the official API host, so — however the ask
    // flow opts in — the request body must stay exactly the legacy shape: no
    // `response_format`, and the fallback fence contract still gets its answer.
    let answer = openai_sse(&[
        json!({ "choices": [{ "delta": { "content": "{\"sql\": \"SELECT id FROM users\"," } }] }),
        json!({ "choices": [{ "delta": { "content": " \"explanation\": \"one statement\"}" } }] }),
    ]);
    let server = MockProvider::start(vec![answer]).await;
    let config = openai_config(&server.base_url);

    let text = stream_structured(&config, &Notify::new()).await.expect("the structured stream succeeds");

    assert_eq!(text, "{\"sql\": \"SELECT id FROM users\", \"explanation\": \"one statement\"}");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/chat/completions");
    let body: Value = serde_json::from_str(&requests[0].body).expect("request body is JSON");
    assert!(body.get("response_format").is_none(), "custom endpoints never get native response_format");
    assert_eq!(body["model"], "gpt-test");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["content"], "List the users.");
}

#[tokio::test]
async fn structured_opt_in_leaves_gemini_traffic_unchanged() {
    // Gemini has no native response_format wired in this codebase: the opt-in
    // rides the prompt alone, so the request body must not carry any format
    // hint (the Gemini field would be generationConfig.responseMimeType).
    let answer = gemini_sse(&[json!({
        "candidates": [{ "content": { "role": "model", "parts": [{ "text": "{\"sql\": \"SELECT 1\"}" }] } }]
    })]);
    let server = MockProvider::start(vec![answer]).await;
    let config = gemini_config(&server.base_url);

    let text = stream_structured(&config, &Notify::new()).await.expect("the structured stream succeeds");

    assert_eq!(text, "{\"sql\": \"SELECT 1\"}");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    let body: Value = serde_json::from_str(&requests[0].body).expect("request body is JSON");
    assert!(body.get("response_format").is_none());
    assert!(body["generationConfig"].get("responseMimeType").is_none());
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 256);
}

// ---------------------------------------------------------------------------
// T43: the full agent loop — `run_agent_loop` across three model turns over
// the same mock server, with the tool calls executing against a real SQLite
// database seeded for the run.
// ---------------------------------------------------------------------------

/// Connection id the run's SQLite pool is seeded under.
const AGENT_CONN: &str = "agent-loop-e2e-conn";

/// AppState with a SQLite pool seeded under [`AGENT_CONN`] (same shape as
/// `agent_tools`' unit-test helper), so the loop's tools hit a real database.
/// Returns the state, a handle for post-run verification, and the temp dir to
/// clean up.
async fn sqlite_agent_state(seed_sql: &str) -> (Arc<AppState>, db::sqlite::SqliteHandle, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("dbx-agent-loop-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let storage = Storage::open(&dir.join("storage.db")).await.expect("open storage");
    let state = Arc::new(AppState::new(storage));
    let pool = db::sqlite::connect_path_create_if_missing(&dir.join("agent.db").to_string_lossy())
        .await
        .expect("connect sqlite");
    state.connections.write().await.insert(AGENT_CONN.to_string(), PoolKind::Sqlite(pool.clone()));
    db::sqlite::execute_query(&pool, seed_sql).await.expect("seed sqlite");
    (state, pool, dir)
}

/// One OpenAI-compatible tool-call delta carrying the whole call (id, name and
/// complete JSON arguments), the way a non-fragmenting provider streams it.
fn openai_tool_call_delta(id: &str, name: &str, arguments: &str) -> Value {
    json!({ "choices": [{ "delta": { "tool_calls": [
        { "index": 0, "id": id, "function": { "name": name, "arguments": arguments } }
    ] } }] })
}

/// The usage-only trailing chunk OpenAI sends with `stream_options.include_usage`.
fn openai_usage_chunk(input: u64, output: u64) -> Value {
    json!({ "choices": [], "usage": { "prompt_tokens": input, "completion_tokens": output } })
}

/// Serialize every `AgentEvent` the loop emits into JSON, in emission order.
fn event_collector() -> (Arc<Mutex<Vec<Value>>>, impl Fn(AgentEvent) + Send + Sync + Clone + 'static) {
    let log: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&log);
    let on_event = move |event: AgentEvent| {
        sink.lock().expect("event log").push(serde_json::to_value(&event).expect("serialize event"));
    };
    (log, on_event)
}

fn event_kinds(events: &[Value]) -> Vec<&str> {
    events.iter().map(|e| e["type"].as_str().expect("event type")).collect()
}

#[tokio::test]
async fn agent_loop_runs_two_tool_rounds_against_sqlite_then_answers() {
    let (state, _pool, dir) = sqlite_agent_state(
        "CREATE TABLE notes (id INTEGER, title TEXT); INSERT INTO notes VALUES (1, 'alpha'), (2, 'beta');",
    )
    .await;

    // Turn 1 streams text plus an execute_query call, turn 2 a search_tables
    // call, turn 3 the tool-free final answer. Usage rides every turn.
    let query_args = json!({ "sql": "SELECT COUNT(*) AS total FROM notes" }).to_string();
    let search_args = json!({ "search": "notes" }).to_string();
    let turn1 = openai_sse(&[
        json!({ "choices": [{ "delta": { "content": "Let me count the notes." } }] }),
        openai_tool_call_delta("call_q1", "execute_query", &query_args),
        openai_usage_chunk(10, 4),
    ]);
    let turn2 =
        openai_sse(&[openai_tool_call_delta("call_s1", "search_tables", &search_args), openai_usage_chunk(20, 3)]);
    let turn3 = openai_sse(&[
        json!({ "choices": [{ "delta": { "content": "There are " } }] }),
        json!({ "choices": [{ "delta": { "content": "2 notes in total." } }] }),
        openai_usage_chunk(30, 8),
    ]);
    let server = MockProvider::start(vec![turn1, turn2, turn3]).await;
    let config = openai_config(&server.base_url);
    assert!(ai::provider_supports_function_calling(&config).await, "the loop must take the tool path");

    let (log, on_event) = event_collector();
    let ctx = AgentLoopContext {
        state,
        connection_id: AGENT_CONN.to_string(),
        database: String::new(),
        db_type: DatabaseType::Sqlite,
    };
    let final_text = run_agent_loop(
        &config,
        "You are DBX's assistant.",
        &[AiMessage::text("user", "How many notes do I have?")],
        &ctx,
        "t43-two-rounds",
        on_event,
        &Notify::new(),
        CancellationToken::new(),
        Some(512),
        Some(0.2),
        true, // agent mode: the full tool set
    )
    .await
    .expect("the agent loop completes");
    let _ = std::fs::remove_dir_all(dir);

    // The loop returns the model's final answer.
    assert_eq!(final_text, "There are 2 notes in total.");

    // The full event sequence: turn 1 streams text then calls execute_query
    // (whose real SQLite result lands on the ToolCallEnd), turn 2 calls
    // search_tables, turn 3 answers without tools.
    let events = log.lock().expect("event log").clone();
    assert_eq!(
        event_kinds(&events),
        vec![
            "turn_start",
            "text_delta",
            "turn_end",
            "tool_call_start",
            "tool_call_end",
            "turn_start",
            "turn_end",
            "tool_call_start",
            "tool_call_end",
            "turn_start",
            "text_delta",
            "text_delta",
            "turn_end",
            "agent_end",
        ]
    );
    assert_eq!(events[0]["turn"], 0);
    assert_eq!(events[1]["delta"], "Let me count the notes.");
    assert_eq!(events[3]["tool_call_id"], "call_q1");
    assert_eq!(events[3]["tool_name"], "execute_query");
    assert_eq!(events[3]["args"], json!({ "sql": "SELECT COUNT(*) AS total FROM notes" }));
    assert_eq!(events[4]["is_error"], false, "the query executed against the seeded database");
    let query_result = events[4]["result"]["content"].as_str().expect("tool result content");
    assert!(query_result.contains("| total |"), "{query_result}");
    assert!(query_result.contains("| 2 |"), "{query_result}");
    assert_eq!(events[5]["turn"], 1);
    assert_eq!(events[7]["tool_call_id"], "call_s1");
    assert_eq!(events[7]["tool_name"], "search_tables");
    let search_result = events[8]["result"]["content"].as_str().expect("tool result content");
    assert!(search_result.contains("- notes (BASE TABLE)"), "{search_result}");
    assert_eq!(events[9]["turn"], 2);
    assert_eq!(events[10]["delta"], "There are ");
    assert_eq!(events[11]["delta"], "2 notes in total.");
    // Usage accumulates across all three turns into the terminal event.
    assert_eq!(events[13]["input_tokens"], 60);
    assert_eq!(events[13]["output_tokens"], 15);

    // One model request per turn, all on the completions endpoint.
    let requests = server.requests();
    assert_eq!(requests.len(), 3, "one request per model turn");
    assert!(requests.iter().all(|r| r.path == "/chat/completions"));

    // Turn 1: system + user only, with the SQLite agent tool set declared.
    let body1: Value = serde_json::from_str(&requests[0].body).expect("turn 1 body is JSON");
    let messages1 = body1["messages"].as_array().expect("messages");
    assert_eq!(messages1.len(), 2);
    assert_eq!(messages1[0]["role"], "system");
    assert_eq!(messages1[1]["content"], "How many notes do I have?");
    let tool_names: Vec<&str> = body1["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .map(|t| t["function"]["name"].as_str().expect("name"))
        .collect();
    assert_eq!(
        tool_names,
        vec!["list_tables", "search_tables", "get_columns", "execute_query", "get_sample_data"],
        "agent mode exposes the SQLite tool set"
    );

    // Turn 2 replays the assistant's tool call and the real tool output.
    let body2: Value = serde_json::from_str(&requests[1].body).expect("turn 2 body is JSON");
    let messages2 = body2["messages"].as_array().expect("messages");
    assert_eq!(messages2.len(), 4, "[system, user, assistant(tool_calls), tool(result)]");
    assert_eq!(messages2[2]["role"], "assistant");
    assert_eq!(messages2[2]["tool_calls"][0]["id"], "call_q1");
    assert_eq!(messages2[2]["tool_calls"][0]["function"]["name"], "execute_query");
    assert_eq!(messages2[3]["role"], "tool");
    assert_eq!(messages2[3]["tool_call_id"], "call_q1");
    assert!(
        messages2[3]["content"].as_str().expect("tool message").contains("| 2 |"),
        "the executed result is fed back: {}",
        messages2[3]["content"]
    );

    // Turn 3 carries both rounds: both assistant calls and both tool results.
    let body3: Value = serde_json::from_str(&requests[2].body).expect("turn 3 body is JSON");
    let messages3 = body3["messages"].as_array().expect("messages");
    assert_eq!(messages3.len(), 6);
    assert_eq!(messages3[4]["role"], "assistant");
    assert_eq!(messages3[4]["tool_calls"][0]["id"], "call_s1");
    assert_eq!(messages3[4]["tool_calls"][0]["function"]["name"], "search_tables");
    assert_eq!(messages3[5]["role"], "tool");
    assert_eq!(messages3[5]["tool_call_id"], "call_s1");
    assert!(
        messages3[5]["content"].as_str().expect("tool message").contains("- notes (BASE TABLE)"),
        "{}",
        messages3[5]["content"]
    );
}

/// Resolve the named write confirmation from a background task as soon as the
/// loop registers it, with the given verdict.
fn resolve_when_registered(session: &'static str, tool_call_id: &'static str, approved: bool) {
    tokio::spawn(async move {
        for _ in 0..1_000 {
            if ai::resolve_confirmation(session, tool_call_id, approved).await {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("the write confirmation was never registered");
    });
}

#[tokio::test]
async fn agent_loop_pauses_a_write_until_the_confirmation_is_approved() {
    let (state, pool, dir) =
        sqlite_agent_state("CREATE TABLE notes (id INTEGER, title TEXT); INSERT INTO notes VALUES (1, 'alpha');").await;

    let insert_args = json!({ "sql": "INSERT INTO notes (id, title) VALUES (2, 'beta')" }).to_string();
    let turn1 =
        openai_sse(&[openai_tool_call_delta("call_w1", "execute_query", &insert_args), openai_usage_chunk(10, 4)]);
    let turn2 = openai_sse(&[
        json!({ "choices": [{ "delta": { "content": "Inserted the new note." } }] }),
        openai_usage_chunk(20, 3),
    ]);
    let server = MockProvider::start(vec![turn1, turn2]).await;
    let config = openai_config(&server.base_url);

    resolve_when_registered("t43-write-approved", "call_w1", true);

    let (log, on_event) = event_collector();
    let ctx = AgentLoopContext {
        state,
        connection_id: AGENT_CONN.to_string(),
        database: String::new(),
        db_type: DatabaseType::Sqlite,
    };
    let run = tokio::time::timeout(
        Duration::from_secs(30),
        run_agent_loop(
            &config,
            "You are DBX's assistant.",
            &[AiMessage::text("user", "Add a note titled beta.")],
            &ctx,
            "t43-write-approved",
            on_event,
            &Notify::new(),
            CancellationToken::new(),
            Some(512),
            Some(0.2),
            true,
        ),
    )
    .await
    .expect("the loop finishes once the write is approved")
    .expect("the approved write completes the loop");
    let _ = std::fs::remove_dir_all(dir);
    assert_eq!(run, "Inserted the new note.");

    // The mutating statement pauses for a confirmation card, then executes.
    let events = log.lock().expect("event log").clone();
    assert_eq!(
        event_kinds(&events),
        vec![
            "turn_start",
            "turn_end",
            "tool_call_start",
            "tool_confirm_request",
            "tool_call_end",
            "turn_start",
            "text_delta",
            "turn_end",
            "agent_end",
        ]
    );
    assert_eq!(events[3]["tool_call_id"], "call_w1");
    assert_eq!(events[3]["sql"], "INSERT INTO notes (id, title) VALUES (2, 'beta')");
    assert_eq!(events[4]["is_error"], false, "the approved write executed");
    assert!(
        events[4]["result"]["content"].as_str().expect("tool result").contains("1 affected rows"),
        "{}",
        events[4]["result"]["content"]
    );

    // The write really hit the database, not just the event stream.
    let count = db::sqlite::execute_query(&pool, "SELECT COUNT(*) AS n FROM notes").await.expect("count notes");
    assert_eq!(count.rows[0][0].as_i64(), Some(2), "the insert landed");

    // The model sees the write's outcome on the follow-up request.
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    let body2: Value = serde_json::from_str(&requests[1].body).expect("turn 2 body is JSON");
    let messages = body2["messages"].as_array().expect("messages");
    assert_eq!(messages.len(), 4);
    assert!(
        messages[3]["content"].as_str().expect("tool message").contains("1 affected rows"),
        "{}",
        messages[3]["content"]
    );
}

#[tokio::test]
async fn agent_loop_feeds_a_rejected_write_back_as_a_tool_error() {
    let (state, pool, dir) =
        sqlite_agent_state("CREATE TABLE notes (id INTEGER, title TEXT); INSERT INTO notes VALUES (1, 'alpha');").await;

    let delete_args = json!({ "sql": "DELETE FROM notes" }).to_string();
    let turn1 =
        openai_sse(&[openai_tool_call_delta("call_r1", "execute_query", &delete_args), openai_usage_chunk(10, 4)]);
    let turn2 = openai_sse(&[
        json!({ "choices": [{ "delta": { "content": "I will not delete the notes." } }] }),
        openai_usage_chunk(20, 3),
    ]);
    let server = MockProvider::start(vec![turn1, turn2]).await;
    let config = openai_config(&server.base_url);

    resolve_when_registered("t43-write-rejected", "call_r1", false);

    let (log, on_event) = event_collector();
    let ctx = AgentLoopContext {
        state,
        connection_id: AGENT_CONN.to_string(),
        database: String::new(),
        db_type: DatabaseType::Sqlite,
    };
    let run = tokio::time::timeout(
        Duration::from_secs(30),
        run_agent_loop(
            &config,
            "You are DBX's assistant.",
            &[AiMessage::text("user", "Delete all the notes.")],
            &ctx,
            "t43-write-rejected",
            on_event,
            &Notify::new(),
            CancellationToken::new(),
            Some(512),
            Some(0.2),
            true,
        ),
    )
    .await
    .expect("the loop finishes once the write is rejected")
    .expect("the rejected write still completes the loop");
    let _ = std::fs::remove_dir_all(dir);
    assert_eq!(run, "I will not delete the notes.");

    // The rejection is fed back as a tool error for the model to react to.
    let events = log.lock().expect("event log").clone();
    assert_eq!(
        event_kinds(&events),
        vec![
            "turn_start",
            "turn_end",
            "tool_call_start",
            "tool_confirm_request",
            "tool_call_end",
            "turn_start",
            "text_delta",
            "turn_end",
            "agent_end",
        ]
    );
    assert_eq!(events[3]["tool_call_id"], "call_r1");
    assert_eq!(events[4]["is_error"], true, "the rejection surfaces as an errored tool result");
    assert_eq!(
        events[4]["result"]["content"],
        json!("Error: User rejected execution of this statement."),
        "the model is told the user said no"
    );

    // Nothing was deleted.
    let count = db::sqlite::execute_query(&pool, "SELECT COUNT(*) AS n FROM notes").await.expect("count notes");
    assert_eq!(count.rows[0][0].as_i64(), Some(1), "the rejected statement never ran");

    // The follow-up request carries the rejection so the model can adjust.
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    let body2: Value = serde_json::from_str(&requests[1].body).expect("turn 2 body is JSON");
    let messages = body2["messages"].as_array().expect("messages");
    assert_eq!(messages.len(), 4);
    assert!(
        messages[3]["content"].as_str().expect("tool message").contains("User rejected"),
        "{}",
        messages[3]["content"]
    );
}
