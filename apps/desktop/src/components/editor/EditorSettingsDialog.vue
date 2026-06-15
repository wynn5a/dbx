<script setup lang="ts">
import { ref, watch, shallowRef, computed, onMounted, type Component } from "vue";
import type { EditorView as EditorViewType } from "@codemirror/view";
import { useI18n } from "vue-i18n";
import {
  Activity,
  AlertTriangle,
  AlignLeft,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Cloud,
  Command,
  Compass,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Hash,
  Info,
  Keyboard,
  Languages,
  LayoutGrid,
  Link2,
  Loader2,
  Menu,
  PackageSearch,
  Palette,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  SquareChevronRight,
  SquareTerminal,
  Terminal,
  Trash2,
  Type,
  Upload,
  WrapText,
  X,
  Zap,
} from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle, DsDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useSettingsStore,
  AI_PROVIDER_PRESETS,
  EDITOR_THEMES,
  FONT_FAMILIES,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_DESKTOP_SETTINGS,
  type AiProvider,
  type AiApiStyle,
  type EditorTheme,
  type DisconnectTabHandlingMode,
  type CustomThemeColors,
  type CustomTheme,
} from "@/stores/settingsStore";
import { loadEditorTheme, editorFontTheme } from "@/lib/editorThemes";
import ThemeCustomizerDialog from "./ThemeCustomizerDialog.vue";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { useTheme } from "@/composables/useTheme";
import { copyToClipboard } from "@/lib/clipboard";
import { clearDebugLogs as clearStoredDebugLogs, downloadDebugLogs, getDebugLogBundleText } from "@/lib/debugLog";
import {
  aiListModels,
  aiTestConnection,
  checkMcpServerStatus,
  forgetWebdavSavedPassword,
  listSystemFonts,
  saveWebdavSavedPassword,
  webdavPasswordStatus,
  webdavSyncDownload,
  webdavSyncTest,
  webdavSyncUpload,
  type AiModelInfo,
  type McpServerStatus,
  type WebDavConfig,
} from "@/lib/api";
import { eventToShortcut } from "@/lib/keyboardShortcuts";
import {
  SHORTCUT_DEFINITIONS,
  findShortcutConflict,
  normalizeShortcutSettings,
  type ShortcutActionId,
  type ShortcutScope,
} from "@/lib/shortcutRegistry";
import { normalizeSidebarHiddenTablePrefixes } from "@/lib/sidebarTableNameDisplay";
import { normalizeSqlFormatterSettings, type SqlFormatterSettings } from "@/lib/sqlFormatterConfig";
import type { SqlSnippet } from "@/types/database";
import { uuid } from "@/lib/utils";
import { DEFAULT_SQL_SNIPPETS } from "@/lib/sqlCompletion";
import AiProviderLogo from "@/components/icons/AiProviderLogo.vue";
import AppLogo from "@/components/icons/AppLogo.vue";
import SqlFormatterSettingsPanel from "./SqlFormatterSettingsPanel.vue";
import type { AppThemeAppearance } from "@/lib/appTheme";
import { useConnectionStore } from "@/stores/connectionStore";
import { currentLocale, setLocale, type Locale } from "@/i18n";
import { LOCALE_OPTIONS } from "@/lib/localeOptions";

const { t } = useI18n();
const settingsStore = useSettingsStore();
const connectionStore = useConnectionStore();
const { isDark } = useTheme();

