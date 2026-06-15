<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span data-slot="tooltip-kbd" :class="cn('ds-tooltip-kbd shrink-0', props.class)">
    <slot />
  </span>
</template>
