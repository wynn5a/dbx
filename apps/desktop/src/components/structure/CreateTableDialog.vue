<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Database, Loader2, Table2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import TableStructureEditor from "@/components/structure/TableStructureEditor.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { buildStructureTargetLabel } from "@/lib/tableStructureEditorState";
import { isMacOS } from "@/lib/platform";

const props = defineProps<{
  prefillConnectionId: string;
  prefillDatabase: string;
  prefillSchema?: string;
}>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();
const connectionStore = useConnectionStore();

const editorRef = ref<InstanceType<typeof TableStructureEditor> | null>(null);

const connection = computed(() =>
  props.prefillConnectionId ? connectionStore.getConfig(props.prefillConnectionId) : undefined,
);
const breadcrumb = computed(() =>
  buildStructureTargetLabel(connection.value?.name, props.prefillDatabase, props.prefillSchema, undefined),
);
const driverLabel = computed(() => connection.value?.driver_label || "");

const canCreate = computed(() => editorRef.value?.canApply ?? false);
const saving = computed(() => editorRef.value?.saving ?? false);
const modKey = isMacOS() ? "⌘" : "Ctrl";

function create() {
  if (!editorRef.value || !canCreate.value) return;
  void editorRef.value.applyChanges();
}

async function onSaved() {
  try {
    await connectionStore.refreshObjectListTreeNode(
      props.prefillConnectionId,
      props.prefillDatabase,
      props.prefillSchema || undefined,
    );
  } catch {
    /* tree refresh is best-effort */
  }
}

function onDialogKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    create();
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="ds-dialog flex h-[80vh] max-h-[calc(100dvh-3rem)] w-[min(1120px,calc(100vw-3rem))] max-w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
      :show-close-button="false"
      @keydown="onDialogKeydown"
    >
      <!-- Header: icon + title/breadcrumb, driver badge, Cancel / Create -->
      <div class="flex shrink-0 items-center gap-3 border-b border-[var(--ds-border)] px-4 py-3">
        <div
          class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
        >
          <Table2 class="h-[18px] w-[18px]" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <DialogTitle class="truncate text-[15px] font-semibold tracking-[-0.012em] text-[var(--ds-text-1)]">
            {{ t("structureEditor.newTable") }}
          </DialogTitle>
          <span v-if="breadcrumb" class="flex min-w-0 items-center gap-1 text-xs text-[var(--ds-text-3)]">
            <Database class="h-3 w-3 shrink-0 text-[var(--ds-text-4)]" />
            <span class="truncate">{{ breadcrumb }}</span>
          </span>
        </div>
        <span
          v-if="driverLabel"
          class="inline-flex h-6 shrink-0 items-center rounded-md border border-[var(--ds-border)] px-2 font-mono text-[11px] text-[var(--ds-text-2)]"
        >
          {{ driverLabel }}
        </span>
        <Button variant="outline" size="sm" @click="open = false">{{ t("common.cancel") }}</Button>
        <Button size="sm" :disabled="!canCreate" class="gap-1.5" @click="create">
          <Loader2 v-if="saving" class="h-3.5 w-3.5 animate-spin" />
          <Check v-else class="h-3.5 w-3.5" />
          {{ t("structureEditor.createTable") }}
          <span
            class="ml-0.5 rounded bg-[rgb(255_255_255/0.16)] px-1.5 py-px font-mono text-[10.5px] leading-none text-[rgb(255_255_255/0.9)]"
          >
            {{ modKey }}↵
          </span>
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        <TableStructureEditor
          ref="editorRef"
          presentation="dialog"
          :connection-id="prefillConnectionId"
          :database="prefillDatabase"
          :schema="prefillSchema"
          table-name=""
          @saved="onSaved"
          @close="open = false"
        />
      </div>
    </DialogContent>
  </Dialog>
</template>