const props = defineProps<{
  open: boolean;
  initialTab?: string;
  appVersion?: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

// Local edit state
const editFontFamily = ref(settingsStore.editorSettings.fontFamily);
const editFontSize = ref(settingsStore.editorSettings.fontSize);
const editUiScale = ref(settingsStore.editorSettings.uiScale);
const editTheme = ref(settingsStore.editorSettings.theme);
const editCustomThemes = ref<CustomTheme[]>([...settingsStore.editorSettings.customThemes]);
const editActiveCustomThemeId = ref(settingsStore.editorSettings.activeCustomThemeId);
const showThemeCustomizer = ref(false);
const editExecuteMode = ref(settingsStore.editorSettings.executeMode);
const editWordWrap = ref(settingsStore.editorSettings.wordWrap);
const editConfirmDangerousSqlExecution = ref(settingsStore.editorSettings.confirmDangerousSqlExecution);
const editShowTrayIcon = ref(settingsStore.desktopSettings.show_tray_icon);
const editDebugLoggingEnabled = ref(settingsStore.desktopSettings.debug_logging_enabled);
const debugLogCopied = ref(false);
const debugLogDownloaded = ref(false);
const editShowColumnCommentsInHeader = ref(settingsStore.editorSettings.showColumnCommentsInHeader);
const editShowColumnTypesInHeader = ref(settingsStore.editorSettings.showColumnTypesInHeader);
const editCompactColumnHeaderActions = ref(settingsStore.editorSettings.compactColumnHeaderActions);
const editRedisScanPageSize = ref(settingsStore.editorSettings.redisScanPageSize);
const editShortcuts = ref(normalizeShortcutSettings(settingsStore.editorSettings.shortcuts));
const editSqlFormatter = ref<SqlFormatterSettings>(
  normalizeSqlFormatterSettings(settingsStore.editorSettings.sqlFormatter),
);
const editingShortcutId = ref<ShortcutActionId | null>(null);
const shortcutSearch = ref("");
const editSidebarActivation = ref(settingsStore.editorSettings.sidebarActivation);
const editSidebarObjectDisplay = ref(settingsStore.editorSettings.sidebarObjectDisplay);
const editAutoSelectActiveSidebarNode = ref(settingsStore.editorSettings.autoSelectActiveSidebarNode);
const editDisconnectTabHandlingMode = ref<DisconnectTabHandlingMode>(
  settingsStore.editorSettings.disconnectTabHandlingMode,
);
const editReuseDataTab = ref(settingsStore.editorSettings.reuseDataTab);
const editUpdateNotificationsEnabled = ref(settingsStore.editorSettings.updateNotificationsEnabled);
const editSidebarHiddenTablePrefixes = ref(settingsStore.editorSettings.sidebarHiddenTablePrefixes.join("\n"));
const editSidebarHideTableComments = ref(settingsStore.editorSettings.sidebarHideTableComments);
const editSidebarAllowHorizontalScroll = ref(settingsStore.editorSettings.sidebarAllowHorizontalScroll);
const editExportBatchSize = ref(settingsStore.editorSettings.exportBatchSize);
const redisScanPageSizeOptions = [200, 1000, 5000, 10000];
const systemFonts = ref<string[]>([]);
const systemFontsLoading = ref(false);
const systemFontsLoaded = ref(false);
const uiScaleOptions = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
// Fill % for the .ds-range track gradient (WebKit reads it via the inline --range-fill var).
const fontSizeFillPercent = computed(
  () => ((editFontSize.value - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100,
);
const disconnectTabHandlingModeDescriptionKey = computed(() => {
  switch (editDisconnectTabHandlingMode.value) {
    case "close-tabs":
      return "disconnectTabHandlingModeCloseTabsDescription";
    case "keep-tabs-clear-results":
      return "disconnectTabHandlingModeKeepTabsClearResultsDescription";
    case "keep-tabs-keep-results":
      return "disconnectTabHandlingModeKeepTabsKeepResultsDescription";
  }

  return "disconnectTabHandlingModeCloseTabsDescription";
});

// --- Snippet state ---
const editSnippets = ref<SqlSnippet[]>(settingsStore.editorSettings.snippets.map((s) => ({ ...s })));
const snippetSearch = ref("");
const filteredSnippets = computed(() => {
  const query = snippetSearch.value.trim().toLowerCase();
  if (!query) return editSnippets.value;
  return editSnippets.value.filter(
    (snippet) =>
      snippet.label.toLowerCase().includes(query) ||
      snippet.prefix.toLowerCase().includes(query) ||
      snippet.body.toLowerCase().includes(query),
  );
});

const snippetDialogOpen = ref(false);
const snippetEditingId = ref<string | null>(null);
const snippetForm = ref({ label: "", prefix: "", body: "" });
const snippetFormPrefixError = ref("");

function openAddSnippetDialog() {
  snippetEditingId.value = null;
  snippetForm.value = { label: "", prefix: "", body: "" };
  snippetFormPrefixError.value = "";
  snippetDialogOpen.value = true;
}

function openEditSnippetDialog(snippet: SqlSnippet) {
  snippetEditingId.value = snippet.id;
  snippetForm.value = { label: snippet.label, prefix: snippet.prefix, body: snippet.body };
  snippetFormPrefixError.value = "";
  snippetDialogOpen.value = true;
}

function saveSnippet() {
  const prefix = snippetForm.value.prefix.trim();
  if (!prefix) {
    snippetFormPrefixError.value = "Prefix is required.";
    return;
  }
  const duplicate = editSnippets.value.find((s) => s.prefix === prefix && s.id !== snippetEditingId.value);
  if (duplicate) {
    snippetFormPrefixError.value = "Prefix must be unique.";
    return;
  }
  if (snippetEditingId.value) {
    const idx = editSnippets.value.findIndex((s) => s.id === snippetEditingId.value);
    if (idx !== -1) {
      editSnippets.value[idx] = {
        id: snippetEditingId.value,
        label: snippetForm.value.label.trim() || prefix,
        prefix,
        body: snippetForm.value.body,
      };
    }
  } else {
    editSnippets.value.push({
      id: uuid(),
      label: snippetForm.value.label.trim() || prefix,
      prefix,
      body: snippetForm.value.body,
    });
  }
  snippetDialogOpen.value = false;
}

function deleteSnippet(id: string) {
  editSnippets.value = editSnippets.value.filter((s) => s.id !== id);
}

function confirmDeleteSnippet(snippet: SqlSnippet) {
  if (window.confirm(`Delete snippet "${snippet.label}"?`)) {
    deleteSnippet(snippet.id);
  }
}

const presetFontLabels = new Map(FONT_FAMILIES.map((font) => [font.value, font.label]));

function cssFontFamilyForName(name: string): string {
  return `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}', monospace`;
}

function readableFontFamily(value: string): string {
  const first = value.split(",")[0]?.trim() ?? value;
  return first.replace(/^['"]|['"]$/g, "").replace(/\\'/g, "'");
}

function normalizeCustomFontFamilyInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.includes(",") || trimmed.includes("'") || trimmed.includes('"')) return trimmed;
  return cssFontFamilyForName(trimmed);
}

const systemFontOptions = computed(() => {
  const options = new Set(FONT_FAMILIES.map((font) => font.value));
  for (const font of systemFonts.value) options.add(cssFontFamilyForName(font));
  if (editFontFamily.value) options.add(editFontFamily.value);
  return [...options];
});

function displayFontFamily(value: string): string {
  return presetFontLabels.get(value) ?? readableFontFamily(value);
}

async function loadSystemFontOptions() {
  if (systemFontsLoaded.value || systemFontsLoading.value) return;
  systemFontsLoading.value = true;
  try {
    systemFonts.value = await listSystemFonts();
    systemFontsLoaded.value = true;
  } catch {
    systemFonts.value = [];
  } finally {
    systemFontsLoading.value = false;
  }
}

// Sync from store when dialog opens
watch(
  () => props.open,
  (open) => {
    if (open) {
      editFontFamily.value = settingsStore.editorSettings.fontFamily;
      editFontSize.value = settingsStore.editorSettings.fontSize;
      editUiScale.value = settingsStore.editorSettings.uiScale;
      editTheme.value = settingsStore.editorSettings.theme;
      editCustomThemes.value = [...settingsStore.editorSettings.customThemes];
      editActiveCustomThemeId.value = settingsStore.editorSettings.activeCustomThemeId;
      editExecuteMode.value = settingsStore.editorSettings.executeMode;
      editWordWrap.value = settingsStore.editorSettings.wordWrap;
      editConfirmDangerousSqlExecution.value = settingsStore.editorSettings.confirmDangerousSqlExecution;
      editShowTrayIcon.value = settingsStore.desktopSettings.show_tray_icon;
      editDebugLoggingEnabled.value = settingsStore.desktopSettings.debug_logging_enabled;
      editShowColumnCommentsInHeader.value = settingsStore.editorSettings.showColumnCommentsInHeader;
      editShowColumnTypesInHeader.value = settingsStore.editorSettings.showColumnTypesInHeader;
      editCompactColumnHeaderActions.value = settingsStore.editorSettings.compactColumnHeaderActions;
      editRedisScanPageSize.value = settingsStore.editorSettings.redisScanPageSize;
      editShortcuts.value = normalizeShortcutSettings(settingsStore.editorSettings.shortcuts);
      editSqlFormatter.value = normalizeSqlFormatterSettings(settingsStore.editorSettings.sqlFormatter);
      editSidebarActivation.value = settingsStore.editorSettings.sidebarActivation;
      editSidebarObjectDisplay.value = settingsStore.editorSettings.sidebarObjectDisplay;
      editAutoSelectActiveSidebarNode.value = settingsStore.editorSettings.autoSelectActiveSidebarNode;
      editDisconnectTabHandlingMode.value = settingsStore.editorSettings.disconnectTabHandlingMode;
      editReuseDataTab.value = settingsStore.editorSettings.reuseDataTab;
      editUpdateNotificationsEnabled.value = settingsStore.editorSettings.updateNotificationsEnabled;
      editSidebarHiddenTablePrefixes.value = settingsStore.editorSettings.sidebarHiddenTablePrefixes.join("\n");
      editSidebarHideTableComments.value = settingsStore.editorSettings.sidebarHideTableComments;
      editSidebarAllowHorizontalScroll.value = settingsStore.editorSettings.sidebarAllowHorizontalScroll;
      editExportBatchSize.value = settingsStore.editorSettings.exportBatchSize;
      editSnippets.value = settingsStore.editorSettings.snippets.map((s) => ({ ...s }));
      void loadSystemFontOptions();
    }
  },
  { immediate: true },
);

const shortcutConflicts = computed(() =>
  SHORTCUT_DEFINITIONS.flatMap((definition) => {
    const conflict = findShortcutConflict(definition.id, editShortcuts.value[definition.id], editShortcuts.value);
    return conflict ? [definition.id] : [];
  }),
);
const hasShortcutConflicts = computed(() => shortcutConflicts.value.length > 0);
const shortcutsChanged = computed(
  () => JSON.stringify(editShortcuts.value) !== JSON.stringify(settingsStore.editorSettings.shortcuts),
);
const hasBlockingShortcutConflicts = computed(() => shortcutsChanged.value && hasShortcutConflicts.value);
const hasApplyBlocker = computed(() => hasBlockingShortcutConflicts.value);

function hasChanges(): boolean {
  return (
    editFontFamily.value !== settingsStore.editorSettings.fontFamily ||
    editFontSize.value !== settingsStore.editorSettings.fontSize ||
    editUiScale.value !== settingsStore.editorSettings.uiScale ||
    editTheme.value !== settingsStore.editorSettings.theme ||
    JSON.stringify(editCustomThemes.value) !== JSON.stringify(settingsStore.editorSettings.customThemes) ||
    editActiveCustomThemeId.value !== settingsStore.editorSettings.activeCustomThemeId ||
    editExecuteMode.value !== settingsStore.editorSettings.executeMode ||
    editWordWrap.value !== settingsStore.editorSettings.wordWrap ||
    editConfirmDangerousSqlExecution.value !== settingsStore.editorSettings.confirmDangerousSqlExecution ||
    editShowTrayIcon.value !== settingsStore.desktopSettings.show_tray_icon ||
    editDebugLoggingEnabled.value !== settingsStore.desktopSettings.debug_logging_enabled ||
    editShowColumnCommentsInHeader.value !== settingsStore.editorSettings.showColumnCommentsInHeader ||
    editShowColumnTypesInHeader.value !== settingsStore.editorSettings.showColumnTypesInHeader ||
    editCompactColumnHeaderActions.value !== settingsStore.editorSettings.compactColumnHeaderActions ||
    editRedisScanPageSize.value !== settingsStore.editorSettings.redisScanPageSize ||
    JSON.stringify(editShortcuts.value) !== JSON.stringify(settingsStore.editorSettings.shortcuts) ||
    JSON.stringify(editSqlFormatter.value) !==
      JSON.stringify(normalizeSqlFormatterSettings(settingsStore.editorSettings.sqlFormatter)) ||
    editSidebarActivation.value !== settingsStore.editorSettings.sidebarActivation ||
    editSidebarObjectDisplay.value !== settingsStore.editorSettings.sidebarObjectDisplay ||
    editAutoSelectActiveSidebarNode.value !== settingsStore.editorSettings.autoSelectActiveSidebarNode ||
    editDisconnectTabHandlingMode.value !== settingsStore.editorSettings.disconnectTabHandlingMode ||
    editReuseDataTab.value !== settingsStore.editorSettings.reuseDataTab ||
    editUpdateNotificationsEnabled.value !== settingsStore.editorSettings.updateNotificationsEnabled ||
    editSidebarHideTableComments.value !== settingsStore.editorSettings.sidebarHideTableComments ||
    editSidebarAllowHorizontalScroll.value !== settingsStore.editorSettings.sidebarAllowHorizontalScroll ||
    editExportBatchSize.value !== settingsStore.editorSettings.exportBatchSize ||
    JSON.stringify(normalizeSidebarHiddenTablePrefixes(editSidebarHiddenTablePrefixes.value)) !==
      JSON.stringify(settingsStore.editorSettings.sidebarHiddenTablePrefixes) ||
    JSON.stringify(editSnippets.value) !== JSON.stringify(settingsStore.editorSettings.snippets)
  );
}

async function persistSettings() {
  if (hasApplyBlocker.value) return;
  const sidebarObjectDisplayChanged =
    editSidebarObjectDisplay.value !== settingsStore.editorSettings.sidebarObjectDisplay;
  settingsStore.updateEditorSettings({
    fontFamily: editFontFamily.value,
    fontSize: editFontSize.value,
    uiScale: editUiScale.value,
    theme: editTheme.value,
    customThemes: editCustomThemes.value,
    activeCustomThemeId: editActiveCustomThemeId.value,
    executeMode: editExecuteMode.value,
    wordWrap: editWordWrap.value,
    confirmDangerousSqlExecution: editConfirmDangerousSqlExecution.value,
    showColumnCommentsInHeader: editShowColumnCommentsInHeader.value,
    showColumnTypesInHeader: editShowColumnTypesInHeader.value,
    compactColumnHeaderActions: editCompactColumnHeaderActions.value,
    redisScanPageSize: editRedisScanPageSize.value,
    shortcuts: editShortcuts.value,
    sqlFormatter: normalizeSqlFormatterSettings(editSqlFormatter.value),
    sidebarActivation: editSidebarActivation.value,
    sidebarObjectDisplay: editSidebarObjectDisplay.value,
    autoSelectActiveSidebarNode: editAutoSelectActiveSidebarNode.value,
    disconnectTabHandlingMode: editDisconnectTabHandlingMode.value,
    reuseDataTab: editReuseDataTab.value,
    updateNotificationsEnabled: editUpdateNotificationsEnabled.value,
    sidebarHideTableComments: editSidebarHideTableComments.value,
    sidebarAllowHorizontalScroll: editSidebarAllowHorizontalScroll.value,
    sidebarHiddenTablePrefixes: normalizeSidebarHiddenTablePrefixes(editSidebarHiddenTablePrefixes.value),
    exportBatchSize: editExportBatchSize.value,
    snippets: editSnippets.value,
  });
  await settingsStore.updateDesktopSettings({
    show_tray_icon: editShowTrayIcon.value,
    debug_logging_enabled: editDebugLoggingEnabled.value,
  });
  if (sidebarObjectDisplayChanged) {
    await connectionStore.refreshAllTree();
  }
}

async function applySettings() {
  await persistSettings();
}

async function applySettingsAndClose() {
  await persistSettings();
  emit("update:open", false);
}

function resetDefaults() {
  editFontFamily.value = DEFAULT_EDITOR_SETTINGS.fontFamily;
  editFontSize.value = DEFAULT_EDITOR_SETTINGS.fontSize;
  editUiScale.value = DEFAULT_EDITOR_SETTINGS.uiScale;
  editTheme.value = DEFAULT_EDITOR_SETTINGS.theme;
  editCustomThemes.value = [...DEFAULT_EDITOR_SETTINGS.customThemes];
  editActiveCustomThemeId.value = DEFAULT_EDITOR_SETTINGS.activeCustomThemeId;
  editExecuteMode.value = DEFAULT_EDITOR_SETTINGS.executeMode;
  editWordWrap.value = DEFAULT_EDITOR_SETTINGS.wordWrap;
  editConfirmDangerousSqlExecution.value = DEFAULT_EDITOR_SETTINGS.confirmDangerousSqlExecution;
  editShowTrayIcon.value = DEFAULT_DESKTOP_SETTINGS.show_tray_icon;
  editDebugLoggingEnabled.value = DEFAULT_DESKTOP_SETTINGS.debug_logging_enabled;
  editShowColumnCommentsInHeader.value = DEFAULT_EDITOR_SETTINGS.showColumnCommentsInHeader;
  editShowColumnTypesInHeader.value = DEFAULT_EDITOR_SETTINGS.showColumnTypesInHeader;
  editCompactColumnHeaderActions.value = DEFAULT_EDITOR_SETTINGS.compactColumnHeaderActions;
  editRedisScanPageSize.value = DEFAULT_EDITOR_SETTINGS.redisScanPageSize;
  editShortcuts.value = normalizeShortcutSettings(DEFAULT_EDITOR_SETTINGS.shortcuts);
  editSqlFormatter.value = normalizeSqlFormatterSettings(DEFAULT_EDITOR_SETTINGS.sqlFormatter);
  editSidebarActivation.value = DEFAULT_EDITOR_SETTINGS.sidebarActivation;
  editSidebarObjectDisplay.value = DEFAULT_EDITOR_SETTINGS.sidebarObjectDisplay;
  editAutoSelectActiveSidebarNode.value = DEFAULT_EDITOR_SETTINGS.autoSelectActiveSidebarNode;
  editDisconnectTabHandlingMode.value = DEFAULT_EDITOR_SETTINGS.disconnectTabHandlingMode;
  editReuseDataTab.value = DEFAULT_EDITOR_SETTINGS.reuseDataTab;
  editUpdateNotificationsEnabled.value = DEFAULT_EDITOR_SETTINGS.updateNotificationsEnabled;
  editSidebarHideTableComments.value = DEFAULT_EDITOR_SETTINGS.sidebarHideTableComments;
  editSidebarAllowHorizontalScroll.value = DEFAULT_EDITOR_SETTINGS.sidebarAllowHorizontalScroll;
  editSidebarHiddenTablePrefixes.value = DEFAULT_EDITOR_SETTINGS.sidebarHiddenTablePrefixes.join("\n");
  editExportBatchSize.value = DEFAULT_EDITOR_SETTINGS.exportBatchSize;
  editSnippets.value = DEFAULT_SQL_SNIPPETS.map((s) => ({ ...s }));
}

// SQL Formatter header action: restore just the formatter settings to defaults,
// disabled when the draft already matches them.
const isSqlFormatterAtDefaults = computed(
  () =>
    JSON.stringify(normalizeSqlFormatterSettings(editSqlFormatter.value)) ===
    JSON.stringify(normalizeSqlFormatterSettings(DEFAULT_EDITOR_SETTINGS.sqlFormatter)),
);

function restoreSqlFormatterDefaults() {
  editSqlFormatter.value = normalizeSqlFormatterSettings(DEFAULT_EDITOR_SETTINGS.sqlFormatter);
}

// Mirrors resetDefaults(): true when every edit field already holds its default,
// so the Reset Defaults button disables itself the same way the Apply buttons do.
const isAtDefaults = computed(
  () =>
    editFontFamily.value === DEFAULT_EDITOR_SETTINGS.fontFamily &&
    editFontSize.value === DEFAULT_EDITOR_SETTINGS.fontSize &&
    editUiScale.value === DEFAULT_EDITOR_SETTINGS.uiScale &&
    editTheme.value === DEFAULT_EDITOR_SETTINGS.theme &&
    JSON.stringify(editCustomThemes.value) === JSON.stringify(DEFAULT_EDITOR_SETTINGS.customThemes) &&
    editActiveCustomThemeId.value === DEFAULT_EDITOR_SETTINGS.activeCustomThemeId &&
    editExecuteMode.value === DEFAULT_EDITOR_SETTINGS.executeMode &&
    editWordWrap.value === DEFAULT_EDITOR_SETTINGS.wordWrap &&
    editConfirmDangerousSqlExecution.value === DEFAULT_EDITOR_SETTINGS.confirmDangerousSqlExecution &&
    editShowTrayIcon.value === DEFAULT_DESKTOP_SETTINGS.show_tray_icon &&
    editDebugLoggingEnabled.value === DEFAULT_DESKTOP_SETTINGS.debug_logging_enabled &&
    editShowColumnCommentsInHeader.value === DEFAULT_EDITOR_SETTINGS.showColumnCommentsInHeader &&
    editShowColumnTypesInHeader.value === DEFAULT_EDITOR_SETTINGS.showColumnTypesInHeader &&
    editCompactColumnHeaderActions.value === DEFAULT_EDITOR_SETTINGS.compactColumnHeaderActions &&
    editRedisScanPageSize.value === DEFAULT_EDITOR_SETTINGS.redisScanPageSize &&
    JSON.stringify(editShortcuts.value) ===
      JSON.stringify(normalizeShortcutSettings(DEFAULT_EDITOR_SETTINGS.shortcuts)) &&
    JSON.stringify(editSqlFormatter.value) ===
      JSON.stringify(normalizeSqlFormatterSettings(DEFAULT_EDITOR_SETTINGS.sqlFormatter)) &&
    editSidebarActivation.value === DEFAULT_EDITOR_SETTINGS.sidebarActivation &&
    editSidebarObjectDisplay.value === DEFAULT_EDITOR_SETTINGS.sidebarObjectDisplay &&
    editAutoSelectActiveSidebarNode.value === DEFAULT_EDITOR_SETTINGS.autoSelectActiveSidebarNode &&
    editDisconnectTabHandlingMode.value === DEFAULT_EDITOR_SETTINGS.disconnectTabHandlingMode &&
    editReuseDataTab.value === DEFAULT_EDITOR_SETTINGS.reuseDataTab &&
    editUpdateNotificationsEnabled.value === DEFAULT_EDITOR_SETTINGS.updateNotificationsEnabled &&
    editSidebarHideTableComments.value === DEFAULT_EDITOR_SETTINGS.sidebarHideTableComments &&
    editSidebarAllowHorizontalScroll.value === DEFAULT_EDITOR_SETTINGS.sidebarAllowHorizontalScroll &&
    JSON.stringify(normalizeSidebarHiddenTablePrefixes(editSidebarHiddenTablePrefixes.value)) ===
      JSON.stringify(DEFAULT_EDITOR_SETTINGS.sidebarHiddenTablePrefixes) &&
    editExportBatchSize.value === DEFAULT_EDITOR_SETTINGS.exportBatchSize &&
    JSON.stringify(editSnippets.value) === JSON.stringify(DEFAULT_SQL_SNIPPETS),
);

function onExecuteModeChange(v: any) {
  if (v === "all" || v === "current") editExecuteMode.value = v;
}

function onFontFamilyChange(v: any) {
  if (typeof v === "string") editFontFamily.value = v;
}

const themeSelectValue = computed(() => {
  if (editTheme.value === "custom") {
    return `custom:${editActiveCustomThemeId.value}`;
  }
  return editTheme.value;
});

const themeSelectOptions = computed(() => [
  ...EDITOR_THEMES.filter((theme) => theme.value !== "custom").map((theme) => ({
    value: theme.value,
    label: theme.value === "app" ? t("settings.followAppTheme") : theme.label,
    dark: theme.dark,
    isCustom: false,
  })),
  ...editCustomThemes.value.map((theme) => ({
    value: `custom:${theme.id}`,
    label: theme.name,
    dark: true,
    isCustom: true,
  })),
]);

function onThemeChange(v: any) {
  if (typeof v !== "string") return;
  if (v.startsWith("custom:")) {
    editTheme.value = "custom";
    editActiveCustomThemeId.value = v.slice(7);
  } else {
    editTheme.value = v as typeof DEFAULT_EDITOR_SETTINGS.theme;
  }
}

function handleThemeSave(updatedThemes: CustomTheme[], activeId: string) {
  editCustomThemes.value = updatedThemes;
  editActiveCustomThemeId.value = activeId;
  editTheme.value = "custom";
  showThemeCustomizer.value = false;
}

function onDisconnectTabHandlingModeChange(v: any) {
  if (v === "close-tabs" || v === "keep-tabs-clear-results" || v === "keep-tabs-keep-results") {
    editDisconnectTabHandlingMode.value = v;
  }
}

function onLocaleChange(v: any) {
  if (typeof v === "string") void setLocale(v as Locale);
}

function onRedisScanPageSizeChange(v: any) {
  const value = Number(v);
  if (redisScanPageSizeOptions.includes(value)) editRedisScanPageSize.value = value;
}

function setSidebarObjectDisplay(value: "grouped" | "simple") {
  editSidebarObjectDisplay.value = value;
}

const EXPORT_BATCH_SIZE_MIN = 100;
const EXPORT_BATCH_SIZE_MAX = 100000;

function stepExportBatchSize(delta: number) {
  const current = Number.isFinite(editExportBatchSize.value)
    ? editExportBatchSize.value
    : DEFAULT_EDITOR_SETTINGS.exportBatchSize;
  editExportBatchSize.value = Math.min(EXPORT_BATCH_SIZE_MAX, Math.max(EXPORT_BATCH_SIZE_MIN, current + delta));
}

function onShortcutChange(actionId: ShortcutActionId, value: any) {
  if (typeof value !== "string") return;
  const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === actionId);
  if (!definition) return;
  editShortcuts.value = { ...editShortcuts.value, [actionId]: value };
}

function onShortcutKeydown(actionId: ShortcutActionId, event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (editingShortcutId.value !== actionId) return;
  if (event.key === "Escape") {
    editingShortcutId.value = null;
    return;
  }
  const shortcut = eventToShortcut(event);
  if (!shortcut) return;
  onShortcutChange(actionId, shortcut);
  editingShortcutId.value = null;
}

function formatShortcutPill(shortcut: string): string {
  const isMac = globalThis.navigator?.platform?.toLowerCase().includes("mac") ?? false;
  return shortcut
    .split("+")
    .filter(Boolean)
    .map((part) => {
      if (part === "Mod") return isMac ? "⌘" : "Ctrl";
      if (part === "Meta") return isMac ? "⌘" : "Meta";
      if (part === "Shift") return isMac ? "⇧" : "Shift";
      if (part === "Alt") return isMac ? "⌥" : "Alt";
      if (part === "Control" || part === "Ctrl") return isMac ? "⌃" : "Ctrl";
      if (part === "Enter") return "↵";
      if (part === "Backspace") return "⌫";
      if (part === "Delete") return isMac ? "⌦" : "Del";
      if (part === "Escape") return "Esc";
      if (part === "ArrowUp") return "↑";
      if (part === "ArrowDown") return "↓";
      if (part === "ArrowLeft") return "←";
      if (part === "ArrowRight") return "→";
      if (part === " ") return "Space";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(isMac ? " " : " + ");
}

const shortcutPressShortcutLabel = computed(() => t("settings.shortcutPressShortcut"));
const shortcutPressShortcutInputWidth = computed(() => `${shortcutPressShortcutLabel.value.length + 2}em`);

function focusShortcutInput(actionId: ShortcutActionId) {
  editingShortcutId.value = actionId;
  const input = document.querySelector<HTMLInputElement>(`[data-shortcut-input="${actionId}"]`);
  requestAnimationFrame(() => {
    input?.focus();
    input?.select();
  });
}

function cancelShortcutEdit() {
  editingShortcutId.value = null;
}

function resetShortcut(actionId: ShortcutActionId) {
  const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === actionId);
  if (!definition) return;
  editShortcuts.value = { ...editShortcuts.value, [actionId]: definition.defaultShortcut };
}

// Split a stored shortcut ("Mod+Shift+T") into per-key display tokens ("⌘", "⇧", "T")
// so each renders as an individual keycap.
function shortcutKeyTokens(shortcut: string): string[] {
  return formatShortcutPill(shortcut)
    .split(/\s\+\s|\s/)
    .filter(Boolean);
}

const SHORTCUT_SCOPE_META: { scope: ShortcutScope; labelKey: string; icon: Component }[] = [
  { scope: "global", labelKey: "settings.shortcutScopeGlobal", icon: Command },
  { scope: "editor", labelKey: "settings.shortcutScopeEditor", icon: SquareTerminal },
  { scope: "grid", labelKey: "settings.shortcutScopeGrid", icon: LayoutGrid },
  { scope: "search", labelKey: "settings.shortcutScopeSearch", icon: Search },
];

const filteredShortcutGroups = computed(() => {
  const query = shortcutSearch.value.trim().toLowerCase();
  return SHORTCUT_SCOPE_META.map((meta) => {
    const items = SHORTCUT_DEFINITIONS.filter((definition) => {
      if (definition.scope !== meta.scope) return false;
      if (!query) return true;
      const label = t(definition.labelKey).toLowerCase();
      const keys = formatShortcutPill(editShortcuts.value[definition.id]).toLowerCase();
      return label.includes(query) || keys.includes(query);
    });
    return { ...meta, items };
  }).filter((group) => group.items.length > 0);
});

const hasShortcutResults = computed(() => filteredShortcutGroups.value.length > 0);

function setSidebarActivation(value: "single" | "double") {
  editSidebarActivation.value = value;
}

const activeSettingsTab = ref("editor");
const isWeb = !isTauriRuntime();
const displayedAppVersion = computed(() => (props.appVersion ? `v${props.appVersion}` : ""));
type SettingsCategory =
  | "editor"
  | "formatter"
  | "appearance"
  | "navigation"
  | "data"
  | "shortcuts"
  | "snippets"
  | "sync"
  | "ai"
  | "mcp"
  | "security"
  | "about";
type SettingsCategoryNavItem = {
  value: SettingsCategory;
  label: string;
  icon: Component;
  subtitleKey: string;
};
const settingsCategoryNav = computed<SettingsCategoryNavItem[]>(() => [
  { value: "editor", label: t("settings.editorTab"), icon: FileCode2, subtitleKey: "settings.editorSubtitle" },
  {
    value: "formatter",
    label: t("settings.sqlFormatterTab"),
    icon: AlignLeft,
    subtitleKey: "settings.sqlFormatterSubtitle",
  },
  {
    value: "appearance",
    label: t("settings.appearanceTab"),
    icon: Palette,
    subtitleKey: "settings.appearanceSubtitle",
  },
  {
    value: "navigation",
    label: t("settings.navigationTab"),
    icon: Compass,
    subtitleKey: "settings.navigationSubtitle",
  },
  { value: "data", label: t("settings.dataTab"), icon: Database, subtitleKey: "settings.dataSubtitle" },
  { value: "shortcuts", label: t("settings.shortcutsTab"), icon: Keyboard, subtitleKey: "settings.shortcutsSubtitle" },
  { value: "snippets", label: t("settings.snippetsTab"), icon: Braces, subtitleKey: "settings.snippetsDescription" },
  ...(isWeb
    ? []
    : [
        {
          value: "sync" as const,
          label: t("settings.syncTab"),
          icon: Cloud,
          subtitleKey: "settings.syncWebDavDescription",
        },
      ]),
  { value: "ai", label: t("settings.aiTab"), icon: Sparkles, subtitleKey: "settings.aiSubtitle" },
  ...(isWeb
    ? []
    : [
        {
          value: "mcp" as const,
          label: t("settings.mcpTab"),
          icon: PackageSearch,
          subtitleKey: "settings.mcpDescription",
        },
      ]),
  ...(isWeb
    ? [
        {
          value: "security" as const,
          label: t("settings.securityTab"),
          icon: ShieldCheck,
          subtitleKey: "auth.changePasswordDescription",
        },
      ]
    : []),
  { value: "about", label: t("settings.aboutTab"), icon: Info, subtitleKey: "settings.aboutDescription" },
]);
const activeCategoryMeta = computed(
  () =>
    settingsCategoryNav.value.find((category) => category.value === activeSettingsTab.value) ??
    settingsCategoryNav.value[0],
);

// DESIGN-SYSTEM grouped setting card: panel surface (.ds-card) with internal divide-y dividers.
const dsSettingGroup = "ds-card overflow-hidden divide-y divide-[var(--ds-border-soft)]";
const dsSettingRow = "flex items-center justify-between gap-4 px-3.5 py-3";
const dsSettingDesc = "text-[11.5px] leading-relaxed text-[var(--ds-text-3)]";
// DESIGN-SYSTEM section label (type-scale "label" role) — see .ds-section-label in globals.css.
const dsSectionLabel = "ds-section-label";
const settingsTabsWithApplyFooter = new Set<SettingsCategory>([
  "editor",
  "formatter",
  "appearance",
  "navigation",
  "data",
  "shortcuts",
  "snippets",
]);

function hasSettingsApplyFooter(value: SettingsCategory): boolean {
  return settingsTabsWithApplyFooter.has(value);
}

// DESIGN-SYSTEM "Nav row (sidebar)" recipe: neutral active fill (never accent),
// idle text steps up one ramp level on hover.
function settingsCategoryButton(value: SettingsCategory): string {
  return [
    "flex w-full items-center gap-2.5 rounded-md px-3 py-[7px] text-left text-[13px] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]",
    value === activeSettingsTab.value
      ? "bg-[var(--ds-bg-active)] font-medium text-[var(--ds-text-1)]"
      : "text-[var(--ds-text-2)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]",
  ].join(" ");
}

function openExternalUrl(url: string) {
  if (isTauriRuntime()) {
    import("@tauri-apps/plugin-shell").then(({ open }) => open(url));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function copyDebugLogs() {
  await copyToClipboard(await getDebugLogBundleText());
  debugLogCopied.value = true;
  window.setTimeout(() => {
    debugLogCopied.value = false;
  }, 1500);
}

function clearDebugLogs() {
  clearStoredDebugLogs();
  debugLogCopied.value = false;
  debugLogDownloaded.value = false;
}

async function exportDebugLogs() {
  const saved = await downloadDebugLogs();
  if (!saved) return;
  debugLogDownloaded.value = true;
  window.setTimeout(() => {
    debugLogDownloaded.value = false;
  }, 1500);
}

// ---------- MCP Server ----------
const mcpStatus = ref<McpServerStatus | null>(null);
const mcpStatusLoading = ref(false);
const mcpStatusError = ref("");
const mcpCopied = ref<"" | "install" | "claude-config" | "codex-config">("");
const mcpConfigTab = ref<"claude" | "codex">("claude");
const mcpReadonlyMode = ref(false);
const mcpAllowDangerous = ref(false);

const mcpEnvEntries = computed(() => {
  const entries: Array<[string, string]> = [];
  if (mcpReadonlyMode.value) {
    entries.push(["DBX_MCP_ALLOW_WRITES", "0"]);
  }
  if (!mcpReadonlyMode.value && mcpAllowDangerous.value) {
    entries.push(["DBX_MCP_ALLOW_DANGEROUS_SQL", "1"]);
  }
  return entries;
});

const mcpClaudeRecommendedConfig = computed(() => {
  const config: Record<string, unknown> = {
    mcpServers: {
      dbx: {
        command: "dbx-mcp-server",
      } as Record<string, unknown>,
    },
  };
  if (mcpEnvEntries.value.length > 0) {
    const env = Object.fromEntries(mcpEnvEntries.value);
    ((config.mcpServers as Record<string, any>).dbx as Record<string, unknown>).env = env;
  }
  return JSON.stringify(config, null, 2);
});

const mcpCodexRecommendedConfig = computed(() => {
  const lines = ["[mcp_servers.dbx]", 'command = "dbx-mcp-server"'];
  if (mcpEnvEntries.value.length > 0) {
    lines.push("");
    lines.push("[mcp_servers.dbx.env]");
    for (const [key, value] of mcpEnvEntries.value) {
      lines.push(`${key} = "${value}"`);
    }
  }
  return lines.join("\n");
});

const mcpStatusTone = computed<"ok" | "warning" | "muted">(() => {
  if (!mcpStatus.value) return "muted";
  if (!mcpStatus.value.installed || mcpStatus.value.update_available || mcpStatus.value.error) return "warning";
  return "ok";
});

const mcpStatusLabel = computed(() => {
  if (mcpStatusLoading.value) return t("settings.mcpChecking");
  if (mcpStatusError.value) return t("settings.mcpStatusError");
  if (!mcpStatus.value) return t("settings.mcpStatusUnknown");
  if (!mcpStatus.value.installed) return t("settings.mcpNotInstalled");
  if (mcpStatus.value.update_available) return t("settings.mcpUpdateAvailable");
  return t("settings.mcpReady");
});

const mcpCommand = computed(() => {
  if (!mcpStatus.value) return "npm install -g @dbx-app/mcp-server@latest --registry=https://registry.npmjs.org";
  return mcpStatus.value.installed ? mcpStatus.value.update_command : mcpStatus.value.install_command;
});

watch(mcpReadonlyMode, (value) => {
  if (value) mcpAllowDangerous.value = false;
});

async function refreshMcpStatus() {
  if (mcpStatusLoading.value) return;
  mcpStatusLoading.value = true;
  mcpStatusError.value = "";
  try {
    mcpStatus.value = await checkMcpServerStatus();
  } catch (e: any) {
    mcpStatusError.value = e?.message || String(e);
  } finally {
    mcpStatusLoading.value = false;
  }
}

async function copyMcpText(kind: "install" | "claude-config" | "codex-config", value: string) {
  mcpCopied.value = kind;
  try {
    await copyToClipboard(value);
  } catch {
    mcpCopied.value = "";
    return;
  }
  window.setTimeout(() => {
    if (mcpCopied.value === kind) mcpCopied.value = "";
  }, 1500);
}

// ---------- WebDAV Sync ----------
const webdavEndpoint = ref(localStorage.getItem("dbx-webdav-endpoint") || "");
const webdavUsername = ref(localStorage.getItem("dbx-webdav-username") || "");
const webdavPassword = ref("");
const webdavPasswordVisible = ref(false);
const webdavRememberPassword = ref(localStorage.getItem("dbx-webdav-remember-password") === "true");
const webdavHasSavedPassword = ref(false);
const webdavRemotePath = ref(localStorage.getItem("dbx-webdav-remote-path") || "DBX/sync/snapshot.json");
const webdavSyncSecrets = ref(false);
const webdavSecretsPassphrase = ref("");
const webdavBusy = ref<"" | "test" | "upload" | "download">("");
const webdavMessage = ref("");
const webdavError = ref(false);

const webdavReady = computed(
  () =>
    !!webdavEndpoint.value.trim() &&
    !webdavBusy.value &&
    (!webdavSyncSecrets.value || !!webdavSecretsPassphrase.value.trim()),
);

function currentWebDavConfig(): WebDavConfig {
  return {
    endpoint: webdavEndpoint.value.trim(),
    username: webdavUsername.value.trim() || undefined,
    password: webdavPassword.value || undefined,
    remotePath: webdavRemotePath.value.trim() || "DBX/sync/snapshot.json",
  };
}

function currentWebDavAccountConfig(): WebDavConfig {
  const config = currentWebDavConfig();
  return { ...config, password: undefined };
}

function rememberWebDavFields() {
  localStorage.setItem("dbx-webdav-endpoint", webdavEndpoint.value.trim());
  localStorage.setItem("dbx-webdav-username", webdavUsername.value.trim());
  localStorage.setItem("dbx-webdav-remote-path", webdavRemotePath.value.trim() || "DBX/sync/snapshot.json");
}

function setWebDavResult(message: string, error = false) {
  webdavMessage.value = message;
  webdavError.value = error;
}

async function runWebDavAction(kind: "test" | "upload" | "download", action: () => Promise<string>) {
  webdavBusy.value = kind;
  webdavMessage.value = "";
  webdavError.value = false;
  try {
    rememberWebDavFields();
    await applyWebDavPasswordPreference();
    setWebDavResult(await action());
  } catch (e: any) {
    setWebDavResult(e?.message || String(e), true);
  } finally {
    webdavBusy.value = "";
  }
}

async function refreshWebDavPasswordStatus() {
  if (!webdavEndpoint.value.trim()) {
    webdavHasSavedPassword.value = false;
    webdavRememberPassword.value = false;
    return;
  }
  try {
    const status = await webdavPasswordStatus(currentWebDavAccountConfig());
    webdavHasSavedPassword.value = status.hasSavedPassword;
    if (status.hasSavedPassword) webdavRememberPassword.value = true;
  } catch {
    webdavHasSavedPassword.value = false;
  }
}

async function applyWebDavPasswordPreference() {
  const password = webdavPassword.value;
  if (webdavRememberPassword.value && password) {
    await saveWebdavSavedPassword(currentWebDavAccountConfig(), password);
    webdavHasSavedPassword.value = true;
    return;
  }
  if (!webdavRememberPassword.value && webdavHasSavedPassword.value) {
    await forgetWebdavSavedPassword(currentWebDavAccountConfig());
    webdavHasSavedPassword.value = false;
  }
}

async function testWebDav() {
  await runWebDavAction("test", async () => {
    await webdavSyncTest(currentWebDavConfig());
    return t("settings.syncTestSuccess");
  });
}

async function uploadWebDavSnapshot() {
  await runWebDavAction("upload", async () => {
    const summary = await webdavSyncUpload(
      currentWebDavConfig(),
      settingsStore.editorSettings,
      webdavSyncSecrets.value ? webdavSecretsPassphrase.value : undefined,
    );
    return t("settings.syncUploadSuccess", { bytes: summary.bytes, path: summary.remotePath });
  });
}

async function downloadWebDavSnapshot() {
  if (!window.confirm(t("settings.syncDownloadConfirm"))) return;
  await runWebDavAction("download", async () => {
    const result = await webdavSyncDownload(
      currentWebDavConfig(),
      webdavSyncSecrets.value ? webdavSecretsPassphrase.value : undefined,
    );
    if (result.editorSettings && typeof result.editorSettings === "object") {
      settingsStore.updateEditorSettings(result.editorSettings as any);
    }
    await settingsStore.updateDesktopSettings(result.desktopSettings);
    await connectionStore.initFromDisk();
    const message = t("settings.syncDownloadSuccess", {
      bytes: result.summary.bytes,
      path: result.summary.remotePath,
    });
    if (result.applySummary.encryptedSecretsPresent && !result.applySummary.secretsApplied) {
      return `${message} ${t("settings.syncSecretsSkipped")}`;
    }
    if (result.applySummary.secretsApplied) {
      return `${message} ${t("settings.syncSecretsApplied")}`;
    }
    return message;
  });
}

const oldPassword = ref("");
const newPassword = ref("");
const confirmNewPassword = ref("");
const passwordMessage = ref("");
const passwordError = ref(false);
const changingPassword = ref(false);

watch(
  () => props.open,
  async (open) => {
    if (open) {
      activeSettingsTab.value = props.initialTab || "editor";
      passwordMessage.value = "";
      oldPassword.value = "";
      newPassword.value = "";
      confirmNewPassword.value = "";
      await settingsStore.initAiConfig();
      await settingsStore.initDesktopSettings();
      editShowTrayIcon.value = settingsStore.desktopSettings.show_tray_icon;
      editDebugLoggingEnabled.value = settingsStore.desktopSettings.debug_logging_enabled;
      webdavPassword.value = "";
      await refreshWebDavPasswordStatus();
      syncAiEditState();
      if (!isWeb && activeSettingsTab.value === "mcp") void refreshMcpStatus();
    }
  },
  { immediate: true },
);

watch([webdavEndpoint, webdavUsername], () => {
  void refreshWebDavPasswordStatus();
});
watch(webdavRememberPassword, (val) => {
  localStorage.setItem("dbx-webdav-remember-password", String(val));
});

watch(activeSettingsTab, (tab) => {
  if (tab === "mcp" && !mcpStatus.value && !mcpStatusLoading.value) void refreshMcpStatus();
});

onMounted(() => {
  void refreshWebDavPasswordStatus();
});

async function changePassword() {
  if (newPassword.value !== confirmNewPassword.value) {
    passwordMessage.value = t("auth.passwordMismatch");
    passwordError.value = true;
    return;
  }
  changingPassword.value = true;
  passwordMessage.value = "";
  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPassword.value, new_password: newPassword.value }),
    });
    if (res.ok) {
      passwordMessage.value = t("auth.passwordChanged");
      passwordError.value = false;
      oldPassword.value = "";
      newPassword.value = "";
      confirmNewPassword.value = "";
    } else if (res.status === 401) {
      passwordMessage.value = t("auth.oldPasswordWrong");
      passwordError.value = true;
    } else {
      passwordMessage.value = t("auth.changePasswordFailed");
      passwordError.value = true;
    }
  } catch {
    passwordMessage.value = t("auth.connectFailed");
    passwordError.value = true;
  } finally {
    changingPassword.value = false;
  }
}

