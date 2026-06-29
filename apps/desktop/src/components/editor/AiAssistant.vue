<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { uuid } from "@/lib/utils";
import { useI18n } from "vue-i18n";
import { translateBackendError } from "@/i18n/backend-errors";
import {
  ArrowUp,
  ArrowRightLeft,
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  CircleSlash,
  Copy,
  Database,
  HelpCircle,
  History,
  Loader2,
  MessageSquarePlus,
  Replace,
  Server,
  ShieldCheck,
  Table2,
  Play,
  Square,
  Trash2,
  Terminal,
  Wand2,
  Wrench,
  X,
  Zap,
  TestTube,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import LightDropdown from "@/components/ui/LightDropdown.vue";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/composables/useTheme";
import { useSettingsStore } from "@/stores/settingsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { connectionIconType } from "@/lib/connectionPresentation";
import DatabaseIcon from "@/components/icons/DatabaseIcon.vue";
import { useQueryStore } from "@/stores/queryStore";
import { useToast } from "@/composables/useToast";
import {
  buildAgentSystemPrompt,
  buildAiContext,
  buildTurnContextBlock,
  buildVolatileContext,
  runAiStream,
  type AiAction,
  type AiContext,
} from "@/lib/ai";
import {
  classifyAiSqlExecution,
  type AiSqlExecutionCategory,
  type AiSqlExecutionDecision,
} from "@/lib/aiSqlExecutionPolicy";
import ExplainPlanViewer from "@/components/explain/ExplainPlanViewer.vue";
import { parseExplainResult, type ParsedExplainPlan } from "@/lib/explainPlan";
import type { QueryResult } from "@/types/database";
import { createAiShikiCodeHighlighter, type AiCodeHighlighter } from "@/lib/aiCodeHighlighter";
import { createAiMessageRenderer } from "@/lib/aiMessageRender";
import { Marked } from "marked";
import {
  aiAgentStream,
  aiAgentConfirmTool,
  aiCancelStream,
  saveAiConversation,
  loadAiConversations,
  deleteAiConversation,
  type AiConversation,
} from "@/lib/api";
import type { AgentEvent, AgentStreamRequest, AiMessage } from "@/lib/api";
import type { ConnectionConfig, QueryTab } from "@/types/database";
import type { SqlCompletionTable } from "@/lib/sqlCompletion";
import { useDatabaseOptions } from "@/composables/useDatabaseOptions";
import {
  decodeSelectableDatabaseValue,
  encodeSelectableDatabaseValue,
  formatDatabaseLabel,
  resolveDefaultDatabase,
} from "@/lib/defaultDatabase";
import { copyToClipboard } from "@/lib/clipboard";
import { formatAiTableMention, parseAiTableMentions, type AiTableMention } from "@/lib/aiTableMentions";
import { isAiPromptImeCompositionEvent, shouldSubmitAiPromptOnKeydown } from "@/lib/aiPromptKeyboard";

const { t } = useI18n();
const settings = useSettingsStore();
const connectionStore = useConnectionStore();
const queryStore = useQueryStore();
const { toast } = useToast();
const { isDark } = useTheme();

type AgentStepTone = "active" | "success" | "danger";

interface AgentToolStep {
  /** tool_call_id */
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  resultText?: string;
  explainData?: unknown;
}

interface PendingToolConfirm {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  sql: string;
  decision: AiSqlExecutionDecision;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  isThinking?: boolean;
  toolSteps?: AgentToolStep[];
  pendingConfirm?: PendingToolConfirm | null;
}

const props = defineProps<{
  tab?: QueryTab;
  connection?: ConnectionConfig;
}>();

const emit = defineEmits<{
  replaceSql: [sql: string];
  executeSql: [sql: string];
  close: [];
}>();

const prompt = ref("");
const messages = ref<ChatMessage[]>([]);
const isGenerating = ref(false);
const scrollRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const activeAction = ref<AiAction>("generate");
const assistantMode = ref<"ask" | "agent">("ask");
const currentSessionId = ref("");
const conversationId = ref("");
// A run token identifies one user-initiated turn; bumping it (new send or
// cancel) invalidates stale stream/confirmation callbacks.
const agentRunToken = ref(0);
// Schema context is expensive to build (many backend calls) and large in the
// prompt. Cache it per (connection, database, mentions, focused table) so turns
// reuse it instead of rebuilding/re-sending — and so the system prompt prefix
// stays stable for provider prompt caching.
const cachedSchemaContext = ref<{ signature: string; context: AiContext } | null>(null);
const conversations = ref<AiConversation[]>([]);
const showConversationList = ref(false);
const promptTextareaRef = ref<HTMLTextAreaElement | null>(null);
const promptCompositionActive = ref(false);
const shikiCodeHighlighter = ref<AiCodeHighlighter>();

interface AiMentionCandidate {
  schema?: string;
  name: string;
  tableType: string;
}

const mentionOpen = ref(false);
const mentionLoading = ref(false);
const mentionError = ref("");
const mentionStart = ref(0);
const mentionSelectedIndex = ref(0);
const mentionCandidates = ref<AiMentionCandidate[]>([]);
const mentionCache = ref<Record<string, AiMentionCandidate[]>>({});
const selectedMentions = ref<AiTableMention[]>([]);
let mentionTimer: ReturnType<typeof setTimeout> | undefined;
let mentionRequestId = 0;

const actionButtons: { action: AiAction; icon: any; key: string }[] = [
  { action: "generate", icon: Wand2, key: "ai.actions.generate" },
  { action: "explain", icon: HelpCircle, key: "ai.actions.explain" },
  { action: "optimize", icon: Zap, key: "ai.actions.optimize" },
  { action: "fix", icon: Wrench, key: "ai.actions.fix" },
  { action: "convert", icon: ArrowRightLeft, key: "ai.actions.convert" },
  { action: "sampleData", icon: TestTube, key: "ai.actions.sampleData" },
];

function selectAction(action: AiAction) {
  activeAction.value = action;
  if (action === "fix" && props.tab?.result) {
    const cols = props.tab.result.columns;
    if (cols.includes("Error")) {
      const errVal = props.tab.result.rows[0]?.[0];
      if (errVal != null) prompt.value = String(errVal);
    }
  }
}

const chatTitle = computed(() => {
  const first = messages.value.find((m) => m.role === "user");
  return first ? first.content.slice(0, 30) : t("ai.newChat");
});

const promptMentionChips = computed(() => selectedMentions.value);

const isWaitingForFirstDelta = computed(() => {
  const last = messages.value[messages.value.length - 1];
  return isGenerating.value && last?.role === "assistant" && !last.content && !last.reasoning;
});

const activePlaceholder = computed(
  () => `${t(`ai.placeholders.${activeAction.value}`)} ${t("ai.tableMentionPlaceholderHint")}`,
);
const activeModeHint = computed(() => t(`ai.modeHints.${assistantMode.value}`));
const assistantModeItems = computed(() => [
  {
    value: "ask",
    label: t("ai.modes.ask"),
    title: t("ai.modeHints.ask"),
    icon: MessageSquarePlus,
  },
  {
    value: "agent",
    label: t("ai.modes.agent"),
    title: t("ai.modeHints.agent"),
    icon: Bot,
  },
]);
const actionMenuItems = computed(() =>
  actionButtons.map((button) => ({
    value: button.action,
    label: t(button.key),
    icon: button.icon,
  })),
);
const aiCodeAppearance = computed(() => (isDark.value ? "dark" : "light"));

const { databaseOptions: allDbOptions, loadDatabaseOptions } = useDatabaseOptions();

const dbOptions = computed(() => {
  if (!props.connection) return [];
  return allDbOptions.value[props.connection.id] || [];
});

const dbSelectOptions = computed(() => {
  const connection = props.connection;
  if (!connection) return [];
  return dbOptions.value.map((database) => ({
    database,
    value: encodeSelectableDatabaseValue(connection.db_type, database),
    label: formatDatabaseLabel(connection, database, {
      defaultDatabase: t("editor.defaultDatabase"),
      noDatabase: t("editor.noDatabase"),
    }),
  }));
});

const selectedDatabaseSelectValue = computed(() =>
  props.connection ? encodeSelectableDatabaseValue(props.connection.db_type, props.tab?.database || "") : "",
);

const selectedDatabaseLabel = computed(() => {
  if (!props.connection) return t("editor.selectDatabase");
  if (!props.tab) return t("editor.selectDatabase");
  return formatDatabaseLabel(props.connection, props.tab.database || "", {
    defaultDatabase: t("editor.defaultDatabase"),
    noDatabase: t("editor.noDatabase"),
  });
});

async function loadDatabases() {
  if (!props.connection) return;
  await loadDatabaseOptions(props.connection.id);
}

async function changeConnection(connectionId: string) {
  const conn = connectionStore.getConfig(connectionId);
  if (!conn) return;
  connectionStore.activeConnectionId = connectionId;
  const tab = props.tab;
  if (tab) {
    queryStore.updateConnection(tab.id, connectionId, resolveDefaultDatabase(conn, []));
  } else {
    queryStore.createTab(connectionId, resolveDefaultDatabase(conn, []));
  }
  try {
    await loadDatabaseOptions(connectionId);
    const database = resolveDefaultDatabase(conn, allDbOptions.value[connectionId] || []);
    if (tab) {
      queryStore.updateDatabase(tab.id, database);
    }
  } catch (e: any) {
    toast(t("connection.connectFailed", { message: translateBackendError(t, e?.message || String(e)) }), 5000);
  }
}

function changeDatabase(value: string) {
  const tab = props.tab;
  const connection = props.connection;
  if (!tab || !connection) return;
  queryStore.updateDatabase(tab.id, decodeSelectableDatabaseValue(connection.db_type, value));
}

function appendAssistantDelta(assistantIdx: number, delta: string) {
  const msg = messages.value[assistantIdx];
  if (msg.isThinking) msg.isThinking = false;
  msg.content += delta;
  // Keep msg.content authoritative (history/finalize read it), but feed the
  // in-flight render through a throttled, shiki-free mirror — see streamingIndex.
  scheduleLiveStreamUpdate(msg.content);
  scrollToBottom();
}

function appendAssistantReasoning(assistantIdx: number, delta: string) {
  const msg = messages.value[assistantIdx];
  if (!msg.reasoning) msg.reasoning = "";
  msg.reasoning += delta;
  msg.isThinking = true;
  scrollToBottom();
}

const expandedReasoning = ref<Set<number>>(new Set());

function toolStepTone(step: AgentToolStep): AgentStepTone {
  if (step.status === "error") return "danger";
  if (step.status === "running") return "active";
  return "success";
}

function agentStepIcon(tone: AgentStepTone) {
  if (tone === "danger") return CircleSlash;
  if (tone === "active") return Loader2;
  return ShieldCheck;
}

function agentStepClass(tone: AgentStepTone): string {
  switch (tone) {
    case "success":
      return "border-[color-mix(in_srgb,var(--ds-green)_30%,transparent)] bg-[color-mix(in_srgb,var(--ds-green)_14%,transparent)] text-[var(--ds-green)]";
    case "active":
      return "border-[color-mix(in_srgb,var(--ds-blue)_30%,transparent)] bg-[color-mix(in_srgb,var(--ds-blue)_14%,transparent)] text-[var(--ds-blue)]";
    case "danger":
      return "border-[color-mix(in_srgb,var(--ds-red)_35%,transparent)] bg-[color-mix(in_srgb,var(--ds-red)_14%,transparent)] text-[var(--ds-red)]";
    default:
      return "border-[var(--ds-border)] bg-[var(--ds-bg-active)] text-[var(--ds-text-3)]";
  }
}

// Risk descriptors shown on the write-confirmation card, derived from the
// client-side execution-policy classification of the SQL the agent wants to run.
type RiskTone = "danger" | "warning" | "neutral";

function confirmCategoryTone(category: AiSqlExecutionCategory): RiskTone {
  if (category === "dangerous") return "danger";
  if (category === "write" || category === "schema_change" || category === "unknown") return "warning";
  return "neutral";
}

function confirmCategoryLabel(category: AiSqlExecutionCategory): string {
  return t(`ai.toolConfirm.category.${category}`);
}

function riskBadgeClass(tone: RiskTone): string {
  switch (tone) {
    case "danger":
      return "border-[color-mix(in_srgb,var(--ds-red)_35%,transparent)] bg-[color-mix(in_srgb,var(--ds-red)_14%,transparent)] text-[var(--ds-red)]";
    case "warning":
      return "border-[color-mix(in_srgb,var(--ds-amber)_35%,transparent)] bg-[color-mix(in_srgb,var(--ds-amber)_14%,transparent)] text-[var(--ds-amber)]";
    default:
      return "border-[var(--ds-border)] bg-[var(--ds-bg-active)] text-[var(--ds-text-3)]";
  }
}

const KNOWN_CONFIRM_REASONS = new Set(["multi_statement", "empty_sql"]);

function confirmReasonLabel(reason: string): string {
  return KNOWN_CONFIRM_REASONS.has(reason) ? t(`ai.toolConfirm.reasons.${reason}`) : reason;
}

/** Parse a tool's `explain_data` (a serialized QueryResult) into a plan for the viewer. */
function parseExplainFromData(explainData: unknown, dbType: string): ParsedExplainPlan | undefined {
  if (!explainData || typeof explainData !== "object") return undefined;
  if (dbType !== "mysql" && dbType !== "postgres" && dbType !== "dameng") return undefined;
  try {
    return parseExplainResult(dbType, explainData as QueryResult);
  } catch {
    return undefined;
  }
}

function toggleReasoning(index: number) {
  const next = new Set(expandedReasoning.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  expandedReasoning.value = next;
}

function scrollToBottom() {
  nextTick(() => {
    const root = scrollRef.value?.$el as HTMLElement | undefined;
    const el = root?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  });
}

function mentionCacheKey(connectionId: string, database: string, query: string) {
  return `${connectionId}:${database}:${query.toLowerCase()}`;
}

function activeMentionAtCursor(): { start: number; query: string } | null {
  const textarea = promptTextareaRef.value;
  const cursor = textarea?.selectionStart ?? prompt.value.length;
  const beforeCursor = prompt.value.slice(0, cursor);
  const match = /(^|[\s([{,;:])@([^\s]*)$/.exec(beforeCursor);
  if (!match) return null;
  return { start: beforeCursor.length - match[2].length - 1, query: match[2] };
}

function normalizeMentionQuery(query: string): { schemaPrefix: string; tableFilter: string } {
  const clean = query.replace(/^["`]+|["`]+$/g, "");
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return { schemaPrefix: "", tableFilter: clean };
  return {
    schemaPrefix: clean.slice(0, dot).replace(/^["`]+|["`]+$/g, ""),
    tableFilter: clean.slice(dot + 1).replace(/^["`]+|["`]+$/g, ""),
  };
}

async function loadMentionCandidates(query: string) {
  if (!props.connection || !props.tab?.connectionId || !props.tab.database) return;

  const connectionId = props.tab.connectionId;
  const database = props.tab.database;
  const key = mentionCacheKey(connectionId, database, query);
  if (mentionCache.value[key]) {
    mentionCandidates.value = mentionCache.value[key];
    return;
  }

  const requestId = ++mentionRequestId;
  const { schemaPrefix, tableFilter } = normalizeMentionQuery(query);
  const bySchemaPrefix = (items: AiMentionCandidate[]) =>
    schemaPrefix
      ? items.filter((item) => (item.schema || "").toLowerCase().includes(schemaPrefix.toLowerCase()))
      : items;

  // Instant path: reuse the SQL editor's warmed in-memory completion index. This
  // is synchronous and never touches the backend, so the dropdown appears at once
  // whenever tables have already been loaded for this connection/database.
  const local = bySchemaPrefix(
    connectionStore
      .lookupLocalCompletionTables(connectionId, database, tableFilter, 40)
      .map(mentionCandidateFromCompletionTable),
  );
  if (local.length) {
    mentionCandidates.value = local;
    mentionSelectedIndex.value = 0;
  }
  mentionLoading.value = local.length === 0;
  mentionError.value = "";

  try {
    // Backfill/refresh from the store's shared, persistent completion cache. It
    // de-duplicates in-flight requests and only hits the backend on a cold cache,
    // so mentions and editor autocomplete warm each other.
    const tables = await connectionStore.listCompletionTables(connectionId, database, tableFilter, 40);
    if (requestId !== mentionRequestId) return;
    const candidates = bySchemaPrefix(tables.map(mentionCandidateFromCompletionTable)).slice(0, 40);
    mentionCache.value[key] = candidates;
    mentionCandidates.value = candidates;
    mentionSelectedIndex.value = 0;
  } catch (e: any) {
    if (requestId !== mentionRequestId) return;
    if (!local.length) {
      mentionError.value = translateBackendError(t, e?.message || String(e));
      mentionCandidates.value = [];
    }
  } finally {
    if (requestId === mentionRequestId) mentionLoading.value = false;
  }
}

function mentionCandidateFromCompletionTable(table: SqlCompletionTable): AiMentionCandidate {
  return { schema: table.schema, name: table.name, tableType: table.type === "view" ? "VIEW" : "TABLE" };
}

function mentionDisplayName(mention: AiTableMention) {
  return [mention.schema, mention.table].filter(Boolean).join(".");
}

function removeMentionChip(mention: AiTableMention) {
  selectedMentions.value = selectedMentions.value.filter((item) => item.raw !== mention.raw);
  nextTick(() => promptTextareaRef.value?.focus());
}

function addSelectedMention(candidate: AiMentionCandidate) {
  const raw = formatAiTableMention(candidate.schema, candidate.name);
  const key = `${candidate.schema || ""}.${candidate.name}`.toLowerCase();
  if (selectedMentions.value.some((mention) => `${mention.schema || ""}.${mention.table}`.toLowerCase() === key))
    return;
  selectedMentions.value.push({ raw, schema: candidate.schema, table: candidate.name });
}

function formatMentionTableType(tableType: string) {
  const normalized = tableType.toUpperCase().replace(/\s+/g, "_");
  if (normalized.includes("VIEW")) return t("ai.tableMentionTypes.view");
  if (normalized.includes("SYSTEM")) return t("ai.tableMentionTypes.systemTable");
  if (normalized.includes("TEMP")) return t("ai.tableMentionTypes.temporaryTable");
  return t("ai.tableMentionTypes.table");
}

function refreshMentionState() {
  clearTimeout(mentionTimer);
  const mention = activeMentionAtCursor();
  if (!mention || !props.connection || !props.tab?.database || isGenerating.value) {
    mentionOpen.value = false;
    return;
  }

  mentionOpen.value = true;
  mentionStart.value = mention.start;
  mentionTimer = setTimeout(() => {
    loadMentionCandidates(mention.query).catch(() => {});
  }, 120);
}

function insertMention(candidate: AiMentionCandidate) {
  const textarea = promptTextareaRef.value;
  const cursor = textarea?.selectionStart ?? prompt.value.length;
  const before = prompt.value.slice(0, mentionStart.value);
  const after = prompt.value.slice(cursor);
  addSelectedMention(candidate);
  prompt.value = `${before}${after}`.replace(/\s{2,}/g, " ");
  mentionOpen.value = false;
  nextTick(() => {
    const nextCursor = before.length;
    promptTextareaRef.value?.focus();
    promptTextareaRef.value?.setSelectionRange(nextCursor, nextCursor);
  });
}

function onPromptKeydown(event: KeyboardEvent) {
  if (isAiPromptImeCompositionEvent(event, promptCompositionActive.value)) return;

  if (mentionOpen.value) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      mentionSelectedIndex.value = Math.min(
        mentionSelectedIndex.value + 1,
        Math.max(mentionCandidates.value.length - 1, 0),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      mentionSelectedIndex.value = Math.max(mentionSelectedIndex.value - 1, 0);
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && mentionCandidates.value[mentionSelectedIndex.value]) {
      event.preventDefault();
      insertMention(mentionCandidates.value[mentionSelectedIndex.value]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      mentionOpen.value = false;
      return;
    }
  }

  if (shouldSubmitAiPromptOnKeydown(event, promptCompositionActive.value)) {
    event.preventDefault();
    send();
  }
}

async function send() {
  const text = prompt.value.trim();
  if ((!text && !selectedMentions.value.length) || isGenerating.value) return;

  if (!props.connection || !props.tab) return;
  if (!settings.isConfigured()) {
    toast(t("ai.noConfig"));
    return;
  }

  const mentionedTables = [...selectedMentions.value, ...parseAiTableMentions(text)];
  const displayText = [selectedMentions.value.map((mention) => mention.raw).join(" "), text].filter(Boolean).join(" ");

  messages.value.push({ role: "user", content: displayText });
  prompt.value = "";
  selectedMentions.value = [];
  scrollToBottom();

  const requestedMode = assistantMode.value;
  const requestedAction = activeAction.value;

  // Begin a fresh run; the token invalidates any in-flight stream or pending confirm.
  const token = ++agentRunToken.value;
  isGenerating.value = true;

  let schemaContext: AiContext;
  try {
    schemaContext = await getSchemaContext(mentionedTables);
  } catch (e: any) {
    messages.value.push({ role: "assistant", content: `Error: ${e?.message || e}` });
    finalizeRun();
    return;
  }

  if (requestedMode === "agent") {
    await runBackendAgent({ action: requestedAction, instruction: displayText, schemaContext, token });
  } else {
    await runAskTurn({ action: requestedAction, instruction: displayText, schemaContext });
    if (token === agentRunToken.value) finalizeRun();
  }
}

// Signature over the inputs that change the schema context. Same signature →
// reuse the cached context (no rebuild, identical cacheable system prompt).
function schemaContextSignature(mentionedTables: AiTableMention[]): string {
  const conn = props.tab?.connectionId || "";
  const db = props.tab?.database || "";
  const focused = props.tab?.tableMeta ? `${props.tab.tableMeta.schema || ""}.${props.tab.tableMeta.tableName}` : "";
  const mentions = mentionedTables
    .map((m) => `${m.schema || ""}.${m.table}`.toLowerCase())
    .sort()
    .join(",");
  return `${conn}|${db}|${focused}|${mentions}`;
}

async function getSchemaContext(mentionedTables: AiTableMention[]): Promise<AiContext> {
  const signature = schemaContextSignature(mentionedTables);
  const cached = cachedSchemaContext.value;
  if (cached && cached.signature === signature) return cached.context;
  const context = await buildAiContext(props.tab!, props.connection!, { mentionedTables });
  cachedSchemaContext.value = { signature, context };
  return context;
}

interface RunTurnParams {
  action: AiAction;
  instruction: string;
  schemaContext: AiContext;
}

// Ask mode: one streaming assistant turn, no tools. Generates SQL/explanations
// into a fresh assistant bubble.
async function runAskTurn(params: RunTurnParams) {
  messages.value.push({ role: "assistant", content: "" });
  const assistantIdx = messages.value.length - 1;
  const sessionId = uuid();
  currentSessionId.value = sessionId;

  try {
    const context: AiContext = props.tab
      ? { ...params.schemaContext, ...buildVolatileContext(props.tab) }
      : params.schemaContext;
    const history: AiMessage[] = messages.value.slice(0, assistantIdx).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    await runAiStream(
      {
        config: settings.aiConfig,
        action: params.action,
        mode: "ask",
        instruction: params.instruction,
        context,
      },
      history,
      (delta) => appendAssistantDelta(assistantIdx, delta),
      sessionId,
      (reasoningDelta) => appendAssistantReasoning(assistantIdx, reasoningDelta),
    );
  } catch (e: any) {
    messages.value[assistantIdx].content = `Error: ${e.message || e}`;
  } finally {
    const msg = messages.value[assistantIdx];
    if (msg) msg.isThinking = false;
    if (currentSessionId.value === sessionId) currentSessionId.value = "";
  }
}

// Agent mode: drive the server-side tool-calling loop. The backend streams
// AgentEvents (text, reasoning, tool calls, write-confirmation requests) which
// we render into a single assistant bubble.
async function runBackendAgent(params: RunTurnParams & { token: number }) {
  if (!props.connection || !props.tab) {
    finalizeRun();
    return;
  }
  messages.value.push({ role: "assistant", content: "", toolSteps: [], pendingConfirm: null });
  const assistantIdx = messages.value.length - 1;
  const sessionId = uuid();
  currentSessionId.value = sessionId;

  const context: AiContext = { ...params.schemaContext, ...buildVolatileContext(props.tab) };
  // Prior turns become conversation history; the current user turn carries the
  // instruction plus the volatile context block (current SQL / last error).
  const priorHistory: AiMessage[] = messages.value.slice(0, assistantIdx - 1).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const contextBlock = buildTurnContextBlock(context);
  const userPrompt = contextBlock ? `${params.instruction}\n\n${contextBlock}` : params.instruction;

  const request: AgentStreamRequest = {
    config: settings.aiConfig,
    systemPrompt: buildAgentSystemPrompt(params.action, context),
    messages: [...priorHistory, { role: "user", content: userPrompt }],
    maxTokens: settings.aiConfig.enableThinking ? 8192 : 2400,
    temperature: 0.15,
    connectionId: props.tab.connectionId,
    database: props.tab.database,
    dbType: props.connection.db_type,
    mode: "agent",
  };

  try {
    await aiAgentStream(sessionId, request, (event) => handleAgentEvent(assistantIdx, sessionId, event));
  } catch (e: any) {
    const msg = messages.value[assistantIdx];
    if (msg) msg.content += `${msg.content ? "\n\n" : ""}Error: ${e?.message || e}`;
  } finally {
    const msg = messages.value[assistantIdx];
    if (msg) {
      msg.isThinking = false;
      msg.pendingConfirm = null;
    }
    if (currentSessionId.value === sessionId) currentSessionId.value = "";
  }

  if (params.token === agentRunToken.value) finalizeRun();
}

function handleAgentEvent(assistantIdx: number, sessionId: string, event: AgentEvent) {
  const msg = messages.value[assistantIdx];
  if (!msg) return;
  switch (event.type) {
    case "reasoning_delta":
      appendAssistantReasoning(assistantIdx, event.delta);
      break;
    case "text_delta":
      // A tool call between two text runs ends the prior run mid-stream; the
      // model rarely re-emits a leading newline, so without a separator the runs
      // glue together (e.g. a code-fence onto following prose). Break the
      // paragraph when resuming text after a tool step.
      if (msg.content && msg.toolSteps?.length && !/\n\s*$/.test(msg.content)) {
        msg.content += "\n\n";
      }
      appendAssistantDelta(assistantIdx, event.delta);
      break;
    case "tool_call_start": {
      if (!msg.toolSteps) msg.toolSteps = [];
      msg.toolSteps.push({
        id: event.tool_call_id,
        name: event.tool_name,
        args: event.args && typeof event.args === "object" ? (event.args as Record<string, unknown>) : undefined,
        status: "running",
      });
      scrollToBottom();
      break;
    }
    case "tool_call_end": {
      const step = msg.toolSteps?.find((s) => s.id === event.tool_call_id);
      if (step) {
        step.status = event.is_error ? "error" : "done";
        const { content, explainData } = extractToolResult(event.result);
        step.resultText = content;
        step.explainData = explainData;
      }
      if (msg.pendingConfirm?.toolCallId === event.tool_call_id) msg.pendingConfirm = null;
      scrollToBottom();
      break;
    }
    case "tool_confirm_request": {
      msg.pendingConfirm = {
        sessionId,
        toolCallId: event.tool_call_id,
        toolName: event.tool_name,
        sql: event.sql,
        decision: classifyAiSqlExecution(event.sql, props.connection),
      };
      scrollToBottom();
      break;
    }
    case "error":
      msg.content += `${msg.content ? "\n\n" : ""}Error: ${event.message}`;
      break;
    case "turn_start":
    case "turn_end":
    case "agent_end":
      break;
  }
}

function extractToolResult(result: unknown): { content?: string; explainData?: unknown } {
  if (!result || typeof result !== "object") return {};
  const obj = result as Record<string, unknown>;
  return {
    content: typeof obj.content === "string" ? obj.content : undefined,
    explainData: obj.explain_data,
  };
}

async function confirmTool(assistantIdx: number, approved: boolean) {
  const msg = messages.value[assistantIdx];
  const confirm = msg?.pendingConfirm;
  if (!confirm) return;
  if (msg) msg.pendingConfirm = null;
  await aiAgentConfirmTool(confirm.sessionId, confirm.toolCallId, approved).catch(() => {});
}

function clearPendingConfirms() {
  for (const msg of messages.value) {
    if (msg.pendingConfirm) msg.pendingConfirm = null;
  }
}

function finalizeRun() {
  isGenerating.value = false;
  activeAction.value = "generate";
  currentSessionId.value = "";
  persistConversation();
  scrollToBottom();
}

async function cancelStream() {
  // Invalidate the run so any in-flight stream or pending confirmation is dropped.
  agentRunToken.value++;
  clearPendingConfirms();
  if (currentSessionId.value) await aiCancelStream(currentSessionId.value).catch(() => {});
  finalizeRun();
}

function applySql(code: string) {
  emit("replaceSql", code);
}

function executeSql(code: string) {
  emit("replaceSql", code);
  emit("executeSql", code);
}

const copiedIndex = ref("");

async function copyCode(code: string, key: string) {
  try {
    await copyToClipboard(code);
    copiedIndex.value = key;
    setTimeout(() => {
      if (copiedIndex.value === key) copiedIndex.value = "";
    }, 2000);
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}

function clearMessages() {
  messages.value = [];
  conversationId.value = "";
  cachedSchemaContext.value = null;
}

async function persistConversation() {
  if (!messages.value.length || !props.connection) return;
  if (!conversationId.value) conversationId.value = uuid();
  const first = messages.value.find((m) => m.role === "user");
  await saveAiConversation({
    id: conversationId.value,
    title: first ? first.content.slice(0, 50) : "Untitled",
    connectionName: props.connection.name,
    database: props.tab?.database || "",
    messages: messages.value.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

async function setConversationListOpen(open: boolean) {
  showConversationList.value = open;
  if (open) conversations.value = await loadAiConversations().catch(() => []);
}

function selectConversation(conv: AiConversation) {
  conversationId.value = conv.id;
  messages.value = conv.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    reasoning: m.reasoning,
  }));
  cachedSchemaContext.value = null;
  showConversationList.value = false;
  scrollToBottom();
}

async function deleteConversation(id: string) {
  await deleteAiConversation(id).catch(() => {});
  conversations.value = conversations.value.filter((c) => c.id !== id);
  if (conversationId.value === id) clearMessages();
}

function startNewChat() {
  clearMessages();
  showConversationList.value = false;
}

onMounted(async () => {
  conversations.value = await loadAiConversations().catch(() => []);
  shikiCodeHighlighter.value = await createAiShikiCodeHighlighter({
    appearance: () => aiCodeAppearance.value,
  }).catch(() => undefined);
});

onUnmounted(() => {
  clearTimeout(mentionTimer);
});

function triggerAction(action: AiAction, instruction?: string) {
  activeAction.value = action;
  if (instruction) prompt.value = instruction;
  send();
}

defineExpose({ triggerAction });

const markedInstance = new Marked({
  breaks: true,
  gfm: true,
  renderer: {
    code({ text }: { text: string }) {
      return `<code class="rounded-[4px] bg-[var(--ds-bg-canvas)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--ds-text-1)]">${text}</code>`;
    },
  },
});

function formatInlineText(text: string): string {
  return markedInstance.parse(text) as string;
}

const messageRenderer = computed(() => {
  const appearance = aiCodeAppearance.value;
  const highlightCode = shikiCodeHighlighter.value;
  return createAiMessageRenderer({
    markdown: formatInlineText,
    highlightCode: highlightCode ? (content, lang) => highlightCode(content, lang, appearance) : undefined,
  });
});

// While a reply streams, re-running markdown + shiki on the whole growing
// message every token is O(n²) and freezes the main thread on long replies
// (measured: multi-second frames in long conversations). The in-flight bubble
// therefore renders WITHOUT shiki and at a throttled ~10fps; once the turn
// finishes it switches back to `messageRenderer` for a one-time, cached,
// fully-highlighted render.
const liveMessageRenderer = createAiMessageRenderer({ markdown: formatInlineText });
const streamingIndex = computed(() => (currentSessionId.value ? messages.value.length - 1 : null));
const liveStreamContent = ref("");
let liveStreamPending = "";
let liveStreamTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLiveStreamUpdate(content: string) {
  liveStreamPending = content;
  if (liveStreamTimer == null) {
    liveStreamTimer = setTimeout(() => {
      liveStreamTimer = null;
      liveStreamContent.value = liveStreamPending;
    }, 90);
  }
}
watch(streamingIndex, () => {
  liveStreamContent.value = "";
  liveStreamPending = "";
  if (liveStreamTimer != null) {
    clearTimeout(liveStreamTimer);
    liveStreamTimer = null;
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="flex items-center gap-1 border-b border-[var(--ds-border)] px-2 shrink-0 h-10">
      <span
        class="flex flex-1 self-stretch items-center truncate px-1 text-xs font-medium text-[var(--ds-text-2)]"
        data-tauri-drag-region
      >
        {{ chatTitle }}
      </span>
      <Button variant="ghost" size="icon-sm" @click="startNewChat" :title="t('ai.newChat')">
        <MessageSquarePlus class="h-3.5 w-3.5" />
      </Button>
      <Popover :open="showConversationList" @update:open="setConversationListOpen">
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :class="{ 'bg-[var(--ds-bg-active)] text-[var(--ds-text-1)]': showConversationList }"
            :title="t('history.title')"
          >
            <History class="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-72 gap-0 p-0" @click.stop>
          <div class="flex items-center border-b border-[var(--ds-border)] px-3 py-2">
            <span class="flex-1 text-xs font-medium text-[var(--ds-text-2)]">{{ t("history.title") }}</span>
            <Button variant="ghost" size="icon-sm" @click="startNewChat">
              <MessageSquarePlus class="h-3.5 w-3.5" />
            </Button>
          </div>
          <div v-if="!conversations.length" class="p-3 text-center text-xs text-[var(--ds-text-3)]">
            {{ t("history.empty") }}
          </div>
          <div v-else class="max-h-64 overflow-auto p-1">
            <div
              v-for="conv in conversations"
              :key="conv.id"
              class="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              :class="{ 'bg-[var(--ds-bg-active)] text-[var(--ds-text-1)]': conv.id === conversationId }"
              @click="selectConversation(conv)"
            >
              <span class="min-w-0 flex-1 truncate">{{ conv.title }}</span>
              <button
                class="shrink-0 rounded p-0.5 text-[var(--ds-text-3)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-red)]"
                @click.stop="deleteConversation(conv.id)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon-sm" @click="clearMessages" :title="t('ai.clear')">
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon-sm" @click="emit('close')">
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <div
      v-if="messages.length === 0"
      class="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center"
    >
      <Bot class="h-9 w-9 text-[var(--ds-text-4)]" />
      <p class="text-[13px] text-[var(--ds-text-2)]">{{ t("ai.welcome") }}</p>
    </div>
    <ScrollArea v-else ref="scrollRef" class="min-h-0 flex-1 overflow-hidden">
      <div class="flex flex-col gap-3 p-3">
        <template v-for="(msg, i) in messages" :key="i">
          <div
            v-if="msg.role === 'user'"
            class="flex w-full justify-end [content-visibility:auto] [contain-intrinsic-size:auto_60px]"
          >
            <div
              class="max-w-[85%] rounded-lg border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] px-3 py-2 text-xs leading-relaxed text-[var(--ds-text-1)]"
            >
              {{ msg.content }}
            </div>
          </div>

          <div
            v-else-if="msg.content || msg.reasoning || msg.isThinking"
            class="flex w-full [content-visibility:auto] [contain-intrinsic-size:auto_200px]"
          >
            <div
              class="max-w-[95%] rounded-lg border border-[var(--ds-border)] bg-[var(--ds-bg-elevated)] px-3 py-2 text-xs leading-relaxed text-[var(--ds-text-1)]"
            >
              <div v-if="msg.reasoning || msg.isThinking" class="mb-2">
                <button
                  class="flex items-center gap-1 text-[11px] text-[var(--ds-text-3)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:text-[var(--ds-text-1)]"
                  @click="toggleReasoning(i)"
                >
                  <ChevronRight
                    class="h-3 w-3 transition-transform duration-200"
                    :class="{ 'rotate-90': expandedReasoning.has(i) || msg.isThinking }"
                  />
                  <Loader2 v-if="msg.isThinking" class="h-3 w-3 animate-spin" />
                  <span>{{ t("ai.reasoningProcess") }}</span>
                </button>
                <div
                  class="overflow-hidden transition-all duration-200 ease-in-out"
                  :style="{
                    maxHeight: expandedReasoning.has(i) || msg.isThinking ? '20000px' : '0px',
                    opacity: expandedReasoning.has(i) || msg.isThinking ? '1' : '0',
                  }"
                >
                  <div
                    class="mt-1.5 pl-4 border-l-2 border-[var(--ds-border-strong)] text-[11px] text-[var(--ds-text-3)] whitespace-pre-wrap"
                  >
                    {{ msg.reasoning }}
                  </div>
                </div>
              </div>
              <div v-if="msg.toolSteps?.length" class="mb-2 flex flex-col gap-1.5">
                <div v-for="step in msg.toolSteps" :key="step.id" class="flex flex-col gap-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span
                      class="inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium"
                      :class="agentStepClass(toolStepTone(step))"
                      :title="(step.args?.sql as string) || step.name"
                    >
                      <component
                        :is="agentStepIcon(toolStepTone(step))"
                        class="h-3 w-3 shrink-0"
                        :class="{ 'animate-spin': step.status === 'running' }"
                      />
                      <span class="truncate font-mono">{{ step.name }}</span>
                    </span>
                    <Button
                      v-if="step.name === 'explain_query' && step.args?.sql"
                      size="sm"
                      variant="outline"
                      class="h-5 gap-1 px-1.5 text-[10px]"
                      :title="t('ai.executeSql')"
                      @click="executeSql(step.args.sql as string)"
                    >
                      <Play class="h-3 w-3" />
                      {{ t("ai.executeSql") }}
                    </Button>
                  </div>
                  <ExplainPlanViewer
                    v-if="step.explainData && connection?.db_type"
                    :plan="parseExplainFromData(step.explainData, connection.db_type)"
                    class="max-h-64"
                  />
                  <div
                    v-else-if="step.resultText && step.status === 'error'"
                    class="rounded bg-[var(--ds-bg-canvas)] px-2 py-1 text-[10px] text-[var(--ds-red)] whitespace-pre-wrap"
                  >
                    {{ step.resultText }}
                  </div>
                </div>
              </div>
              <div
                v-if="msg.pendingConfirm"
                class="mb-2 rounded-md border border-[color-mix(in_srgb,var(--ds-amber)_35%,transparent)] bg-[color-mix(in_srgb,var(--ds-amber)_10%,transparent)] p-2"
              >
                <div class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--ds-amber)]">
                  <AlertTriangle class="h-3.5 w-3.5 shrink-0" />
                  <span>{{ t("ai.toolConfirm.title") }}</span>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-1">
                  <span
                    class="inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium"
                    :class="riskBadgeClass(confirmCategoryTone(msg.pendingConfirm.decision.category))"
                  >
                    {{ confirmCategoryLabel(msg.pendingConfirm.decision.category) }}
                  </span>
                  <span
                    v-if="msg.pendingConfirm.decision.environment === 'production'"
                    class="inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium"
                    :class="riskBadgeClass('danger')"
                  >
                    {{ t("ai.toolConfirm.production") }}
                  </span>
                  <span
                    v-for="reason in msg.pendingConfirm.decision.reasons"
                    :key="reason"
                    class="inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium"
                    :class="riskBadgeClass('neutral')"
                  >
                    {{ confirmReasonLabel(reason) }}
                  </span>
                </div>
                <pre
                  class="mt-1.5 max-h-32 overflow-auto rounded bg-[var(--ds-bg-canvas)] px-2 py-1 font-mono text-[10px] text-[var(--ds-text-1)] whitespace-pre-wrap"
                  >{{ msg.pendingConfirm.sql }}</pre
                >
                <div class="mt-2 flex items-center gap-1.5">
                  <Button size="sm" class="h-6 gap-1 text-[10px]" @click="confirmTool(i, true)">
                    <Play class="h-3 w-3" />
                    {{ t("ai.toolConfirm.run") }}
                  </Button>
                  <Button size="sm" variant="outline" class="h-6 gap-1 text-[10px]" @click="confirmTool(i, false)">
                    <X class="h-3 w-3" />
                    {{ t("ai.toolConfirm.reject") }}
                  </Button>
                </div>
              </div>
              <template
                v-for="(seg, j) in i === streamingIndex
                  ? liveMessageRenderer.render(liveStreamContent)
                  : messageRenderer.render(msg.content)"
                :key="j"
              >
                <div v-if="seg.type === 'text'" class="ai-markdown whitespace-normal">
                  <div v-html="seg.html" />
                </div>
                <div
                  v-else
                  class="my-2 overflow-hidden rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-canvas)]"
                >
                  <div
                    class="flex items-center border-b border-[var(--ds-border)] px-3 py-1.5 text-[10px] font-medium text-[var(--ds-text-3)]"
                  >
                    <component :is="seg.isSql ? Database : Terminal" class="h-3 w-3 mr-1.5" />
                    <span class="font-mono uppercase tracking-wide">{{ seg.lang }}</span>
                    <span class="flex-1" />
                    <div class="flex items-center gap-1.5">
                      <button
                        v-if="seg.isSql"
                        class="rounded p-0.5 text-[var(--ds-text-3)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)]"
                        :title="t('ai.executeSql')"
                        @click="executeSql(seg.content)"
                      >
                        <Play class="h-3.5 w-3.5" />
                      </button>
                      <button
                        v-if="seg.isSql"
                        class="rounded p-0.5 text-[var(--ds-text-3)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)]"
                        :title="t('ai.apply')"
                        @click="applySql(seg.content)"
                      >
                        <Replace class="h-3.5 w-3.5" />
                      </button>
                      <button
                        class="rounded p-0.5 text-[var(--ds-text-3)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)]"
                        :title="
                          copiedIndex === `${i}-${j}` ? t('ai.copied') : t(seg.isSql ? 'ai.copySql' : 'ai.copyCode')
                        "
                        @click="copyCode(seg.content, `${i}-${j}`)"
                      >
                        <Check v-if="copiedIndex === `${i}-${j}`" class="h-3.5 w-3.5 text-[var(--ds-green)]" />
                        <Copy v-else class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <pre
                    class="ai-code-block whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-[var(--ds-text-1)]"
                  ><code v-html="seg.html"></code></pre>
                </div>
              </template>
            </div>
          </div>
        </template>

        <div v-if="isWaitingForFirstDelta" class="flex items-center gap-2 text-xs text-[var(--ds-text-3)]">
          <Loader2 class="h-3.5 w-3.5 animate-spin" />
          <span>{{ t("ai.thinking") }}</span>
        </div>
      </div>
    </ScrollArea>

    <div class="p-2">
      <div
        class="relative rounded-lg border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-2 pb-2 pt-1 transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] focus-within:border-[var(--ds-accent-line)]"
      >
        <div
          v-if="connectionStore.connections.length"
          class="flex items-center gap-1 mb-1 text-xs text-[var(--ds-text-3)]"
        >
          <DatabaseIcon v-if="connection" :db-type="connectionIconType(connection)" class="h-3 w-3 shrink-0" />
          <Server v-else class="h-3 w-3 shrink-0" />
          <Select :model-value="connection?.id || ''" @update:model-value="(v: any) => changeConnection(v)">
            <SelectTrigger
              class="h-5 w-auto border-0 rounded-md bg-transparent dark:bg-transparent p-0 px-1 text-xs text-[var(--ds-text-3)] shadow-none focus:ring-0 focus-visible:ring-0 [&_svg]:size-3"
            >
              <SelectValue :placeholder="t('editor.selectConnection')">{{
                connection?.name || t("editor.selectConnection")
              }}</SelectValue>
            </SelectTrigger>
            <SelectContent class="min-w-48">
              <SelectItem v-for="conn in connectionStore.connections" :key="conn.id" :value="conn.id">
                <div class="flex min-w-0 items-center gap-2">
                  <DatabaseIcon :db-type="connectionIconType(conn)" class="h-3.5 w-3.5 shrink-0" />
                  <span class="truncate">{{ conn.name }}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <template v-if="connection">
            <Database class="h-3 w-3 shrink-0 text-[var(--ds-text-4)]" />
            <Select
              :model-value="selectedDatabaseSelectValue"
              @update:model-value="(v: any) => changeDatabase(v)"
              @update:open="
                (open: boolean) => {
                  if (open) loadDatabases();
                }
              "
            >
              <SelectTrigger
                class="h-5 w-auto border-0 rounded-md bg-transparent dark:bg-transparent p-0 px-1 text-xs text-[var(--ds-text-3)] shadow-none focus:ring-0 focus-visible:ring-0 [&_svg]:size-3"
              >
                <SelectValue :placeholder="t('editor.selectDatabase')">{{ selectedDatabaseLabel }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in dbSelectOptions" :key="option.value" :value="option.value">{{
                  option.label
                }}</SelectItem>
                <SelectItem v-if="!dbSelectOptions.length && connection && tab" :value="selectedDatabaseSelectValue">{{
                  selectedDatabaseLabel
                }}</SelectItem>
              </SelectContent>
            </Select>
          </template>
        </div>
        <div
          v-if="mentionOpen"
          class="ds-popover absolute bottom-full left-2 right-2 z-20 mb-1.5 overflow-hidden p-1 text-[var(--ds-text-1)]"
        >
          <div class="ds-menu-label flex items-center gap-1.5 px-2 pb-1 pt-1.5">
            <Table2 class="h-3 w-3" />
            <span>{{ t("ai.tableMentionHeader") }}</span>
          </div>
          <div v-if="mentionLoading" class="flex items-center gap-2 px-2 py-2 text-[12px] text-[var(--ds-text-3)]">
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            <span>{{ t("common.loading") }}</span>
          </div>
          <div v-else-if="mentionError" class="px-2 py-2 text-[12px] text-[var(--ds-red)]">
            {{ mentionError }}
          </div>
          <div v-else-if="!mentionCandidates.length" class="px-2 py-2 text-[12px] text-[var(--ds-text-3)]">
            {{ t("ai.tableMentionEmpty") }}
          </div>
          <div v-else class="max-h-56 overflow-auto">
            <button
              v-for="(candidate, index) in mentionCandidates"
              :key="`${candidate.schema || ''}.${candidate.name}`"
              type="button"
              class="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] leading-4 text-[var(--ds-text-2)] outline-hidden transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-accent-soft)] hover:text-[var(--ds-text-1)]"
              :class="{ 'bg-[var(--ds-accent-soft)] text-[var(--ds-text-1)]': index === mentionSelectedIndex }"
              @mousedown.prevent="insertMention(candidate)"
              @mouseenter="mentionSelectedIndex = index"
            >
              <Table2 class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-3)]" />
              <span class="min-w-0 flex-1 truncate">
                <span v-if="candidate.schema" class="text-[var(--ds-text-3)]">{{ candidate.schema }}.</span
                >{{ candidate.name }}
              </span>
              <span class="shrink-0 text-[10px] uppercase tracking-wide text-[var(--ds-text-4)]">{{
                formatMentionTableType(candidate.tableType)
              }}</span>
            </button>
          </div>
        </div>
        <div v-if="promptMentionChips.length" class="mb-1.5 flex flex-wrap gap-1">
          <button
            v-for="mention in promptMentionChips"
            :key="mention.raw"
            type="button"
            class="group inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--ds-border)] bg-[var(--ds-bg-hover)] px-2 py-0.5 text-[11px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)]"
            :title="mentionDisplayName(mention)"
            @click="removeMentionChip(mention)"
          >
            <Table2 class="h-3 w-3 shrink-0 text-[var(--ds-accent)]" />
            <span class="truncate">{{ mentionDisplayName(mention) }}</span>
            <X class="h-3 w-3 shrink-0 text-[var(--ds-text-3)] group-hover:text-[var(--ds-text-1)]" />
          </button>
        </div>
        <textarea
          ref="promptTextareaRef"
          v-model="prompt"
          rows="3"
          class="w-full resize-none bg-transparent text-xs text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)] mb-1"
          :placeholder="activePlaceholder"
          :disabled="isGenerating"
          @input="refreshMentionState"
          @click="refreshMentionState"
          @keyup="refreshMentionState"
          @compositionstart="promptCompositionActive = true"
          @compositionend="promptCompositionActive = false"
          @keydown="onPromptKeydown"
        />
        <div class="flex items-center gap-1.5">
          <LightDropdown
            v-model="assistantMode"
            :items="assistantModeItems"
            :aria-label="activeModeHint"
            item-class="text-xs px-2"
          />
          <LightDropdown
            :model-value="activeAction"
            :items="actionMenuItems"
            content-class="w-max min-w-0"
            item-class="text-xs px-2"
            @update:model-value="(value) => selectAction(value as AiAction)"
          />
          <span class="flex-1" />
          <button
            v-if="isGenerating"
            class="h-7 w-7 shrink-0 rounded-full border border-[color-mix(in_srgb,var(--ds-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--ds-red)_16%,transparent)] text-[var(--ds-red)] flex items-center justify-center transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[color-mix(in_srgb,var(--ds-red)_24%,transparent)]"
            :title="t('ai.stopGenerating')"
            @click="cancelStream"
          >
            <Square class="h-3.5 w-3.5" />
          </button>
          <button
            v-else
            class="h-7 w-7 shrink-0 rounded-full bg-[var(--ds-accent)] text-white flex items-center justify-center transition-[filter,opacity] duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:brightness-110 disabled:opacity-30 disabled:hover:brightness-100"
            :disabled="!prompt.trim() || !props.tab?.database"
            @click="send"
          >
            <ArrowUp class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-markdown :deep(h1) {
  font-size: 1em;
  font-weight: 700;
  margin: 0.5em 0 0.25em;
}
.ai-markdown :deep(h2) {
  font-size: 0.95em;
  font-weight: 600;
  margin: 0.5em 0 0.25em;
}
.ai-markdown :deep(h3) {
  font-size: 0.9em;
  font-weight: 600;
  margin: 0.4em 0 0.2em;
}
.ai-markdown :deep(p) {
  margin: 0.3em 0;
}
.ai-markdown :deep(ul),
.ai-markdown :deep(ol) {
  padding-left: 1.4em;
  margin: 0.3em 0;
}
.ai-markdown :deep(ul) {
  list-style-type: disc;
}
.ai-markdown :deep(ol) {
  list-style-type: decimal;
}
.ai-markdown :deep(li) {
  margin: 0.15em 0;
}
.ai-markdown :deep(strong) {
  font-weight: 600;
}
.ai-markdown :deep(a) {
  color: var(--ds-accent);
  text-decoration: underline;
}
.ai-markdown :deep(blockquote) {
  border-left: 2px solid var(--ds-border-strong);
  padding-left: 0.75em;
  margin: 0.3em 0;
  color: var(--ds-text-3);
}
.ai-markdown :deep(code) {
  border-radius: 0.25rem;
  background: var(--ds-bg-canvas);
  color: var(--ds-text-1);
  padding: 0.125rem 0.375rem;
  font-size: 11px;
  font-family: var(--ds-mono);
}
.ai-markdown :deep(pre) {
  background: var(--ds-bg-canvas);
  border: 1px solid var(--ds-border);
  border-radius: 0.375rem;
  padding: 0.5em 0.75em;
  margin: 0.3em 0;
  overflow-x: auto;
}
.ai-markdown :deep(pre code) {
  background: none;
  padding: 0;
}
.ai-markdown :deep(table) {
  border-collapse: collapse;
  margin: 0.3em 0;
  width: 100%;
}
.ai-markdown :deep(th),
.ai-markdown :deep(td) {
  border: 1px solid var(--ds-border);
  padding: 0.25em 0.5em;
  text-align: left;
}
.ai-markdown :deep(th) {
  font-weight: 600;
  background: var(--ds-bg-canvas);
}
.ai-code-block :deep(.line) {
  min-height: 1lh;
}
</style>
