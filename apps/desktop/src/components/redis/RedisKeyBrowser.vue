<script setup lang="ts">
import { computed, nextTick, ref, onMounted, onUnmounted, onActivated, onDeactivated, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  FolderClosed,
  FolderOpen,
  Trash2,
  Plus,
  KeyRound,
  TerminalSquare,
  Asterisk,
  Database,
  X,
} from "@lucide/vue";
import { RecycleScroller } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DsDialog } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import DangerConfirmDialog from "@/components/editor/DangerConfirmDialog.vue";
import RedisValueViewer from "./RedisValueViewer.vue";
import * as api from "@/lib/api";
import type { RedisKeyInfo, RedisScanResult } from "@/lib/api";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  buildRedisKeyTree,
  collectExpandedGroupIds,
  collectRedisGroupKeyRaws,
  flattenVisibleRedisKeyTree,
  mergeKeysIntoRedisKeyTree,
  redisKeyToFlatTreeRow,
  type RedisKeyTreeNode,
} from "@/lib/redisKeyTree";
import { classifyRedisCommandSafety } from "@/lib/redisCommandSafety";
import { isRedisClearScreenCommand, nextRedisCommandDb, redisKeyTextToRaw } from "@/lib/redisCommandSession";
import { formatRedisCommandResult, formatRedisStringValue, redisTypeColor } from "@/lib/redisValuePresentation";
import { isCancelSearchShortcut } from "@/lib/keyboardShortcuts";
import { useEditorFontFamilyStyle } from "@/composables/useEditorFontFamilyStyle";
import { useToast } from "@/composables/useToast";
import { redisKeySearchPattern } from "@/lib/redisKeyPattern";
import {
  applyRedisCompletion,
  buildRedisCompletionItems,
  measureInputCaretLeft,
  type RedisCompletionItem,
} from "@/lib/redisCommandCompletion";

const { t } = useI18n();
const { toast } = useToast();
const connectionStore = useConnectionStore();
const settingsStore = useSettingsStore();
const editorFontFamilyStyle = useEditorFontFamilyStyle();

type RedisSearchMode = "key" | "value";
type RedisCreateKeyType = "string" | "hash" | "list" | "set" | "zset";
type RedisSidePanel = "detail" | "command";
type RedisCommandHistoryEntry = {
  id: number;
  prompt: string;
  command: string;
  output: string;
  error: boolean;
};

const props = defineProps<{
  connectionId: string;
  db: number;
}>();