// ---------- AI Settings ----------
const aiProviderOptions = Object.values(AI_PROVIDER_PRESETS);
const aiEditProvider = ref<AiProvider>(settingsStore.aiConfig.provider);
const selectedAiProviderPreset = computed(() => AI_PROVIDER_PRESETS[aiEditProvider.value]);
const aiEditApiKey = ref(settingsStore.aiConfig.apiKey);
const aiEditEndpoint = ref(settingsStore.aiConfig.endpoint);
const aiEditModel = ref(settingsStore.aiConfig.model);
const aiEditApiStyle = ref<AiApiStyle>(settingsStore.aiConfig.apiStyle || "completions");
const aiEditProxyEnabled = ref(!!settingsStore.aiConfig.proxyEnabled);
const aiEditProxyUrl = ref(settingsStore.aiConfig.proxyUrl || "");
const aiEditEnableThinking = ref(settingsStore.aiConfig.enableThinking ?? true);

const aiModelOptions = ref<AiModelInfo[]>([]);
const aiModelLoading = ref(false);
const aiModelError = ref("");
const aiModelLoadedSignature = ref("");
let aiModelRequestToken = 0;

const aiCompletionsMode = computed(() => aiEditApiStyle.value === "completions");

const aiTesting = ref(false);
const aiTestResult = ref<"" | "success" | "error">("");
const aiTestError = ref("");
const aiApiKeyVisible = ref(false);
const aiRequiresApiKey = computed(() => AI_PROVIDER_PRESETS[aiEditProvider.value].requiresApiKey);
const aiSupportsApiStyle = computed(
  () =>
    aiEditProvider.value === "openai" ||
    aiEditProvider.value === "openai-compatible" ||
    aiEditProvider.value === "custom",
);
const aiModelListSupported = computed(() => aiEditProvider.value !== "gemini");
const aiCanListModels = computed(
  () =>
    aiModelListSupported.value &&
    !!aiEditEndpoint.value.trim() &&
    (!aiRequiresApiKey.value || !!aiEditApiKey.value.trim()),
);
const aiModelOptionIds = computed(() => aiModelOptions.value.map((model) => model.id));
const aiModelEmptyText = computed(() => {
  if (aiModelError.value) return aiModelError.value;
  if (!aiModelListSupported.value) return t("ai.modelListUnsupported");
  return t("ai.noModels");
});

