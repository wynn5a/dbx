<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Upload, Download, RotateCcw, Type, IndentIncrease, Rows3, Zap, Eye } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/composables/useToast";
import {
  DEFAULT_SQL_FORMATTER_SETTINGS,
  normalizeSqlFormatterSettings,
  parseSqlFormatterConfig,
  serializeSqlFormatterConfig,
  type SqlFormatterCase,
  type SqlFormatterExpressionWidth,
  type SqlFormatterLinesBetweenQueries,
  type SqlFormatterLogicalOperatorNewline,
  type SqlFormatterSettings,
  type SqlFormatterTabWidth,
} from "@/lib/sqlFormatterConfig";
import { formatSqlText } from "@/lib/sqlFormatter";

const props = defineProps<{
  modelValue: SqlFormatterSettings;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: SqlFormatterSettings];
}>();

const { t } = useI18n();
const { toast } = useToast();

const fileInputRef = ref<HTMLInputElement>();
const importError = ref("");

const settings = computed(() => normalizeSqlFormatterSettings(props.modelValue));

const caseOptions: { value: SqlFormatterCase; labelKey: string }[] = [
  { value: "upper", labelKey: "settings.sqlFormatterCaseUpper" },
  { value: "lower", labelKey: "settings.sqlFormatterCaseLower" },
  { value: "preserve", labelKey: "settings.sqlFormatterCasePreserve" },
];

const logicalOperatorOptions: { value: SqlFormatterLogicalOperatorNewline; labelKey: string }[] = [
  { value: "before", labelKey: "settings.sqlFormatterLogicalBefore" },
  { value: "after", labelKey: "settings.sqlFormatterLogicalAfter" },
];

const tabWidthOptions: SqlFormatterTabWidth[] = [2, 4];
const expressionWidthOptions: SqlFormatterExpressionWidth[] = [50, 80, 120];
const linesBetweenQueriesOptions: SqlFormatterLinesBetweenQueries[] = [0, 1, 2];
const sqlFormatterOptionLabelKeys: Record<keyof SqlFormatterSettings, string> = {
  keywordCase: "settings.sqlFormatterKeywordCase",
  dataTypeCase: "settings.sqlFormatterDataTypeCase",
  functionCase: "settings.sqlFormatterFunctionCase",
  useTabs: "settings.sqlFormatterIndent",
  tabWidth: "settings.sqlFormatterTabWidth",
  logicalOperatorNewline: "settings.sqlFormatterLogicalOperatorNewline",
  expressionWidth: "settings.sqlFormatterExpressionWidth",
  linesBetweenQueries: "settings.sqlFormatterLinesBetweenQueries",
  denseOperators: "settings.sqlFormatterDenseOperators",
  newlineBeforeSemicolon: "settings.sqlFormatterNewlineBeforeSemicolon",
};
const sqlFormatterConfigErrorKeys: Record<string, string> = {
  "Invalid JSON.": "settings.sqlFormatterConfigErrorInvalidJson",
  "Config must be a JSON object.": "settings.sqlFormatterConfigErrorObject",
  "Unsupported config version.": "settings.sqlFormatterConfigErrorVersion",
  "Unsupported formatter.": "settings.sqlFormatterConfigErrorFormatter",
  "Config options must be a JSON object.": "settings.sqlFormatterConfigErrorOptionsObject",
};

// ----- Live preview -----
// A fixed sample exercises every option group (casing, indentation, layout, operators)
// and two statements so `linesBetweenQueries` is visible. We run it through the real
// `formatSqlText` path so the preview always matches what the editor's "beautify" produces.
const PREVIEW_SAMPLE_SQL = [
  "SELECT u.id, u.name, SUM(o.total) AS revenue, COUNT(o.id) AS orders",
  "FROM users u JOIN orders o ON o.user_id = u.id",
  "WHERE u.is_active = TRUE AND o.created_at >= '2024-01-01'",
  "GROUP BY u.id, u.name ORDER BY revenue DESC LIMIT 10;",
  "INSERT INTO audit_log (user_id, action) VALUES (42, 'login');",
].join("\n");

const previewSql = ref("");
const previewError = ref("");
let previewToken = 0;

async function refreshPreview() {
  const token = ++previewToken;
  try {
    const out = await formatSqlText(PREVIEW_SAMPLE_SQL, "generic", settings.value);
    if (token !== previewToken) return;
    previewSql.value = out;
    previewError.value = "";
  } catch (e: any) {
    if (token !== previewToken) return;
    previewError.value = String(e?.message || e);
  }
}

