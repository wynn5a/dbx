# Review — UX / AI UI (T15, T16, T17, T19, T30, T32, T34, T35, T37, T38, T39)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T15 No dark-mode flash | 73011fe7 | OK |
| T16 Global error handler | 6609cd39 | OK, 1 low |
| T17 Actionable connection errors | 0bbf6f2d | 1 medium, 1 low |
| T19 High-risk SQL friction | 75cfc769 | 1 medium-high |
| T30 Token usage | 96fbac3b | OK, 1 low |
| T32 Chart from chat | b7ad137e | 1 medium |
| T34 Tab-switch shortcuts | e66e03dc | 1 medium-low |
| T35 Format SQL shortcut | fa0e42a8 | OK |
| T37 prefers-reduced-motion | a92296bb | OK |
| T38 Startup performance marks | f158bc2b | OK |
| T39 Async QueryEditor | cfb367b9 | OK |

## T19 — High-risk SQL friction

- [ ] **MEDIUM-HIGH — multi-statement SQL bypasses the acknowledgment**
  - Where: `apps/desktop/src/lib/aiSqlExecutionPolicy.ts:94-96` (`classifyAiSqlExecution`) → `requiresAiConfirmFriction`.
  - Multi-statement with no dangerous/unknown statement collapses to `"write"`. Verified: `CREATE TABLE a(x int); CREATE INDEX i ON a(x)` → `write`; `INSERT …; CREATE TABLE x(a int)` → `write`. Schema change bundled with anything gets one-click Run.
  - Related (pre-existing): `DELETE FROM users` with no WHERE is `write`, while unscoped `UPDATE` is `dangerous`.
  - Fix: multi-statement branch returns `schema_change` if any statement is one (or friction keys off "any statement ∈ {dangerous, schema_change}"); optionally classify unscoped DELETE as dangerous. Add tests.

## T17 — Actionable connection errors

- [ ] **MEDIUM — "Connection failed:" framing removed from every connect toast**
  - Where: `i18n/backend-errors.ts` `presentConnectionError`; callers `App.vue` `toastConnectError`, `TreeItem.vue:175-184`, `AppSidebar.vue:69-72`, `AiAssistant.vue` `changeConnection`. `connection.connectFailed` is now unused (only locale entries remain).
  - Unclassified errors (`Unknown database 'foo'`, JDBC stack line) show as a bare string with no context; plan said raw text stays as *fallback*, not replacement.
  - Fix: `title: t("connection.connectFailed", { message: translateBackendError(t, message) })`.
- [ ] **LOW — auth rule misfires on permission errors**
  - Where: `lib/connectionErrorHints.ts:48,51`.
  - Mongo `not authorized on admin to execute command { listDatabases … }` and MySQL `Access denied for user 'u'@'h' to database 'd'` (1044, grant issue) get "check username and password".
  - Fix: Mongo anchor to `Authentication failed`; MySQL exclude `to database` (or match `\(using password:`).

## T32 — Chart from chat

- [ ] **MEDIUM — chart column choices reset on every assistant re-render**
  - Where: `AiAssistant.vue` template `:result="stepChartResult(step)!"`; `QueryChart.vue:35-43` watches `props.result` by identity (immediate) and resets `xColumn`/`yColumns`.
  - Typing one character in the prompt box or any streaming delta snaps chosen X/Y back to defaults and recomputes the ECharts option; also re-parses up to 100 rows per chartable step per keystroke (`isChartableToolStep` parses again).
  - Fix: memoize parsed result per step (key `step.id` + `resultText`, or a computed map).

## T34 — Tab-switch shortcuts

- [ ] **MEDIUM-LOW — shortcuts misbehave while Driver Store is shown**
  - Where: `App.vue` `switchTab` (~801). Opening Driver Store doesn't clear `activeTabId`; `switchTab` only assigns it; hiding relies on a watcher that doesn't fire when target == active. Tab clicks work because `AppTabBar.activateTab` emits `close-driver-store`.
  - Driver Store over tab 1: Mod+1 (or next/prev with one tab) does nothing; next/prev computed from the hidden tab.
  - Fix: `showDriverStore.value = false` in `switchTab` whenever a target resolves.

## T16 — Global error handler

- [ ] **LOW — every error logged twice when debug logging is on**
  - Where: `lib/globalErrorHandler.ts:61-64` + install order in `main.ts` (`installDebugLogCapture()` wraps `console.error` before the handler binds it).
  - Handler calls `appendErrorDebugLog` then the wrapped `console.error` → second entry (stack formatted twice); burns the 1500-entry cap twice as fast in render loops.
  - Fix: use the pre-capture original `console.error`, or skip capture for `[vue:error]` messages.

## T30 — Token usage

- [ ] **LOW — usage of a cancelled run is never persisted**
  - Where: `AiAssistant.vue` `cancelStream` → `finalizeRun` → `persistConversation` (persists immediately); later `AgentEnd` writes `msg.usage` but `runBackendAgent`'s `finalizeRun` is skipped (token bumped). Shown until reload, then lost.
  - Fix: `persistConversation()` in the `agent_end` case when the run is no longer active, or persist in `runBackendAgent`'s finally regardless of token.

## OK tasks (notes)

- T15: same key `dbx-theme`, same normalization, matchMedia, `html.dark`, inline `color-scheme` as `useTheme.applyTheme`.
- T35: `Mod+Shift+F` only inside `[data-query-editor-root]` on query tabs; no CodeMirror keymap conflict.
- T37: global reduced-motion override; JS smooth scrolls go through the helper; ECharts excluded as documented.
- T38: marks recorded once, in order; summary flushed without duplicates; ad-hoc `[STARTUP]` timing removed.
- T39: async wrapper forwards template ref; every `queryEditorRef` caller uses `?.`; `formatRequestId` watch non-immediate.
- i18n: all new strings present in all six locales.