function clearAiModelOptions() {
  aiModelRequestToken += 1;
  aiModelOptions.value = [];
  aiModelError.value = "";
  aiModelLoadedSignature.value = "";
  aiModelLoading.value = false;
}

function aiModelConfigSignature() {
  return JSON.stringify({
    provider: aiEditProvider.value,
    endpoint: aiEditEndpoint.value.trim(),
    apiKey: aiEditApiKey.value.trim(),
    proxyEnabled: aiEditProxyEnabled.value,
    proxyUrl: aiEditProxyUrl.value.trim(),
  });
}

function currentAiEditConfig() {
  return {
    provider: aiEditProvider.value,
    apiKey: aiEditApiKey.value,
    endpoint: aiEditEndpoint.value,
    model: aiEditModel.value,
    apiStyle: aiEditApiStyle.value,
    proxyEnabled: aiEditProxyEnabled.value,
    proxyUrl: aiEditProxyUrl.value,
    enableThinking: aiEditEnableThinking.value,
  };
}

function normalizeAiModelOptions(models: AiModelInfo[]): AiModelInfo[] {
  const seen = new Set<string>();
  const normalized: AiModelInfo[] = [];
  for (const model of models) {
    const id = model.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, displayName: model.displayName?.trim() || undefined });
  }
  return normalized;
}

function displayAiModelName(modelId: string): string {
  return aiModelOptions.value.find((model) => model.id === modelId)?.displayName || modelId;
}

async function aiRefreshModels() {
  if (aiModelLoading.value) return;
  if (!aiModelListSupported.value) {
    aiModelError.value = t("ai.modelListUnsupported");
    return;
  }
  if (!aiEditEndpoint.value.trim()) {
    aiModelError.value = t("ai.modelListEndpointRequired");
    return;
  }
  if (aiRequiresApiKey.value && !aiEditApiKey.value.trim()) {
    aiModelError.value = t("ai.modelListApiKeyRequired");
    return;
  }

  const token = ++aiModelRequestToken;
  const signature = aiModelConfigSignature();
  aiModelLoading.value = true;
  aiModelError.value = "";
  try {
    const models = normalizeAiModelOptions(await aiListModels(currentAiEditConfig()));
    if (token !== aiModelRequestToken) return;
    aiModelOptions.value = models;
    aiModelLoadedSignature.value = signature;
    if (!aiEditModel.value.trim() && models[0]) aiEditModel.value = models[0].id;
  } catch (e: any) {
    if (token !== aiModelRequestToken) return;
    aiModelOptions.value = [];
    aiModelError.value = e?.message || String(e);
  } finally {
    if (token === aiModelRequestToken) aiModelLoading.value = false;
  }
}

function onAiModelListOpen(open: boolean) {
  if (
    open &&
    aiCanListModels.value &&
    !aiModelLoading.value &&
    (!aiModelOptions.value.length || aiModelLoadedSignature.value !== aiModelConfigSignature())
  ) {
    void aiRefreshModels();
  }
}

function aiSelectModel(modelId: string) {
  aiEditModel.value = modelId;
}

function syncAiEditState() {
  aiEditProvider.value = settingsStore.aiConfig.provider;
  aiEditApiKey.value = settingsStore.aiConfig.apiKey;
  aiEditEndpoint.value = settingsStore.aiConfig.endpoint;
  aiEditModel.value = settingsStore.aiConfig.model;
  aiEditApiStyle.value = settingsStore.aiConfig.apiStyle || "completions";
  aiEditProxyEnabled.value = !!settingsStore.aiConfig.proxyEnabled;
  aiEditProxyUrl.value = settingsStore.aiConfig.proxyUrl || "";
  aiEditEnableThinking.value = settingsStore.aiConfig.enableThinking ?? true;
  aiTestResult.value = "";
  aiTestError.value = "";
  clearAiModelOptions();
}

function aiSelectProvider(provider: AiProvider) {
  aiEditProvider.value = provider;
  aiEditEndpoint.value = AI_PROVIDER_PRESETS[provider].endpoint;
  aiEditModel.value = AI_PROVIDER_PRESETS[provider].model;
  aiEditApiStyle.value = AI_PROVIDER_PRESETS[provider].apiStyle;
  if (!AI_PROVIDER_PRESETS[provider].requiresApiKey) aiEditApiKey.value = "";
  clearAiModelOptions();
}

function aiHasChanges(): boolean {
  return (
    aiEditProvider.value !== settingsStore.aiConfig.provider ||
    aiEditApiKey.value !== settingsStore.aiConfig.apiKey ||
    aiEditEndpoint.value !== settingsStore.aiConfig.endpoint ||
    aiEditModel.value !== settingsStore.aiConfig.model ||
    aiEditApiStyle.value !== (settingsStore.aiConfig.apiStyle || "completions") ||
    aiEditProxyEnabled.value !== !!settingsStore.aiConfig.proxyEnabled ||
    aiEditProxyUrl.value !== (settingsStore.aiConfig.proxyUrl || "") ||
    aiEditEnableThinking.value !== (settingsStore.aiConfig.enableThinking ?? true)
  );
}

function aiApplySettings() {
  settingsStore.updateAiConfig(currentAiEditConfig());
}

async function aiTestConn() {
  if (
    (aiRequiresApiKey.value && !aiEditApiKey.value.trim()) ||
    !aiEditEndpoint.value.trim() ||
    !aiEditModel.value.trim()
  )
    return;
  aiTesting.value = true;
  aiTestResult.value = "";
  aiTestError.value = "";
  try {
    await aiTestConnection(currentAiEditConfig());
    aiTestResult.value = "success";
  } catch (e: any) {
    aiTestResult.value = "error";
    aiTestError.value = e?.message || String(e);
  } finally {
    aiTesting.value = false;
  }
}

// ---------- CodeMirror preview ----------
const previewRef = ref<HTMLDivElement>();
const previewView = shallowRef<EditorViewType | null>(null);

function getPreviewCustomThemeColors(): CustomThemeColors | undefined {
  if (editTheme.value !== "custom") return undefined;
  const activeTheme = editCustomThemes.value.find((t) => t.id === editActiveCustomThemeId.value);
  return activeTheme?.colors;
}

const previewSettings = computed<{
  fontFamily: string;
  fontSize: number;
  theme: EditorTheme;
  appAppearance: AppThemeAppearance;
  customColors?: CustomThemeColors;
}>(() => ({
  fontFamily: editFontFamily.value,
  fontSize: editFontSize.value,
  theme: editTheme.value,
  appAppearance: isDark.value ? "dark" : "light",
  customColors: getPreviewCustomThemeColors(),
}));

const previewSql = `SELECT u.id, u.name, u.mrr
FROM users u
WHERE u.is_active = true  -- only active accounts
ORDER BY u.mrr DESC LIMIT 5;`;

let fontThemeComp: import("@codemirror/state").Compartment | null = null;
let themeComp: import("@codemirror/state").Compartment | null = null;
let wrapComp: import("@codemirror/state").Compartment | null = null;
let editorViewModule: typeof import("@codemirror/view") | null = null;

watch(
  [previewSettings, editCustomThemes, editActiveCustomThemeId, editWordWrap],
  async ([ss]) => {
    if (!previewView.value || !fontThemeComp || !themeComp || !wrapComp || !editorViewModule) return;

    const themeExt = await loadEditorTheme(ss.theme, ss.appAppearance, ss.customColors);
    previewView.value.dispatch({
      effects: [
        themeComp.reconfigure(themeExt),
        fontThemeComp.reconfigure(editorFontTheme(editorViewModule.EditorView, ss.fontSize, ss.fontFamily)),
        wrapComp.reconfigure(editWordWrap.value ? editorViewModule.EditorView.lineWrapping : []),
      ],
    });
  },
  { deep: true },
);

let previewInitialized = false;

watch(activeSettingsTab, (tab) => {
  if (tab !== "editor" && previewView.value) {
    previewView.value.destroy();
    previewView.value = null;
    previewInitialized = false;
    fontThemeComp = null;
    themeComp = null;
    wrapComp = null;
    editorViewModule = null;
  }
});

watch(previewRef, async (el) => {
  if (!el || previewInitialized) return;
  previewInitialized = true;
  if (previewView.value) return;

  const [{ EditorView }, { EditorState, Compartment }, { sql, MySQL }, { basicSetup }] = await Promise.all([
    import("@codemirror/view"),
    import("@codemirror/state"),
    import("@codemirror/lang-sql"),
    import("codemirror"),
  ]);

  editorViewModule = { EditorView } as typeof import("@codemirror/view");
  fontThemeComp = new Compartment();
  themeComp = new Compartment();
  wrapComp = new Compartment();

  const ss = previewSettings.value;
  const themeExt = await loadEditorTheme(ss.theme, ss.appAppearance, ss.customColors);

  const state = EditorState.create({
    doc: previewSql,
    extensions: [
      basicSetup,
      sql({ dialect: MySQL }),
      themeComp.of(themeExt),
      fontThemeComp.of(editorFontTheme(EditorView, ss.fontSize, ss.fontFamily)),
      wrapComp.of(editWordWrap.value ? EditorView.lineWrapping : []),
    ],
  });

  previewView.value = new EditorView({ state, parent: previewRef.value });
});