const SQL_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "ON",
  "USING",
  "GROUP",
  "BY",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "BETWEEN",
  "DISTINCT",
  "UNION",
  "ALL",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "ALTER",
  "DROP",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
  "TRUE",
  "FALSE",
  "WITH",
  "EXISTS",
  "OVER",
  "PARTITION",
]);
const SQL_FUNCTIONS = new Set([
  "SUM",
  "COUNT",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NOW",
  "CAST",
  "CONCAT",
  "ROUND",
  "LOWER",
  "UPPER",
  "LENGTH",
  "DATE",
  "ABS",
  "NULLIF",
  "GREATEST",
  "LEAST",
  "TRIM",
  "SUBSTRING",
]);

type PreviewToken = { text: string; color: string };
const PREVIEW_TOKEN_RE =
  /(--[^\n]*)|('(?:[^'\\]|\\.|'')*')|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_])/g;

function tokenizeSqlLine(line: string): PreviewToken[] {
  const tokens: PreviewToken[] = [];
  for (const match of line.matchAll(PREVIEW_TOKEN_RE)) {
    const [full, comment, str, num, word, ws] = match;
    if (comment !== undefined) tokens.push({ text: full, color: "var(--ds-text-4)" });
    else if (str !== undefined) tokens.push({ text: full, color: "var(--ds-green)" });
    else if (num !== undefined) tokens.push({ text: full, color: "var(--ds-purple)" });
    else if (word !== undefined) {
      const upper = word.toUpperCase();
      const color = SQL_FUNCTIONS.has(upper)
        ? "var(--ds-amber)"
        : SQL_KEYWORDS.has(upper)
          ? "var(--ds-blue)"
          : "var(--ds-text-1)";
      tokens.push({ text: full, color });
    } else if (ws !== undefined) tokens.push({ text: full, color: "inherit" });
    else tokens.push({ text: full, color: "var(--ds-text-3)" });
  }
  return tokens;
}

const previewLines = computed(() => previewSql.value.split("\n").map((line) => tokenizeSqlLine(line)));
const previewLineCount = computed(() => (previewSql.value ? previewSql.value.split("\n").length : 0));
const indentLabel = computed(() =>
  settings.value.useTabs ? t("settings.sqlFormatterIndentTabs") : t("settings.sqlFormatterIndentSpaces"),
);

function segmentClass(active: boolean): string {
  return [
    "flex h-8 flex-1 items-center justify-center rounded-[var(--ds-radius-sm)] text-[12.5px] font-medium transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]",
    active
      ? "bg-[var(--ds-accent-soft)] text-[var(--ds-text-1)] shadow-[inset_0_0_0_1px_var(--ds-accent-line)]"
      : "text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]",
  ].join(" ");
}

const fieldLabelClass = "ds-menu-label mb-1.5 block";

function localizeSqlFormatterConfigError(message: string): string {
  const exactKey = sqlFormatterConfigErrorKeys[message];
  if (exactKey) return t(exactKey);

  const unknownOption = message.match(/^Unknown formatter option: (.+)\.$/);
  if (unknownOption?.[1]) {
    return t("settings.sqlFormatterConfigErrorUnknownOption", { option: unknownOption[1] });
  }

  const invalidOption = message.match(/^Invalid formatter option value: (.+)\.$/);
  if (invalidOption?.[1]) {
    const labelKey = sqlFormatterOptionLabelKeys[invalidOption[1] as keyof SqlFormatterSettings];
    if (labelKey) {
      return t("settings.sqlFormatterConfigErrorInvalidOptionValue", { option: t(labelKey) });
    }
  }

  return t("settings.sqlFormatterConfigErrorInvalidConfig");
}

function updateSettings(next: unknown) {
  importError.value = "";
  emit("update:modelValue", normalizeSqlFormatterSettings(next));
}

function updateOption<K extends keyof SqlFormatterSettings>(key: K, value: SqlFormatterSettings[K]) {
  updateSettings({ ...settings.value, [key]: value });
}

function onCaseOption(key: "keywordCase" | "functionCase" | "dataTypeCase", value: any) {
  if (value === "upper" || value === "lower" || value === "preserve") updateOption(key, value);
}

function onLogicalOperatorNewline(value: any) {
  if (value === "before" || value === "after") updateOption("logicalOperatorNewline", value);
}

function onTabWidth(value: any) {
  const next = Number(value);
  if (next === 2 || next === 4) updateOption("tabWidth", next);
}

function onExpressionWidth(value: any) {
  const next = Number(value);
  if (next === 50 || next === 80 || next === 120) updateOption("expressionWidth", next);
}

function onLinesBetweenQueries(value: any) {
  const next = Number(value);
  if (next === 0 || next === 1 || next === 2) updateOption("linesBetweenQueries", next);
}

