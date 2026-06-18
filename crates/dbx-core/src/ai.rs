use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::ops::ControlFlow;
use std::path::Path;
use std::sync::{Arc, LazyLock};
use tokio::sync::{oneshot, Notify, RwLock};

use crate::agent_events::{ToolCall, ToolDefinition};

// ---------------------------------------------------------------------------
// Stream cancel registry
// ---------------------------------------------------------------------------

static AI_STREAMS: LazyLock<RwLock<HashMap<String, Arc<Notify>>>> = LazyLock::new(|| RwLock::new(HashMap::new()));

pub async fn register_stream(session_id: &str) -> Arc<Notify> {
    let notify = Arc::new(Notify::new());
    AI_STREAMS.write().await.insert(session_id.to_string(), notify.clone());
    notify
}

pub async fn cancel_stream(session_id: &str) -> bool {
    if let Some(notify) = AI_STREAMS.read().await.get(session_id) {
        notify.notify_one();
        true
    } else {
        false
    }
}

pub async fn unregister_stream(session_id: &str) {
    AI_STREAMS.write().await.remove(session_id);
}

// ---------------------------------------------------------------------------
// Tool-confirmation registry
//
// The agent loop pauses on a mutating tool call and waits for the frontend to
// approve or reject it. The frontend's decision arrives out-of-band (a separate
// Tauri command / HTTP route), so we bridge it through a per-(session,tool_call)
// oneshot channel.
// ---------------------------------------------------------------------------

static AI_CONFIRMATIONS: LazyLock<RwLock<HashMap<String, oneshot::Sender<bool>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn confirmation_key(session_id: &str, tool_call_id: &str) -> String {
    format!("{session_id}\u{0}{tool_call_id}")
}

/// Register a pending confirmation and block until the frontend resolves it or
/// the stream is cancelled. Returns `true` only on explicit approval.
pub async fn await_confirmation(session_id: &str, tool_call_id: &str, cancelled: &Notify) -> bool {
    let key = confirmation_key(session_id, tool_call_id);
    let (tx, rx) = oneshot::channel();
    AI_CONFIRMATIONS.write().await.insert(key.clone(), tx);

    tokio::select! {
        result = rx => result.unwrap_or(false),
        _ = cancelled.notified() => {
            AI_CONFIRMATIONS.write().await.remove(&key);
            false
        }
    }
}

/// Resolve a pending confirmation. Returns `false` if none was awaiting.
pub async fn resolve_confirmation(session_id: &str, tool_call_id: &str, approved: bool) -> bool {
    if let Some(tx) = AI_CONFIRMATIONS.write().await.remove(&confirmation_key(session_id, tool_call_id)) {
        let _ = tx.send(approved);
        true
    } else {
        false
    }
}

/// Drop any confirmations still pending for a session (called on stream teardown).
pub async fn unregister_confirmations(session_id: &str) {
    let prefix = format!("{session_id}\u{0}");
    AI_CONFIRMATIONS.write().await.retain(|key, _| !key.starts_with(&prefix));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    #[serde(alias = "anthropic")]
    Claude,
    Openai,
    Gemini,
    Deepseek,
    Qwen,
    Ollama,
    #[serde(rename = "openai-compatible")]
    OpenaiCompatible,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AiApiStyle {
    #[default]
    Completions,
    Responses,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: AiProvider,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_style: AiApiStyle,
    #[serde(default)]
    pub proxy_enabled: bool,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_enable_thinking")]
    pub enable_thinking: bool,
}

fn default_enable_thinking() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub role: String,
    pub content: String,
    /// Set on `role == "tool"` messages: the id of the tool call this answers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Set on `role == "assistant"` messages that invoked tools.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCallRef>,
}

impl AiMessage {
    /// Plain text message with no tool metadata (the common case).
    pub fn text(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self { role: role.into(), content: content.into(), tool_call_id: None, tool_calls: Vec::new() }
    }
}

/// A tool call recorded on an assistant message, replayed to the provider on the
/// next turn so the model sees its own prior tool invocations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRef {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// Best-effort token accounting accumulated across a streamed response.
#[derive(Debug, Clone, Copy, Default)]
pub struct TokenUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompletionRequest {
    pub config: AiConfig,
    pub system_prompt: String,
    pub messages: Vec<AiMessage>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiStreamChunk {
    pub session_id: String,
    pub delta: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_delta: Option<String>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub id: String,
    pub title: String,
    pub connection_name: String,
    pub database: String,
    pub messages: Vec<AiChatMessage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

pub fn resolve_endpoint(config: &AiConfig) -> String {
    let ep = config.endpoint.trim().trim_end_matches('/');
    if matches!(config.provider, AiProvider::Gemini) {
        if ep.ends_with(":generateContent") || ep.ends_with(":streamGenerateContent") {
            return ep.to_string();
        }
        let base = ep.trim_end_matches("/v1beta");
        return format!("{base}/v1beta/models/{}:generateContent", config.model);
    }
    if ep.ends_with("/chat/completions") || ep.ends_with("/responses") || ep.ends_with("/messages") {
        return ep.to_string();
    }
    match config.provider {
        AiProvider::Claude => format!("{ep}/messages"),
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if config.api_style == AiApiStyle::Responses {
                format!("{ep}/responses")
            } else {
                format!("{ep}/chat/completions")
            }
        }
        AiProvider::Gemini => unreachable!(),
    }
}

fn resolve_gemini_stream_endpoint(config: &AiConfig) -> String {
    let endpoint = resolve_endpoint(config);
    if endpoint.ends_with(":streamGenerateContent") {
        endpoint
    } else {
        endpoint.replace(":generateContent", ":streamGenerateContent")
    }
}

pub fn resolve_model_list_endpoint(config: &AiConfig) -> Result<String, String> {
    if matches!(config.provider, AiProvider::Gemini) {
        return Err("Model listing is only supported for OpenAI-compatible and Claude providers".to_string());
    }

    let ep = config.endpoint.trim().trim_end_matches('/');
    if ep.is_empty() {
        return Err("Endpoint is required".to_string());
    }
    if ep.ends_with("/models") {
        return Ok(ep.to_string());
    }

    let base = ep
        .strip_suffix("/chat/completions")
        .or_else(|| ep.strip_suffix("/responses"))
        .or_else(|| ep.strip_suffix("/messages"))
        .unwrap_or(ep)
        .trim_end_matches('/');

    Ok(format!("{base}/models"))
}

pub fn stream_data_payload(line: &str) -> Option<&str> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
        return None;
    }
    if let Some(data) = line.strip_prefix("data:") {
        return Some(data.trim_start());
    }
    if line.starts_with('{') {
        return Some(line);
    }
    None
}

