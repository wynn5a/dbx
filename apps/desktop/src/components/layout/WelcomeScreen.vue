<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { FilePlus2, Plus, History, Download, Database, Search, ShieldCheck, Sparkles } from "@lucide/vue";
import DatabaseIcon from "@/components/icons/DatabaseIcon.vue";
import {
  connectionDriverLabel,
  connectionIconType,
  connectionRedactedNameLabel,
  connectionRedactedOptionSubtitle,
} from "@/lib/connectionPresentation";
import type { ConnectionConfig } from "@/types/database";

const props = defineProps<{
  connectionStats: { total: number; connected: number; types: number };
  databaseTypes: { iconType: string; label: string; count: number }[];
  recentConnections: ConnectionConfig[];
  connectedIds: Set<string>;
  lastUsedAt: Record<string, number>;
  appVersion: string;
  hasConnections: boolean;
}>();

// Cap the visible icon band so the stat card stays one tidy row; overflow folds
// into a "+N" chip.
const MAX_TYPE_BADGES = 6;
const visibleDatabaseTypes = computed(() => props.databaseTypes.slice(0, MAX_TYPE_BADGES));
const hiddenDatabaseTypeCount = computed(() => Math.max(0, props.databaseTypes.length - MAX_TYPE_BADGES));

const emit = defineEmits<{
  "open-connection-query": [connectionId: string];
  "new-connection": [];
  "new-query": [];
  "show-history": [];
  "import-config": [];
  "open-github": [];
  "open-mcp-guide": [];
}>();

const { t, locale } = useI18n();

