<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <span data-slot="tooltip-sub" :class="cn('ds-tooltip-sub', props.class)">
    <slot />
  </span>
</template>