function restoreDefaults() {
  updateSettings(DEFAULT_SQL_FORMATTER_SETTINGS);
}

function importConfig() {
  importError.value = "";
  fileInputRef.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const result = parseSqlFormatterConfig(text);
    if (!result.ok) {
      importError.value = localizeSqlFormatterConfigError(result.message);
      return;
    }
    updateSettings(result.settings);
    toast(t("settings.sqlFormatterImportSuccess"));
  } catch (e: any) {
    importError.value = e?.message || String(e);
  }
}

function exportConfig() {
  const blob = new Blob([serializeSqlFormatterConfig(settings.value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dbx-sql-formatter.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

watch(
  () => props.modelValue,
  () => void refreshPreview(),
  { deep: true, immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Action bar -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <input ref="fileInputRef" type="file" accept="application/json,.json" class="hidden" @change="onImportFile" />
        <Button type="button" variant="outline" size="sm" @click="importConfig">
          <Upload class="mr-1.5 h-3.5 w-3.5" />
          {{ t("settings.sqlFormatterImport") }}
        </Button>
        <Button type="button" variant="outline" size="sm" @click="exportConfig">
          <Download class="mr-1.5 h-3.5 w-3.5" />
          {{ t("settings.sqlFormatterExport") }}
        </Button>
      </div>
      <Button type="button" variant="ghost" size="sm" @click="restoreDefaults">
        <RotateCcw class="mr-1.5 h-3.5 w-3.5" />
        {{ t("settings.sqlFormatterRestoreDefaults") }}
      </Button>
    </div>

    <p
      v-if="importError"
      class="rounded-[var(--ds-radius-sm)] border border-[color-mix(in_srgb,var(--ds-red)_40%,transparent)] bg-[color-mix(in_srgb,var(--ds-red)_12%,transparent)] px-3 py-2 text-xs text-[var(--ds-red)]"
    >
      {{ importError }}
    </p>

    <!-- Controls + live preview -->
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
      <!-- Left: controls -->
      <div class="flex min-w-0 flex-col gap-5">
        <!-- Casing -->
        <section>
          <div class="ds-section-label mb-3">
            <Type class="h-3.5 w-3.5" />
            {{ t("settings.sqlFormatterCasingGroup") }}
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterKeywordCase") }}</label>
              <Select
                :model-value="settings.keywordCase"
                @update:model-value="(value: any) => onCaseOption('keywordCase', value)"
              >
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in caseOptions" :key="option.value" :value="option.value">
                    {{ t(option.labelKey) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterFunctionCase") }}</label>
              <Select
                :model-value="settings.functionCase"
                @update:model-value="(value: any) => onCaseOption('functionCase', value)"
              >
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in caseOptions" :key="option.value" :value="option.value">
                    {{ t(option.labelKey) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterDataTypeCase") }}</label>
              <Select
                :model-value="settings.dataTypeCase"
                @update:model-value="(value: any) => onCaseOption('dataTypeCase', value)"
              >
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in caseOptions" :key="option.value" :value="option.value">
                    {{ t(option.labelKey) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div class="h-px bg-[var(--ds-border-soft)]" />

        <!-- Indentation -->
        <section>
          <div class="ds-section-label mb-3">
            <IndentIncrease class="h-3.5 w-3.5" />
            {{ t("settings.sqlFormatterIndentationGroup") }}
          </div>
          <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterIndent") }}</label>
              <div
                class="inline-flex w-full gap-1 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-1"
              >
                <button type="button" :class="segmentClass(!settings.useTabs)" @click="updateOption('useTabs', false)">
                  {{ t("settings.sqlFormatterIndentSpaces") }}
                </button>
                <button type="button" :class="segmentClass(settings.useTabs)" @click="updateOption('useTabs', true)">
                  {{ t("settings.sqlFormatterIndentTabs") }}
                </button>
              </div>
            </div>

            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterTabWidth") }}</label>
              <Select :model-value="String(settings.tabWidth)" @update:model-value="onTabWidth">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="width in tabWidthOptions" :key="width" :value="String(width)">
                    {{ width }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div class="h-px bg-[var(--ds-border-soft)]" />

        <!-- Layout -->
        <section>
          <div class="ds-section-label mb-3">
            <Rows3 class="h-3.5 w-3.5" />
            {{ t("settings.sqlFormatterLayoutGroup") }}
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterLogicalOperatorNewline") }}</label>
              <Select :model-value="settings.logicalOperatorNewline" @update:model-value="onLogicalOperatorNewline">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in logicalOperatorOptions" :key="option.value" :value="option.value">
                    {{ t(option.labelKey) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterExpressionWidth") }}</label>
              <Select :model-value="String(settings.expressionWidth)" @update:model-value="onExpressionWidth">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="width in expressionWidthOptions" :key="width" :value="String(width)">
                    {{ width }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label :class="fieldLabelClass">{{ t("settings.sqlFormatterLinesBetweenQueries") }}</label>
              <Select :model-value="String(settings.linesBetweenQueries)" @update:model-value="onLinesBetweenQueries">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="count in linesBetweenQueriesOptions" :key="count" :value="String(count)">
                    {{ count }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div class="h-px bg-[var(--ds-border-soft)]" />

        <!-- Operators -->
        <section>
          <div class="ds-section-label mb-3">
            <Zap class="h-3.5 w-3.5" />
            {{ t("settings.sqlFormatterOperatorsGroup") }}
          </div>
          <div class="ds-card divide-y divide-[var(--ds-border-soft)] overflow-hidden">
            <div class="flex items-center justify-between gap-4 px-3.5 py-3">
              <div class="min-w-0">
                <label for="sql-formatter-dense-operators" class="text-[13px] font-medium text-[var(--ds-text-1)]">
                  {{ t("settings.sqlFormatterDenseOperators") }}
                </label>
                <p class="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ds-text-3)]">
                  {{ t("settings.sqlFormatterDenseOperatorsDesc") }}
                </p>
              </div>
              <Switch
                id="sql-formatter-dense-operators"
                class="shrink-0"
                :model-value="settings.denseOperators"
                @update:model-value="(value: boolean) => updateOption('denseOperators', value)"
              />
            </div>

            <div class="flex items-center justify-between gap-4 px-3.5 py-3">
              <div class="min-w-0">
                <label
                  for="sql-formatter-newline-before-semicolon"
                  class="text-[13px] font-medium text-[var(--ds-text-1)]"
                >
                  {{ t("settings.sqlFormatterNewlineBeforeSemicolon") }}
                </label>
                <p class="mt-0.5 text-[11.5px] leading-relaxed text-[var(--ds-text-3)]">
                  {{ t("settings.sqlFormatterNewlineBeforeSemicolonDesc") }}
                </p>
              </div>
              <Switch
                id="sql-formatter-newline-before-semicolon"
                class="shrink-0"
                :model-value="settings.newlineBeforeSemicolon"
                @update:model-value="(value: boolean) => updateOption('newlineBeforeSemicolon', value)"
              />
            </div>
          </div>
        </section>
      </div>

      <!-- Right: live preview -->
      <div class="lg:sticky lg:top-1 lg:self-start">
        <div class="ds-card overflow-hidden">
          <div
            class="flex items-center justify-between gap-2 border-b border-[var(--ds-border-soft)] bg-[var(--ds-bg-elevated)] px-3 py-2"
          >
            <span class="ds-section-label">
              <Eye class="h-3.5 w-3.5" />
              {{ t("settings.sqlFormatterPreview") }}
            </span>
            <span class="font-mono text-[10.5px] text-[var(--ds-text-4)]">
              {{ t("settings.sqlFormatterPreviewLines", { count: previewLineCount }) }}
            </span>
          </div>

          <div v-if="previewError" class="px-3 py-3 text-xs text-[var(--ds-red)]">
            {{ previewError }}
          </div>
          <div
            v-else
            class="max-h-[460px] overflow-auto bg-[var(--ds-bg-base)] py-2 text-[12px] leading-[1.65]"
            :style="{ tabSize: settings.tabWidth, fontFamily: 'var(--ds-mono)' }"
          >
            <div v-for="(line, index) in previewLines" :key="index" class="flex px-1">
              <span
                class="sticky left-0 mr-3 inline-block min-w-[1.75rem] shrink-0 select-none bg-[var(--ds-bg-base)] pr-1 text-right font-mono text-[11px] tabular-nums text-[var(--ds-text-4)]"
              >
                {{ index + 1 }}
              </span>
              <code class="whitespace-pre">
                <span v-for="(token, tokenIndex) in line" :key="tokenIndex" :style="{ color: token.color }">{{
                  token.text
                }}</span>
              </code>
            </div>
          </div>

          <div
            class="flex items-center gap-1.5 border-t border-[var(--ds-border-soft)] bg-[var(--ds-bg-elevated)] px-3 py-1.5 font-mono text-[10.5px] text-[var(--ds-text-4)]"
          >
            <span>{{ t("settings.sqlFormatterPreviewWrap", { cols: settings.expressionWidth }) }}</span>
            <span>·</span>
            <span class="lowercase">{{ indentLabel }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