watch(
  () => props.open,
  (open) => {
    if (!open && previewView.value) {
      previewView.value.destroy();
      previewView.value = null;
      previewInitialized = false;
      fontThemeComp = null;
      themeComp = null;
      wrapComp = null;
      editorViewModule = null;
    }
  },
);
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent
      class="ds-dialog sm:max-w-[1040px] h-[min(820px,calc(100vh-48px))] flex flex-col gap-0 overflow-hidden p-0"
      :show-close-button="false"
    >
      <!-- DESIGN-SYSTEM dialog shell: edge-to-edge title bar, hairline seam below -->
      <header class="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--ds-border)] px-4">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
        >
          <Settings class="h-4 w-4" />
        </div>
        <DialogTitle class="text-[15px] font-semibold tracking-[-0.012em] text-[var(--ds-text-1)]">
          {{ t("settings.title") }}
        </DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto">
            <X />
            <span class="sr-only">{{ t("common.close") }}</span>
          </Button>
        </DialogClose>
      </header>

      <div class="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
        <nav
          class="flex min-h-0 shrink-0 gap-1 overflow-x-auto border-b border-[var(--ds-border)] bg-[var(--ds-bg-canvas)] p-3 sm:w-56 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:border-b-0 sm:border-r"
        >
          <button
            v-for="category in settingsCategoryNav"
            :key="category.value"
            type="button"
            :class="settingsCategoryButton(category.value)"
            @click="activeSettingsTab = category.value"
          >
            <component
              :is="category.icon"
              class="h-4 w-4 shrink-0"
              :class="category.value === activeSettingsTab ? 'text-[var(--ds-accent)]' : 'text-[var(--ds-text-3)]'"
            />
            <span class="truncate">{{ category.label }}</span>
          </button>
        </nav>

        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header class="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
            <div class="min-w-0 space-y-1">
              <h2 class="text-[18px] font-semibold tracking-[-0.018em] text-[var(--ds-text-1)]">
                {{ activeCategoryMeta.label }}
              </h2>
              <p class="text-[12.5px] leading-relaxed text-[var(--ds-text-3)]">
                {{ t(activeCategoryMeta.subtitleKey) }}
              </p>
            </div>
            <Button
              v-if="activeSettingsTab === 'formatter'"
              type="button"
              variant="secondary"
              size="sm"
              class="shrink-0"
              :disabled="isSqlFormatterAtDefaults"
              @click="restoreSqlFormatterDefaults"
            >
              <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
              {{ t("settings.sqlFormatterRestoreDefaults") }}
            </Button>
            <Button
              v-if="activeSettingsTab === 'snippets'"
              type="button"
              size="sm"
              class="shrink-0"
              @click="openAddSnippetDialog"
            >
              <Plus class="mr-1.5 h-3.5 w-3.5" />
              {{ t("settings.snippetsAdd") }}
            </Button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-6">
            <section v-if="activeSettingsTab === 'editor'" class="flex flex-col gap-5 py-2">
              <div class="grid gap-4 md:grid-cols-[2fr_1fr]">
                <!-- Font Family -->
                <div class="min-w-0 space-y-2">
                  <div :class="dsSectionLabel">
                    <Type class="h-3.5 w-3.5" />
                    {{ t("settings.fontFamily") }}
                  </div>
                  <SearchableSelect
                    :model-value="editFontFamily"
                    :options="systemFontOptions"
                    :placeholder="t('settings.selectFont')"
                    :search-placeholder="t('settings.searchFont')"
                    :empty-text="t('settings.noFontsFound')"
                    :loading-text="t('settings.loadingFonts')"
                    :loading="systemFontsLoading"
                    allow-custom
                    :display-name="displayFontFamily"
                    :normalize-custom="normalizeCustomFontFamilyInput"
                    trigger-class="h-8 w-full max-w-none justify-between rounded-sm border border-[var(--ds-border)] bg-[var(--ds-bg-input)] py-2 pr-2 pl-2.5 text-[12.5px] font-medium hover:bg-[var(--ds-bg-hover)] hover:border-[var(--ds-border-strong)]"
                    content-class="w-[var(--reka-popover-trigger-width)] min-w-[260px]"
                    @update:model-value="onFontFamilyChange"
                    @update:open="(open: boolean) => open && loadSystemFontOptions()"
                  >
                    <template #trigger-label="{ label, loading }">
                      <span class="truncate" :style="{ fontFamily: editFontFamily }">
                        {{ loading ? t("settings.loadingFonts") : label }}
                      </span>
                    </template>
                    <template #option-label="{ option, label }">
                      <span class="truncate" :style="{ fontFamily: option }">{{ label }}</span>
                    </template>
                    <template #custom-option-label="{ value }">
                      <span class="truncate" :style="{ fontFamily: value }">
                        {{ t("settings.useCustomFont", { font: readableFontFamily(value) }) }}
                      </span>
                    </template>
                  </SearchableSelect>
                </div>

                <!-- Theme + Custom Theme Button -->
                <div class="min-w-0 space-y-2">
                  <div :class="dsSectionLabel">
                    <Palette class="h-3.5 w-3.5" />
                    {{ t("settings.theme") }}
                  </div>
                  <Select :model-value="themeSelectValue" @update:model-value="onThemeChange">
                    <SelectTrigger
                      class="w-full data-[state=open]:ring-2 data-[state=open]:ring-[var(--ds-accent-line)]"
                    >
                      <SelectValue :placeholder="t('settings.selectTheme')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="theme in themeSelectOptions" :key="theme.value" :value="theme.value">
                        <div class="flex items-center gap-2">
                          <span
                            class="h-3 w-3 rounded-full border"
                            :class="
                              theme.dark
                                ? 'bg-[var(--ds-text-1)] border-[var(--ds-border-strong)]'
                                : 'bg-[var(--ds-text-4)] border-[var(--ds-border-strong)]'
                            "
                          />
                          {{ theme.label }}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    v-if="editTheme === 'custom'"
                    variant="outline"
                    size="sm"
                    class="w-full"
                    @click="showThemeCustomizer = true"
                  >
                    <Settings class="mr-2 h-4 w-4" />
                    {{ t("settings.customThemeConfigure") }}
                  </Button>
                </div>
              </div>

              <!-- Font Size -->
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <div :class="dsSectionLabel">{{ t("settings.fontSize") }}</div>
                  <span
                    class="rounded-md border border-[var(--ds-border)] px-2 py-0.5 font-mono text-[12px] tabular-nums text-[var(--ds-text-1)]"
                    >{{ editFontSize }}px</span
                  >
                </div>
                <input
                  type="range"
                  :min="FONT_SIZE_MIN"
                  :max="FONT_SIZE_MAX"
                  step="1"
                  :value="editFontSize"
                  :style="{ '--range-fill': `${fontSizeFillPercent}%` }"
                  @input="editFontSize = Number(($event.target as HTMLInputElement).value)"
                  class="ds-range"
                />
                <div class="flex items-center justify-between font-mono text-[11px] text-[var(--ds-text-4)]">
                  <span>{{ FONT_SIZE_MIN }}px</span>
                  <span>{{ FONT_SIZE_MAX }}px</span>
                </div>
              </div>

              <!-- Live Preview -->
              <div class="space-y-2">
                <div :class="dsSectionLabel">
                  <Eye class="h-3.5 w-3.5" />
                  {{ t("settings.preview") }}
                </div>
                <div
                  class="overflow-hidden rounded-md border"
                  :class="
                    editTheme === 'vscode-light' || editTheme === 'duotone-light' || editTheme === 'xcode'
                      ? 'border-[var(--ds-border-strong)]'
                      : 'border-[var(--ds-border)]'
                  "
                >
                  <div
                    class="flex items-center justify-between gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-bg-hover)] px-3 py-2"
                  >
                    <div class="flex items-center gap-2 text-[var(--ds-text-3)]">
                      <SquareChevronRight class="h-3.5 w-3.5 shrink-0" />
                      <span class="font-mono text-[12px]">query.sql</span>
                    </div>
                    <span class="truncate font-mono text-[11px] text-[var(--ds-text-4)]">
                      {{ displayFontFamily(editFontFamily) }} · {{ editFontSize }}px
                    </span>
                  </div>
                  <div class="max-w-full overflow-auto">
                    <div ref="previewRef" style="min-width: 100%" />
                  </div>
                </div>
              </div>

              <Separator />

              <!-- Editor behavior: Execute mode + Word wrap + Confirm in one grouped card -->
              <div :class="dsSettingGroup">
                <!-- Execute mode (select on the right) -->
                <div class="flex items-center justify-between gap-4 px-4 py-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <Play class="h-3.5 w-3.5 shrink-0 fill-current text-[var(--ds-text-2)]" />
                      <span class="text-[14px] font-semibold text-[var(--ds-text-1)]">{{
                        t("settings.executeMode")
                      }}</span>
                      <span class="ds-kbd">⌘↵</span>
                    </div>
                    <p :class="[dsSettingDesc, 'mt-1']">{{ t("settings.executeModeDescription") }}</p>
                  </div>
                  <Select :model-value="editExecuteMode" @update:model-value="onExecuteModeChange">
                    <SelectTrigger class="w-[280px] max-w-[50%] shrink-0">
                      <SelectValue :placeholder="t('settings.executeMode')" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{{ t("settings.executeModeAll") }}</SelectItem>
                      <SelectItem value="current">{{ t("settings.executeModeCurrent") }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <!-- Word wrap -->
                <div class="flex items-center justify-between gap-4 px-4 py-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <WrapText class="h-4 w-4 shrink-0 text-[var(--ds-text-2)]" />
                      <Label for="editor-word-wrap" class="text-[14px] font-semibold text-[var(--ds-text-1)]">{{
                        t("settings.wordWrap")
                      }}</Label>
                    </div>
                    <p :class="[dsSettingDesc, 'mt-1']">{{ t("settings.wordWrapDescription") }}</p>
                  </div>
                  <Switch id="editor-word-wrap" v-model="editWordWrap" class="shrink-0" />
                </div>

                <!-- Confirm before dangerous SQL -->
                <div class="flex items-center justify-between gap-4 px-4 py-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <Shield class="h-4 w-4 shrink-0 text-[var(--ds-text-2)]" />
                      <Label
                        for="editor-confirm-dangerous-sql"
                        class="text-[14px] font-semibold text-[var(--ds-text-1)]"
                      >
                        {{ t("settings.confirmDangerousSqlExecution") }}
                      </Label>
                    </div>
                    <p class="mt-1 text-[11.5px] leading-relaxed text-[var(--ds-text-3)]">
                      {{ t("settings.confirmDangerousSqlLead") }}
                      <span class="font-mono font-medium text-[var(--ds-red)]">ALTER</span>
                      <span class="text-[var(--ds-text-4)]">·</span>
                      <span class="font-mono font-medium text-[var(--ds-red)]">DROP</span>
                      <span class="text-[var(--ds-text-4)]">·</span>
                      <span class="font-mono font-medium text-[var(--ds-red)]">DELETE</span>
                      <span class="text-[var(--ds-text-4)]">·</span>
                      <span class="font-mono font-medium text-[var(--ds-red)]">TRUNCATE</span>
                      {{ t("settings.confirmDangerousSqlTrail") }}
                    </p>
                  </div>
                  <Switch
                    id="editor-confirm-dangerous-sql"
                    v-model="editConfirmDangerousSqlExecution"
                    class="shrink-0"
                  />
                </div>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'formatter'" class="flex flex-col gap-5 py-2">
              <SqlFormatterSettingsPanel v-model="editSqlFormatter" />
            </section>

            <section v-else-if="activeSettingsTab === 'appearance'" class="flex flex-col gap-6 py-2">
              <div class="grid gap-4 md:grid-cols-2">
                <div class="min-w-0 space-y-2">
                  <div :class="dsSectionLabel">
                    <Languages class="h-3.5 w-3.5" />
                    {{ t("settings.languageTitle") }}
                  </div>
                  <Select :model-value="currentLocale()" @update:model-value="onLocaleChange">
                    <SelectTrigger class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="locale in LOCALE_OPTIONS" :key="locale.value" :value="locale.value">
                        <div class="flex items-center gap-2">
                          <span
                            class="inline-flex h-5 w-6 shrink-0 items-center justify-center text-sm font-medium leading-none"
                          >
                            {{ locale.flag }}
                          </span>
                          <span>{{ locale.label }}</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="min-w-0 space-y-2">
                  <div :class="dsSectionLabel">
                    <Eye class="h-3.5 w-3.5" />
                    {{ t("settings.uiScale") }}
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span
                          class="inline-flex shrink-0 cursor-help text-[var(--ds-text-4)] hover:text-[var(--ds-text-1)]"
                        >
                          <Info class="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" :side-offset="8">
                        {{ t("settings.uiScaleDescription") }}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    :model-value="String(editUiScale)"
                    @update:model-value="
                      (value: any) => {
                        const next = Number(value);
                        if (Number.isFinite(next)) editUiScale = next;
                      }
                    "
                  >
                    <SelectTrigger class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="scale in uiScaleOptions" :key="scale" :value="String(scale)">
                        {{ Math.round(scale * 100) }}%
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div class="space-y-2">
                <div :class="dsSectionLabel">
                  <Settings class="h-3.5 w-3.5" />
                  {{ t("settings.systemSection") }}
                </div>
                <div :class="dsSettingGroup">
                  <div v-if="!isWeb" :class="dsSettingRow">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Menu class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label for="show-tray-icon" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                          {{ t("settings.showTrayIcon") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">{{ t("settings.showTrayIconDescription") }}</p>
                    </div>
                    <Switch id="show-tray-icon" v-model="editShowTrayIcon" class="shrink-0" />
                  </div>
                  <div :class="dsSettingRow">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <RefreshCw class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label
                          for="update-notifications-enabled"
                          class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                        >
                          {{ t("settings.updateNotificationsEnabled") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">
                        {{ t("settings.updateNotificationsEnabledDescription") }}
                      </p>
                    </div>
                    <Switch
                      id="update-notifications-enabled"
                      v-model="editUpdateNotificationsEnabled"
                      class="shrink-0"
                    />
                  </div>
                  <div v-if="!isWeb" class="flex flex-col gap-2.5 px-3.5 py-3">
                    <div class="flex items-center justify-between gap-4">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <Activity class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                          <Label for="debug-logging-enabled" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                            {{ t("settings.debugLoggingEnabled") }}
                          </Label>
                        </div>
                        <p :class="[dsSettingDesc, 'mt-1']">
                          {{ t("settings.debugLoggingEnabledDescription") }}
                        </p>
                      </div>
                      <Switch id="debug-logging-enabled" v-model="editDebugLoggingEnabled" class="shrink-0" />
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" @click="clearDebugLogs">
                        <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
                        {{ t("settings.debugLogsClear") }}
                      </Button>
                      <Button type="button" variant="outline" size="sm" @click="copyDebugLogs">
                        <Copy class="mr-1.5 h-3.5 w-3.5" />
                        {{ debugLogCopied ? t("settings.debugLogsCopied") : t("settings.debugLogsCopy") }}
                      </Button>
                      <Button type="button" variant="outline" size="sm" @click="exportDebugLogs">
                        <Download class="mr-1.5 h-3.5 w-3.5" />
                        {{ debugLogDownloaded ? t("settings.debugLogsDownloaded") : t("settings.debugLogsDownload") }}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="space-y-2">
                <div :class="dsSectionLabel">
                  <LayoutGrid class="h-3.5 w-3.5" />
                  {{ t("settings.dataGridDisplay") }}
                </div>
                <div :class="dsSettingGroup">
                  <div :class="dsSettingRow">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Type class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label
                          for="show-column-comments-in-header"
                          class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                        >
                          {{ t("settings.showColumnCommentsInHeader") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">
                        {{ t("settings.showColumnCommentsInHeaderDescription") }}
                      </p>
                    </div>
                    <Switch
                      id="show-column-comments-in-header"
                      v-model="editShowColumnCommentsInHeader"
                      class="shrink-0"
                    />
                  </div>
                  <div :class="dsSettingRow">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Hash class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label
                          for="show-column-types-in-header"
                          class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                        >
                          {{ t("settings.showColumnTypesInHeader") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">
                        {{ t("settings.showColumnTypesInHeaderDescription") }}
                      </p>
                    </div>
                    <Switch id="show-column-types-in-header" v-model="editShowColumnTypesInHeader" class="shrink-0" />
                  </div>
                  <div :class="dsSettingRow">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <AlignLeft class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label
                          for="compact-column-header-actions"
                          class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                        >
                          {{ t("settings.compactColumnHeaderActions") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">
                        {{ t("settings.compactColumnHeaderActionsDescription") }}
                      </p>
                    </div>
                    <Switch
                      id="compact-column-header-actions"
                      v-model="editCompactColumnHeaderActions"
                      class="shrink-0"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'navigation'" class="flex flex-col gap-6 py-2">
              <div class="space-y-2">
                <div :class="dsSectionLabel">{{ t("settings.sidebarActivation") }}</div>
                <div class="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    class="h-auto items-start justify-start border border-[var(--ds-border)] p-4"
                    :class="
                      editSidebarActivation === 'single'
                        ? 'border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)]'
                        : ''
                    "
                    @click="setSidebarActivation('single')"
                  >
                    <div class="flex w-full items-start justify-between gap-3 text-left">
                      <div class="min-w-0 space-y-1">
                        <div class="text-sm font-semibold">{{ t("settings.sidebarActivationSingle") }}</div>
                        <div class="whitespace-normal text-xs leading-relaxed text-[var(--ds-text-3)]">
                          {{ t("settings.sidebarActivationSingleDescription") }}
                        </div>
                      </div>
                      <Check
                        v-if="editSidebarActivation === 'single'"
                        class="h-4 w-4 shrink-0 text-[var(--ds-accent)]"
                      />
                    </div>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    class="h-auto items-start justify-start border border-[var(--ds-border)] p-4"
                    :class="
                      editSidebarActivation === 'double'
                        ? 'border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)]'
                        : ''
                    "
                    @click="setSidebarActivation('double')"
                  >
                    <div class="flex w-full items-start justify-between gap-3 text-left">
                      <div class="min-w-0 space-y-1">
                        <div class="text-sm font-semibold">{{ t("settings.sidebarActivationDouble") }}</div>
                        <div class="whitespace-normal text-xs leading-relaxed text-[var(--ds-text-3)]">
                          {{ t("settings.sidebarActivationDoubleDescription") }}
                        </div>
                      </div>
                      <Check
                        v-if="editSidebarActivation === 'double'"
                        class="h-4 w-4 shrink-0 text-[var(--ds-accent)]"
                      />
                    </div>
                  </Button>
                </div>
              </div>

              <div class="space-y-2">
                <div :class="dsSectionLabel">{{ t("settings.sidebarObjectDisplay") }}</div>
                <div class="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    class="h-auto items-start justify-start border border-[var(--ds-border)] p-4"
                    :class="
                      editSidebarObjectDisplay === 'grouped'
                        ? 'border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)]'
                        : ''
                    "
                    @click="setSidebarObjectDisplay('grouped')"
                  >
                    <div class="flex w-full items-start justify-between gap-3 text-left">
                      <div class="min-w-0 space-y-1">
                        <div class="text-sm font-semibold">{{ t("settings.sidebarObjectDisplayGrouped") }}</div>
                        <div class="whitespace-normal text-xs leading-relaxed text-[var(--ds-text-3)]">
                          {{ t("settings.sidebarObjectDisplayGroupedDescription") }}
                        </div>
                      </div>
                      <Check
                        v-if="editSidebarObjectDisplay === 'grouped'"
                        class="h-4 w-4 shrink-0 text-[var(--ds-accent)]"
                      />
                    </div>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    class="h-auto items-start justify-start border border-[var(--ds-border)] p-4"
                    :class="
                      editSidebarObjectDisplay === 'simple'
                        ? 'border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)]'
                        : ''
                    "
                    @click="setSidebarObjectDisplay('simple')"
                  >
                    <div class="flex w-full items-start justify-between gap-3 text-left">
                      <div class="min-w-0 space-y-1">
                        <div class="text-sm font-semibold">{{ t("settings.sidebarObjectDisplaySimple") }}</div>
                        <div class="whitespace-normal text-xs leading-relaxed text-[var(--ds-text-3)]">
                          {{ t("settings.sidebarObjectDisplaySimpleDescription") }}
                        </div>
                      </div>
                      <Check
                        v-if="editSidebarObjectDisplay === 'simple'"
                        class="h-4 w-4 shrink-0 text-[var(--ds-accent)]"
                      />
                    </div>
                  </Button>
                </div>
              </div>

              <Separator />

              <div class="flex items-center justify-between gap-6">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <Label for="disconnect-tab-handling-mode" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                      {{ t("settings.disconnectTabHandlingMode") }}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <CircleHelp
                          class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                        />
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                        {{ t("settings.disconnectTabHandlingModeDescription") }}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p :class="[dsSettingDesc, 'mt-1']">
                    {{ t(`settings.${disconnectTabHandlingModeDescriptionKey}`) }}
                  </p>
                </div>
                <Select
                  :model-value="editDisconnectTabHandlingMode"
                  @update:model-value="onDisconnectTabHandlingModeChange"
                >
                  <SelectTrigger id="disconnect-tab-handling-mode" class="w-64 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="close-tabs">{{ t("settings.disconnectTabHandlingModeCloseTabs") }}</SelectItem>
                    <SelectItem value="keep-tabs-clear-results">
                      {{ t("settings.disconnectTabHandlingModeKeepTabsClearResults") }}
                    </SelectItem>
                    <SelectItem value="keep-tabs-keep-results">
                      {{ t("settings.disconnectTabHandlingModeKeepTabsKeepResults") }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div class="space-y-2">
                <div :class="dsSectionLabel">
                  <Zap class="h-3.5 w-3.5" />
                  {{ t("settings.behaviorSection") }}
                </div>
                <div :class="dsSettingGroup">
                  <div :class="dsSettingRow">
                    <div class="flex min-w-0 items-center gap-2">
                      <Label for="reuse-data-tab" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                        {{ t("settings.reuseDataTab") }}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <CircleHelp
                            class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                          />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                          {{ t("settings.reuseDataTabDescription") }}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch id="reuse-data-tab" v-model="editReuseDataTab" class="shrink-0" />
                  </div>
                  <div :class="dsSettingRow">
                    <div class="flex min-w-0 items-center gap-2">
                      <Label
                        for="auto-select-active-sidebar-node"
                        class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                      >
                        {{ t("settings.autoSelectActiveSidebarNode") }}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <CircleHelp
                            class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                          />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                          {{ t("settings.autoSelectActiveSidebarNodeDescription") }}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch
                      id="auto-select-active-sidebar-node"
                      v-model="editAutoSelectActiveSidebarNode"
                      class="shrink-0"
                    />
                  </div>
                  <div :class="dsSettingRow">
                    <div class="flex min-w-0 items-center gap-2">
                      <Label
                        for="sidebar-hide-table-comments"
                        class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                      >
                        {{ t("settings.sidebarHideTableComments") }}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <CircleHelp
                            class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                          />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                          {{ t("settings.sidebarHideTableCommentsDescription") }}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch id="sidebar-hide-table-comments" v-model="editSidebarHideTableComments" class="shrink-0" />
                  </div>
                  <div :class="dsSettingRow">
                    <div class="flex min-w-0 items-center gap-2">
                      <Label
                        for="sidebar-allow-horizontal-scroll"
                        class="text-[13px] font-semibold text-[var(--ds-text-1)]"
                      >
                        {{ t("settings.sidebarAllowHorizontalScroll") }}
                      </Label>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <CircleHelp
                            class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                          />
                        </TooltipTrigger>
                        <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                          {{ t("settings.sidebarAllowHorizontalScrollDescription") }}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch
                      id="sidebar-allow-horizontal-scroll"
                      v-model="editSidebarAllowHorizontalScroll"
                      class="shrink-0"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div class="space-y-2">
                <Label for="sidebar-hidden-table-prefixes" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                  {{ t("settings.sidebarHiddenTablePrefixes") }}
                </Label>
                <p :class="dsSettingDesc">
                  {{ t("settings.sidebarHiddenTablePrefixesDescription") }}
                </p>
                <textarea
                  id="sidebar-hidden-table-prefixes"
                  v-model="editSidebarHiddenTablePrefixes"
                  class="min-h-24 w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-3 py-2 text-sm text-[var(--ds-text-1)] outline-none transition-colors placeholder:text-[var(--ds-text-3)] focus-visible:border-[var(--ds-accent-line)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ds-accent-line)]"
                  :placeholder="t('settings.sidebarHiddenTablePrefixesPlaceholder')"
                />
              </div>
            </section>

            <!-- Data Tab -->
            <section v-else-if="activeSettingsTab === 'data'" class="flex flex-col gap-6 py-2">
              <div class="space-y-2">
                <div :class="dsSectionLabel">
                  <Download class="h-3.5 w-3.5" />
                  {{ t("settings.exportSection") }}
                </div>
                <div :class="dsSettingGroup">
                  <div class="flex items-center justify-between gap-6 px-3.5 py-3.5">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Rows3 class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label for="export-batch-size" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                          {{ t("settings.exportBatchSize") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">
                        {{ t("settings.exportBatchSizeDescription") }}
                        <span class="font-mono text-[var(--ds-text-4)]">100–100000</span>
                      </p>
                    </div>
                    <div
                      class="flex h-9 shrink-0 items-stretch overflow-hidden rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] transition-colors focus-within:border-[var(--ds-accent-line)] focus-within:ring-2 focus-within:ring-inset focus-within:ring-[var(--ds-accent-line)]"
                    >
                      <input
                        id="export-batch-size"
                        type="number"
                        list="export-batch-sizes"
                        :min="EXPORT_BATCH_SIZE_MIN"
                        :max="EXPORT_BATCH_SIZE_MAX"
                        step="100"
                        v-model.number="editExportBatchSize"
                        class="w-24 bg-transparent px-3 font-mono text-sm text-[var(--ds-text-1)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <div class="flex flex-col border-l border-[var(--ds-border)]">
                        <button
                          type="button"
                          tabindex="-1"
                          :aria-label="t('settings.exportBatchSize')"
                          class="flex flex-1 items-center justify-center px-1.5 text-[var(--ds-text-3)] transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
                          @click="stepExportBatchSize(100)"
                        >
                          <ChevronUp class="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          tabindex="-1"
                          :aria-label="t('settings.exportBatchSize')"
                          class="flex flex-1 items-center justify-center border-t border-[var(--ds-border)] px-1.5 text-[var(--ds-text-3)] transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
                          @click="stepExportBatchSize(-100)"
                        >
                          <ChevronDown class="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <datalist id="export-batch-sizes">
                      <option value="500" />
                      <option value="1000" />
                      <option value="2000" />
                      <option value="5000" />
                      <option value="10000" />
                    </datalist>
                  </div>
                </div>
              </div>

              <div class="space-y-2">
                <div :class="dsSectionLabel">
                  <Server class="h-3.5 w-3.5" />
                  {{ t("settings.redisTab") }}
                </div>
                <div :class="dsSettingGroup">
                  <div class="flex items-center justify-between gap-6 px-3.5 py-3.5">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Hash class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-2)]" />
                        <Label for="redis-scan-page-size" class="text-[13px] font-semibold text-[var(--ds-text-1)]">
                          {{ t("settings.redisScanPageSize") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">{{ t("settings.redisScanPageSizeDescription") }}</p>
                    </div>
                    <Select
                      :model-value="String(editRedisScanPageSize)"
                      @update:model-value="onRedisScanPageSizeChange"
                    >
                      <SelectTrigger id="redis-scan-page-size" class="w-40 shrink-0">
                        <SelectValue :placeholder="t('settings.redisScanPageSize')" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="size in redisScanPageSizeOptions" :key="size" :value="String(size)">
                          {{ t("settings.redisScanPageSizeOption", { count: size }) }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'shortcuts'" class="flex flex-col gap-4 py-2">
              <!-- Search -->
              <div class="relative">
                <Search
                  class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--ds-text-3)]"
                />
                <input
                  v-model="shortcutSearch"
                  type="text"
                  :placeholder="t('settings.shortcutSearchPlaceholder')"
                  class="h-9 w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] pr-3 pl-9 text-[13px] text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)] focus-visible:border-[var(--ds-accent-line)] focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                />
              </div>

              <!-- Grouped shortcut lists -->
              <div v-for="group in filteredShortcutGroups" :key="group.scope" class="flex flex-col gap-2">
                <span class="ds-section-label px-0.5">
                  <component :is="group.icon" class="h-3.5 w-3.5" />
                  {{ t(group.labelKey) }}
                </span>

                <div class="overflow-hidden rounded-md border border-[var(--ds-border)] bg-transparent">
                  <div
                    v-for="definition in group.items"
                    :key="definition.id"
                    class="group -mt-px border-t border-[var(--ds-border)] px-3 py-2.5 transition-colors first:mt-0 first:border-t-0 hover:bg-[var(--ds-bg-hover)]"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <Label class="min-w-0 truncate leading-none text-[var(--ds-text-1)]">
                        {{ t(definition.labelKey) }}
                      </Label>

                      <!-- Capturing a new shortcut -->
                      <div v-if="editingShortcutId === definition.id" class="flex shrink-0 items-center gap-1.5">
                        <input
                          :data-shortcut-input="definition.id"
                          value=""
                          :style="{ width: shortcutPressShortcutInputWidth }"
                          readonly
                          :placeholder="t('settings.shortcutPressShortcut')"
                          class="h-7 max-w-44 cursor-text rounded-md border border-[var(--ds-border-strong)] bg-[var(--ds-bg-input)] px-2.5 text-left font-mono text-[13px] text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)] focus-visible:border-[var(--ds-accent-line)] focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                          @keydown="(event: KeyboardEvent) => onShortcutKeydown(definition.id, event)"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          class="h-7 shrink-0 px-2 text-sm font-medium text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                          @click="cancelShortcutEdit"
                        >
                          {{ t("settings.cancel") }}
                        </Button>
                      </div>

                      <!-- Resting state: hover actions + keycaps -->
                      <div v-else class="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          class="h-7 w-7 shrink-0 text-[var(--ds-text-3)] opacity-0 transition-opacity hover:text-[var(--ds-text-1)] focus-visible:opacity-100 group-hover:opacity-100"
                          :aria-label="t('settings.shortcutPressShortcut')"
                          @click="focusShortcutInput(definition.id)"
                        >
                          <Pencil class="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          class="h-7 w-7 shrink-0 text-[var(--ds-text-3)] opacity-0 transition-opacity hover:text-[var(--ds-text-1)] focus-visible:opacity-100 group-hover:opacity-100"
                          :aria-label="t('settings.reset')"
                          @click="resetShortcut(definition.id)"
                        >
                          <RotateCcw class="h-4 w-4" />
                        </Button>
                        <div class="flex items-center gap-1">
                          <kbd
                            v-for="(token, index) in shortcutKeyTokens(editShortcuts[definition.id])"
                            :key="index"
                            class="ds-kbd inline-flex h-6 min-w-6 items-center justify-center text-center"
                            :class="
                              shortcutConflicts.includes(definition.id)
                                ? 'border-[color-mix(in_srgb,var(--ds-red)_60%,transparent)] text-[var(--ds-red)]'
                                : ''
                            "
                          >
                            {{ token }}
                          </kbd>
                        </div>
                      </div>
                    </div>

                    <p
                      v-if="shortcutConflicts.includes(definition.id)"
                      class="mt-1 text-right text-xs text-[var(--ds-red)]"
                    >
                      {{ t("settings.shortcutConflict") }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Empty state -->
              <div
                v-if="!hasShortcutResults"
                class="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-[var(--ds-border)] py-10 text-center"
              >
                <Search class="h-5 w-5 text-[var(--ds-text-3)]" />
                <p class="text-sm text-[var(--ds-text-3)]">{{ t("settings.shortcutNoResults") }}</p>
              </div>
            </section>

            <!-- Snippets Tab -->
            <section v-else-if="activeSettingsTab === 'snippets'" class="flex flex-col gap-4 py-2">
              <!-- Search + count -->
              <div class="flex items-center gap-3">
                <div class="relative flex-1">
                  <Search
                    class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--ds-text-3)]"
                  />
                  <input
                    v-model="snippetSearch"
                    type="text"
                    :placeholder="t('settings.snippetsSearchPlaceholder')"
                    class="h-9 w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] pr-3 pl-9 text-[13px] text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)] focus-visible:border-[var(--ds-accent-line)] focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                  />
                </div>
                <span class="shrink-0 text-[12px] text-[var(--ds-text-3)]">
                  {{ t("settings.snippetsCount", { count: filteredSnippets.length }) }}
                </span>
              </div>

              <div class="overflow-hidden rounded-md border border-[var(--ds-border)]">
                <table class="w-full table-fixed text-sm">
                  <colgroup>
                    <col class="w-[42%]" />
                    <col class="w-[88px]" />
                    <col />
                    <col class="w-[72px]" />
                  </colgroup>
                  <thead>
                    <tr class="border-b border-[var(--ds-border)] bg-[var(--ds-bg-hover)]">
                      <th
                        class="px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-[var(--ds-text-3)] uppercase"
                      >
                        {{ t("settings.snippetsLabel") }}
                      </th>
                      <th
                        class="px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-[var(--ds-text-3)] uppercase"
                      >
                        {{ t("settings.snippetsPrefix") }}
                      </th>
                      <th
                        class="px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-[var(--ds-text-3)] uppercase"
                      >
                        {{ t("settings.snippetsBody") }}
                      </th>
                      <th class="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="snippet in filteredSnippets"
                      :key="snippet.id"
                      class="group border-b border-[var(--ds-border-soft)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] last:border-b-0 hover:bg-[var(--ds-bg-hover)]"
                    >
                      <td class="truncate px-3 py-2.5 text-[var(--ds-text-1)]">{{ snippet.label }}</td>
                      <td class="px-3 py-2.5">
                        <kbd class="ds-kbd inline-flex h-5 items-center px-1.5">{{ snippet.prefix }}</kbd>
                      </td>
                      <td class="px-3 py-2.5 font-mono text-xs text-[var(--ds-text-3)]">
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <span class="block truncate">{{ snippet.body }}</span>
                          </TooltipTrigger>
                          <TooltipContent
                            class="max-w-[420px] font-mono text-xs leading-relaxed"
                            side="top"
                            :side-offset="6"
                          >
                            <span class="whitespace-pre-wrap break-words">{{ snippet.body }}</span>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td class="px-3 py-2.5">
                        <div
                          class="flex items-center justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            class="text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                            :aria-label="t('settings.snippetsEditTitle')"
                            @click="openEditSnippetDialog(snippet)"
                          >
                            <Pencil class="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            class="text-[var(--ds-text-3)] hover:text-[var(--ds-red)]"
                            :aria-label="t('settings.snippetsDeleteTitle')"
                            @click="confirmDeleteSnippet(snippet)"
                          >
                            <Trash2 class="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <!-- Empty state -->
                <div
                  v-if="filteredSnippets.length === 0"
                  class="flex flex-col items-center justify-center gap-1 py-12 text-center"
                >
                  <Braces class="h-5 w-5 text-[var(--ds-text-3)]" />
                  <p class="text-sm text-[var(--ds-text-3)]">{{ t("settings.snippetsNoResults") }}</p>
                </div>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'sync'" class="flex flex-col gap-5 py-2">
              <div class="grid gap-4 md:grid-cols-2">
                <div class="space-y-2 md:col-span-2">
                  <Label for="webdav-endpoint">{{ t("settings.syncEndpoint") }}</Label>
                  <Input
                    id="webdav-endpoint"
                    v-model="webdavEndpoint"
                    autocomplete="off"
                    placeholder="https://example.com/remote.php/dav/files/user/"
                  />
                </div>
                <div class="space-y-2">
                  <Label for="webdav-username">{{ t("settings.syncUsername") }}</Label>
                  <Input id="webdav-username" v-model="webdavUsername" autocomplete="username" />
                </div>
                <div class="space-y-2">
                  <Label for="webdav-password">{{ t("settings.syncPassword") }}</Label>
                  <div class="relative">
                    <Input
                      id="webdav-password"
                      v-model="webdavPassword"
                      :type="webdavPasswordVisible ? 'text' : 'password'"
                      class="pr-10"
                      :placeholder="webdavHasSavedPassword ? '••••••••' : t('settings.syncPasswordPlaceholder')"
                      :disabled="webdavHasSavedPassword"
                      autocomplete="current-password"
                    />
                    <Button
                      v-if="webdavHasSavedPassword"
                      variant="ghost"
                      size="icon-xs"
                      class="absolute top-1/2 right-1.5 -translate-y-1/2 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                      :title="t('settings.syncClearSavedPassword')"
                      @click="
                        webdavRememberPassword = false;
                        forgetWebdavSavedPassword(currentWebDavAccountConfig());
                        webdavHasSavedPassword = false;
                        webdavPassword = '';
                      "
                    >
                      <X class="size-3.5" />
                    </Button>
                    <Button
                      v-else
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="absolute top-1/2 right-1.5 -translate-y-1/2 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                      :aria-label="
                        webdavPasswordVisible ? t('settings.syncHidePassword') : t('settings.syncShowPassword')
                      "
                      @click="webdavPasswordVisible = !webdavPasswordVisible"
                    >
                      <EyeOff v-if="webdavPasswordVisible" class="h-4 w-4" />
                      <Eye v-else class="h-4 w-4" />
                    </Button>
                  </div>
                  <label class="flex items-center gap-2 text-xs text-[var(--ds-text-3)]">
                    <input
                      v-model="webdavRememberPassword"
                      type="checkbox"
                      class="h-4 w-4 shrink-0 accent-[var(--ds-accent)]"
                    />
                    <span>
                      {{ t("settings.syncRememberWebDavPassword") }}
                      <span v-if="webdavHasSavedPassword">{{ t("settings.syncSavedPassword") }}</span>
                    </span>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Info class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]" />
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                        {{ t("settings.syncRememberWebDavPasswordDescription") }}
                      </TooltipContent>
                    </Tooltip>
                  </label>
                </div>
                <div class="space-y-2 md:col-span-2">
                  <div class="flex items-center gap-1.5">
                    <Label for="webdav-remote-path">{{ t("settings.syncRemotePath") }}</Label>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Info class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]" />
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                        {{ t("settings.syncRemotePathDescription") }}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input id="webdav-remote-path" v-model="webdavRemotePath" autocomplete="off" />
                </div>
              </div>

              <div :class="dsSettingGroup">
                <div class="flex items-start gap-2.5 px-4 py-3.5">
                  <Info class="mt-0.5 h-4 w-4 shrink-0 text-[var(--ds-text-3)]" />
                  <p :class="dsSettingDesc">{{ t("settings.syncSecretNotice") }}</p>
                </div>
                <div class="px-4 py-4">
                  <div class="flex items-center justify-between gap-4">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Shield class="h-4 w-4 shrink-0 text-[var(--ds-text-2)]" />
                        <Label for="webdav-sync-secrets" class="text-[14px] font-semibold text-[var(--ds-text-1)]">
                          {{ t("settings.syncSecrets") }}
                        </Label>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">{{ t("settings.syncSecretsDescription") }}</p>
                    </div>
                    <Switch id="webdav-sync-secrets" v-model="webdavSyncSecrets" class="shrink-0" />
                  </div>
                  <div v-if="webdavSyncSecrets" class="mt-4 space-y-2">
                    <Label for="webdav-secrets-passphrase">{{ t("settings.syncSecretsPassphrase") }}</Label>
                    <Input
                      id="webdav-secrets-passphrase"
                      v-model="webdavSecretsPassphrase"
                      type="password"
                      autocomplete="new-password"
                    />
                    <p :class="dsSettingDesc">{{ t("settings.syncSecretsPassphraseDescription") }}</p>
                  </div>
                </div>
              </div>
            </section>

            <!-- AI Settings Tab -->
            <section v-else-if="activeSettingsTab === 'ai'" class="flex flex-col gap-6 py-2">
              <!-- CONNECTION -->
              <div class="flex flex-col gap-4">
                <div :class="dsSectionLabel">
                  <Link2 class="h-3.5 w-3.5" />
                  {{ t("settings.aiSectionConnection") }}
                </div>

                <div class="space-y-2">
                  <Label>{{ t("ai.provider") }}</Label>
                  <Select :model-value="aiEditProvider" @update:model-value="(v: any) => aiSelectProvider(v)">
                    <SelectTrigger class="w-full">
                      <SelectValue>
                        <span class="flex items-center gap-2">
                          <AiProviderLogo
                            :provider="selectedAiProviderPreset.provider"
                            :label="selectedAiProviderPreset.label"
                            :icon-slug="selectedAiProviderPreset.iconSlug"
                          />
                          <span>{{ selectedAiProviderPreset.label }}</span>
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="provider in aiProviderOptions"
                        :key="provider.provider"
                        :value="provider.provider"
                      >
                        <span class="flex items-center gap-2">
                          <AiProviderLogo
                            :provider="provider.provider"
                            :label="provider.label"
                            :icon-slug="provider.iconSlug"
                          />
                          <span>{{ provider.label }}</span>
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div class="space-y-2">
                  <div class="flex items-center gap-1.5">
                    <Label>API key</Label>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Info class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]" />
                      </TooltipTrigger>
                      <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                        {{ t("ai.apiKeyHint") }}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div class="relative">
                    <Input
                      v-model="aiEditApiKey"
                      :type="aiApiKeyVisible ? 'text' : 'password'"
                      autocomplete="off"
                      class="pr-10"
                      :placeholder="aiRequiresApiKey ? '' : 'Optional'"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="absolute top-1/2 right-1.5 -translate-y-1/2 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                      :aria-label="aiApiKeyVisible ? t('ai.hideApiKey') : t('ai.showApiKey')"
                      @click="aiApiKeyVisible = !aiApiKeyVisible"
                    >
                      <EyeOff v-if="aiApiKeyVisible" class="h-4 w-4" />
                      <Eye v-else class="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div class="space-y-2">
                  <Label>Endpoint</Label>
                  <Input v-model="aiEditEndpoint" placeholder="https://api.openai.com/v1" autocomplete="off" />
                </div>

                <div class="space-y-2">
                  <Label>{{ t("ai.model") }}</Label>
                  <div class="flex min-w-0 items-center gap-2">
                    <Input v-model="aiEditModel" autocomplete="off" class="min-w-0 flex-1" />
                    <SearchableSelect
                      :model-value="aiEditModel"
                      :options="aiModelOptionIds"
                      :placeholder="t('ai.browseModels')"
                      :search-placeholder="t('ai.searchModels')"
                      :empty-text="aiModelEmptyText"
                      :loading-text="t('ai.loadingModels')"
                      :loading="aiModelLoading"
                      :display-name="displayAiModelName"
                      trigger-class="h-8 min-w-[104px] max-w-[150px] shrink-0 border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-2 text-sm shadow-none hover:bg-[var(--ds-bg-hover)] hover:border-[var(--ds-border-strong)]"
                      content-class="w-72"
                      @update:model-value="aiSelectModel"
                      @update:open="onAiModelListOpen"
                    >
                      <template #trigger-label="{ loading }">
                        <span class="truncate">{{ loading ? t("ai.loadingModels") : t("ai.browseModels") }}</span>
                      </template>
                      <template #option-label="{ option, label }">
                        <span class="flex min-w-0 flex-col">
                          <span class="truncate">{{ label }}</span>
                          <span v-if="label !== option" class="truncate text-[11px] text-[var(--ds-text-3)]">{{
                            option
                          }}</span>
                        </span>
                      </template>
                    </SearchableSelect>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      class="size-8 shrink-0"
                      :disabled="aiModelLoading || !aiModelListSupported"
                      :title="t('ai.refreshModels')"
                      :aria-label="t('ai.refreshModels')"
                      @click="aiRefreshModels"
                    >
                      <Loader2 v-if="aiModelLoading" class="h-3.5 w-3.5 animate-spin" />
                      <RefreshCw v-else class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p v-if="aiModelError" class="text-xs text-[var(--ds-red)]">{{ aiModelError }}</p>
                  <p v-else-if="!aiModelOptionIds.length" class="text-xs text-[var(--ds-text-3)]">
                    {{ aiModelListSupported ? t("ai.modelListHint") : t("ai.modelListUnsupported") }}
                  </p>
                </div>
              </div>

              <!-- REQUEST -->
              <div class="flex flex-col gap-4 border-t border-[var(--ds-border-soft)] pt-6">
                <div :class="dsSectionLabel">
                  <Zap class="h-3.5 w-3.5" />
                  {{ t("settings.aiSectionRequest") }}
                </div>

                <div v-if="aiSupportsApiStyle" class="space-y-2">
                  <Label>API</Label>
                  <div
                    class="grid grid-cols-2 gap-1 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-base)] p-1"
                  >
                    <button
                      type="button"
                      class="h-8 rounded-[5px] font-mono text-[13px] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
                      :class="
                        aiEditApiStyle === 'completions'
                          ? 'border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] font-medium text-[var(--ds-text-1)]'
                          : 'border border-transparent text-[var(--ds-text-3)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]'
                      "
                      @click="aiEditApiStyle = 'completions'"
                    >
                      /chat/completions
                    </button>
                    <button
                      type="button"
                      class="h-8 rounded-[5px] font-mono text-[13px] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
                      :class="
                        aiEditApiStyle === 'responses'
                          ? 'border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] font-medium text-[var(--ds-text-1)]'
                          : 'border border-transparent text-[var(--ds-text-3)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]'
                      "
                      @click="aiEditApiStyle = 'responses'"
                    >
                      /responses
                    </button>
                  </div>
                </div>

                <div :class="dsSettingGroup">
                  <div class="flex items-center justify-between gap-4 px-4 py-4">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <Sparkles class="h-4 w-4 shrink-0 text-[var(--ds-text-2)]" />
                        <Label class="text-[14px] font-semibold text-[var(--ds-text-1)]">
                          {{ t("ai.enableThinking") }}
                        </Label>
                        <Tooltip>
                          <TooltipTrigger as-child>
                            <Info
                              class="h-3.5 w-3.5 cursor-help text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                            />
                          </TooltipTrigger>
                          <TooltipContent class="max-w-[320px] text-xs leading-relaxed" side="top" align="start">
                            {{ t("ai.enableThinkingHint") }}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p :class="[dsSettingDesc, 'mt-1']">{{ t("ai.enableThinkingDescription") }}</p>
                    </div>
                    <Switch
                      v-model="aiEditEnableThinking"
                      class="shrink-0"
                      :disabled="!aiCompletionsMode || aiEditProvider === 'gemini'"
                    />
                  </div>
                </div>
              </div>

              <!-- NETWORK -->
              <div class="flex flex-col gap-4 border-t border-[var(--ds-border-soft)] pt-6">
                <div :class="dsSectionLabel">
                  <Cloud class="h-3.5 w-3.5" />
                  {{ t("settings.aiSectionNetwork") }}
                </div>

                <div :class="dsSettingGroup">
                  <div class="px-4 py-4">
                    <div class="flex items-center justify-between gap-4">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <Server class="h-4 w-4 shrink-0 text-[var(--ds-text-2)]" />
                          <Label class="text-[14px] font-semibold text-[var(--ds-text-1)]">
                            {{ t("ai.proxyEnable") }}
                          </Label>
                        </div>
                        <p :class="[dsSettingDesc, 'mt-1']">{{ t("ai.proxyDescription") }}</p>
                      </div>
                      <Switch v-model="aiEditProxyEnabled" class="shrink-0" />
                    </div>
                    <div v-if="aiEditProxyEnabled" class="mt-4 space-y-2">
                      <Label>{{ t("ai.proxyUrl") }}</Label>
                      <Input v-model="aiEditProxyUrl" autocomplete="off" placeholder="socks5://127.0.0.1:7890" />
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="shrink-0"
                    :disabled="
                      aiTesting ||
                      (aiRequiresApiKey && !aiEditApiKey?.trim()) ||
                      !aiEditEndpoint?.trim() ||
                      !aiEditModel?.trim()
                    "
                    @click="aiTestConn"
                  >
                    <Loader2 v-if="aiTesting" class="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    <Activity v-else class="mr-1.5 h-3.5 w-3.5" />
                    {{ t("connection.test") }}
                  </Button>
                  <span v-if="aiTestResult === 'success'" class="text-xs text-[var(--ds-green)]">
                    {{ t("connection.testSuccess") }}
                  </span>
                  <span
                    v-else-if="aiTestResult === 'error'"
                    class="max-w-[240px] truncate text-xs text-[var(--ds-red)]"
                    :title="aiTestError"
                  >
                    {{ aiTestError }}
                  </span>
                </div>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'mcp' && !isWeb" class="flex flex-col gap-5 py-2">
              <div
                class="flex items-center justify-between gap-4 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-hover)] px-3 py-2.5"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <PackageSearch class="h-4 w-4 shrink-0 text-[var(--ds-text-3)]" />
                  <span class="truncate text-sm font-medium text-[var(--ds-text-1)]">{{ t("settings.mcpTitle") }}</span>
                </div>
                <Badge
                  variant="outline"
                  class="shrink-0 rounded-md"
                  :class="
                    mcpStatusTone === 'ok'
                      ? 'border-[color-mix(in_srgb,var(--ds-green)_35%,transparent)] text-[var(--ds-green)]'
                      : mcpStatusTone === 'warning'
                        ? 'border-[color-mix(in_srgb,var(--ds-amber)_35%,transparent)] text-[var(--ds-amber)]'
                        : 'text-[var(--ds-text-3)]'
                  "
                >
                  <Loader2 v-if="mcpStatusLoading" class="mr-1 h-3 w-3 animate-spin" />
                  <CheckCircle2 v-else-if="mcpStatusTone === 'ok'" class="mr-1 h-3 w-3" />
                  <AlertTriangle v-else-if="mcpStatusTone === 'warning'" class="mr-1 h-3 w-3" />
                  {{ mcpStatusLabel }}
                </Badge>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class="rounded-md border border-[var(--ds-border)] p-3">
                  <div class="ds-menu-label">{{ t("settings.mcpCurrent") }}</div>
                  <div class="mt-2 font-mono text-sm text-[var(--ds-text-1)]">
                    {{ mcpStatus?.current_version ? `v${mcpStatus.current_version}` : t("settings.mcpVersionMissing") }}
                  </div>
                </div>
                <div class="rounded-md border border-[var(--ds-border)] p-3">
                  <div class="ds-menu-label">{{ t("settings.mcpLatest") }}</div>
                  <div class="mt-2 font-mono text-sm text-[var(--ds-text-1)]">
                    {{ mcpStatus?.latest_version ? `v${mcpStatus.latest_version}` : t("settings.mcpVersionUnknown") }}
                  </div>
                </div>
                <div class="rounded-md border border-[var(--ds-border)] p-3">
                  <div class="ds-menu-label">Node.js</div>
                  <div class="mt-2 font-mono text-sm text-[var(--ds-text-1)]">
                    {{ mcpStatus?.node_version || t("settings.mcpVersionUnknown") }}
                  </div>
                </div>
                <div class="rounded-md border border-[var(--ds-border)] p-3">
                  <div class="ds-menu-label">npm</div>
                  <div class="mt-2 font-mono text-sm text-[var(--ds-text-1)]">
                    {{ mcpStatus?.npm_available ? t("settings.mcpAvailable") : t("settings.mcpUnavailable") }}
                  </div>
                </div>
              </div>

              <div v-if="mcpStatus?.bin_path" class="space-y-2">
                <Label>{{ t("settings.mcpBinPath") }}</Label>
                <div
                  class="rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-hover)] px-3 py-2 font-mono text-xs text-[var(--ds-text-3)]"
                >
                  {{ mcpStatus.bin_path }}
                </div>
              </div>

              <div class="space-y-2">
                <Label>{{
                  mcpStatus?.installed ? t("settings.mcpUpdateCommand") : t("settings.mcpInstallCommand")
                }}</Label>
                <div class="flex min-w-0 items-center gap-2">
                  <div
                    class="min-w-0 flex-1 overflow-x-auto rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-3 py-2 font-mono text-xs whitespace-nowrap text-[var(--ds-text-1)]"
                  >
                    {{ mcpCommand }}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    :title="t('common.copy')"
                    @click="copyMcpText('install', mcpCommand)"
                  >
                    <CheckCircle2 v-if="mcpCopied === 'install'" class="h-4 w-4 text-[var(--ds-green)]" />
                    <Copy v-else class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div :class="dsSettingGroup">
                <div :class="dsSettingRow">
                  <div class="min-w-0 space-y-0.5">
                    <Label for="mcp-readonly-mode">{{ t("settings.mcpReadonlyMode") }}</Label>
                    <p :class="dsSettingDesc">{{ t("settings.mcpReadonlyModeDescription") }}</p>
                  </div>
                  <Switch id="mcp-readonly-mode" v-model="mcpReadonlyMode" class="shrink-0" />
                </div>
                <div :class="dsSettingRow">
                  <div class="min-w-0 space-y-0.5">
                    <Label for="mcp-allow-dangerous">{{ t("settings.mcpAllowDangerous") }}</Label>
                    <p :class="dsSettingDesc">{{ t("settings.mcpAllowDangerousDescription") }}</p>
                  </div>
                  <Switch
                    id="mcp-allow-dangerous"
                    v-model="mcpAllowDangerous"
                    :disabled="mcpReadonlyMode"
                    class="shrink-0"
                  />
                </div>
              </div>

              <div class="space-y-2">
                <Label>{{ t("settings.mcpConfig") }}</Label>
                <Tabs v-model="mcpConfigTab" class="space-y-3">
                  <TabsList>
                    <TabsTrigger value="claude">Claude Code</TabsTrigger>
                    <TabsTrigger value="codex">Codex</TabsTrigger>
                  </TabsList>

                  <TabsContent value="claude" class="m-0">
                    <div class="relative rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-3">
                      <pre
                        class="overflow-x-auto whitespace-pre text-xs leading-relaxed"
                      ><code>{{ mcpClaudeRecommendedConfig }}</code></pre>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        class="absolute right-2 top-2"
                        :title="t('common.copy')"
                        @click="copyMcpText('claude-config', mcpClaudeRecommendedConfig)"
                      >
                        <CheckCircle2 v-if="mcpCopied === 'claude-config'" class="h-3.5 w-3.5 text-[var(--ds-green)]" />
                        <Copy v-else class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="codex" class="m-0">
                    <div class="space-y-2">
                      <div
                        class="rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-hover)] px-3 py-2 text-xs text-[var(--ds-text-3)]"
                      >
                        {{ t("settings.mcpCodexConfigPath") }}
                      </div>
                      <div class="relative rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-3">
                        <pre
                          class="overflow-x-auto whitespace-pre text-xs leading-relaxed"
                        ><code>{{ mcpCodexRecommendedConfig }}</code></pre>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          class="absolute right-2 top-2"
                          :title="t('common.copy')"
                          @click="copyMcpText('codex-config', mcpCodexRecommendedConfig)"
                        >
                          <CheckCircle2
                            v-if="mcpCopied === 'codex-config'"
                            class="h-3.5 w-3.5 text-[var(--ds-green)]"
                          />
                          <Copy v-else class="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              <div
                v-if="mcpStatus?.error || mcpStatusError"
                class="rounded-md border border-[color-mix(in_srgb,var(--ds-amber)_30%,transparent)] bg-[color-mix(in_srgb,var(--ds-amber)_12%,transparent)] px-3 py-2 text-xs text-[var(--ds-amber)]"
              >
                {{ mcpStatusError || mcpStatus?.error }}
              </div>

              <div class="flex items-center gap-2 text-xs text-[var(--ds-text-3)]">
                <Terminal class="h-3.5 w-3.5" />
                <span>{{ t("settings.mcpDetectionTiming") }} {{ t("settings.mcpNpmBoundary") }}</span>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'security' && isWeb" class="flex flex-col gap-5 py-2">
              <div class="space-y-3">
                <Input
                  v-model="oldPassword"
                  type="password"
                  :placeholder="t('auth.oldPassword')"
                  class="h-9"
                  autocomplete="off"
                />
                <Input
                  v-model="newPassword"
                  type="password"
                  :placeholder="t('auth.newPassword')"
                  class="h-9"
                  autocomplete="off"
                />
                <Input
                  v-model="confirmNewPassword"
                  type="password"
                  :placeholder="t('auth.confirmPassword')"
                  class="h-9"
                  autocomplete="off"
                />
                <p
                  v-if="passwordMessage"
                  class="text-xs"
                  :class="passwordError ? 'text-[var(--ds-red)]' : 'text-[var(--ds-green)]'"
                >
                  {{ passwordMessage }}
                </p>
              </div>
            </section>

            <section v-else-if="activeSettingsTab === 'about'" class="flex flex-col gap-5 py-2">
              <div
                class="flex items-center justify-between gap-4 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-bg-hover)] p-4"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <AppLogo class="h-9 w-9 shrink-0" />
                  <div class="text-base font-semibold text-[var(--ds-text-1)]">DBX</div>
                </div>
                <div
                  v-if="displayedAppVersion"
                  class="shrink-0 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-2 py-1 font-mono text-xs text-[var(--ds-text-3)]"
                >
                  {{ displayedAppVersion }}
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  class="rounded-lg border border-[var(--ds-border)] p-4 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                  @click="openExternalUrl('https://qm.qq.com/cgi-bin/qm/qr?k=&group_code=1087880322')"
                >
                  <div class="ds-menu-label">
                    {{ t("settings.community") }}
                  </div>
                  <div class="mt-3 flex items-center gap-2 text-sm font-medium">
                    <img
                      src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iODYiIHdpZHRoPSI4NiIgdmlld0JveD0iMCAwIDEyMCAxNDUiPjxwYXRoIGZpbGw9IiNmYWFiMDciIGQ9Ik02MC41MDMgMTQyLjIzN2MtMTIuNTMzIDAtMjQuMDM4LTQuMTk1LTMxLjQ0NS0xMC40Ni0zLjc2MiAxLjEyNC04LjU3NCAyLjkzMi0xMS42MSA1LjE3NS0yLjYgMS45MTgtMi4yNzUgMy44NzQtMS44MDcgNC42NjMgMi4wNTYgMy40NyAzNS4yNzMgMi4yMTYgNDQuODYyIDEuMTM2em0wIDBjMTIuNTM1IDAgMjQuMDM5LTQuMTk1IDMxLjQ0Ny0xMC40NiAzLjc2IDEuMTI0IDguNTczIDIuOTMyIDExLjYxIDUuMTc1IDIuNTk4IDEuOTE4IDIuMjc0IDMuODc0IDEuODA1IDQuNjYzLTIuMDU2IDMuNDctMzUuMjcyIDIuMjE2LTQ0Ljg2MiAxLjEzNnptMCAwIi8+PHBhdGggZD0iTTYwLjU3NiA2Ny4xMTljMjAuNjk4LS4xNCAzNy4yODYtNC4xNDcgNDIuOTA3LTUuNjgzIDEuMzQtLjM2NyAyLjA1Ni0xLjAyNCAyLjA1Ni0xLjAyNC4wMDUtLjE4OS4wODUtMy4zNy4wODUtNS4wMUMxMDUuNjI0IDI3Ljc2OCA5Mi41OC4wMDEgNjAuNSAwIDI4LjQyLjAwMSAxNS4zNzUgMjcuNzY5IDE1LjM3NSA1NS40MDFjMCAxLjY0Mi4wOCA0LjgyMi4wODYgNS4wMSAwIDAgLjU4My42MTUgMS42NS45MTMgNS4xOSAxLjQ0NCAyMi4wOSA1LjY1IDQzLjMxMiA1Ljc5NXptNTYuMjQ1IDIzLjAyYy0xLjI4My00LjEyOS0zLjAzNC04Ljk0NC00LjgwOC0xMy41NjggMCAwLTEuMDItLjEyNi0xLjUzNy4wMjMtMTUuOTEzIDQuNjIzLTM1LjIwMiA3LjU3LTQ5LjkgNy4zOTJoLS4xNTNjLTE0LjYxNi4xNzUtMzMuNzc0LTIuNzM3LTQ5LjYzNC03LjMxNS0uNjA2LS4xNzUtMS44MDItLjEtMS44MDItLjEtMS43NzQgNC42MjQtMy41MjUgOS40NC00LjgwOCAxMy41NjgtNi4xMTkgMTkuNjktNC4xMzYgMjcuODM4LTIuNjI3IDI4LjAyIDMuMjM5LjM5MiAxMi42MDYtMTQuODIxIDEyLjYwNi0xNC44MjEgMCAxNS40NTkgMTMuOTU3IDM5LjE5NSA0NS45MTggMzkuNDEzaC44NDhjMzEuOTYtLjIxOCA0NS45MTctMjMuOTU0IDQ1LjkxNy0zOS40MTMgMCAwIDkuMzY4IDE1LjIxMyAxMi42MDcgMTQuODIyIDEuNTA4LS4xODMgMy40OTEtOC4zMzItMi42MjctMjguMDIxIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQ5LjA4NSA0MC44MjRjLTQuMzUyLjE5Ny04LjA3LTQuNzYtOC4zMDQtMTEuMDYzLS4yMzYtNi4zMDUgMy4wOTgtMTEuNTc2IDcuNDUtMTEuNzczIDQuMzQ3LS4xOTUgOC4wNjQgNC43NiA4LjMgMTEuMDY1LjIzOCA2LjMwNi0zLjA5NyAxMS41NzctNy40NDYgMTEuNzcxbTMxLjEzMy0xMS4wNjNjLS4yMzMgNi4zMDItMy45NTEgMTEuMjYtOC4zMDMgMTEuMDYzLTQuMzUtLjE5NS03LjY4NC01LjQ2NS03LjQ0Ni0xMS43Ny4yMzYtNi4zMDUgMy45NTItMTEuMjYgOC4zLTExLjA2NiA0LjM1Mi4xOTcgNy42ODYgNS40NjggNy40NDkgMTEuNzczIi8+PHBhdGggZmlsbD0iI2ZhYWIwNyIgZD0iTTg3Ljk1MiA0OS43MjVDODYuNzkgNDcuMTUgNzUuMDc3IDQ0LjI4IDYwLjU3OCA0NC4yOGgtLjE1NmMtMTQuNSAwLTI2LjIxMiAyLjg3LTI3LjM3NSA1LjQ0NmEuODYzLjg2MyAwIDAwLS4wODUuMzY3Ljg4Ljg4IDAgMDAuMTYuNDk2Yy45OCAxLjQyNyAxMy45ODUgOC40ODcgMjcuMyA4LjQ4N2guMTU2YzEzLjMxNCAwIDI2LjMxOS03LjA1OCAyNy4yOTktOC40ODdhLjg3My44NzMgMCAwMC4xNi0uNDk4Ljg1Ni44NTYgMCAwMC0uMDg1LS4zNjUiLz48cGF0aCBkPSJNNTQuNDM0IDI5Ljg1NGMuMTk5IDIuNDktMS4xNjcgNC43MDItMy4wNDYgNC45NDMtMS44ODMuMjQyLTMuNTY4LTEuNTgtMy43NjgtNC4wNy0uMTk3LTIuNDkyIDEuMTY3LTQuNzA0IDMuMDQzLTQuOTQ0IDEuODg2LS4yNDQgMy41NzQgMS41OCAzLjc3MSA0LjA3bTExLjk1Ni44MzNjLjM4NS0uNjg5IDMuMDA0LTQuMzEyIDguNDI3LTIuOTkzIDEuNDI1LjM0NyAyLjA4NC44NTcgMi4yMjMgMS4wNTcuMjA1LjI5Ni4yNjIuNzE4LjA1MyAxLjI4Ni0uNDEyIDEuMTI2LTEuMjYzIDEuMDk1LTEuNzM0Ljg3NS0uMzA1LS4xNDItNC4wODItMi42Ni03LjU2MiAxLjA5Ny0uMjQuMjU3LS42NjguMzQ2LTEuMDczLjA0LS40MDctLjMwOC0uNTc0LS45My0uMzM0LTEuMzYyIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTYwLjU3NiA4My4wOGgtLjE1M2MtOS45OTYuMTItMjIuMTE2LTEuMjA0LTMzLjg1NC0zLjUxOC0xLjAwNCA1LjgxOC0xLjYxIDEzLjEzMi0xLjA5IDIxLjg1MyAxLjMxNiAyMi4wNDMgMTQuNDA3IDM1LjkgMzQuNjE0IDM2LjFoLjgyYzIwLjIwOC0uMiAzMy4yOTgtMTQuMDU3IDM0LjYxNi0zNi4xLjUyLTguNzIzLS4wODctMTYuMDM1LTEuMDkyLTIxLjg1NC0xMS43MzkgMi4zMTUtMjMuODYyIDMuNjQtMzMuODYgMy41MTgiLz48cGF0aCBmaWxsPSIjZWIxOTIzIiBkPSJNMzIuMTAyIDgxLjIzNXYyMS42OTNzOS45MzcgMi4wMDQgMTkuODkzLjYxNlY4My41MzVjLTYuMzA3LS4zNTctMTMuMTA5LTEuMTUyLTE5Ljg5My0yLjMiLz48cGF0aCBmaWxsPSIjZWIxOTIzIiBkPSJNMTA1LjUzOSA2MC40MTJzLTE5LjMzIDYuMTAyLTQ0Ljk2MyA2LjI3NWgtLjE1M2MtMjUuNTkxLS4xNzItNDQuODk2LTYuMjU1LTQ0Ljk2Mi02LjI3NUw4Ljk4NyA3Ni41N2MxNi4xOTMgNC44ODIgMzYuMjYxIDguMDI4IDUxLjQzNiA3Ljg0NWguMTUzYzE1LjE3NS4xODMgMzUuMjQyLTIuOTYzIDUxLjQzNy03Ljg0NXptMCAwIi8+PC9zdmc+"
                      alt="QQ"
                      class="h-7 w-7 rounded-md bg-white p-1"
                    />
                    {{ t("settings.qqGroup") }}
                    <ExternalLink class="ml-auto h-3.5 w-3.5 text-[var(--ds-text-3)]" />
                  </div>
                  <div class="mt-1 font-mono text-base text-[var(--ds-text-1)]">1087880322</div>
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-[var(--ds-border)] p-4 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                  @click="openExternalUrl('https://discord.gg/W7NyVDRt6a')"
                >
                  <div class="ds-menu-label">
                    {{ t("settings.community") }}
                  </div>
                  <div class="mt-3 flex items-center gap-2 text-sm font-medium">
                    <img
                      src="https://cdn.simpleicons.org/discord/5865F2"
                      alt="Discord"
                      class="h-7 w-7 rounded-md bg-white p-1"
                    />
                    Discord
                    <ExternalLink class="ml-auto h-3.5 w-3.5 text-[var(--ds-text-3)]" />
                  </div>
                  <div class="mt-1 text-sm text-[var(--ds-accent)]">discord.gg/W7NyVDRt6a</div>
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-[var(--ds-border)] p-4 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                  @click="openExternalUrl('https://docs.qq.com/doc/DVVhMY0h1ekJqc0tz')"
                >
                  <div class="ds-menu-label">
                    {{ t("settings.community") }}
                  </div>
                  <div class="mt-3 flex items-center gap-2 text-sm font-medium">
                    <span class="flex h-7 w-7 items-center justify-center rounded-md bg-[#07C160] text-white">
                      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path
                          d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.08 3.56 2.78 4.66l-.7 2.1 2.46-1.23c.87.27 1.8.42 2.78.42.24 0 .48-.01.71-.03A5.93 5.93 0 0 1 10 14c0-3.31 3.13-6 7-6 .34 0 .67.03 1 .07C17.27 5.56 13.72 4 9.5 4Zm-3 4.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM22 14c0-2.76-2.69-5-6-5s-6 2.24-6 5 2.69 5 6 5c.73 0 1.43-.11 2.09-.3l1.72.86-.49-1.46C20.94 17.07 22 15.64 22 14Zm-7.5-.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm4 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z"
                        />
                      </svg>
                    </span>
                    {{ t("settings.wechatGroup") }}
                    <ExternalLink class="ml-auto h-3.5 w-3.5 text-[var(--ds-text-3)]" />
                  </div>
                  <div class="mt-1 text-sm text-[var(--ds-accent)]">{{ t("settings.wechatGroupInvite") }}</div>
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-[var(--ds-border)] p-4 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                  @click="openExternalUrl('https://github.com/t8y2/dbx')"
                >
                  <div class="ds-menu-label">
                    {{ t("settings.project") }}
                  </div>
                  <div class="mt-3 flex items-center gap-2 text-sm font-medium">
                    <img
                      src="https://cdn.simpleicons.org/github/181717"
                      alt="GitHub"
                      class="h-7 w-7 rounded-md bg-white p-1"
                    />
                    {{ t("settings.openSource") }}
                    <ExternalLink class="ml-auto h-3.5 w-3.5 text-[var(--ds-text-3)]" />
                  </div>
                  <div class="mt-1 text-sm text-[var(--ds-accent)]">github.com/t8y2/dbx</div>
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-[var(--ds-border)] p-4 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
                  @click="openExternalUrl('https://dbxio.com')"
                >
                  <div class="ds-menu-label">
                    {{ t("settings.project") }}
                  </div>
                  <div class="mt-3 flex items-center gap-2 text-sm font-medium">
                    <AppLogo class="h-7 w-7" />
                    {{ t("settings.officialDocs") }}
                    <ExternalLink class="ml-auto h-3.5 w-3.5 text-[var(--ds-text-3)]" />
                  </div>
                  <div class="mt-1 text-sm text-[var(--ds-accent)]">dbxio.com</div>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <DialogFooter
        v-if="hasSettingsApplyFooter(activeSettingsTab as SettingsCategory)"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3 gap-3 sm:gap-3"
      >
        <Button
          variant="ghost"
          class="text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
          :disabled="isAtDefaults"
          @click="resetDefaults"
        >
          {{ t("settings.resetDefaults") }}
        </Button>
        <div class="flex-1" />
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.close") }}
        </Button>
        <Button variant="secondary" :disabled="!hasChanges() || hasApplyBlocker" @click="applySettings">
          {{ t("settings.apply") }}
        </Button>
        <Button :disabled="!hasChanges() || hasApplyBlocker" @click="applySettingsAndClose">
          {{ t("settings.applyAndClose") }}
        </Button>
      </DialogFooter>

      <DialogFooter
        v-else-if="activeSettingsTab === 'ai'"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3 gap-3 sm:gap-3"
      >
        <div class="flex-1" />
        <Button variant="outline" @click="emit('update:open', false)">{{ t("common.close") }}</Button>
        <Button variant="secondary" :disabled="!aiHasChanges()" @click="aiApplySettings">
          {{ t("settings.apply") }}
        </Button>
        <Button
          :disabled="!aiHasChanges()"
          @click="
            aiApplySettings();
            emit('update:open', false);
          "
        >
          {{ t("settings.applyAndClose") }}
        </Button>
      </DialogFooter>

      <DialogFooter
        v-else-if="activeSettingsTab === 'sync'"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3 gap-3 sm:gap-3"
      >
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.close") }}
        </Button>
        <p
          v-if="webdavMessage"
          class="text-xs self-center truncate max-w-[280px]"
          :class="webdavError ? 'text-[var(--ds-red)]' : 'text-[var(--ds-green)]'"
        >
          {{ webdavMessage }}
        </p>
        <div class="flex-1" />
        <Button variant="outline" :disabled="!webdavReady" @click="testWebDav">
          <Loader2 v-if="webdavBusy === 'test'" class="mr-1 h-3 w-3 animate-spin" />
          {{ t("settings.syncTest") }}
        </Button>
        <Button variant="outline" :disabled="!webdavReady" @click="downloadWebDavSnapshot">
          <Loader2 v-if="webdavBusy === 'download'" class="mr-1 h-3 w-3 animate-spin" />
          <Download v-else class="mr-1 h-3 w-3" />
          {{ t("settings.syncDownload") }}
        </Button>
        <Button :disabled="!webdavReady" @click="uploadWebDavSnapshot">
          <Loader2 v-if="webdavBusy === 'upload'" class="mr-1 h-3 w-3 animate-spin" />
          <Upload v-else class="mr-1 h-3 w-3" />
          {{ t("settings.syncUpload") }}
        </Button>
      </DialogFooter>

      <DialogFooter
        v-else-if="activeSettingsTab === 'mcp' && !isWeb"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3"
      >
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.close") }}
        </Button>
        <div class="flex-1" />
        <Button variant="outline" :disabled="mcpStatusLoading" @click="refreshMcpStatus">
          <Loader2 v-if="mcpStatusLoading" class="mr-1 h-3 w-3 animate-spin" />
          <RefreshCw v-else class="mr-1 h-3 w-3" />
          {{ t("settings.mcpRefresh") }}
        </Button>
        <Button variant="outline" @click="openExternalUrl('https://dbxio.com/cn/docs/mcp')">
          <ExternalLink class="mr-1 h-3 w-3" />
          {{ t("settings.mcpGuide") }}
        </Button>
      </DialogFooter>

      <DialogFooter
        v-else-if="activeSettingsTab === 'security' && isWeb"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3"
      >
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.close") }}
        </Button>
        <Button
          :disabled="changingPassword || !oldPassword || !newPassword || !confirmNewPassword"
          @click="changePassword"
        >
          {{ t("auth.changePassword") }}
        </Button>
      </DialogFooter>

      <DialogFooter
        v-else-if="activeSettingsTab === 'about'"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3"
      >
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t("common.close") }}
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- Theme Customizer Dialog -->
    <ThemeCustomizerDialog
      v-model:open="showThemeCustomizer"
      :themes="editCustomThemes"
      :active-theme-id="editActiveCustomThemeId"
      @save="handleThemeSave"
    />

    <!-- Snippet Add/Edit Dialog -->
    <DsDialog
      :open="snippetDialogOpen"
      :title="snippetEditingId ? t('settings.snippetsEditTitle') : t('settings.snippetsAddTitle')"
      :icon="Braces"
      content-class="sm:max-w-[500px]"
      @update:open="snippetDialogOpen = $event"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <Label for="snippet-label">{{ t("settings.snippetsLabel") }}</Label>
          <Input id="snippet-label" v-model="snippetForm.label" :placeholder="t('settings.snippetsLabelPlaceholder')" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="snippet-prefix">{{ t("settings.snippetsPrefix") }}</Label>
          <Input
            id="snippet-prefix"
            v-model="snippetForm.prefix"
            :placeholder="t('settings.snippetsPrefixPlaceholder')"
          />
          <p v-if="snippetFormPrefixError" class="text-xs text-[var(--ds-red)]">{{ snippetFormPrefixError }}</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="snippet-body">{{ t("settings.snippetsBody") }}</Label>
          <textarea
            id="snippet-body"
            v-model="snippetForm.body"
            :placeholder="t('settings.snippetsBodyPlaceholder')"
            rows="6"
            class="flex min-h-[120px] w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-3 py-2 text-sm font-mono text-[var(--ds-text-1)] placeholder:text-[var(--ds-text-3)] focus-visible:border-[var(--ds-accent-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)]"
          />
        </div>
      </div>
      <template #footer>
        <Button variant="outline" @click="snippetDialogOpen = false">{{ t("settings.cancel") }}</Button>
        <Button @click="saveSnippet">{{ t("settings.save") }}</Button>
      </template>
    </DsDialog>
  </Dialog>
</template>
