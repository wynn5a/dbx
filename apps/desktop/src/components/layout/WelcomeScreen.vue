<script setup lang="ts">
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

defineProps<{
  connectionStats: { total: number; connected: number; types: number };
  recentConnections: ConnectionConfig[];
  appVersion: string;
  hasConnections: boolean;
}>();

const emit = defineEmits<{
  "open-connection-query": [connectionId: string];
  "new-connection": [];
  "new-query": [];
  "show-history": [];
  "import-config": [];
  "open-github": [];
  "open-mcp-guide": [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--ds-bg-base)]">
    <div class="mx-auto flex min-h-full w-full min-w-0 max-w-5xl flex-col justify-center gap-6 px-8 py-10">
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="ds-card px-4 py-3">
          <div class="flex items-center gap-2 text-xs text-[var(--ds-text-3)]">
            <Database class="h-3.5 w-3.5" /> {{ t("welcome.connections") }}
          </div>
          <div class="mt-2 text-2xl font-semibold text-[var(--ds-text-1)]">{{ connectionStats.total }}</div>
        </div>
        <div class="ds-card px-4 py-3">
          <div class="flex items-center gap-2 text-xs text-[var(--ds-text-3)]">
            <ShieldCheck class="h-3.5 w-3.5" /> {{ t("welcome.connected") }}
          </div>
          <div class="mt-2 text-2xl font-semibold text-[var(--ds-text-1)]">{{ connectionStats.connected }}</div>
        </div>
        <div class="ds-card px-4 py-3">
          <div class="flex items-center gap-2 text-xs text-[var(--ds-text-3)]">
            <Sparkles class="h-3.5 w-3.5" /> {{ t("welcome.databaseTypes") }}
          </div>
          <div class="mt-2 text-2xl font-semibold text-[var(--ds-text-1)]">{{ connectionStats.types }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div class="ds-card overflow-hidden">
          <div class="flex items-center justify-between border-b border-[var(--ds-border-soft)] px-4 py-3">
            <div class="text-sm font-medium text-[var(--ds-text-1)]">{{ t("welcome.quickConnections") }}</div>
          </div>
          <div class="divide-y divide-[var(--ds-border-soft)]">
            <button
              v-for="connection in recentConnections"
              :key="connection.id"
              class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)]"
              @click="emit('open-connection-query', connection.id)"
            >
              <DatabaseIcon :db-type="connectionIconType(connection)" class="h-4 w-4" />
              <span class="h-5 w-1 rounded-full shrink-0" :style="{ backgroundColor: connection.color || '#9ca3af' }" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-[var(--ds-text-1)]">
                  {{ connectionRedactedNameLabel(connection) }}
                </div>
                <div class="truncate text-xs text-[var(--ds-text-3)]">
                  {{ connectionRedactedOptionSubtitle(connection) || connectionDriverLabel(connection) }}
                </div>
              </div>
              <FilePlus2 class="h-4 w-4 text-[var(--ds-text-3)]" />
            </button>
            <div v-if="recentConnections.length === 0" class="px-4 py-8 text-sm text-[var(--ds-text-3)]">
              {{ t("sidebar.noConnections") }}
            </div>
          </div>
        </div>

        <div class="ds-card overflow-hidden">
          <div class="border-b border-[var(--ds-border-soft)] px-4 py-3">
            <div class="text-sm font-medium text-[var(--ds-text-1)]">{{ t("welcome.shortcuts") }}</div>
          </div>
          <div class="grid gap-1 p-2">
            <button
              class="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              @click="emit('new-connection')"
            >
              <Plus class="h-4 w-4" /> {{ t("toolbar.newConnection") }}
            </button>
            <button
              class="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] disabled:opacity-50"
              :disabled="!hasConnections"
              @click="emit('new-query')"
            >
              <FilePlus2 class="h-4 w-4" /> {{ t("toolbar.newQuery") }}
            </button>
            <button
              class="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              @click="emit('show-history')"
            >
              <History class="h-4 w-4" /> {{ t("history.title") }}
            </button>
            <button
              class="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
              @click="emit('import-config')"
            >
              <Download class="h-4 w-4" /> {{ t("sidebar.import") }}
            </button>
            <div class="mt-2 rounded-md bg-[var(--ds-bg-active)] px-3 py-2 text-xs leading-5 text-[var(--ds-text-3)]">
              <Search class="mr-1 inline h-3.5 w-3.5" />
              {{ t("welcome.tip") }}
            </div>
          </div>
        </div>
      </div>

      <!-- MCP Integration Hint -->
      <div class="ds-card px-5 py-4">
        <div class="flex items-start gap-3">
          <Sparkles class="h-4 w-4 mt-0.5 text-[var(--ds-accent)] shrink-0" />
          <div class="min-w-0">
            <div class="text-sm font-medium text-[var(--ds-text-1)]">{{ t("welcome.mcpTitle") }}</div>
            <p class="mt-1 text-xs leading-5 text-[var(--ds-text-3)]">
              {{ t("welcome.mcpDescription") }}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <code
                class="max-w-full break-all rounded bg-[var(--ds-bg-active)] px-2 py-0.5 text-[11px] text-[var(--ds-text-2)] select-all"
                style="font-family: var(--ds-mono)"
                >npx @dbx-app/mcp-server</code
              >
              <a
                href="#"
                class="text-xs text-[var(--ds-accent)] hover:underline"
                @click.prevent="emit('open-mcp-guide')"
                >{{ t("welcome.mcpLearnMore") }}</a
              >
            </div>
          </div>
        </div>
      </div>

      <!-- Project Info -->
      <div class="mt-2 flex items-center justify-center gap-3 text-[11px] text-[var(--ds-text-4)]">
        <span>DBX {{ appVersion ? "v" + appVersion : "" }}</span>
        <span>·</span>
        <a href="#" class="hover:text-[var(--ds-text-1)] transition-colors" @click.prevent="emit('open-github')"
          >GitHub</a
        >
      </div>
    </div>
  </div>
</template>