pub fn claude_stream_text(event: &serde_json::Value) -> Option<&str> {
    if event["type"] == "content_block_delta" {
        return event["delta"]["text"].as_str();
    }
    None
}

fn text_from_content_value(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str().filter(|text| !text.is_empty()) {
        return Some(text.to_string());
    }

    value.as_array().and_then(|parts| {
        let text = parts
            .iter()
            .filter_map(|part| {
                part["text"]
                    .as_str()
                    .or_else(|| part["content"].as_str())
                    .or_else(|| part["input_text"].as_str())
                    .or_else(|| part["output_text"].as_str())
            })
            .collect::<Vec<_>>()
            .join("");
        (!text.is_empty()).then_some(text)
    })
}

pub fn openai_response_text(data: &serde_json::Value) -> String {
    data["choices"]
        .get(0)
        .and_then(|choice| {
            text_from_content_value(&choice["message"]["content"])
                .or_else(|| text_from_content_value(&choice["text"]))
                .or_else(|| text_from_content_value(&choice["delta"]["content"]))
        })
        .or_else(|| text_from_content_value(&data["content"]))
        .or_else(|| {
            let text = responses_text(data);
            (!text.is_empty()).then_some(text)
        })
        .unwrap_or_default()
}

pub fn openai_stream_text(event: &serde_json::Value) -> Option<String> {
    event["choices"]
        .get(0)
        .and_then(|choice| {
            text_from_content_value(&choice["delta"]["content"])
                .or_else(|| text_from_content_value(&choice["message"]["content"]))
                .or_else(|| text_from_content_value(&choice["text"]))
        })
        .or_else(|| text_from_content_value(&event["content"]))
        .or_else(|| event["delta"].as_str().filter(|text| !text.is_empty()).map(ToString::to_string))
}

pub fn openai_stream_reasoning(event: &serde_json::Value) -> Option<&str> {
    event["choices"]
        .get(0)
        .and_then(|choice| choice["delta"]["reasoning_content"].as_str())
        .filter(|text| !text.is_empty())
}

pub fn responses_stream_text(event: &serde_json::Value) -> Option<&str> {
    event["delta"].as_str().filter(|s| !s.is_empty())
}

fn responses_max_output_tokens(max_tokens: Option<u32>) -> u32 {
    max_tokens.unwrap_or(2048).max(16)
}

fn responses_text(data: &serde_json::Value) -> String {
    if let Some(text) = data["output_text"].as_str().filter(|text| !text.is_empty()) {
        return text.to_string();
    }

    data["output"]
        .as_array()
        .and_then(|items| {
            items.iter().find_map(|item| {
                item["content"].as_array().and_then(|parts| parts.iter().find_map(|p| p["text"].as_str()))
            })
        })
        .unwrap_or_default()
        .to_string()
}

pub fn gemini_text(data: &serde_json::Value) -> String {
    data["candidates"]
        .get(0)
        .and_then(|candidate| candidate["content"]["parts"].as_array())
        .map(|parts| parts.iter().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
}

pub fn extract_error(data: &serde_json::Value) -> Option<String> {
    data["error"]["message"].as_str().or_else(|| data["error"].as_str()).map(ToString::to_string)
}

/// Build the Claude `system` field as a single cacheable text block. Marking it
/// ephemeral lets Anthropic cache the (stable) system prompt across turns and read
/// it back at a fraction of the input cost; below the model's minimum cacheable
/// size Anthropic simply ignores the directive, so this is always safe to send.
pub fn claude_system_blocks(system_prompt: &str) -> serde_json::Value {
    json!([{
        "type": "text",
        "text": system_prompt,
        "cache_control": { "type": "ephemeral" },
    }])
}

pub fn build_responses_input(system_prompt: &str, messages: &[AiMessage]) -> serde_json::Value {
    let mut input = Vec::new();
    if !system_prompt.is_empty() {
        input.push(json!({
            "role": "developer",
            "content": system_prompt,
        }));
    }
    for m in messages {
        input.push(json!({
            "role": m.role,
            "content": m.content,
        }));
    }
    json!(input)
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

fn validate_config(config: &AiConfig) -> Result<(), String> {
    if !matches!(config.provider, AiProvider::Ollama) && config.api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    if config.endpoint.trim().is_empty() {
        return Err("Endpoint is required".to_string());
    }
    if config.model.trim().is_empty() {
        return Err("Model is required".to_string());
    }
    Ok(())
}

fn validate_model_list_config(config: &AiConfig) -> Result<(), String> {
    if !matches!(config.provider, AiProvider::Ollama) && config.api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    resolve_model_list_endpoint(config).map(|_| ())
}

fn maybe_bearer_headers(config: &AiConfig) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !config.api_key.trim().is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", config.api_key)).map_err(|e| e.to_string())?,
        );
    }
    Ok(headers)
}

fn claude_headers(config: &AiConfig) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert("x-api-key", HeaderValue::from_str(&config.api_key).map_err(|e| e.to_string())?);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    Ok(headers)
}

fn normalize_ai_proxy_url(proxy_url: &str) -> String {
    let proxy_url = proxy_url.trim();
    if proxy_url.contains("://") || proxy_url.is_empty() {
        proxy_url.to_string()
    } else {
        format!("http://{proxy_url}")
    }
}

fn ai_endpoint_is_loopback(config: &AiConfig) -> bool {
    let endpoint = resolve_endpoint(config);
    let Ok(url) = reqwest::Url::parse(&endpoint) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().map(|addr| addr.is_loopback()).unwrap_or(false)
}

