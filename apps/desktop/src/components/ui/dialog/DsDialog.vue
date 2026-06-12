<script setup lang="ts">
import type { Component, HTMLAttributes } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import Dialog from "./Dialog.vue";
import DialogClose from "./DialogClose.vue";
import DialogContent from "./DialogContent.vue";
import DialogHeader from "./DialogHeader.vue";
import DialogTitle from "./DialogTitle.vue";
import DialogFooter from "./DialogFooter.vue";

defineOptions({
  inheritAttrs: false,
});

withDefaults(
  defineProps<{
    title: string;
    icon?: Component;
    /** Width class forwarded to DialogContent, e.g. "sm:max-w-[480px]". */
    contentClass?: HTMLAttributes["class"];
    /** Extra classes for the scrollable body wrapper. */
    bodyClass?: HTMLAttributes["class"];
    showClose?: boolean;
  }>(),
  {
    icon: undefined,
    contentClass: "sm:max-w-[420px]",
    bodyClass: "",
    showClose: true,
  },
);

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :class="['ds-dialog flex flex-col gap-0 overflow-hidden p-0', contentClass]"
      :show-close-button="false"
      v-bind="$attrs"
    >
      <DialogHeader
        class="flex h-14 shrink-0 flex-row items-center gap-3 space-y-0 border-b border-[var(--ds-border)] px-4 text-left"
      >
        <div
          v-if="icon"
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
        >
          <component :is="icon" class="h-4 w-4" />
        </div>
        <DialogTitle
          class="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.012em] text-[var(--ds-text-1)]"
        >
          {{ title }}
        </DialogTitle>
        <slot name="header-actions" />
        <DialogClose v-if="showClose" as-child>
          <Button variant="ghost" size="icon-sm" class="-mr-1 shrink-0">
            <X />
            <span class="sr-only">{{ t("common.close") }}</span>
          </Button>
        </DialogClose>
      </DialogHeader>

      <div :class="['min-h-0 flex-1 overflow-y-auto px-4 py-5', bodyClass]">
        <slot />
      </div>

      <DialogFooter
        v-if="$slots.footer"
        class="mx-0 mb-0 shrink-0 rounded-none border-t border-[var(--ds-border)] bg-transparent px-4 py-3"
      >
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