const flatKeys = ref<RedisKeyInfo[]>([]);
const treeKeys = ref<RedisKeyTreeNode[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const isFetchingAll = ref(false);
const rootRef = ref<HTMLElement>();
const commandTerminalRef = ref<HTMLElement>();
const searchPattern = ref("");
const searchMode = ref<RedisSearchMode>("key");
const fuzzyKeySearch = ref(false);
const selectedKeyRaw = ref<string | null>(null);
const hasMore = ref(false);
const scanCursor = ref(0);
const expandedGroupIds = ref<Set<string>>(new Set());
const checkedKeys = ref<Set<string>>(new Set());
const pendingDanger = ref<
  { kind: "delete-keys"; title: string; keyRaws: string[] } | { kind: "command"; command: string } | null
>(null);
const showDangerConfirm = ref(false);
const commandText = ref("");
const commandRunning = ref(false);
const commandDb = ref(props.db);
const commandHistory = ref<RedisCommandHistoryEntry[]>([]);
const completionItems = ref<RedisCompletionItem[]>([]);
const completionVisible = ref(false);
const completionIndex = ref(0);
const completionLeft = ref(0);
// Sampled key names per db (db number -> key_display[]), used for argument completion.
const completionKeyCache = new Map<number, string[]>();
const COMPLETION_KEY_SAMPLE = 500;
const activeSidePanel = ref<RedisSidePanel>("detail");
const showCreateKeyDialog = ref(false);
const creatingKey = ref(false);
const createKeyName = ref("");
const createKeyType = ref<RedisCreateKeyType>("string");
const createKeyValue = ref("");
const createKeyField = ref("");
const createKeyScore = ref("0");
const createKeyError = ref("");
let searchRequestId = 0;
let redisBrowserIsActive = true;
let redisDbFlushedListenerRegistered = false;

const valueQuery = computed(() => searchPattern.value.trim());
const effectivePattern = computed(() =>
  searchMode.value === "key" ? redisKeySearchPattern(searchPattern.value, fuzzyKeySearch.value) : "*",
);
const isSearchMode = computed(() =>
  searchMode.value === "key" ? effectivePattern.value !== "*" : valueQuery.value !== "",
);
// During a key-pattern search we render hits as a flat list rather than rebuilding the
// namespace tree, and we skip per-key TYPE lookups on the backend. Type is omitted from
// search rows (still shown in the detail panel and in normal browse).
const useFlatKeySearchRows = computed(() => searchMode.value === "key" && isSearchMode.value);
const searchPlaceholder = computed(() =>
  searchMode.value === "key"
    ? fuzzyKeySearch.value
      ? t("redis.fuzzyPattern")
      : t("redis.pattern")
    : t("redis.valueSearchPlaceholder"),
);
const loadingEmptyText = computed(() =>
  searchMode.value === "value" && valueQuery.value ? t("redis.searchingValues") : t("redis.loadingKeys"),
);
const lastTotalKeys = ref(0);
const fetchAllProgressText = computed(() => {
  if (!isFetchingAll.value) return "";
  if (lastTotalKeys.value > 0) {
    return t("redis.fetchAllProgress", { loaded: flatKeys.value.length, total: lastTotalKeys.value });
  }
  return t("redis.fetchAllProgressUnknown", { loaded: flatKeys.value.length });
});
const selectedKey = computed(() => flatKeys.value.find((key) => key.key_raw === selectedKeyRaw.value) ?? null);
const dangerDetails = computed(() => {
  if (!pendingDanger.value) return "";
  if (pendingDanger.value.kind === "delete-keys") {
    return t("redis.deleteGroupDetails", {
      target: pendingDanger.value.title,
      count: pendingDanger.value.keyRaws.length,
    });
  }
  return pendingDanger.value.command;
});
const dangerConfirmLabel = computed(() => {
  if (pendingDanger.value?.kind === "command") return t("dangerDialog.confirm");
  return t("dangerDialog.deleteConfirm");
});
const commandPrompt = computed(() => `db${commandDb.value}>`);
const createKeyTypeOptions = computed<{ value: RedisCreateKeyType; label: string }[]>(() => [
  { value: "string", label: "String" },
  { value: "hash", label: "Hash" },
  { value: "list", label: "List" },
  { value: "set", label: "Set" },
  { value: "zset", label: "Sorted Set" },
]);
const visibleRows = computed(() => {
  const rows = useFlatKeySearchRows.value
    ? flatKeys.value.map((key) => redisKeyToFlatTreeRow(key, props.db))
    : flattenVisibleRedisKeyTree(treeKeys.value, expandedGroupIds.value);
  return rows.map((row) => ({
    ...row,
    id: row.node.id,
  }));
});
let commandHistoryId = 0;

function countLeaves(node: RedisKeyTreeNode): number {
  if (node.kind === "leaf") return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

function rebuildTree(expandAll = false) {
  const nextTree = buildRedisKeyTree(flatKeys.value, props.db);
  treeKeys.value = nextTree;

  const nextExpanded = new Set<string>();
  const availableExpanded = collectExpandedGroupIds(nextTree);
  if (expandAll) {
    for (const id of availableExpanded) nextExpanded.add(id);
  } else {
    for (const id of expandedGroupIds.value) {
      if (availableExpanded.has(id)) nextExpanded.add(id);
    }
  }
  expandedGroupIds.value = nextExpanded;

  if (selectedKeyRaw.value && !flatKeys.value.some((key) => key.key_raw === selectedKeyRaw.value)) {
    selectedKeyRaw.value = null;
  }
}

function mergeTree(newKeys: RedisKeyInfo[]) {
  if (newKeys.length === 0) return;
  treeKeys.value = mergeKeysIntoRedisKeyTree(treeKeys.value, newKeys, props.db);

  const availableExpanded = collectExpandedGroupIds(treeKeys.value);
  const nextExpanded = new Set<string>();
  for (const id of expandedGroupIds.value) {
    if (availableExpanded.has(id)) nextExpanded.add(id);
  }
  expandedGroupIds.value = nextExpanded;

  if (selectedKeyRaw.value && !flatKeys.value.some((key) => key.key_raw === selectedKeyRaw.value)) {
    selectedKeyRaw.value = null;
  }
}

async function fetchScanPage(): Promise<RedisScanResult> {
  const pageSize = settingsStore.editorSettings.redisScanPageSize;
  return searchMode.value === "value"
    ? await api.redisScanValues(props.connectionId, props.db, scanCursor.value, "*", valueQuery.value, pageSize)
    : await api.redisScanKeys(
        props.connectionId,
        props.db,
        scanCursor.value,
        effectivePattern.value,
        pageSize,
        !useFlatKeySearchRows.value,
      );
}

function appendScanResult(result: RedisScanResult) {
  const existingKeys = new Set(flatKeys.value.map((key) => key.key_raw));
  const newKeys = result.keys.filter((key) => !existingKeys.has(key.key_raw));
  flatKeys.value = [...flatKeys.value, ...newKeys];
  scanCursor.value = result.cursor;
  hasMore.value = result.cursor !== 0;
  lastTotalKeys.value = result.total_keys;

  if (useFlatKeySearchRows.value) {
    // Flat search rendering reads straight from flatKeys; keep the tree empty.
    treeKeys.value = [];
    expandedGroupIds.value = new Set();
  } else if (treeKeys.value.length === 0) {
    rebuildTree(isSearchMode.value);
  } else {
    mergeTree(newKeys);
  }

  connectionStore.updateRedisDbKeyStats(props.connectionId, props.db, {
    loaded: isSearchMode.value ? undefined : flatKeys.value.length,
    total: result.total_keys,
  });
}

async function scanNextPage(requestId = searchRequestId): Promise<boolean> {
  const result = await fetchScanPage();
  if (requestId !== searchRequestId) return false;
  appendScanResult(result);
  return true;
}

async function streamValueSearch(requestId: number) {
  while (requestId === searchRequestId && searchMode.value === "value" && valueQuery.value && hasMore.value) {
    const applied = await scanNextPage(requestId);
    if (!applied) return;
  }
}

async function fillInitialKeyBatch(requestId: number) {
  const targetCount = Math.max(1, settingsStore.editorSettings.redisScanPageSize);
  let rounds = 0;
  while (
    requestId === searchRequestId &&
    searchMode.value === "key" &&
    hasMore.value &&
    flatKeys.value.length < targetCount
  ) {
    const beforeCount = flatKeys.value.length;
    const applied = await scanNextPage(requestId);
    if (!applied) return;
    rounds += 1;
    if (flatKeys.value.length >= targetCount) return;
    if (rounds >= 12 && flatKeys.value.length === beforeCount) return;
    if (rounds >= 24) return;
  }
}

async function loadKeys() {
  if (!redisBrowserIsActive) return;
  const requestId = ++searchRequestId;
  isFetchingAll.value = false;
  loading.value = true;
  flatKeys.value = [];
  treeKeys.value = [];
  selectedKeyRaw.value = null;
  checkedKeys.value = new Set();
  expandedGroupIds.value = new Set();
  scanCursor.value = 0;
  try {
    if (searchMode.value === "value" && !valueQuery.value) {
      hasMore.value = false;
      return;
    }
    const applied = await scanNextPage(requestId);
    if (applied) {
      if (searchMode.value === "value") {
        await streamValueSearch(requestId);
      } else {
        await fillInitialKeyBatch(requestId);
      }
    }
  } finally {
    if (requestId === searchRequestId) {
      loading.value = false;
    }
  }
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return;
  const requestId = searchRequestId;
  loadingMore.value = true;
  try {
    await scanNextPage(requestId);
  } finally {
    loadingMore.value = false;
  }
}

async function fetchAll() {
  if (!hasMore.value || isFetchingAll.value) return;
  const requestId = searchRequestId;
  isFetchingAll.value = true;
  try {
    while (requestId === searchRequestId && isFetchingAll.value && hasMore.value) {
      const applied = await scanNextPage(requestId);
      if (!applied) break;
    }
  } finally {
    if (requestId === searchRequestId) {
      isFetchingAll.value = false;
    }
  }
}

function stopFetchAll() {
  isFetchingAll.value = false;
}

function toggleGroup(groupId: string) {
  const next = new Set(expandedGroupIds.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  expandedGroupIds.value = next;
}

function onRowClick(node: RedisKeyTreeNode) {
  if (node.kind === "group") {
    toggleGroup(node.id);
    return;
  }

  selectedKeyRaw.value = node.keyRaw;
  activeSidePanel.value = "detail";
}

function onKeyDeleted() {
  if (!selectedKeyRaw.value) return;
  flatKeys.value = flatKeys.value.filter((key) => key.key_raw !== selectedKeyRaw.value);
  selectedKeyRaw.value = null;
  if (!useFlatKeySearchRows.value) rebuildTree(false);
  connectionStore.updateRedisDbKeyStats(props.connectionId, props.db, {
    loaded: isSearchMode.value ? undefined : flatKeys.value.length,
    totalDelta: -1,
  });
}

function toggleCheck(keyRaw: string, event: Event) {
  event.stopPropagation();
  const next = new Set(checkedKeys.value);
  if (next.has(keyRaw)) next.delete(keyRaw);
  else next.add(keyRaw);
  checkedKeys.value = next;
}

function requestBatchDelete() {
  if (checkedKeys.value.size === 0) return;
  pendingDanger.value = { kind: "delete-keys", title: t("redis.selectedKeys"), keyRaws: [...checkedKeys.value] };
  showDangerConfirm.value = true;
}

function requestGroupDelete(node: RedisKeyTreeNode, event: Event) {
  event.stopPropagation();
  if (node.kind !== "group") return;
  const keyRaws = collectRedisGroupKeyRaws(node);
  if (keyRaws.length === 0) return;
  pendingDanger.value = { kind: "delete-keys", title: node.pathSegments.join(":"), keyRaws };
  showDangerConfirm.value = true;
}

function resetLoadedKeys() {
  flatKeys.value = [];
  treeKeys.value = [];
  selectedKeyRaw.value = null;
  checkedKeys.value = new Set();
  expandedGroupIds.value = new Set();
  hasMore.value = false;
}

async function deleteKeyRaws(keys: string[]) {
  const deletedCount = await api.redisDeleteKeys(props.connectionId, props.db, keys);
  const deleted = new Set(keys);
  flatKeys.value = flatKeys.value.filter((k) => !deleted.has(k.key_raw));
  if (selectedKeyRaw.value && deleted.has(selectedKeyRaw.value)) {
    selectedKeyRaw.value = null;
  }
  checkedKeys.value = new Set();
  if (!useFlatKeySearchRows.value) rebuildTree(false);
  connectionStore.updateRedisDbKeyStats(props.connectionId, props.db, {
    loaded: isSearchMode.value ? undefined : flatKeys.value.length,
    totalDelta: -deletedCount,
  });
}

function scrollCommandTerminalToEnd() {
  void nextTick(() => {
    if (!commandTerminalRef.value) return;
    commandTerminalRef.value.scrollTop = commandTerminalRef.value.scrollHeight;
  });
}

function appendCommandHistory(entry: Omit<RedisCommandHistoryEntry, "id">) {
  commandHistory.value = [...commandHistory.value, { id: ++commandHistoryId, ...entry }];
  scrollCommandTerminalToEnd();
}

async function runRedisCommand(command: string) {
  const prompt = commandPrompt.value;
  commandRunning.value = true;
  try {
    const result = await api.redisExecuteCommand(props.connectionId, commandDb.value, command);
    appendCommandHistory({
      prompt,
      command,
      output: formatRedisCommandResult(result.value),
      error: false,
    });
    commandDb.value = nextRedisCommandDb(commandDb.value, command, result.value);
    if (result.safety === "confirm") {
      await refreshAfterWrite(commandDb.value);
    }
  } catch (error) {
    appendCommandHistory({
      prompt,
      command,
      output: error instanceof Error ? error.message : String(error),
      error: true,
    });
  } finally {
    commandRunning.value = false;
    scrollCommandTerminalToEnd();
  }
}

async function openCommandPanel() {
  activeSidePanel.value = "command";
  await nextTick();
  getCommandInput()?.focus();
}

async function ensureCompletionKeys(db: number): Promise<string[]> {
  const cached = completionKeyCache.get(db);
  if (cached) return cached;
  try {
    const scan = await api.redisScanKeys(props.connectionId, db, 0, "*", COMPLETION_KEY_SAMPLE, false);
    const names = scan.keys.map((key) => key.key_display);
    completionKeyCache.set(db, names);
    return names;
  } catch {
    completionKeyCache.set(db, []);
    return [];
  }
}

async function refreshCompletionKeys(db: number): Promise<number | null> {
  try {
    const scan = await api.redisScanKeys(props.connectionId, db, 0, "*", COMPLETION_KEY_SAMPLE, false);
    completionKeyCache.set(
      db,
      scan.keys.map((key) => key.key_display),
    );
    return scan.total_keys;
  } catch {
    return null;
  }
}

async function refreshAfterWrite(db: number) {
  // A write may have created or removed keys: re-sample for completion and pull a fresh
  // DBSIZE so the sidebar `dbN (loaded/total)` label stays accurate.
  const total = await refreshCompletionKeys(db);
  if (total != null) {
    connectionStore.updateRedisDbKeyStats(props.connectionId, db, { total });
  }
  // Keep the visible key list in sync when the command targeted the browsed db.
  if (db === props.db) await loadKeys();
}

function hideCompletion() {
  completionVisible.value = false;
  completionItems.value = [];
  completionIndex.value = 0;
}

function updateCompletion() {
  const input = getCommandInput();
  if (!input) {
    hideCompletion();
    return;
  }
  const text = input.value;
  const caret = input.selectionStart ?? text.length;
  const keys = completionKeyCache.get(commandDb.value) ?? [];
  const items = buildRedisCompletionItems(text, caret, keys);
  completionItems.value = items;
  completionIndex.value = 0;
  completionVisible.value = items.length > 0;
  if (completionVisible.value) {
    completionLeft.value = input.offsetLeft + measureInputCaretLeft(input, caret);
  }
}

function onCommandInput() {
  // Warm the key-name cache lazily for argument completion, then re-render the menu.
  void ensureCompletionKeys(commandDb.value).then(() => {
    if (commandText.value.length > 0) updateCompletion();
  });
  updateCompletion();
}

function acceptCompletion(item: RedisCompletionItem) {
  const input = getCommandInput();
  const caret = input?.selectionStart ?? commandText.value.length;
  const result = applyRedisCompletion(commandText.value, caret, item);
  commandText.value = result.text;
  hideCompletion();
  void nextTick(() => {
    const el = getCommandInput();
    if (!el) return;
    el.focus();
    el.setSelectionRange(result.caret, result.caret);
  });
}

function onCommandKeydown(event: KeyboardEvent) {
  if (completionVisible.value && completionItems.value.length > 0) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      completionIndex.value = (completionIndex.value + 1) % completionItems.value.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      completionIndex.value = (completionIndex.value - 1 + completionItems.value.length) % completionItems.value.length;
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptCompletion(completionItems.value[completionIndex.value]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideCompletion();
      return;
    }
  }
  if (event.key === "Enter") {
    event.preventDefault();
    void executeCommand();
  }
}

function onCommandBlur() {
  // Menu items use @mousedown.prevent so clicking one does not blur the input;
  // any real blur should dismiss the menu.
  hideCompletion();
}

function clearCommandInput() {
  commandText.value = "";
  hideCompletion();
  void nextTick(() => getCommandInput()?.focus());
}

function resetCreateKeyForm() {
  createKeyName.value = "";
  createKeyType.value = "string";
  createKeyValue.value = "";
  createKeyField.value = "";
  createKeyScore.value = "0";
  createKeyError.value = "";
}

function openCreateKeyDialog() {
  resetCreateKeyForm();
  showCreateKeyDialog.value = true;
}

function createdKeyPreview(value: any): string {
  if (typeof value === "string") {
    const text = formatRedisStringValue(value).replace(/\s+/g, " ").trim();
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  if (Array.isArray(value) && value.length > 0) return String(value.length);
  return "";
}

function upsertCreatedKey(value: any) {
  const keyInfo: RedisKeyInfo = {
    key_display: value.key_display,
    key_raw: value.key_raw,
    key_type: value.key_type,
    ttl: value.ttl,
    size: typeof value.value === "string" ? value.value.length : (value.total ?? 0),
    value_preview: createdKeyPreview(value.value),
  };
  const existingIndex = flatKeys.value.findIndex((key) => key.key_raw === keyInfo.key_raw);
  if (existingIndex >= 0) {
    flatKeys.value = flatKeys.value.map((key, index) => (index === existingIndex ? keyInfo : key));
  } else {
    flatKeys.value = [keyInfo, ...flatKeys.value];
  }
  selectedKeyRaw.value = keyInfo.key_raw;
  if (!useFlatKeySearchRows.value) rebuildTree(isSearchMode.value);
  connectionStore.updateRedisDbKeyStats(props.connectionId, props.db, {
    loaded: isSearchMode.value ? undefined : flatKeys.value.length,
    totalDelta: existingIndex >= 0 ? 0 : 1,
  });
}

async function createRedisKey() {
  const keyName = createKeyName.value.trim();
  if (!keyName) {
    createKeyError.value = t("redis.createKeyNameRequired");
    toast(t("redis.createKeyNameRequired"), 3000);
    return;
  }
  if (createKeyType.value === "hash" && !createKeyField.value.trim()) {
    createKeyError.value = t("redis.createFieldRequired");
    toast(t("redis.createFieldRequired"), 3000);
    return;
  }
  const score = Number.parseFloat(createKeyScore.value || "0");
  if (createKeyType.value === "zset" && Number.isNaN(score)) {
    createKeyError.value = t("redis.createScoreInvalid");
    toast(t("redis.createScoreInvalid"), 3000);
    return;
  }

  creatingKey.value = true;
  createKeyError.value = "";
  try {
    const keyRaw = redisKeyTextToRaw(keyName);
    if (createKeyType.value === "string") {
      await api.redisSetString(props.connectionId, props.db, keyRaw, createKeyValue.value);
    } else if (createKeyType.value === "hash") {
      await api.redisHashSet(props.connectionId, props.db, keyRaw, createKeyField.value, createKeyValue.value);
    } else if (createKeyType.value === "list") {
      await api.redisListPush(props.connectionId, props.db, keyRaw, createKeyValue.value);
    } else if (createKeyType.value === "set") {
      await api.redisSetAdd(props.connectionId, props.db, keyRaw, createKeyValue.value);
    } else if (createKeyType.value === "zset") {
      await api.redisZadd(props.connectionId, props.db, keyRaw, createKeyValue.value, score);
    }
    const created = await api.redisGetValue(props.connectionId, props.db, keyRaw);
    upsertCreatedKey(created);
    showCreateKeyDialog.value = false;
  } catch (error) {
    createKeyError.value = error instanceof Error ? error.message : String(error);
  } finally {
    creatingKey.value = false;
  }
}

async function executeCommand() {
  hideCompletion();
  const command = commandText.value.trim();
  if (!command) {
    appendCommandHistory({
      prompt: commandPrompt.value,
      command: "",
      output: t("redis.commandEmpty"),
      error: true,
    });
    return;
  }
  if (isRedisClearScreenCommand(command)) {
    commandHistory.value = [];
    commandText.value = "";
    scrollCommandTerminalToEnd();
    return;
  }

  const safety = classifyRedisCommandSafety(command);
  if (safety === "blocked") {
    appendCommandHistory({
      prompt: commandPrompt.value,
      command,
      output: t("redis.commandBlocked"),
      error: true,
    });
    commandText.value = "";
    return;
  }
  if (safety === "confirm") {
    pendingDanger.value = { kind: "command", command };
    showDangerConfirm.value = true;
    commandText.value = "";
    return;
  }
  commandText.value = "";
  await runRedisCommand(command);
}

async function applyDangerAction() {
  const pending = pendingDanger.value;
  pendingDanger.value = null;
  showDangerConfirm.value = false;
  if (!pending) return;

  if (pending.kind === "delete-keys") {
    await deleteKeyRaws(pending.keyRaws);
  } else {
    await runRedisCommand(pending.command);
  }
}

// Design-system class recipes (kept here so the template stays declarative).
const dsSegmentTrack =
  "flex shrink-0 items-center gap-0.5 rounded-[var(--ds-radius-sm)] bg-[var(--ds-bg-elevated)] p-0.5";
const dsSegmentBtnBase =
  "h-6 rounded-[5px] px-2 text-[11.5px] font-medium transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]";
const dsSegmentBtnActive = "bg-[var(--ds-bg-panel)] text-[var(--ds-text-1)] shadow-[var(--ds-shadow-card)]";
const dsSegmentBtnIdle = "text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]";

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(loadKeys, 400);
}

function setSearchMode(mode: RedisSearchMode) {
  if (searchMode.value === mode) return;
  searchMode.value = mode;
  void loadKeys();
}

function toggleFuzzyKeySearch() {
  fuzzyKeySearch.value = !fuzzyKeySearch.value;
  if (searchMode.value === "key") void loadKeys();
}

function getSearchInput(): HTMLInputElement | null {
  return rootRef.value?.querySelector<HTMLInputElement>("[data-redis-search-input]") ?? null;
}

function getCommandInput(): HTMLInputElement | null {
  return rootRef.value?.querySelector<HTMLInputElement>("[data-redis-command-input]") ?? null;
}

function focusSearch(): boolean {
  const input = getSearchInput();
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    void loadKeys();
    return;
  }
  if (!isCancelSearchShortcut(event)) return;
  event.preventDefault();
  searchPattern.value = "";
  void loadKeys();
}

function onRedisDbFlushed(event: Event) {
  const detail = (event as CustomEvent<{ connectionId: string; db: number }>).detail;
  if (!detail || detail.connectionId !== props.connectionId || detail.db !== props.db) return;
  resetLoadedKeys();
}

function registerRedisDbFlushedListener() {
  if (redisDbFlushedListenerRegistered) return;
  window.addEventListener("dbx-redis-db-flushed", onRedisDbFlushed);
  redisDbFlushedListenerRegistered = true;
}

function unregisterRedisDbFlushedListener() {
  if (!redisDbFlushedListenerRegistered) return;
  window.removeEventListener("dbx-redis-db-flushed", onRedisDbFlushed);
  redisDbFlushedListenerRegistered = false;
}

function pauseRedisBrowserBackgroundWork() {
  redisBrowserIsActive = false;
  searchRequestId++;
  isFetchingAll.value = false;
  loading.value = false;
  loadingMore.value = false;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = null;
  unregisterRedisDbFlushedListener();
}

function resumeRedisBrowserBackgroundWork() {
  redisBrowserIsActive = true;
  registerRedisDbFlushedListener();
}

onMounted(() => {
  resumeRedisBrowserBackgroundWork();
  void loadKeys();
});

onActivated(resumeRedisBrowserBackgroundWork);

onDeactivated(pauseRedisBrowserBackgroundWork);

onUnmounted(pauseRedisBrowserBackgroundWork);

watch(
  () => props.db,
  (db) => {
    commandDb.value = db;
  },
);

defineExpose({ focusSearch });
</script>

<template>
  <div ref="rootRef" class="h-full" :style="editorFontFamilyStyle">
    <Splitpanes class="redis-workspace-splitpanes h-full">
      <!-- Key tree (left) -->
      <Pane :size="36" :min-size="24">
        <div class="relative h-full flex flex-col overflow-hidden bg-[var(--ds-bg-panel)]">
          <!-- Panel header: identity + count + global actions -->
          <div class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] px-3">
            <div
              class="flex size-6 shrink-0 items-center justify-center rounded-[var(--ds-radius-sm)] bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
            >
              <Database class="size-3.5" />
            </div>
            <span class="text-[13px] font-semibold tracking-[-0.01em] text-[var(--ds-text-1)]">
              {{ t("redis.keys", { count: flatKeys.length }) }}
            </span>
            <div class="ml-auto flex shrink-0 items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" :title="t('redis.createKey')" @click="openCreateKeyDialog">
                <Plus class="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" @click="loadKeys">
                <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" />
                <RefreshCw v-else class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <!-- Toolbar: search scope + query -->
          <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--ds-border)] px-3">
            <div :class="dsSegmentTrack" role="group">
              <button
                type="button"
                :class="[dsSegmentBtnBase, searchMode === 'key' ? dsSegmentBtnActive : dsSegmentBtnIdle]"
                @click="setSearchMode('key')"
              >
                {{ t("redis.searchByKey") }}
              </button>
              <button
                type="button"
                :class="[dsSegmentBtnBase, searchMode === 'value' ? dsSegmentBtnActive : dsSegmentBtnIdle]"
                @click="setSearchMode('value')"
              >
                {{ t("redis.searchByValue") }}
              </button>
            </div>
            <div
              class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-2 transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] focus-within:border-[var(--ds-accent-line)]"
            >
              <Search class="size-3.5 shrink-0 text-[var(--ds-text-3)]" />
              <input
                v-model="searchPattern"
                data-redis-search-input
                class="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)]"
                :placeholder="searchPlaceholder"
                @input="onSearchInput"
                @keydown="onSearchKeydown"
              />
              <button
                v-if="searchMode === 'key'"
                type="button"
                class="flex size-5 shrink-0 items-center justify-center rounded-[5px] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
                :class="
                  fuzzyKeySearch
                    ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]'
                    : 'text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]'
                "
                :title="t('redis.fuzzyMatchTitle')"
                :aria-pressed="fuzzyKeySearch"
                @click="toggleFuzzyKeySearch"
              >
                <Asterisk class="size-3.5" />
              </button>
            </div>
          </div>

          <!-- Contextual selection bar -->
          <div
            v-if="checkedKeys.size > 0"
            class="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-bg-canvas)] px-3"
          >
            <span class="text-[11.5px] font-medium text-[var(--ds-text-2)]">
              {{ t("redis.keys", { count: checkedKeys.size }) }}
            </span>
            <Button variant="destructive" size="xs" class="ml-auto" @click="requestBatchDelete">
              <Trash2 class="h-3 w-3" />
              {{ checkedKeys.size }}
            </Button>
          </div>

          <div
            v-if="flatKeys.length === 0 && !loading"
            class="flex-1 flex flex-col items-center justify-center gap-2.5 px-4 text-center"
          >
            <div
              class="flex size-9 items-center justify-center rounded-[var(--ds-radius)] bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
            >
              <KeyRound class="size-4.5" />
            </div>
            <span class="text-[12px] text-[var(--ds-text-3)]">{{ t("redis.noKeys") }}</span>
          </div>
          <div
            v-else-if="loading && flatKeys.length === 0"
            class="flex-1 flex items-center justify-center gap-2 text-[12px] text-[var(--ds-text-3)]"
          >
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            <span>{{ loadingEmptyText }}</span>
          </div>
          <RecycleScroller
            v-else
            class="redis-key-scroller flex-1"
            :items="visibleRows"
            :item-size="30"
            :buffer="600"
            :skip-hover="true"
            key-field="id"
          >
            <template #default="{ item: row }">
              <div
                class="group flex items-center gap-2 border-b border-[var(--ds-border-soft)] px-3 text-[13px] cursor-pointer transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
                :class="
                  row.node.kind === 'leaf' && selectedKeyRaw === row.node.keyRaw
                    ? 'bg-[var(--ds-accent-soft)]'
                    : 'hover:bg-[var(--ds-bg-hover)]'
                "
                :style="{ height: '30px' }"
                @click="onRowClick(row.node)"
              >
                <div
                  class="min-w-0 flex flex-1 items-center gap-1.5 overflow-hidden"
                  :style="{ paddingLeft: `${12 + row.depth * 16}px` }"
                >
                  <template v-if="row.node.kind === 'group'">
                    <component
                      :is="expandedGroupIds.has(row.node.id) ? ChevronDown : ChevronRight"
                      class="w-3 h-3 shrink-0 text-[var(--ds-text-3)]"
                    />
                    <component
                      :is="expandedGroupIds.has(row.node.id) ? FolderOpen : FolderClosed"
                      class="w-3.5 h-3.5 shrink-0 text-[var(--ds-amber)]"
                    />
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span class="dbx-editor-font-family truncate text-[var(--ds-text-2)]">{{
                          row.node.label
                        }}</span>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[480px] break-all">{{
                        row.node.pathSegments.join(":")
                      }}</TooltipContent>
                    </Tooltip>
                    <span class="ml-1 text-[var(--ds-text-4)]">({{ countLeaves(row.node) }})</span>
                  </template>
                  <template v-else>
                    <span class="relative flex h-4 w-4 shrink-0 items-center justify-center">
                      <KeyRound
                        class="h-3.5 w-3.5 text-[var(--ds-text-4)] transition-opacity group-hover:opacity-0"
                        :class="{ 'opacity-0': checkedKeys.has(row.node.keyRaw) }"
                      />
                      <input
                        type="checkbox"
                        class="absolute h-3.5 w-3.5 accent-[var(--ds-accent)] cursor-pointer opacity-0 group-hover:opacity-100"
                        :class="{ 'opacity-100': checkedKeys.has(row.node.keyRaw) }"
                        :checked="checkedKeys.has(row.node.keyRaw)"
                        @click="toggleCheck(row.node.keyRaw, $event)"
                      />
                    </span>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span class="dbx-editor-font-family truncate text-[var(--ds-text-1)]">{{
                          row.node.label
                        }}</span>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[480px] break-all">{{ row.node.fullKeyDisplay }}</TooltipContent>
                    </Tooltip>
                  </template>
                </div>

                <div class="flex shrink-0 items-center justify-end gap-1.5 pr-1">
                  <span v-if="row.node.kind === 'leaf' && row.node.keyType" class="inline-flex items-center gap-1.5">
                    <span
                      class="size-1.5 rounded-full"
                      :style="{ backgroundColor: redisTypeColor(row.node.keyType) }"
                    />
                    <span class="text-[10.5px] uppercase tracking-wide text-[var(--ds-text-3)]">{{
                      row.node.keyType
                    }}</span>
                  </span>
                  <Button
                    v-if="row.node.kind === 'group'"
                    variant="ghost"
                    size="icon-xs"
                    class="shrink-0 text-[var(--ds-red)] opacity-0 group-hover:opacity-100"
                    :title="t('redis.deleteGroup')"
                    @click="requestGroupDelete(row.node, $event)"
                  >
                    <Trash2 class="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </template>
          </RecycleScroller>
          <div
            v-if="hasMore && !isFetchingAll"
            class="shrink-0 border-t border-[var(--ds-border)] px-2 py-1.5 flex items-center gap-1.5"
          >
            <Button variant="outline" size="sm" class="flex-1" :disabled="loadingMore || loading" @click="loadMore">
              <Loader2 v-if="loadingMore" class="w-3 h-3 animate-spin" />
              {{ t("redis.loadMoreKeys") }}
            </Button>
            <Button variant="outline" size="sm" class="flex-1" :disabled="loading || !hasMore" @click="fetchAll">
              {{ t("redis.fetchAllKeys") }}
            </Button>
          </div>
          <div v-if="isFetchingAll" class="shrink-0 border-t border-[var(--ds-border)] px-2 py-1.5 space-y-1">
            <div class="text-[11.5px] text-[var(--ds-text-3)] text-center">
              {{ fetchAllProgressText }}
            </div>
            <Button variant="destructive" size="sm" class="h-7 text-xs w-full" @click="stopFetchAll">
              {{ t("redis.stopFetchAll") }}
            </Button>
          </div>
        </div>
      </Pane>

      <!-- Workspace (right) -->
      <Pane :size="64" :min-size="36">
        <div class="h-full min-w-0 bg-[var(--ds-bg-panel)] flex flex-col overflow-hidden">
          <Tabs v-model="activeSidePanel" :unmount-on-hide="false" class="h-full min-h-0 gap-0">
            <div
              class="h-10 shrink-0 border-b border-[var(--ds-border)] bg-[var(--ds-bg-panel)] px-3 flex items-center"
            >
              <div :class="dsSegmentTrack" role="tablist">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="activeSidePanel === 'detail'"
                  :class="[
                    dsSegmentBtnBase,
                    'inline-flex items-center gap-1.5',
                    activeSidePanel === 'detail' ? dsSegmentBtnActive : dsSegmentBtnIdle,
                  ]"
                  @click="activeSidePanel = 'detail'"
                >
                  <KeyRound class="size-3.5" />
                  {{ t("redis.keyDetail") }}
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="activeSidePanel === 'command'"
                  :class="[
                    dsSegmentBtnBase,
                    'inline-flex items-center gap-1.5',
                    activeSidePanel === 'command' ? dsSegmentBtnActive : dsSegmentBtnIdle,
                  ]"
                  @click="openCommandPanel"
                >
                  <TerminalSquare class="size-3.5" />
                  {{ t("redis.commandLine") }}
                </button>
              </div>
            </div>

            <TabsContent value="detail" class="m-0 min-h-0 flex-1 flex flex-col">
              <RedisValueViewer
                v-if="selectedKey"
                :key="selectedKey.key_raw"
                :connection-id="connectionId"
                :db="db"
                :key-display="selectedKey.key_display"
                :key-raw="selectedKey.key_raw"
                :metadata="selectedKey"
                @deleted="onKeyDeleted"
              />
              <div v-else class="flex-1 flex items-center justify-center text-[12px] text-[var(--ds-text-3)]">
                {{ t("redis.selectKeyForDetail") }}
              </div>
            </TabsContent>

            <TabsContent value="command" class="m-0 min-h-0 flex-1 flex flex-col">
              <div
                class="dbx-editor-font-family relative flex min-h-0 flex-1 flex-col bg-[#171b21] text-[13px] leading-5 text-slate-200"
                @click="getCommandInput()?.focus()"
              >
                <div ref="commandTerminalRef" class="min-h-0 flex-1 overflow-auto px-4 pb-3 pt-4">
                  <div class="mb-4 text-slate-400">
                    <span class="text-slate-200">{{ t("redis.commandWelcome") }}</span>
                  </div>

                  <div v-for="entry in commandHistory" :key="entry.id" class="mb-2">
                    <div class="flex min-w-0 items-start gap-2 whitespace-pre-wrap break-words">
                      <span class="shrink-0 text-[#d7ba7d]">{{ entry.prompt }}</span>
                      <span class="min-w-0 text-slate-200">{{ entry.command }}</span>
                    </div>
                    <pre
                      v-if="entry.output"
                      class="ml-0 whitespace-pre-wrap break-words pl-0"
                      :class="entry.error ? 'text-[#ff6b6b]' : 'text-slate-300'"
                      >{{ entry.output }}</pre
                    >
                  </div>
                </div>

                <form
                  class="relative flex shrink-0 items-center gap-2 border-t border-white/10 bg-[#171b21] px-4 py-2"
                  @submit.prevent="executeCommand"
                >
                  <ul
                    v-if="completionVisible"
                    class="dbx-editor-font-family absolute bottom-full z-20 mb-1 max-h-56 w-80 max-w-[min(32rem,calc(100%-2rem))] overflow-auto rounded-md border border-white/10 bg-[#1f242c] py-1 text-[12px] shadow-lg"
                    :style="{ left: `${completionLeft}px` }"
                  >
                    <li
                      v-for="(item, index) in completionItems"
                      :key="`${item.kind}:${item.label}`"
                      class="flex cursor-pointer items-center gap-2 px-2.5 py-1"
                      :class="index === completionIndex ? 'bg-white/10 text-slate-100' : 'text-slate-300'"
                      @mousedown.prevent="acceptCompletion(item)"
                      @mouseenter="completionIndex = index"
                    >
                      <span
                        class="w-7 shrink-0 text-[10px] uppercase tracking-wide"
                        :class="item.kind === 'command' ? 'text-[#d7ba7d]' : 'text-sky-400'"
                        >{{ item.kind === "command" ? "cmd" : "key" }}</span
                      >
                      <span
                        class="truncate font-medium"
                        :class="item.kind === 'command' ? 'shrink-0' : 'min-w-0 flex-1'"
                        >{{ item.label }}</span
                      >
                      <span
                        v-if="item.detail"
                        class="ml-auto min-w-0 truncate pl-3 text-right text-[11px] text-slate-500"
                        >{{ item.detail }}</span
                      >
                    </li>
                  </ul>
                  <span class="shrink-0 text-[#d7ba7d]">{{ commandPrompt }}</span>
                  <input
                    v-model="commandText"
                    data-redis-command-input
                    class="dbx-editor-font-family min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-slate-200 caret-[#d7ba7d] outline-none placeholder:text-slate-500"
                    :disabled="commandRunning"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    @input="onCommandInput"
                    @keydown="onCommandKeydown"
                    @blur="onCommandBlur"
                  />
                  <Loader2 v-if="commandRunning" class="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" />
                  <Tooltip v-else-if="commandText">
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-slate-500 transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-white/10 hover:text-slate-200"
                        :aria-label="t('redis.clearInput')"
                        @mousedown.prevent="clearCommandInput"
                      >
                        <X class="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{{ t("redis.clearInput") }}</TooltipContent>
                  </Tooltip>
                </form>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </Pane>
    </Splitpanes>

    <DangerConfirmDialog
      v-model:open="showDangerConfirm"
      :message="t('dangerDialog.deleteMessage')"
      :details="dangerDetails"
      :confirm-label="dangerConfirmLabel"
      @confirm="applyDangerAction"
    />

    <DsDialog
      v-model:open="showCreateKeyDialog"
      :title="t('redis.createKey')"
      :icon="KeyRound"
      content-class="sm:max-w-md"
    >
      <div class="grid gap-3" :style="editorFontFamilyStyle">
        <label class="grid gap-1.5 text-xs font-medium text-[var(--ds-text-2)]">
          <span>{{ t("redis.createKeyName") }}</span>
          <Input
            v-model="createKeyName"
            class="dbx-editor-font-family h-8 text-xs"
            :placeholder="t('redis.createKeyNamePlaceholder')"
            @keydown.enter="createRedisKey"
          />
        </label>

        <label class="grid gap-1.5 text-xs font-medium text-[var(--ds-text-2)]">
          <span>{{ t("redis.createKeyType") }}</span>
          <Select
            :model-value="createKeyType"
            @update:model-value="(value: any) => (createKeyType = value as RedisCreateKeyType)"
          >
            <SelectTrigger class="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in createKeyTypeOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label v-if="createKeyType === 'hash'" class="grid gap-1.5 text-xs font-medium">
          <span>{{ t("redis.createField") }}</span>
          <Input
            v-model="createKeyField"
            class="dbx-editor-font-family h-8 text-xs"
            :placeholder="t('redis.createFieldPlaceholder')"
            @keydown.enter="createRedisKey"
          />
        </label>

        <label v-if="createKeyType === 'zset'" class="grid gap-1.5 text-xs font-medium">
          <span>{{ t("redis.createScore") }}</span>
          <Input
            v-model="createKeyScore"
            class="dbx-editor-font-family h-8 text-xs"
            placeholder="0"
            @keydown.enter="createRedisKey"
          />
        </label>

        <label class="grid gap-1.5 text-xs font-medium text-[var(--ds-text-2)]">
          <span>{{
            t(createKeyType === "set" || createKeyType === "zset" ? "redis.createMember" : "redis.createValue")
          }}</span>
          <textarea
            v-model="createKeyValue"
            class="dbx-editor-font-family min-h-28 resize-y rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-2 text-xs text-[var(--ds-text-1)] outline-none transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] focus-visible:border-[var(--ds-accent-line)]"
            spellcheck="false"
            :placeholder="t('redis.createValuePlaceholder')"
          />
        </label>

        <p v-if="createKeyError" class="text-xs text-[var(--ds-red)]">{{ createKeyError }}</p>
      </div>

      <template #footer>
        <Button variant="ghost" :disabled="creatingKey" @click="showCreateKeyDialog = false">
          {{ t("common.cancel") }}
        </Button>
        <Button :disabled="creatingKey" @click="createRedisKey">
          <Loader2 v-if="creatingKey" class="h-4 w-4 animate-spin" />
          <Plus v-else class="h-4 w-4" />
          {{ t("redis.createKeySubmit") }}
        </Button>
      </template>
    </DsDialog>
  </div>
</template>

<style scoped>
.redis-key-scroller {
  will-change: scroll-position;
  contain: content;
}

.redis-key-scroller :deep(.vue-recycle-scroller__item-view) {
  contain: layout style paint;
}

.redis-workspace-splitpanes :deep(.splitpanes--vertical > .splitpanes__splitter) {
  width: 1px !important;
  border-left: 0;
  background: var(--ds-border);
}

.redis-workspace-splitpanes :deep(.splitpanes__splitter:hover) {
  background: var(--ds-accent) !important;
}
</style>
