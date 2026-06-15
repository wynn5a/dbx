<script setup lang="ts">
import { computed } from "vue";
import { AlertCircle, Check, Info, X } from "@lucide/vue";
import type { ToastVariant } from "@/composables/useToast";

const props = defineProps<{
  title: string;
  description?: string;
  variant: ToastVariant;
}>();

const emit = defineEmits<{
  dismiss: [];
}>();

const iconStyle = computed(() => {
  const color =
    props.variant === "error" ? "var(--ds-red)" : props.variant === "info" ? "var(--ds-accent)" : "var(--ds-green)";
  return {
    background: `color-mix(in srgb, ${color} 16%, transparent)`,
    color,
  };
});

const Icon = computed(() => {
  if (props.variant === "error") return AlertCircle;
  if (props.variant === "info") return Info;
  return Check;
});
</script>

<template>
  <div class="ds-toast" role="status" aria-live="polite" aria-atomic="true">
    <span class="ds-toast-icon" :style="iconStyle">
      <component :is="Icon" class="size-[15px]" stroke-width="2" />
    </span>
    <div class="ds-toast-body">
      <b>{{ title }}</b>
      <p v-if="description">{{ description }}</p>
    </div>
    <button type="button" class="ds-toast-close" aria-label="Dismiss" @click="emit('dismiss')">
      <X class="size-[13px]" stroke-width="1.6" />
    </button>
  </div>
</template>