pub fn build_ai_http_client(config: &AiConfig, timeout_secs: u64) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs));
    if config.proxy_enabled && !config.proxy_url.trim().is_empty() && !ai_endpoint_is_loopback(config) {
        let proxy_url = normalize_ai_proxy_url(&config.proxy_url);
        let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| format!("Invalid AI proxy URL: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

fn parse_model_list_response(data: &serde_json::Value) -> Result<Vec<AiModelInfo>, String> {
    let items = data["data"].as_array().ok_or_else(|| "Invalid model list response".to_string())?;
    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for item in items {
        let Some(id) = item["id"].as_str().filter(|id| !id.trim().is_empty()) else {
            continue;
        };
        if !seen.insert(id.to_string()) {
            continue;
        }

        let display_name = item["display_name"]
            .as_str()
            .or_else(|| item["name"].as_str())
            .filter(|name| !name.trim().is_empty() && *name != id)
            .map(ToString::to_string);

        models.push(AiModelInfo { id: id.to_string(), display_name });
    }

    Ok(models)
}

async fn list_claude_models(client: &reqwest::Client, config: &AiConfig) -> Result<Vec<AiModelInfo>, String> {
    let res = client
        .get(resolve_model_list_endpoint(config)?)
        .headers(claude_headers(config)?)
        .send()
        .await
        .map_err(|e| format!("Claude model list request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Claude model list API error: {status}")));
    }

    parse_model_list_response(&data)
}

async fn list_openai_compatible_models(
    client: &reqwest::Client,
    config: &AiConfig,
) -> Result<Vec<AiModelInfo>, String> {
    let res = client
        .get(resolve_model_list_endpoint(config)?)
        .headers(maybe_bearer_headers(config)?)
        .send()
        .await
        .map_err(|e| format!("AI model list request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Model list API error: {status}")));
    }

    parse_model_list_response(&data)
}

pub async fn list_models_core(config: &AiConfig) -> Result<Vec<AiModelInfo>, String> {
    validate_model_list_config(config)?;

    let client = build_ai_http_client(config, 30)?;

    match config.provider {
        AiProvider::Claude => list_claude_models(&client, config).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => list_openai_compatible_models(&client, config).await,
        AiProvider::Gemini => {
            Err("Model listing is only supported for OpenAI-compatible and Claude providers".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Non-streaming calls
// ---------------------------------------------------------------------------

pub async fn call_claude(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let body = json!({
        "model": request.config.model,
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
        "system": claude_system_blocks(&request.system_prompt),
        "messages": request.messages,
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(claude_headers(&request.config)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Claude API error: {status}")));
    }

    Ok(data["content"]
        .as_array()
        .and_then(|items| items.iter().find_map(|item| item["text"].as_str()))
        .unwrap_or_default()
        .to_string())
}

pub async fn call_openai_compatible(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut messages = vec![json!({ "role": "system", "content": request.system_prompt })];
    messages.extend(request.messages.iter().map(|message| json!({ "role": message.role, "content": message.content })));

    let mut body_obj = json!({
        "model": request.config.model,
        "messages": messages,
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
    });
    if !request.config.enable_thinking {
        body_obj["extra_body"] = json!({
            "chat_template_kwargs": { "enable_thinking": false }
        });
    }

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body_obj)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("API error: {status}")));
    }

    Ok(openai_response_text(&data))
}

pub async fn call_responses_api(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let body = json!({
        "model": request.config.model,
        "input": build_responses_input(&request.system_prompt, &request.messages),
        "max_output_tokens": responses_max_output_tokens(request.max_tokens),
        "temperature": request.temperature.unwrap_or(0.2),
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("API error: {status}")));
    }

    Ok(responses_text(&data))
}

pub async fn call_gemini(client: &reqwest::Client, request: AiCompletionRequest) -> Result<String, String> {
    let mut contents = Vec::new();
    for message in &request.messages {
        let role = if message.role == "assistant" { "model" } else { "user" };
        contents.push(json!({
            "role": role,
            "parts": [{ "text": message.content }],
        }));
    }

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": request.system_prompt }],
        },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": request.max_tokens.unwrap_or(2048),
            "temperature": request.temperature.unwrap_or(0.2),
        },
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .query(&[("key", request.config.api_key.as_str())])
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    let status = res.status();
    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(extract_error(&data).unwrap_or_else(|| format!("Gemini API error: {status}")));
    }

    Ok(gemini_text(&data))
}

// ---------------------------------------------------------------------------
// High-level: test_connection_core / complete
// ---------------------------------------------------------------------------

pub async fn test_connection_core(config: &AiConfig) -> Result<String, String> {
    validate_config(config)?;

    let client = build_ai_http_client(config, 15)?;

    let request = AiCompletionRequest {
        config: config.clone(),
        system_prompt: String::new(),
        messages: vec![AiMessage::text("user", "hi")],
        max_tokens: Some(1),
        temperature: Some(0.0),
    };

    match request.config.provider {
        AiProvider::Claude => call_claude(&client, request).await,
        AiProvider::Gemini => call_gemini(&client, request).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if request.config.api_style == AiApiStyle::Responses {
                call_responses_api(&client, request).await
            } else {
                call_openai_compatible(&client, request).await
            }
        }
    }
    .map(|_| "OK".to_string())
}

pub async fn complete(request: &AiCompletionRequest) -> Result<String, String> {
    validate_config(&request.config)?;

    let client = build_ai_http_client(&request.config, 60)?;

    match request.config.provider {
        AiProvider::Claude => call_claude(&client, request.clone()).await,
        AiProvider::Gemini => call_gemini(&client, request.clone()).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if request.config.api_style == AiApiStyle::Responses {
                call_responses_api(&client, request.clone()).await
            } else {
                call_openai_compatible(&client, request.clone()).await
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

pub async fn stream(
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: impl Fn(AiStreamChunk),
) -> Result<(), String> {
    validate_config(&request.config)?;

    let stream_timeout = if request.config.enable_thinking { 600 } else { 120 };
    let client = build_ai_http_client(&request.config, stream_timeout)?;

    match request.config.provider {
        AiProvider::Claude => stream_claude(&client, session_id, request, cancelled, &on_chunk).await,
        AiProvider::Gemini => stream_gemini(&client, session_id, request, cancelled, &on_chunk).await,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::Ollama
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => {
            if request.config.api_style == AiApiStyle::Responses {
                stream_responses_api(&client, session_id, request, cancelled, &on_chunk).await
            } else {
                stream_openai(&client, session_id, request, cancelled, &on_chunk).await
            }
        }
    }
}

/// Reads a Server-Sent Events byte stream and invokes `on_line` for each
/// complete `\n`-terminated line, decoded as UTF-8.
///
/// Bytes are buffered and split only on the `\n` delimiter (0x0A, which never
/// occurs inside a multi-byte UTF-8 sequence), so characters straddling network
/// chunk boundaries are decoded intact instead of being mangled into replacement
/// characters. Returns when the stream ends, `on_line` asks to stop, or
/// cancellation fires.
async fn read_sse_stream<F>(res: reqwest::Response, cancelled: &Notify, mut on_line: F) -> Result<(), String>
where
    F: FnMut(&str) -> ControlFlow<()>,
{
    let mut byte_stream = res.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();

    loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = chunk.map_err(|e| e.to_string())?;
                buf.extend_from_slice(&chunk);

                for line in drain_complete_lines(&mut buf) {
                    if on_line(&line).is_break() {
                        return Ok(());
                    }
                }
            }
            _ = cancelled.notified() => { break; }
        }
    }

    Ok(())
}

