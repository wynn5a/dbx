# Review — AI agent track (T12, T20, T21, T31, T42, T43)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T12 Agent tool queries cancellable | b2e2f9d8 | OK |
| T20 search_tables tool | adf7a942 | 1 medium |
| T21 Gemini/Ollama tool calling | ed844722 | 1 high, 1 medium |
| T31 One retry on connect | b051862a | 1 medium, 1 low |
| T42 Structured final-SQL output | 51803e7b | 2 medium |
| T43 Agent loop e2e test | 4e5a153f | OK |

## T21 — Gemini/Ollama tool calling

- [x] **HIGH — Gemini 3 `thoughtSignature` dropped, turn 2 of every tool loop fails** — fixed in `fba21660`
  - Where: `crates/dbx-core/src/ai.rs:1873-1889` (parse), `:1784` (replay in `gemini_contents_with_tools`).
  - Gemini `functionCall` parts carry `thoughtSignature`; the parser drops it and replay sends `{"functionCall":{name,args}}` without it. Gemini 3 rejects with 400 "Function call is missing a thought_signature" ([docs](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)).
  - Mock SSE fixture has no signature, so tests can't catch it.
  - Fix: optional `thought_signature` on `ToolCall`/`ToolCallRef` (serde-optional), capture `part["thoughtSignature"]` in `parse_gemini_tool_event`, emit beside `functionCall` on replay. Add a round-trip mock test.
  - Done: `thought_signature` on `ToolCall`/`ToolCallRef` (serde-optional, `ToolCallRef: From<&ToolCall>`), captured via a new `StreamToolEvent::ToolCallSignature`, replayed as a sibling `thoughtSignature` of `functionCall`. Mock-SSE round trip in `tests/ai_tool_stream.rs` asserts the signature in the turn-2 body.
- [x] **MEDIUM — tool-call index is per-chunk, not per-stream** — fixed in `fba21660`
  - Where: `ai.rs:1884` (`let index = position as u32;`).
  - Two `functionCall` parts in separate SSE chunks both get index 0: the name is overwritten, args concatenate to `{"a":..}{"b":..}` → parse fails → `{}`. First call lost, second runs with empty args.
  - Fix: running call counter in `stream_gemini_with_tools`, passed into the parser.
  - Done: stream-wide `next_call_index` owned by `stream_gemini_with_tools`. Tests: parser unit test (two chunks → `call_0`/`call_1`, args intact) and `gemini_calls_in_separate_chunks_stay_distinct_through_the_stream` over the real stream + replay.

## T20 — search_tables

- [x] **MEDIUM — default scope is a schema named after the database on PG/SQL Server/Oracle** — fixed in `80faaea4`
  - Where: `crates/dbx-core/src/agent_tools.rs:278` (`arg_str(tool_call, "schema").unwrap_or(database)`); frontend only sends `database: props.tab.database` (`AiAssistant.vue:733`).
  - On PG `search_tables {"search":"orders"}` searches schema `mydb`, answers "no tables matching" while `public.orders` exists; matches would be qualified `mydb.table`. Tool description ("defaults to current database/schema") is wrong.
  - Fix: send `tab.schema` in `AgentStreamRequest` and default to it, or search all schemas on schema-aware engines (bulk multi-schema listing from T08 exists). Add a PG-shaped test.
  - Done (both): frontend sends `schema: tab.schema`; `search_tables` without `schema` spans every schema on schema-aware engines via `list_completion_metadata_core` (default schema first, all matches qualified); `list_tables`/`get_columns`/`get_sample_data` and the no-tools schema-prompt fallback default to the tab schema, else `public`/`dbo`/`main`/user-named schema. Tests: PG-shaped unit tests, DuckDB end-to-end (catalog `memory` now resolves to `main`), and an ignored live PG test (`live_agent_metadata_tools_default_to_real_postgres_schemas`, run green against postgres:16).

## T31 — Retry once

- [x] **MEDIUM — timeouts are retried (plan: 429/5xx/connect only)** — fixed in `a98d2227`
  - Where: `ai.rs:575-590` (`Err(_) => true`).
  - Non-streaming `complete` (60 s client) only gets a response head after generation; timeout ⇒ provider probably still generating and billing; retry doubles the bill and the wait (~121 s). Streaming: 120 s / 600 s (thinking) doubled.
  - Fix: retry `Err(e)` only when `e.is_connect()`; never on `is_timeout()` (at least for non-streaming).
  - Done: send errors retry only when `is_connect() && !is_timeout()`, for streaming and non-streaming alike. Test: silent loopback server + 200 ms client timeout → exactly one connection.
- [x] **LOW — backoff ignores cancel** — fixed in `a98d2227`
  - The 1 s sleep and the second send don't watch the stream's `cancelled` Notify; a Cancel in that window still sends a (billable) retry.
  - Fix: race the sleep against `cancelled`.
  - Done: `send_with_retry_once` takes the stream's `Option<&Notify>` and races backoff + second send against it; on cancel it returns the first outcome and re-arms the permit. Test: 429 then Cancel during a 10 s backoff → returns at once, one request served.

## T42 — Structured final-SQL output

- [x] **MEDIUM — prompt-compliant replies render the SQL twice** — fixed in `44f9efc5`
  - Where: `apps/desktop/src/lib/aiMessageRender.ts:223`, prompt at `lib/ai.ts:176`.
  - Reply shape the prompt asks for (prose + ```sql fence + trailing JSON line) → one text segment containing the fence (rendered by `marked`, no Apply/Execute) + an actionable code segment from the JSON. Other sql fences lose their action buttons. Verified with vitest.
  - Fix: when the structured object is found, still fence-scan `proseBefore` and drop the fence whose content equals `sql` (or keep fence segments and use JSON only to pick the primary). Add a test for this exact shape.
  - Done: prose around the contract object is fence-scanned; its fences stay actionable code segments and the one matching the contract SQL (whitespace/`;`-insensitive) is the primary block, so the SQL renders once; it is appended only when no fence carries it. `dropDanglingFenceOpen` no longer eats a balanced block's closing fence. Tests for the exact prompt shape, multiple fences, and a non-matching fence.
- [x] **MEDIUM — `response_format: json_object` on official OpenAI for every Ask action** — fixed in `44f9efc5`
  - Where: `lib/ai.ts:110` (`structuredOutput` always sent), `ai.rs:1046`.
  - Explain/optimize/general answers get squeezed into a "one short sentence" `explanation`; streaming shows raw `{"sql": "...` until braces balance, then the layout jumps.
  - Fix: opt in only for SQL-generating actions, or drop `response_format` and rely on prompt + parser.
  - Done: dropped `response_format` (and the `structured_output` request field) — JSON mode conflicts with the prompt's prose + fence + JSON-line contract even for SQL actions. Unit test pins the official-endpoint body without it.

## T12 — OK (note)

- Cancel arriving during pool connect waits for the connect (phase 1 of `execute_sql_statement_with_options` doesn't watch the token). Shared with the editor path; not a regression.

## T43 — OK

- Real `run_agent_loop` over loopback mock, 3 turns, real SQLite, both confirmation directions. Only OpenAI-style provider exercised (plan allows).
