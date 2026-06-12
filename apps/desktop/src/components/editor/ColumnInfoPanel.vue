<script setup lang="ts">
import { X, Copy } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/composables/useToast";
import { copyToClipboard } from "@/lib/clipboard";

export interface ColumnInfo {
  name: string;
  table: string;
  dataType?: string;
  isNullable?: boolean;
  columnDefault?: string | null;
  isPrimaryKey?: boolean;
  comment?: string | null;
  extra?: string | null;
}

defineProps<{
  columns: ColumnInfo[];
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const { toast } = useToast();

async function copyText(text: string) {
  try {
    await copyToClipboard(text);
    toast(t("grid.copied"));
  } catch (e: any) {
    toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
  }
}
</script>

<template>
  <div
    class="absolute top-0 right-0 bottom-0 z-10 w-72 bg-[var(--ds-bg-panel)] border-l border-[var(--ds-border)] shadow-[var(--ds-shadow-pop)] flex flex-col"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--ds-border)]">
      <span class="text-sm font-medium text-[var(--ds-text-1)]">{{ t("grid.columnDetails") }}</span>
      <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="emit('close')">
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3">
      <template v-if="loading">
        <div class="text-xs text-[var(--ds-text-3)] animate-pulse">{{ t("common.loading") }}</div>
      </template>

      <template v-else-if="error">
        <div class="text-xs text-[var(--ds-red)]">{{ error }}</div>
      </template>

      <template v-else>
        <!-- Column detail sections -->
        <div v-for="(col, idx) in columns" :key="idx" class="space-y-2">
          <!-- Column header -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-sm text-[var(--ds-text-1)]">{{ col.name }}</span>
              <Badge
                v-if="col.isPrimaryKey"
                variant="outline"
                class="h-4 px-1 font-mono text-[10px] border-[color-mix(in_srgb,var(--ds-amber)_40%,transparent)] text-[var(--ds-amber)]"
              >
                PK
              </Badge>
            </div>
            <Button variant="ghost" size="sm" class="h-5 w-5 p-0" @click="copyText(col.name)">
              <Copy class="h-3 w-3" />
            </Button>
          </div>

          <!-- Table origin -->
          <div class="text-xs text-[var(--ds-text-3)]">{{ t("tabs.tooltipTable") }} {{ col.table }}</div>

          <!-- Detail rows -->
          <div class="rounded-md border border-[var(--ds-border)] divide-y divide-[var(--ds-border-soft)] text-xs">
            <div class="flex items-center justify-between px-2 py-1">
              <span class="text-[var(--ds-text-3)]">{{ t("grid.columnType") }}</span>
              <span class="font-mono text-[var(--ds-t-int)] max-w-[180px] truncate" :title="col.dataType">
                {{ col.dataType || "—" }}
              </span>
            </div>
            <div class="flex items-center justify-between px-2 py-1">
              <span class="text-[var(--ds-text-3)]">{{ t("structureEditor.nullable") }}</span>
              <span class="font-medium text-[var(--ds-text-1)]">{{
                col.isNullable ? t("structureEditor.yes") : t("structureEditor.no")
              }}</span>
            </div>
            <div v-if="col.columnDefault" class="flex items-start justify-between px-2 py-1 gap-2">
              <span class="text-[var(--ds-text-3)] shrink-0">{{ t("structureEditor.defaultValue") }}</span>
              <span
                class="font-mono text-[var(--ds-text-1)] text-right max-w-[180px] truncate"
                :title="col.columnDefault"
              >
                {{ col.columnDefault }}
              </span>
            </div>
            <div v-if="col.comment" class="flex items-start justify-between px-2 py-1 gap-2">
              <span class="text-[var(--ds-text-3)] shrink-0">{{ t("structureEditor.comment") }}</span>
              <span class="font-medium text-[var(--ds-text-1)] text-right max-w-[180px] truncate" :title="col.comment">
                {{ col.comment }}
              </span>
            </div>
            <div v-if="col.extra" class="flex items-start justify-between px-2 py-1 gap-2">
              <span class="text-[var(--ds-text-3)] shrink-0">Extra</span>
              <span class="font-mono text-[var(--ds-text-1)] text-right max-w-[180px] truncate" :title="col.extra">
                {{ col.extra }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