/// Drains every complete `\n`-terminated line from `buf`, decoded as UTF-8, and
/// leaves any trailing partial line in `buf`. Splitting on `\n` (which never
/// appears inside a multi-byte UTF-8 sequence) means a character straddling two
/// network chunks stays buffered until its bytes are complete.
fn drain_complete_lines(buf: &mut Vec<u8>) -> Vec<String> {
    let mut lines = Vec::new();
    while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
        let mut line: Vec<u8> = buf.drain(..=pos).collect();
        line.pop(); // drop the trailing '\n'
        lines.push(String::from_utf8_lossy(&line).into_owned());
    }
    lines
}

async fn stream_claude(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let body = json!({
        "model": request.config.model,
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
        "system": claude_system_blocks(&request.system_prompt),
        "messages": request.messages,
        "stream": true,
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(claude_headers(&request.config)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "Claude API error".to_string()));
    }

    read_sse_stream(res, cancelled, |line| {
        let Some(data) = stream_data_payload(line) else {
            return ControlFlow::Continue(());
        };
        if data == "[DONE]" {
            return ControlFlow::Break(());
        }
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(text) = claude_stream_text(&event) {
                on_chunk(AiStreamChunk {
                    session_id: session_id.to_string(),
                    delta: text.to_string(),
                    reasoning_delta: None,
                    done: false,
                });
            }
        }
        ControlFlow::Continue(())
    })
    .await?;

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        done: true,
    });

    Ok(())
}

async fn stream_openai(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let mut messages = vec![json!({ "role": "system", "content": request.system_prompt })];
    messages.extend(request.messages.iter().map(|m| json!({ "role": m.role, "content": m.content })));

    let mut body_obj = json!({
        "model": request.config.model,
        "messages": messages,
        "max_tokens": request.max_tokens.unwrap_or(2048),
        "temperature": request.temperature.unwrap_or(0.2),
        "stream": true,
    });
    if !request.config.enable_thinking {
        body_obj["extra_body"] = json!({
            "chat_template_kwargs": { "enable_thinking": false }
        });
    }

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body_obj)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "API error".to_string()));
    }

    read_sse_stream(res, cancelled, |line| {
        let Some(data) = stream_data_payload(line) else {
            return ControlFlow::Continue(());
        };
        if data == "[DONE]" {
            return ControlFlow::Break(());
        }
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(reasoning) = openai_stream_reasoning(&event) {
                on_chunk(AiStreamChunk {
                    session_id: session_id.to_string(),
                    delta: String::new(),
                    reasoning_delta: Some(reasoning.to_string()),
                    done: false,
                });
            }
            if let Some(text) = openai_stream_text(&event) {
                on_chunk(AiStreamChunk {
                    session_id: session_id.to_string(),
                    delta: text,
                    reasoning_delta: None,
                    done: false,
                });
            }
        }
        ControlFlow::Continue(())
    })
    .await?;

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        done: true,
    });

    Ok(())
}

async fn stream_responses_api(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let headers = maybe_bearer_headers(&request.config)?;

    let body = json!({
        "model": request.config.model,
        "input": build_responses_input(&request.system_prompt, &request.messages),
        "max_output_tokens": responses_max_output_tokens(request.max_tokens),
        "temperature": request.temperature.unwrap_or(0.2),
        "stream": true,
    });

    let res = client
        .post(resolve_endpoint(&request.config))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "API error".to_string()));
    }

    read_sse_stream(res, cancelled, |line| {
        let Some(data) = stream_data_payload(line) else {
            return ControlFlow::Continue(());
        };
        if data == "[DONE]" {
            return ControlFlow::Break(());
        }
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(text) = responses_stream_text(&event) {
                on_chunk(AiStreamChunk {
                    session_id: session_id.to_string(),
                    delta: text.to_string(),
                    reasoning_delta: None,
                    done: false,
                });
            }
        }
        ControlFlow::Continue(())
    })
    .await?;

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        done: true,
    });

    Ok(())
}

