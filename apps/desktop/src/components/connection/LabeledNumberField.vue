<script setup lang="ts">
import { computed } from "vue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "@lucide/vue";

const props = defineProps<{
  label: string;
  unit?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  disabled?: boolean;
}>();

const model = defineModel<number>();

const stepValue = computed(() => Number(props.step) || 1);
const minValue = computed(() => (props.min === undefined || props.min === "" ? null : Number(props.min)));
const maxValue = computed(() => (props.max === undefined || props.max === "" ? null : Number(props.max)));

const canStepUp = computed(
  () => !props.disabled && (maxValue.value === null || Number(model.value ?? 0) < maxValue.value),
);
const canStepDown = computed(
  () => !props.disabled && (minValue.value === null || Number(model.value ?? 0) > minValue.value),
);

function clamp(value: number): number {
  let next = value;
  if (minValue.value !== null) next = Math.max(minValue.value, next);
  if (maxValue.value !== null) next = Math.min(maxValue.value, next);
  return next;
}

function onUpdate(value: string | number) {
  const next = Number(value);
  model.value = Number.isFinite(next) ? next : undefined;
}

function step(direction: 1 | -1) {
  if (props.disabled) return;
  const base = Number.isFinite(Number(model.value)) ? Number(model.value) : 0;
  model.value = clamp(base + direction * stepValue.value);
}
</script>

<template>
  <div class="grid grid-cols-4 items-center gap-4">
    <Label class="text-right text-xs">{{ props.label }}</Label>
    <div class="col-span-3 flex h-8 items-stretch">
      <Input
        :model-value="model"
        type="number"
        :min="props.min"
        :max="props.max"
        :step="props.step"
        :disabled="props.disabled"
        class="h-full min-w-0 flex-1 rounded-r-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        @update:model-value="onUpdate"
      />
      <div
        class="flex w-8 shrink-0 flex-col border-y border-[var(--ds-border)]"
        :class="props.unit ? '' : 'rounded-r-sm border-r'"
      >
        <button
          type="button"
          tabindex="-1"
          :disabled="!canStepUp"
          class="flex flex-1 items-center justify-center bg-[var(--ds-bg-input)] text-[var(--ds-text-2)] transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] active:bg-[var(--ds-bg-active)] active:text-[var(--ds-accent)] disabled:pointer-events-none disabled:opacity-40 [&>svg]:transition-transform [&>svg]:duration-100 active:[&>svg]:scale-75"
          :class="props.unit ? '' : 'rounded-tr-sm'"
          @click="step(1)"
        >
          <ChevronUp class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          tabindex="-1"
          :disabled="!canStepDown"
          class="flex flex-1 items-center justify-center border-t border-[var(--ds-border)] bg-[var(--ds-bg-input)] text-[var(--ds-text-2)] transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] active:bg-[var(--ds-bg-active)] active:text-[var(--ds-accent)] disabled:pointer-events-none disabled:opacity-40 [&>svg]:transition-transform [&>svg]:duration-100 active:[&>svg]:scale-75"
          :class="props.unit ? '' : 'rounded-br-sm'"
          @click="step(-1)"
        >
          <ChevronDown class="h-3.5 w-3.5" />
        </button>
      </div>
      <span
        v-if="props.unit"
        class="inline-flex shrink-0 items-center rounded-r-sm border border-l border-[var(--ds-border)] bg-[var(--ds-bg-elevated)] px-2.5 text-xs font-medium text-[var(--ds-text-3)]"
        :class="props.disabled ? 'opacity-50' : undefined"
      >
        {{ props.unit }}
      </span>
    </div>
  </div>
</template>
