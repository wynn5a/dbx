<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useSqlHighlighter } from "@/composables/useSqlHighlighter";
import { Clock, Copy, Database, History, RotateCcw, Search, Sparkles, Trash2, X } from "@lucide/vue";
import { RecycleScroller } from "vue-virtual-scroller";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DsDialog,
} from "@/components/ui/dialog";
import CustomContextMenu, { type ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import { useHistoryStore } from "@/stores/historyStore";
import { useToast } from "@/composables/useToast";
import { resolveHistoryActivityKind, type HistoryActivityKind } from "@/lib/historyActivityKind";
import { canRollbackHistoryEntry } from "@/lib/historyAiAnalysis";
import { HISTORY_ROW_HEIGHT, HISTORY_SCROLL_BUFFER, shouldVirtualizeHistory } from "@/lib/historyVirtualList";
import type { HistoryEntry } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import * as api from "@/lib/api";

const { t } = useI18n();
const { toast } = useToast();
const { highlight } = useSqlHighlighter();
const store = useHistoryStore();

const emit = defineEmits<{
  restore: [sql: string, entry: HistoryEntry];
  analyzeAi: [entry: HistoryEntry];
  close: [];
}>();

type HistoryFilter = "all" | "query" | "data_change" | "schema_change" | "failed";

const searchText = ref("");
const activeFilter = ref<HistoryFilter>("all");
const selectedEntry = ref<HistoryEntry | null>(null);
const isRollingBack = ref(false);
const showDeleteConfirm = ref(false);
const showClearConfirm = ref(false);
const deleteTargetId = ref<string | null>(null);

const filters: HistoryFilter[] = ["all", "query", "data_change", "schema_change", "failed"];

const filtered = computed(() => {
  const q = searchText.value.toLowerCase();
  return store.entries.filter((entry) => {
    if (activeFilter.value === "failed" && entry.success) return false;
    if (activeFilter.value !== "all" && activeFilter.value !== "failed" && activityKind(entry) !== activeFilter.value) {
      return false;
    }
    if (!q) return true;
    return [entry.sql, entry.connection_name, entry.database, entry.operation, entry.target]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
});

function activityKind(entry: HistoryEntry) {
  return resolveHistoryActivityKind(entry);
}

// Each activity kind owns a fixed data-type hue (DESIGN-SYSTEM: "color means something").
const KIND_HUE: Record<HistoryActivityKind, string> = {
  query: "var(--ds-blue)",
  data_change: "var(--ds-amber)",
  schema_change: "var(--ds-purple)",
  import: "var(--ds-green)",
  transfer: "var(--ds-teal)",
};

function kindHue(entry: HistoryEntry) {
  return KIND_HUE[activityKind(entry)];
}

function kindBadgeStyle(entry: HistoryEntry) {
  const hue = kindHue(entry);
  return { color: hue, background: `color-mix(in srgb, ${hue} 14%, transparent)` };
}

// DESIGN-SYSTEM "Secondary chip button" recipe.
const filterClass =
  "inline-flex shrink-0 items-center rounded-sm border px-2.5 py-[5px] text-[12.5px] font-medium leading-none transition-[color,background-color,border-color] duration-[var(--ds-speed)] ease-[var(--ds-ease)]";
const filterActiveClass = "border-[var(--ds-border-strong)] bg-[var(--ds-bg-active)] text-[var(--ds-text-1)]";
const filterIdleClass =
  "border-[var(--ds-border)] bg-transparent text-[var(--ds-text-2)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]";

function restore(entry: HistoryEntry) {
  emit("restore", entry.sql, entry);
  selectedEntry.value = null;
}

async function copyText(text: string) {
  try {
    await copyToClipboard(text);
    toast(t("grid.copied"));
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}

function confirmDeleteEntry(id: string) {
  deleteTargetId.value = id;
  showDeleteConfirm.value = true;
}

function executeDelete() {
  if (deleteTargetId.value) {
    store.remove(deleteTargetId.value);
    deleteTargetId.value = null;
  }
  showDeleteConfirm.value = false;
}

function confirmClearHistory() {
  if (store.entries.length > 0) {
    showClearConfirm.value = true;
  }
}

function executeClear() {
  store.clear();
  showClearConfirm.value = false;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFullTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function truncateSql(sql: string): string {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > 120 ? line.slice(0, 120) + "..." : line;
}

function entryTitle(entry: HistoryEntry) {
  return entry.target || entry.operation || truncateSql(entry.sql);
}

function entrySubtitle(entry: HistoryEntry) {
  if (activityKind(entry) === "query") return truncateSql(entry.sql);
  return truncateSql(entry.sql || entry.target || entry.operation || "");
}

function filterLabel(filter: HistoryFilter) {
  return t(`history.filters.${filter}`);
}

function kindLabel(entry: HistoryEntry) {
  return t(`history.kinds.${activityKind(entry)}`);
}

function kindShortLabel(entry: HistoryEntry) {
  return t(`history.kindShort.${activityKind(entry)}`);
}

function detailsRows(entry: HistoryEntry) {
  const rows = [
    [t("history.detail.kind"), kindLabel(entry)],
    [t("history.detail.operation"), entry.operation || "-"],
    [t("history.detail.connection"), entry.connection_name || "-"],
    [t("history.detail.database"), entry.database || "-"],
    [t("history.detail.target"), entry.target || "-"],
    [t("history.detail.time"), formatFullTime(entry.executed_at)],
    [t("history.detail.duration"), `${entry.execution_time_ms}ms`],
    [t("history.detail.affectedRows"), entry.affected_rows ?? "-"],
    [
      t("history.detail.rollback"),
      canRollbackHistoryEntry(entry) ? t("history.rollbackAvailable") : t("history.rollbackUnavailable"),
    ],
    [t("history.detail.status"), entry.success ? t("history.success") : t("history.failed")],
  ];
  if (entry.error) rows.push([t("history.detail.error"), entry.error]);
  return rows;
}

async function rollback(entry: HistoryEntry) {
  if (!canRollbackHistoryEntry(entry) || isRollingBack.value) return;
  if (!window.confirm(t("history.rollbackConfirm"))) return;

  const connectionId = entry.connection_id!;
  const rollbackSql = entry.rollback_sql!;
  isRollingBack.value = true;
  const start = Date.now();
  try {
    const result = await api.executeScript(connectionId, entry.database, rollbackSql);
    await store.add({
      connection_id: connectionId,
      connection_name: entry.connection_name,
      database: entry.database,
      sql: rollbackSql,
      execution_time_ms: Date.now() - start,
      success: true,
      activity_kind: "data_change",
      operation: "ROLLBACK",
      target: entry.target,
      affected_rows: result.affected_rows,
      details_json: JSON.stringify({ rollback_of: entry.id }),
    });
    toast(t("history.rollbackSuccess"));
    selectedEntry.value = null;
  } catch (e: any) {
    toast(t("history.rollbackFailed", { message: e?.message || String(e) }), 5000);
  } finally {
    isRollingBack.value = false;
  }
}

function getHistoryMenuItems(entry: HistoryEntry): ContextMenuItem[] {
  return [
    {
      label: t("history.viewDetails"),
      action: () => {
        selectedEntry.value = entry;
      },
    },
    { label: t("history.restore"), action: () => restore(entry) },
    { label: t("history.analyzeWithAi"), action: () => emit("analyzeAi", entry), icon: Sparkles },
    { label: t("history.copy"), action: () => copyText(entry.sql) },
    ...(canRollbackHistoryEntry(entry) ? [{ label: t("history.rollback"), action: () => rollback(entry) }] : []),
    { label: t("history.delete"), action: () => confirmDeleteEntry(entry.id), variant: "destructive" as const },
  ];
}

onMounted(() => store.load());
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden border-l border-[var(--ds-border)]">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] px-3">
      <Clock class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-3)]" />
      <span class="text-[12.5px] font-medium text-[var(--ds-text-1)]">{{ t("history.title") }}</span>
      <span
        v-if="store.entries.length > 0"
        class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ds-bg-active)] px-1 font-mono text-[10px] tabular-nums text-[var(--ds-text-3)]"
      >
        {{ store.entries.length }}
      </span>
      <span class="flex-1" />
      <Button
        v-if="store.entries.length > 0"
        variant="ghost"
        size="icon"
        class="h-6 w-6 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
        :title="t('history.clear')"
        @click="confirmClearHistory"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-6 w-6 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
        @click="emit('close')"
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <div class="shrink-0 border-b border-[var(--ds-border)] px-3 py-2">
      <div
        class="flex items-center gap-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] px-2.5 transition-[border-color,box-shadow] duration-[var(--ds-speed)] ease-[var(--ds-ease)] focus-within:border-[var(--ds-accent-line)] focus-within:ring-2 focus-within:ring-[var(--ds-accent-line)]"
      >
        <Search class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-3)]" />
        <input
          v-model="searchText"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          class="h-7 flex-1 bg-transparent text-[12.5px] text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)]"
          :placeholder="t('history.search')"
        />
      </div>
      <div class="mt-2 flex gap-1.5 overflow-x-auto">
        <button
          v-for="filter in filters"
          :key="filter"
          type="button"
          :class="[filterClass, activeFilter === filter ? filterActiveClass : filterIdleClass]"
          @click="activeFilter = filter"
        >
          {{ filterLabel(filter) }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1">
      <RecycleScroller
        v-if="shouldVirtualizeHistory(filtered.length)"
        class="h-full"
        :items="filtered"
        :item-size="HISTORY_ROW_HEIGHT"
        :buffer="HISTORY_SCROLL_BUFFER"
        :skip-hover="true"
        key-field="id"
      >
        <template #default="{ item: entry }">
          <CustomContextMenu :items="getHistoryMenuItems(entry)" v-slot="{ onContextMenu }">
            <div
              class="group h-[72px] cursor-pointer border-b border-[var(--ds-border-soft)] px-3 py-2 transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)]"
              @click="selectedEntry = entry"
              @contextmenu="onContextMenu"
            >
              <div class="mb-1 flex items-center gap-1.5">
                <span
                  class="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 font-mono text-[10px] font-medium leading-none"
                  :style="kindBadgeStyle(entry)"
                >
                  {{ kindShortLabel(entry) }}
                </span>
                <span class="truncate text-[12.5px] font-medium text-[var(--ds-text-1)]">{{ entryTitle(entry) }}</span>
                <span class="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[var(--ds-text-4)]">{{
                  formatTime(entry.executed_at)
                }}</span>
              </div>
              <div class="truncate font-mono text-[11.5px] text-[var(--ds-text-3)]">{{ entrySubtitle(entry) }}</div>
              <div class="mt-1 flex items-center gap-2 text-[11px]">
                <span class="inline-flex min-w-0 items-center gap-1 text-[var(--ds-text-3)]">
                  <Database class="h-3 w-3 shrink-0 text-[var(--ds-text-4)]" />
                  <span class="truncate">
                    {{ entry.connection_name }}<template v-if="entry.database"> / {{ entry.database }}</template>
                  </span>
                </span>
                <span
                  class="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono tabular-nums"
                  :class="entry.success ? 'text-[var(--ds-text-4)]' : 'text-[var(--ds-red)]'"
                >
                  <span
                    class="h-[5px] w-[5px] shrink-0 rounded-full"
                    :class="entry.success ? 'bg-[var(--ds-green)]' : 'bg-[var(--ds-red)]'"
                  />
                  {{ entry.success ? `${entry.execution_time_ms}ms` : t("history.failed") }}
                </span>
              </div>
            </div>
          </CustomContextMenu>
        </template>
      </RecycleScroller>

      <div v-if="filtered.length === 0" class="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Clock class="h-7 w-7 text-[var(--ds-text-4)]" />
        <p class="text-[13px] text-[var(--ds-text-2)]">{{ t("history.empty") }}</p>
      </div>
    </div>

    <Dialog :open="!!selectedEntry" @update:open="(value) => !value && (selectedEntry = null)">
      <DialogContent
        class="ds-dialog gap-0 p-0 flex flex-col overflow-hidden sm:max-w-2xl duration-75"
        :show-close-button="false"
        @interact-outside="selectedEntry = null"
      >
        <DialogHeader
          class="flex h-14 shrink-0 flex-row items-center gap-3 space-y-0 border-b border-[var(--ds-border)] px-4 text-left"
        >
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
          >
            <History class="h-4 w-4" />
          </div>
          <DialogTitle
            class="min-w-0 flex-1 flex items-center gap-2 text-[15px] font-semibold tracking-[-0.012em] text-[var(--ds-text-1)]"
          >
            <span
              v-if="selectedEntry"
              class="inline-flex h-[18px] shrink-0 items-center rounded px-1.5 font-mono text-[10px] font-medium leading-none"
              :style="kindBadgeStyle(selectedEntry)"
            >
              {{ kindShortLabel(selectedEntry) }}
            </span>
            <span class="min-w-0 truncate leading-normal">{{
              selectedEntry ? entryTitle(selectedEntry) : t("history.viewDetails")
            }}</span>
          </DialogTitle>
          <DialogClose as-child>
            <Button variant="ghost" size="icon-sm" class="-mr-1 shrink-0"
              ><X class="h-4 w-4" /><span class="sr-only">{{ t("common.close") }}</span></Button
            >
          </DialogClose>
        </DialogHeader>
        <div v-if="selectedEntry" class="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div class="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 text-[12.5px]">
            <template v-for="[label, value] in detailsRows(selectedEntry)" :key="label">
              <div class="text-[var(--ds-text-3)]">{{ label }}</div>
              <div class="min-w-0 break-words text-[var(--ds-text-1)]">{{ value }}</div>
            </template>
          </div>
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <div class="ds-menu-label">SQL</div>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                @click="copyText(selectedEntry.sql)"
              >
                <Copy class="h-3.5 w-3.5" />
                {{ t("history.copy") }}
              </Button>
            </div>
            <pre
              class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-3 font-mono text-xs leading-5"
              v-html="highlight(selectedEntry.sql)"
            ></pre>
          </div>
          <div v-if="selectedEntry.rollback_sql">
            <div class="mb-1.5 flex items-center justify-between">
              <div class="ds-menu-label">{{ t("history.rollbackSql") }}</div>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]"
                @click="copyText(selectedEntry.rollback_sql || '')"
              >
                <Copy class="h-3.5 w-3.5" />
                {{ t("history.copy") }}
              </Button>
            </div>
            <pre
              class="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-3 font-mono text-xs leading-5"
              v-html="highlight(selectedEntry.rollback_sql || '')"
            ></pre>
          </div>
        </div>
        <DialogFooter
          class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3"
        >
          <Button variant="outline" @click="selectedEntry && emit('analyzeAi', selectedEntry)">
            <Sparkles class="h-4 w-4" />
            {{ t("history.analyzeWithAi") }}
          </Button>
          <Button variant="outline" @click="selectedEntry && restore(selectedEntry)">{{ t("history.restore") }}</Button>
          <Button
            v-if="selectedEntry && canRollbackHistoryEntry(selectedEntry)"
            :disabled="isRollingBack"
            @click="rollback(selectedEntry)"
          >
            <RotateCcw class="h-4 w-4" />
            {{ isRollingBack ? t("common.loading") : t("history.rollback") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <DsDialog
      v-model:open="showDeleteConfirm"
      :title="t('history.delete')"
      :icon="Trash2"
      content-class="sm:max-w-[400px]"
    >
      <p class="text-sm text-[var(--ds-text-3)]">{{ t("history.confirmDelete") }}</p>
      <template #footer>
        <Button variant="outline" @click="showDeleteConfirm = false">{{ t("common.cancel") }}</Button>
        <Button variant="destructive" @click="executeDelete">{{ t("dangerDialog.confirm") }}</Button>
      </template>
    </DsDialog>

    <DsDialog
      v-model:open="showClearConfirm"
      :title="t('history.clear')"
      :icon="Trash2"
      content-class="sm:max-w-[400px]"
    >
      <p class="text-sm text-[var(--ds-text-3)]">{{ t("history.confirmClear") }}</p>
      <template #footer>
        <Button variant="outline" @click="showClearConfirm = false">{{ t("common.cancel") }}</Button>
        <Button variant="destructive" @click="executeClear">{{ t("dangerDialog.confirm") }}</Button>
      </template>
    </DsDialog>
  </div>
</template>