async fn stream_gemini(
    client: &reqwest::Client,
    session_id: &str,
    request: &AiCompletionRequest,
    cancelled: &Notify,
    on_chunk: &impl Fn(AiStreamChunk),
) -> Result<(), String> {
    let mut contents = Vec::new();
    for message in &request.messages {
        let role = if message.role == "assistant" { "model" } else { "user" };
        contents.push(json!({
            "role": role,
            "parts": [{ "text": message.content }],
        }));
    }

    let body = json!({
        "systemInstruction": {
            "parts": [{ "text": request.system_prompt }],
        },
        "contents": contents,
        "generationConfig": {
            "maxOutputTokens": request.max_tokens.unwrap_or(2048),
            "temperature": request.temperature.unwrap_or(0.2),
        },
    });

    let res = client
        .post(resolve_gemini_stream_endpoint(&request.config))
        .query(&[("key", request.config.api_key.as_str()), ("alt", "sse")])
        .header(CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;

    if !res.status().is_success() {
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "Gemini API error".to_string()));
    }

    read_sse_stream(res, cancelled, |line| {
        let Some(data) = stream_data_payload(line) else {
            return ControlFlow::Continue(());
        };
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
            let text = gemini_text(&event);
            if !text.is_empty() {
                on_chunk(AiStreamChunk {
                    session_id: session_id.to_string(),
                    delta: text,
                    reasoning_delta: None,
                    done: false,
                });
            }
        }
        ControlFlow::Continue(())
    })
    .await?;

    on_chunk(AiStreamChunk {
        session_id: session_id.to_string(),
        delta: String::new(),
        reasoning_delta: None,
        done: true,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Tool-calling streaming
//
// Provider-agnostic core: each provider parser emits `StreamToolEvent`s, the
// `StreamingToolCallAccumulator` collapses streamed (fragmented) tool-call JSON
// into the canonical `ToolCall` shape, and text/reasoning chunks pass straight
// through to `on_chunk`. Only OpenAI-style and Claude are wired here; Gemini and
// Ollama report `false` from `provider_supports_function_calling` and the agent
// loop uses its text-only fallback for them.
// ---------------------------------------------------------------------------

/// Whether the provider/config can do native function calling in this codebase.
pub fn provider_supports_function_calling(config: &AiConfig) -> bool {
    match config.provider {
        AiProvider::Ollama | AiProvider::Gemini => false,
        AiProvider::Claude => true,
        AiProvider::Openai
        | AiProvider::Deepseek
        | AiProvider::Qwen
        | AiProvider::OpenaiCompatible
        | AiProvider::Custom => config.api_style != AiApiStyle::Responses,
    }
}

/// Normalized streaming event emitted by every provider tool parser.
pub enum StreamToolEvent {
    Chunk(AiStreamChunk),
    ToolCallStart { index: u32, id: String, name: String },
    ToolCallDelta { index: u32, fragment: String },
    ToolCallComplete { index: u32 },
}

#[derive(Default)]
struct PartialToolCall {
    id: String,
    name: String,
    arguments: String,
}

/// Collects streamed tool-call fragments (keyed by provider stream index) and
/// finalizes them into canonical [`ToolCall`]s once the stream ends.
#[derive(Default)]
pub struct StreamingToolCallAccumulator {
    calls: HashMap<u32, PartialToolCall>,
    order: Vec<u32>,
}

impl StreamingToolCallAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn process(&mut self, event: StreamToolEvent, on_chunk: &impl Fn(AiStreamChunk)) {
        match event {
            StreamToolEvent::Chunk(chunk) => on_chunk(chunk),
            StreamToolEvent::ToolCallStart { index, id, name } => {
                let entry = self.entry(index);
                if !id.is_empty() {
                    entry.id = id;
                }
                if !name.is_empty() {
                    entry.name = name;
                }
            }
            StreamToolEvent::ToolCallDelta { index, fragment } => {
                self.entry(index).arguments.push_str(&fragment);
            }
            StreamToolEvent::ToolCallComplete { .. } => {}
        }
    }

    fn entry(&mut self, index: u32) -> &mut PartialToolCall {
        if !self.calls.contains_key(&index) {
            self.order.push(index);
        }
        self.calls.entry(index).or_default()
    }

    pub fn finalize(self) -> Vec<ToolCall> {
        let mut out = Vec::with_capacity(self.order.len());
        for index in &self.order {
            let Some(partial) = self.calls.get(index) else {
                continue;
            };
            if partial.name.is_empty() {
                continue;
            }
            let arguments = if partial.arguments.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str(&partial.arguments).unwrap_or_else(|_| json!({}))
            };
            let id = if partial.id.is_empty() { format!("call_{index}") } else { partial.id.clone() };
            out.push(ToolCall { id, name: partial.name.clone(), arguments });
        }
        out
    }
}

/// Stream a turn that may call tools. Text/reasoning deltas are delivered via
/// `on_chunk`; the parsed tool calls and token usage are returned at the end.
#[allow(clippy::too_many_arguments)]
pub async fn stream_with_tools(
    config: &AiConfig,
    system_prompt: &str,
    messages: &[AiMessage],
    session_id: &str,
    tools: &[ToolDefinition],
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    cancelled: &Notify,
    on_chunk: impl Fn(AiStreamChunk),
) -> Result<(Vec<ToolCall>, TokenUsage), String> {
    validate_config(config)?;
    let stream_timeout = if config.enable_thinking { 600 } else { 120 };
    let client = build_ai_http_client(config, stream_timeout)?;

    let accumulator = std::sync::Mutex::new(StreamingToolCallAccumulator::new());
    let emit = |event: StreamToolEvent| {
        accumulator.lock().expect("accumulator mutex poisoned").process(event, &on_chunk);
    };

    let usage = match config.provider {
        AiProvider::Claude => {
            stream_claude_with_tools(
                &client,
                config,
                system_prompt,
                messages,
                session_id,
                tools,
                max_tokens,
                temperature,
                cancelled,
                &emit,
            )
            .await?
        }
        _ => {
            stream_openai_with_tools(
                &client,
                config,
                system_prompt,
                messages,
                session_id,
                tools,
                max_tokens,
                temperature,
                cancelled,
                &emit,
            )
            .await?
        }
    };

    let tool_calls = accumulator.into_inner().expect("accumulator mutex poisoned").finalize();
    Ok((tool_calls, usage))
}

