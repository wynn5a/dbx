<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { AlertTriangle } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSqlHighlighter } from "@/composables/useSqlHighlighter";

const { t } = useI18n();
const { highlight } = useSqlHighlighter();

const open = defineModel<boolean>("open", { default: false });
const suppressFuturePrompts = defineModel<boolean>("suppressFuturePrompts", { default: false });

const props = withDefaults(
  defineProps<{
    sql?: string;
    title?: string;
    message?: string;
    details?: string;
    confirmLabel?: string;
    showSuppressToggle?: boolean;
    suppressToggleLabel?: string;
  }>(),
  {
    sql: "",
    title: "",
    message: "",
    details: "",
    confirmLabel: "",
    showSuppressToggle: false,
    suppressToggleLabel: "",
  },
);

const emit = defineEmits<{
  confirm: [];
}>();

const code = computed(() => props.details || props.sql);
const highlightedCode = computed(() => highlight(code.value));

function onConfirm() {
  open.value = false;
  emit("confirm");
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="ds-dialog sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-[var(--ds-red)]">
          <AlertTriangle class="h-5 w-5" />
          {{ title || t("dangerDialog.title") }}
        </DialogTitle>
      </DialogHeader>

      <div class="py-4 min-w-0">
        <p class="text-sm text-[var(--ds-text-2)] mb-3">{{ message || t("dangerDialog.message") }}</p>
        <pre
          v-if="code"
          class="text-xs bg-[var(--ds-bg-canvas)] border border-[var(--ds-border-soft)] text-[var(--ds-text-1)] p-3 rounded overflow-auto max-h-40 min-w-0 font-mono whitespace-pre"
          v-html="highlightedCode"
        />
        <div
          v-if="showSuppressToggle"
          class="mt-3 flex items-center justify-between gap-4 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg-active)] px-3 py-2"
        >
          <Label for="danger-confirm-suppress" class="text-sm leading-5 text-[var(--ds-text-2)]">{{
            suppressToggleLabel || t("dangerDialog.suppressFuturePrompts")
          }}</Label>
          <Switch id="danger-confirm-suppress" v-model="suppressFuturePrompts" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="open = false">{{ t("dangerDialog.cancel") }}</Button>
        <Button variant="destructive" @click="onConfirm">{{ confirmLabel || t("dangerDialog.confirm") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