// Locale-aware "2h ago" style label from a stored epoch-ms timestamp. Snapshotted
// at render time (the Welcome screen is only visible while no tab is open, so it
// doesn't need to tick live). Returns "" when the connection has never been used.
function formatLastUsed(connectionId: string): string {
  const ts = props.lastUsedAt[connectionId];
  if (!ts) return "";
  const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
  const seconds = Math.round((ts - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return rtf.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(months, "month");
  return rtf.format(Math.round(months / 12), "year");
}
</script>

<template>
  <div class="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--ds-bg-base)]">
    <div class="mx-auto flex min-h-full w-full min-w-0 max-w-5xl flex-col justify-center gap-6 px-8 py-10">
      <!-- Header: orient the user before the cards -->
      <div class="flex flex-col gap-1">
        <h1 class="text-[20px] font-semibold leading-tight tracking-[-0.022em] text-[var(--ds-text-1)]">
          {{ t("welcome.title") }}
        </h1>
        <p class="max-w-2xl text-[13px] leading-5 text-[var(--ds-text-3)]">{{ t("welcome.subtitle") }}</p>
      </div>

      <!-- Stats row -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="ds-card px-4 py-3">
          <div class="ds-section-label"><Database class="h-3 w-3" />{{ t("welcome.connections") }}</div>
          <div class="mt-2 text-[22px] font-semibold leading-none tracking-[-0.022em] text-[var(--ds-text-1)]">
            {{ connectionStats.total }}
          </div>
        </div>
        <div class="ds-card px-4 py-3">
          <div class="ds-section-label"><ShieldCheck class="h-3 w-3" />{{ t("welcome.connected") }}</div>
          <div
            class="mt-2 text-[22px] font-semibold leading-none tracking-[-0.022em]"
            :class="connectionStats.connected > 0 ? 'text-[var(--ds-green)]' : 'text-[var(--ds-text-1)]'"
          >
            {{ connectionStats.connected }}
          </div>
        </div>
        <div class="ds-card px-4 py-3">
          <div class="ds-section-label"><Sparkles class="h-3 w-3" />{{ t("welcome.databaseTypes") }}</div>
          <div class="mt-2 flex items-center gap-2.5">
            <span class="text-[22px] font-semibold leading-none tracking-[-0.022em] text-[var(--ds-text-1)]">
              {{ connectionStats.types }}
            </span>
            <!-- Icon band: one chip per distinct database type, most-used first -->
            <div v-if="visibleDatabaseTypes.length > 0" class="flex min-w-0 items-center gap-1">
              <span
                v-for="dbType in visibleDatabaseTypes"
                :key="dbType.iconType"
                :title="dbType.label"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--ds-radius-sm)] border border-[var(--ds-border-soft)] bg-[var(--ds-bg-elevated)]"
              >
                <DatabaseIcon :db-type="dbType.iconType" class="h-3.5 w-3.5 text-[var(--ds-text-2)]" />
              </span>
              <span
                v-if="hiddenDatabaseTypeCount > 0"
                class="flex h-6 shrink-0 items-center justify-center rounded-[var(--ds-radius-sm)] border border-[var(--ds-border-soft)] bg-[var(--ds-bg-elevated)] px-1.5 text-[11px] font-medium tabular-nums text-[var(--ds-text-3)]"
              >
                +{{ hiddenDatabaseTypeCount }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Main grid: connections + shortcuts -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <!-- Quick connections -->
        <div class="ds-card overflow-hidden">
          <div class="border-b border-[var(--ds-border-soft)] px-4 py-3">
            <div class="ds-section-label">{{ t("welcome.quickConnections") }}</div>
            <p v-if="recentConnections.length > 0" class="mt-1 text-[11.5px] leading-4 text-[var(--ds-text-4)]">
              {{ t("welcome.quickConnectionsHint") }}
            </p>
          </div>
          <div class="divide-y divide-[var(--ds-border-soft)]">
            <button
              v-for="connection in recentConnections"
              :key="connection.id"
              class="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)]"
              @click="emit('open-connection-query', connection.id)"
            >
              <DatabaseIcon
                :db-type="connectionIconType(connection)"
                class="h-4 w-4 shrink-0 text-[var(--ds-text-3)]"
              />
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :style="{ backgroundColor: connection.color || 'var(--ds-text-4)' }"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium leading-5 text-[var(--ds-text-1)]">
                  {{ connectionRedactedNameLabel(connection) }}
                </div>
                <div class="truncate text-[11.5px] leading-4 text-[var(--ds-text-3)]">
                  {{ connectionRedactedOptionSubtitle(connection) || connectionDriverLabel(connection) }}
                </div>
              </div>
              <!-- Right rail: live "Connected" state, else relative last-used time -->
              <span
                v-if="connectedIds.has(connection.id)"
                class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[var(--ds-green)]"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-[var(--ds-green)]" />
                {{ t("welcome.connected") }}
              </span>
              <span
                v-else-if="formatLastUsed(connection.id)"
                class="shrink-0 text-[11px] tabular-nums text-[var(--ds-text-4)]"
              >
                {{ formatLastUsed(connection.id) }}
              </span>
              <FilePlus2
                class="h-4 w-4 shrink-0 text-[var(--ds-text-4)] opacity-0 transition-opacity duration-[var(--ds-speed)] ease-[var(--ds-ease)] group-hover:opacity-100"
              />
            </button>
            <!-- DS empty state: centered icon + text + chip CTA -->
            <div
              v-if="recentConnections.length === 0"
              class="flex flex-col items-center gap-2.5 px-4 py-10 text-center"
            >
              <Database class="h-7 w-7 text-[var(--ds-text-4)]" />
              <span class="text-[13px] text-[var(--ds-text-2)]">{{ t("sidebar.noConnections") }}</span>
              <button
                class="mt-0.5 inline-flex items-center gap-1.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] bg-transparent px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
                @click="emit('new-connection')"
              >
                <Plus class="h-3.5 w-3.5" />{{ t("toolbar.newConnection") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Shortcuts -->
        <div class="ds-card overflow-hidden">
          <div class="border-b border-[var(--ds-border-soft)] px-4 py-3">
            <div class="ds-section-label">{{ t("welcome.shortcuts") }}</div>
          </div>
          <div class="grid gap-0.5 p-2">
            <button
              class="flex w-full items-center gap-2.5 rounded-[var(--ds-radius-sm)] px-2.5 py-2 text-left text-[13px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              @click="emit('new-connection')"
            >
              <Plus class="h-4 w-4 shrink-0" />
              <span class="flex-1">{{ t("toolbar.newConnection") }}</span>
            </button>
            <button
              class="flex w-full items-center gap-2.5 rounded-[var(--ds-radius-sm)] px-2.5 py-2 text-left text-[13px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] disabled:cursor-default disabled:text-[var(--ds-text-4)] disabled:hover:bg-transparent disabled:hover:text-[var(--ds-text-4)]"
              :disabled="!hasConnections"
              @click="emit('new-query')"
            >
              <FilePlus2 class="h-4 w-4 shrink-0" />
              <span class="flex-1">{{ t("toolbar.newQuery") }}</span>
            </button>
            <button
              class="flex w-full items-center gap-2.5 rounded-[var(--ds-radius-sm)] px-2.5 py-2 text-left text-[13px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              @click="emit('show-history')"
            >
              <History class="h-4 w-4 shrink-0" />
              <span class="flex-1">{{ t("history.title") }}</span>
            </button>
            <button
              class="flex w-full items-center gap-2.5 rounded-[var(--ds-radius-sm)] px-2.5 py-2 text-left text-[13px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              @click="emit('import-config')"
            >
              <Download class="h-4 w-4 shrink-0" />
              <span class="flex-1">{{ t("sidebar.import") }}</span>
            </button>
            <!-- Search tip: elevated surface with border, matching DS tooltip/kbd surface recipe -->
            <div
              class="mt-1.5 flex items-center gap-1.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border-soft)] bg-[var(--ds-bg-elevated)] px-2.5 py-2 text-[11.5px] text-[var(--ds-text-3)]"
            >
              <Search class="h-3.5 w-3.5 shrink-0" />
              <span>{{ t("welcome.tip") }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP hint: accent-tinted card to distinguish from data cards -->
      <div
        class="ds-card overflow-hidden"
        style="
          background: color-mix(in srgb, var(--ds-accent) 6%, var(--ds-bg-panel));
          border-color: color-mix(in srgb, var(--ds-accent) 20%, transparent);
        "
      >
        <div class="flex items-start gap-3 px-5 py-4">
          <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--ds-accent-soft)]">
            <Sparkles class="h-3.5 w-3.5 text-[var(--ds-accent)]" />
          </div>
          <div class="min-w-0">
            <div class="text-[13px] font-medium text-[var(--ds-text-1)]">{{ t("welcome.mcpTitle") }}</div>
            <p class="mt-1 text-[11.5px] leading-5 text-[var(--ds-text-3)]">
              {{ t("welcome.mcpDescription") }}
            </p>
            <div class="mt-2.5 flex flex-wrap items-center gap-2">
              <code
                class="max-w-full break-all rounded border border-[var(--ds-border-soft)] bg-[var(--ds-bg-active)] px-2 py-0.5 text-[11px] text-[var(--ds-text-2)] select-all [font-family:var(--ds-mono)]"
                >npx @dbx-app/mcp-server</code
              >
              <a
                href="#"
                class="text-[12px] text-[var(--ds-accent)] hover:underline"
                @click.prevent="emit('open-mcp-guide')"
                >{{ t("welcome.mcpLearnMore") }}</a
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-center gap-3 text-[11px] text-[var(--ds-text-4)]">
        <span>DBX {{ appVersion ? "v" + appVersion : "" }}</span>
        <span aria-hidden="true">·</span>
        <a
          href="#"
          class="transition-colors duration-[var(--ds-speed)] hover:text-[var(--ds-text-1)]"
          @click.prevent="emit('open-github')"
          >GitHub</a
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Welcome cards read cleaner ("通透/轻灵"): drop the faint top-to-transparent
   gradient for a flat fill, and brighten the whole hairline border one step
   (evenly on all four edges) rather than adding a top-only sheen — the sheen
   stacked on the top border and made it look thicker than the other sides.
   Scoped to the Welcome page so the rest of the app keeps the standard .ds-card. */
.ds-card {
  background: var(--ds-bg-panel);
  border-color: var(--ds-border-strong);
  box-shadow: var(--ds-shadow-card);
}
</style>