fn openai_messages_with_tools(system_prompt: &str, messages: &[AiMessage]) -> Vec<Value> {
    let mut out = Vec::with_capacity(messages.len() + 1);
    out.push(json!({ "role": "system", "content": system_prompt }));
    for m in messages {
        if m.role == "tool" {
            out.push(json!({
                "role": "tool",
                "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content,
            }));
        } else if m.role == "assistant" && !m.tool_calls.is_empty() {
            let calls: Vec<Value> = m
                .tool_calls
                .iter()
                .map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": "function",
                        "function": { "name": tc.name, "arguments": tc.arguments.to_string() },
                    })
                })
                .collect();
            let mut msg = json!({ "role": "assistant", "tool_calls": calls });
            if !m.content.is_empty() {
                msg["content"] = json!(m.content);
            }
            out.push(msg);
        } else {
            out.push(json!({ "role": m.role, "content": m.content }));
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
async fn stream_openai_with_tools(
    client: &reqwest::Client,
    config: &AiConfig,
    system_prompt: &str,
    messages: &[AiMessage],
    session_id: &str,
    tools: &[ToolDefinition],
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    cancelled: &Notify,
    emit: &impl Fn(StreamToolEvent),
) -> Result<TokenUsage, String> {
    let headers = maybe_bearer_headers(config)?;
    let tool_defs: Vec<Value> = tools.iter().map(|t| t.to_openai_tool()).collect();

    let mut body = json!({
        "model": config.model,
        "messages": openai_messages_with_tools(system_prompt, messages),
        "max_tokens": max_tokens.unwrap_or(2048),
        "temperature": temperature.unwrap_or(0.2),
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if !tool_defs.is_empty() {
        body["tools"] = json!(tool_defs);
        body["tool_choice"] = json!("auto");
    }
    if !config.enable_thinking {
        body["extra_body"] = json!({ "chat_template_kwargs": { "enable_thinking": false } });
    }

    let res = client
        .post(resolve_endpoint(config))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {e}"))?;

    if !res.status().is_success() {
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "API error".to_string()));
    }

    let mut usage = TokenUsage::default();
    read_sse_stream(res, cancelled, |line| {
        let Some(data) = stream_data_payload(line) else {
            return ControlFlow::Continue(());
        };
        if data == "[DONE]" {
            return ControlFlow::Break(());
        }
        if let Ok(event) = serde_json::from_str::<Value>(data) {
            parse_openai_tool_event(&event, session_id, emit, &mut usage);
        }
        ControlFlow::Continue(())
    })
    .await?;

    Ok(usage)
}

fn parse_openai_tool_event(event: &Value, session_id: &str, emit: &impl Fn(StreamToolEvent), usage: &mut TokenUsage) {
    if let Some(u) = event.get("usage").filter(|u| !u.is_null()) {
        if let Some(prompt) = u["prompt_tokens"].as_u64() {
            usage.input_tokens = Some(prompt as u32);
        }
        if let Some(completion) = u["completion_tokens"].as_u64() {
            usage.output_tokens = Some(completion as u32);
        }
    }

    let Some(choice) = event["choices"].get(0) else {
        return;
    };

    if let Some(reasoning) = choice["delta"]["reasoning_content"].as_str().filter(|s| !s.is_empty()) {
        emit(StreamToolEvent::Chunk(AiStreamChunk {
            session_id: session_id.to_string(),
            delta: String::new(),
            reasoning_delta: Some(reasoning.to_string()),
            done: false,
        }));
    }
    if let Some(text) = openai_stream_text(event) {
        emit(StreamToolEvent::Chunk(AiStreamChunk {
            session_id: session_id.to_string(),
            delta: text,
            reasoning_delta: None,
            done: false,
        }));
    }

    if let Some(calls) = choice["delta"]["tool_calls"].as_array() {
        for (position, call) in calls.iter().enumerate() {
            let index = call["index"].as_u64().map(|v| v as u32).unwrap_or(position as u32);
            let id = call["id"].as_str().unwrap_or_default();
            let name = call["function"]["name"].as_str().unwrap_or_default();
            if !id.is_empty() || !name.is_empty() {
                emit(StreamToolEvent::ToolCallStart { index, id: id.to_string(), name: name.to_string() });
            }
            if let Some(fragment) = call["function"]["arguments"].as_str().filter(|s| !s.is_empty()) {
                emit(StreamToolEvent::ToolCallDelta { index, fragment: fragment.to_string() });
            }
        }
    }
}

fn push_pending_tool_results(out: &mut Vec<Value>, pending: &mut Vec<Value>) {
    if !pending.is_empty() {
        out.push(json!({ "role": "user", "content": std::mem::take(pending) }));
    }
}

/// Convert our flat message list into Anthropic's content-block format: tool
/// results are grouped into a single `user` turn, and assistant tool calls
/// become `tool_use` content blocks.
fn claude_messages_with_tools(messages: &[AiMessage]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut pending: Vec<Value> = Vec::new();

    for m in messages {
        if m.role == "tool" {
            pending.push(json!({
                "type": "tool_result",
                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content,
            }));
            continue;
        }

        push_pending_tool_results(&mut out, &mut pending);

        if m.role == "assistant" {
            let mut content: Vec<Value> = Vec::new();
            if !m.content.is_empty() {
                content.push(json!({ "type": "text", "text": m.content }));
            }
            for tc in &m.tool_calls {
                content.push(json!({ "type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.arguments }));
            }
            if content.is_empty() {
                content.push(json!({ "type": "text", "text": "" }));
            }
            out.push(json!({ "role": "assistant", "content": content }));
        } else {
            out.push(json!({ "role": "user", "content": m.content }));
        }
    }

    push_pending_tool_results(&mut out, &mut pending);
    out
}

#[allow(clippy::too_many_arguments)]
async fn stream_claude_with_tools(
    client: &reqwest::Client,
    config: &AiConfig,
    system_prompt: &str,
    messages: &[AiMessage],
    session_id: &str,
    tools: &[ToolDefinition],
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    cancelled: &Notify,
    emit: &impl Fn(StreamToolEvent),
) -> Result<TokenUsage, String> {
    let tool_defs: Vec<Value> = tools.iter().map(|t| t.to_anthropic_tool()).collect();

    let mut body = json!({
        "model": config.model,
        "max_tokens": max_tokens.unwrap_or(2048),
        "temperature": temperature.unwrap_or(0.2),
        "system": claude_system_blocks(system_prompt),
        "messages": claude_messages_with_tools(messages),
        "stream": true,
    });
    if !tool_defs.is_empty() {
        body["tools"] = json!(tool_defs);
    }

    let res = client
        .post(resolve_endpoint(config))
        .headers(claude_headers(config)?)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude request failed: {e}"))?;

    if !res.status().is_success() {
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        return Err(extract_error(&data).unwrap_or_else(|| "Claude API error".to_string()));
    }

    let mut usage = TokenUsage::default();
    read_sse_stream(res, cancelled, |line| {
        let Some(data) = stream_data_payload(line) else {
            return ControlFlow::Continue(());
        };
        if let Ok(event) = serde_json::from_str::<Value>(data) {
            parse_claude_tool_event(&event, session_id, emit, &mut usage);
        }
        ControlFlow::Continue(())
    })
    .await?;

    Ok(usage)
}

fn parse_claude_tool_event(event: &Value, session_id: &str, emit: &impl Fn(StreamToolEvent), usage: &mut TokenUsage) {
    match event["type"].as_str() {
        Some("message_start") => {
            if let Some(input) = event["message"]["usage"]["input_tokens"].as_u64() {
                usage.input_tokens = Some(input as u32);
            }
        }
        Some("message_delta") => {
            if let Some(output) = event["usage"]["output_tokens"].as_u64() {
                usage.output_tokens = Some(output as u32);
            }
        }
        Some("content_block_start") => {
            let block = &event["content_block"];
            if block["type"] == "tool_use" {
                let index = event["index"].as_u64().unwrap_or(0) as u32;
                emit(StreamToolEvent::ToolCallStart {
                    index,
                    id: block["id"].as_str().unwrap_or_default().to_string(),
                    name: block["name"].as_str().unwrap_or_default().to_string(),
                });
            }
        }
        Some("content_block_delta") => {
            let index = event["index"].as_u64().unwrap_or(0) as u32;
            let delta = &event["delta"];
            match delta["type"].as_str() {
                Some("text_delta") => {
                    if let Some(text) = delta["text"].as_str().filter(|s| !s.is_empty()) {
                        emit(StreamToolEvent::Chunk(AiStreamChunk {
                            session_id: session_id.to_string(),
                            delta: text.to_string(),
                            reasoning_delta: None,
                            done: false,
                        }));
                    }
                }
                Some("thinking_delta") => {
                    if let Some(text) = delta["thinking"].as_str().filter(|s| !s.is_empty()) {
                        emit(StreamToolEvent::Chunk(AiStreamChunk {
                            session_id: session_id.to_string(),
                            delta: String::new(),
                            reasoning_delta: Some(text.to_string()),
                            done: false,
                        }));
                    }
                }
                Some("input_json_delta") => {
                    if let Some(fragment) = delta["partial_json"].as_str() {
                        emit(StreamToolEvent::ToolCallDelta { index, fragment: fragment.to_string() });
                    }
                }
                _ => {}
            }
        }
        Some("content_block_stop") => {
            let index = event["index"].as_u64().unwrap_or(0) as u32;
            emit(StreamToolEvent::ToolCallComplete { index });
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Conversation persistence (path-based)
// ---------------------------------------------------------------------------

const MAX_CONVERSATIONS: usize = 50;

pub fn read_conversations(path: &Path) -> Result<Vec<AiConversation>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

pub fn write_conversations(path: &Path, conversations: &[AiConversation]) -> Result<(), String> {
    let json = serde_json::to_string(conversations).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn save_conversation(path: &Path, conversation: AiConversation) -> Result<(), String> {
    let mut conversations = read_conversations(path)?;
    if let Some(pos) = conversations.iter().position(|c| c.id == conversation.id) {
        conversations[pos] = conversation;
    } else {
        conversations.insert(0, conversation);
        conversations.truncate(MAX_CONVERSATIONS);
    }
    write_conversations(path, &conversations)
}

pub fn load_conversations(path: &Path) -> Result<Vec<AiConversation>, String> {
    read_conversations(path)
}

pub fn delete_conversation(path: &Path, id: &str) -> Result<(), String> {
    let conversations: Vec<AiConversation> = read_conversations(path)?.into_iter().filter(|c| c.id != id).collect();
    write_conversations(path, &conversations)
}

pub fn save_config(path: &Path, config: &AiConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn load_config(path: &Path) -> Result<Option<AiConfig>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map(Some).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_ai_http_client, claude_system_blocks, drain_complete_lines, gemini_text, openai_response_text,
        openai_stream_text, parse_model_list_response, provider_supports_function_calling, resolve_endpoint,
        resolve_model_list_endpoint, responses_max_output_tokens, responses_text, validate_config, AiApiStyle,
        AiConfig, AiModelInfo, AiProvider, AiStreamChunk, StreamToolEvent, StreamingToolCallAccumulator,
    };

    #[test]
    fn accumulator_collapses_fragmented_tool_call() {
        let mut acc = StreamingToolCallAccumulator::new();
        let noop = |_c: AiStreamChunk| {};
        acc.process(StreamToolEvent::ToolCallStart { index: 0, id: "c1".into(), name: "execute_query".into() }, &noop);
        acc.process(StreamToolEvent::ToolCallDelta { index: 0, fragment: "{\"sql\":\"SE".into() }, &noop);
        acc.process(StreamToolEvent::ToolCallDelta { index: 0, fragment: "LECT 1\"}".into() }, &noop);
        acc.process(StreamToolEvent::ToolCallComplete { index: 0 }, &noop);

        let calls = acc.finalize();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "c1");
        assert_eq!(calls[0].name, "execute_query");
        assert_eq!(calls[0].arguments["sql"], "SELECT 1");
    }

    #[test]
    fn accumulator_preserves_order_and_recovers_from_bad_args() {
        let mut acc = StreamingToolCallAccumulator::new();
        let noop = |_c: AiStreamChunk| {};
        // Streamed out of index order: index 1 arrives first.
        acc.process(StreamToolEvent::ToolCallStart { index: 1, id: String::new(), name: "get_columns".into() }, &noop);
        acc.process(StreamToolEvent::ToolCallStart { index: 0, id: "a".into(), name: "list_tables".into() }, &noop);
        acc.process(StreamToolEvent::ToolCallDelta { index: 1, fragment: "not json".into() }, &noop);

        let calls = acc.finalize();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "get_columns");
        assert_eq!(calls[0].id, "call_1"); // empty id is synthesized from the index
        assert_eq!(calls[0].arguments, serde_json::json!({})); // unparseable args fall back to {}
        assert_eq!(calls[1].name, "list_tables");
    }

    #[test]
    fn function_calling_support_by_provider() {
        let mk = |provider: AiProvider, api_style: AiApiStyle| AiConfig {
            provider,
            api_key: "k".into(),
            endpoint: "https://x/v1".into(),
            model: "m".into(),
            api_style,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
        };
        assert!(provider_supports_function_calling(&mk(AiProvider::Openai, AiApiStyle::Completions)));
        assert!(provider_supports_function_calling(&mk(AiProvider::Claude, AiApiStyle::Completions)));
        assert!(!provider_supports_function_calling(&mk(AiProvider::Ollama, AiApiStyle::Completions)));
        assert!(!provider_supports_function_calling(&mk(AiProvider::Gemini, AiApiStyle::Completions)));
        assert!(!provider_supports_function_calling(&mk(AiProvider::Openai, AiApiStyle::Responses)));
    }

    #[test]
    fn claude_system_is_a_cacheable_ephemeral_block() {
        let blocks = claude_system_blocks("You are DBX's assistant.\nSchema: ...");
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "You are DBX's assistant.\nSchema: ...");
        assert_eq!(blocks[0]["cache_control"]["type"], "ephemeral");
    }

    #[test]
    fn sse_buffer_preserves_multibyte_char_split_across_chunks() {
        // "data: 查询\n" — split the first chunk inside the 3-byte '查' (bytes 6..=8).
        let full = "data: 查询\n".as_bytes();
        let mut buf = Vec::new();

        buf.extend_from_slice(&full[..7]); // ends mid-character, before any newline
        assert!(drain_complete_lines(&mut buf).is_empty());

        buf.extend_from_slice(&full[7..]);
        assert_eq!(drain_complete_lines(&mut buf), vec!["data: 查询".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn sse_buffer_splits_multiple_lines_and_keeps_remainder() {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"a\nbb\nccc");
        assert_eq!(drain_complete_lines(&mut buf), vec!["a".to_string(), "bb".to_string()]);
        assert_eq!(buf, b"ccc");
        assert!(drain_complete_lines(&mut buf).is_empty());
    }

    #[test]
    fn ai_config_proxy_fields_default_for_legacy_config() {
        let config: AiConfig = serde_json::from_value(serde_json::json!({
            "provider": "openai",
            "apiKey": "key",
            "endpoint": "https://api.openai.com/v1/chat/completions",
            "model": "gpt-4o",
            "apiStyle": "completions"
        }))
        .unwrap();

        assert!(!config.proxy_enabled);
        assert_eq!(config.proxy_url, "");
        assert!(config.enable_thinking);
    }

    #[test]
    fn ai_http_client_rejects_invalid_proxy_url() {
        let config = AiConfig {
            provider: AiProvider::Openai,
            api_key: "key".to_string(),
            endpoint: "https://api.openai.com/v1/chat/completions".to_string(),
            model: "gpt-4o".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: true,
            proxy_url: "not a proxy url".to_string(),
            enable_thinking: true,
        };

        let err = build_ai_http_client(&config, 1).unwrap_err();

        assert!(err.contains("Invalid AI proxy URL"));
    }

    #[test]
    fn ai_http_client_accepts_proxy_host_port_without_scheme() {
        let config = AiConfig {
            provider: AiProvider::Openai,
            api_key: "key".to_string(),
            endpoint: "https://api.openai.com/v1/chat/completions".to_string(),
            model: "gpt-4o".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: true,
            proxy_url: "127.0.0.1:7890".to_string(),
            enable_thinking: true,
        };

        build_ai_http_client(&config, 1).unwrap();
    }

    #[test]
    fn ai_http_client_bypasses_proxy_for_loopback_endpoint() {
        let config = AiConfig {
            provider: AiProvider::OpenaiCompatible,
            api_key: "key".to_string(),
            endpoint: "http://127.0.0.1:3456/v1".to_string(),
            model: "gpt-4o".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: true,
            proxy_url: "not a proxy url".to_string(),
            enable_thinking: true,
        };

        build_ai_http_client(&config, 1).unwrap();
    }

    #[test]
    fn resolves_gemini_and_ollama_endpoints() {
        let gemini = AiConfig {
            provider: AiProvider::Gemini,
            api_key: "key".to_string(),
            endpoint: "https://generativelanguage.googleapis.com".to_string(),
            model: "gemini-1.5-pro".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
        };

        assert_eq!(
            resolve_endpoint(&gemini),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent"
        );

        let ollama = AiConfig {
            provider: AiProvider::Ollama,
            api_key: String::new(),
            endpoint: "http://localhost:11434/v1".to_string(),
            model: "llama3.1".to_string(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
        };

        assert_eq!(resolve_endpoint(&ollama), "http://localhost:11434/v1/chat/completions");
        assert!(validate_config(&ollama).is_ok());
    }

    #[test]
    fn resolves_model_list_endpoints_from_base_and_completion_urls() {
        let openai = AiConfig {
            provider: AiProvider::Openai,
            api_key: "key".to_string(),
            endpoint: "https://api.openai.com/v1/chat/completions".to_string(),
            model: String::new(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
        };
        assert_eq!(resolve_model_list_endpoint(&openai).unwrap(), "https://api.openai.com/v1/models");

        let claude = AiConfig {
            provider: AiProvider::Claude,
            api_key: "key".to_string(),
            endpoint: "https://api.anthropic.com/v1/messages".to_string(),
            model: String::new(),
            api_style: AiApiStyle::Completions,
            proxy_enabled: false,
            proxy_url: String::new(),
            enable_thinking: true,
        };
        assert_eq!(resolve_model_list_endpoint(&claude).unwrap(), "https://api.anthropic.com/v1/models");
    }

    #[test]
    fn parses_openai_and_claude_model_list_items() {
        let data = serde_json::json!({
            "data": [
                { "id": "gpt-4o-mini" },
                { "id": "claude-sonnet-4-20250514", "display_name": "Claude Sonnet 4" },
                { "id": "gpt-4o-mini" },
                { "display_name": "Missing ID" }
            ]
        });

        assert_eq!(
            parse_model_list_response(&data).unwrap(),
            vec![
                AiModelInfo { id: "gpt-4o-mini".to_string(), display_name: None },
                AiModelInfo {
                    id: "claude-sonnet-4-20250514".to_string(),
                    display_name: Some("Claude Sonnet 4".to_string())
                },
            ]
        );
    }

    #[test]
    fn responses_api_clamps_tiny_output_token_requests() {
        assert_eq!(responses_max_output_tokens(Some(1)), 16);
        assert_eq!(responses_max_output_tokens(Some(16)), 16);
        assert_eq!(responses_max_output_tokens(Some(2400)), 2400);
        assert_eq!(responses_max_output_tokens(None), 2048);
    }

    #[test]
    fn parses_responses_text_from_current_and_nested_shapes() {
        assert_eq!(
            responses_text(&serde_json::json!({
                "output_text": "SELECT 1;"
            })),
            "SELECT 1;"
        );

        assert_eq!(
            responses_text(&serde_json::json!({
                "output": [{
                    "content": [{ "type": "output_text", "text": "SELECT 2;" }]
                }]
            })),
            "SELECT 2;"
        );
    }

    #[test]
    fn parses_openai_compatible_proxy_response_shapes() {
        assert_eq!(
            openai_response_text(&serde_json::json!({
                "choices": [{
                    "message": {
                        "content": [
                            { "type": "text", "text": "SELECT " },
                            { "type": "text", "text": "1;" }
                        ]
                    }
                }]
            })),
            "SELECT 1;"
        );

        assert_eq!(
            openai_stream_text(&serde_json::json!({
                "type": "response.output_text.delta",
                "delta": "SELECT 2;"
            }))
            .as_deref(),
            Some("SELECT 2;")
        );
    }

    #[test]
    fn parses_gemini_text_and_provider_aliases() {
        let data = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "text": "SELECT " },
                        { "text": "1;" }
                    ]
                }
            }]
        });

        assert_eq!(gemini_text(&data), "SELECT 1;");

        let claude: AiConfig = serde_json::from_value(serde_json::json!({
            "provider": "anthropic",
            "apiKey": "key",
            "endpoint": "https://api.anthropic.com/v1/messages",
            "model": "claude-sonnet-4-20250514"
        }))
        .unwrap();

        assert!(matches!(claude.provider, AiProvider::Claude));
    }
}
