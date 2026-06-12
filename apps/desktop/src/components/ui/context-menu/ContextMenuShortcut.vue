<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span
    data-slot="context-menu-shortcut"
    :class="
      cn(
        'text-[var(--ds-text-3)] group-focus/context-menu-item:text-[var(--ds-text-1)] ml-auto text-xs tracking-widest',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>
