<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { useVModel } from "@vueuse/core";
import { cn } from "@/lib/utils";

const props = defineProps<{
  defaultValue?: string | number;
  modelValue?: string | number;
  class?: HTMLAttributes["class"];
}>();

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void;
}>();

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
});
</script>

<template>
  <input
    v-model="modelValue"
    autocapitalize="off"
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    data-slot="input"
    :class="
      cn(
        'border-[var(--ds-border)] bg-[var(--ds-bg-input)] text-[var(--ds-text-1)] placeholder:text-[var(--ds-text-3)] hover:border-[var(--ds-border-strong)] focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-[var(--ds-accent-line)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 w-full min-w-0 rounded-sm border px-2.5 py-1 text-[12.5px] transition-[background-color,border-color,color,box-shadow] duration-[var(--ds-dur-2)] ease-[var(--ds-ease)] outline-none aria-invalid:ring-3 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  />
</template>
