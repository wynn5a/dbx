<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span data-slot="tooltip-keys" :class="cn('ds-tooltip-keys shrink-0', props.class)">
    <slot />
  </span>
</template>
