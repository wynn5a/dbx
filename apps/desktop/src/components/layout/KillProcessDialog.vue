<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { OctagonX, RefreshCw, Loader2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { DsDialog } from "@/components/ui/dialog";
import { useToast } from "@/composables/useToast";
import { listProcesses, killProcess } from "@/lib/api";
import type { DbProcess, DatabaseType } from "@/types/database";

const open = defineModel<boolean>("open", { required: true });

const props = defineProps<{
  connectionId: string;
  dbType: DatabaseType;
  database: string;
  currentSql?: string;
}>();

const { t } = useI18n();
const { toast } = useToast();

const processes = ref<DbProcess[]>([]);
const loading = ref(false);
const killing = ref(false);
const errorMessage = ref("");
const selectedPid = ref<string | null>(null);

const isSqlServer = computed(() => props.dbType === "sqlserver");

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

// Pids whose running SQL matches the editor's executed statement — computed once
// per data/prop change so the template doesn't re-normalize each row on render.
const currentPids = computed(() => {
  const target = normalizeSql(props.currentSql ?? "");
  if (!target) return new Set<string>();
  return new Set(processes.value.filter((p) => p.query && normalizeSql(p.query) === target).map((p) => p.pid));
});

function formatDuration(secs?: number | null): string {
  if (secs == null || Number.isNaN(secs)) return "—";
  if (secs < 60) return `${secs.toFixed(secs < 10 ? 1 : 0)}s`;
  const total = Math.floor(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function load() {
  if (!props.connectionId || !props.database) return;
  loading.value = true;
  errorMessage.value = "";
  try {
    const rows = await listProcesses(props.connectionId, props.database);
    processes.value = rows;
    // Keep the current selection if it still exists, else preselect the top row.
    if (!rows.some((p) => p.pid === selectedPid.value)) {
      selectedPid.value = rows[0]?.pid ?? null;
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
    processes.value = [];
    selectedPid.value = null;
  } finally {
    loading.value = false;
  }
}

async function kill(mode: "cancel" | "terminate") {
  const pid = selectedPid.value;
  if (!pid || killing.value) return;
  killing.value = true;
  try {
    const signaled = await killProcess(props.connectionId, props.database, pid, mode);
    if (signaled) {
      toast(t("processes.killed", { pid }), { variant: "success" });
    } else {
      // Postgres reports when the backend was already gone (no signal sent).
      toast(t("processes.notRunning", { pid }), { variant: "info" });
    }
    await load();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    toast(t("processes.killFailed"), { variant: "error", description: detail });
  } finally {
    killing.value = false;
  }
}

watch(
  open,
  (isOpen) => {
    if (isOpen) void load();
  },
  { immediate: true },
);
</script>

<template>
  <DsDialog v-model:open="open" :title="t('processes.title')" :icon="OctagonX" content-class="sm:max-w-[760px]">
    <div class="space-y-3 text-sm">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-[var(--ds-text-3)]">{{ t("processes.description") }}</p>
        <Button variant="ghost" size="icon-sm" :disabled="loading" @click="load">
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" />
        </Button>
      </div>

      <div class="rounded-md border border-[var(--ds-border-soft)] bg-[var(--ds-bg-canvas)] max-h-72 overflow-auto">
        <div v-if="loading" class="flex items-center justify-center gap-2 py-10 text-[var(--ds-text-3)]">
          <Loader2 class="h-4 w-4 animate-spin" />
          {{ t("processes.loading") }}
        </div>
        <div v-else-if="errorMessage" class="px-4 py-8 text-center text-[var(--ds-red)] text-xs">
          {{ errorMessage }}
        </div>
        <div v-else-if="processes.length === 0" class="px-4 py-10 text-center text-[var(--ds-text-3)] text-xs">
          {{ t("processes.noProcesses") }}
        </div>
        <table v-else class="w-full text-left text-xs">
          <thead class="sticky top-0 bg-[var(--ds-bg-surface)] text-[var(--ds-text-3)]">
            <tr class="border-b border-[var(--ds-border-soft)]">
              <th class="w-8 px-2 py-1.5"></th>
              <th class="px-2 py-1.5 font-medium whitespace-nowrap">{{ t("processes.colPid") }}</th>
              <th class="px-2 py-1.5 font-medium">{{ t("processes.colQuery") }}</th>
              <th class="px-2 py-1.5 font-medium whitespace-nowrap">{{ t("processes.colState") }}</th>
              <th class="px-2 py-1.5 font-medium whitespace-nowrap text-right">{{ t("processes.colDuration") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="proc in processes"
              :key="proc.pid"
              class="cursor-pointer border-b border-[var(--ds-border-soft)] last:border-0 hover:bg-[var(--ds-bg-hover)]"
              :class="{
                'bg-[color-mix(in_srgb,var(--ds-red)_12%,transparent)]': proc.pid === selectedPid,
                'bg-[color-mix(in_srgb,var(--ds-amber)_10%,transparent)]':
                  proc.pid !== selectedPid && currentPids.has(proc.pid),
              }"
              @click="selectedPid = proc.pid"
            >
              <td class="px-2 py-1.5 align-top">
                <input
                  type="radio"
                  :checked="proc.pid === selectedPid"
                  :aria-label="proc.pid"
                  @change="selectedPid = proc.pid"
                />
              </td>
              <td class="px-2 py-1.5 align-top font-mono whitespace-nowrap">
                {{ proc.pid }}
                <span v-if="currentPids.has(proc.pid)" class="ml-1 text-[10px] text-[var(--ds-amber)]">{{
                  t("processes.thisQuery")
                }}</span>
              </td>
              <td class="px-2 py-1.5 align-top">
                <div class="font-mono max-w-[340px] truncate" :title="proc.query ?? ''">
                  {{ proc.query ?? "—" }}
                </div>
              </td>
              <td class="px-2 py-1.5 align-top whitespace-nowrap text-[var(--ds-text-3)]">{{ proc.state ?? "—" }}</td>
              <td class="px-2 py-1.5 align-top whitespace-nowrap text-right tabular-nums">
                {{ formatDuration(proc.durationSecs) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="isSqlServer" class="text-[11px] text-[var(--ds-text-3)]">{{ t("processes.sqlServerCancelNote") }}</p>
    </div>

    <template #footer>
      <Button variant="outline" @click="open = false">{{ t("common.close") }}</Button>
      <Button
        variant="outline"
        :disabled="!selectedPid || killing"
        class="text-[var(--ds-red)]"
        @click="kill('terminate')"
      >
        {{ t("processes.terminate") }}
      </Button>
      <Button :disabled="!selectedPid || killing" @click="kill('cancel')">
        <Loader2 v-if="killing" class="h-4 w-4 animate-spin" />
        <OctagonX v-else class="h-4 w-4" />
        {{ t("processes.cancelQuery") }}
      </Button>
    </template>
  </DsDialog>
</template>
