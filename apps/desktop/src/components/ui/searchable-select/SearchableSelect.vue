<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { HTMLAttributes } from "vue";
import { Check, ChevronDown, Search } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterDatabaseOptions } from "@/lib/databaseOptionSearch";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: string[];
    placeholder: string;
    searchPlaceholder: string;
    emptyText: string;
    loadingText: string;
    loading?: boolean;
    allowCustom?: boolean;
    triggerClass?: HTMLAttributes["class"];
    contentClass?: HTMLAttributes["class"];
    displayName?: (option: string) => string;
    normalizeCustom?: (value: string) => string;
  }>(),
  {
    loading: false,
    allowCustom: false,
    displayName: (option: string) => option,
    normalizeCustom: (value: string) => value,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:open": [value: boolean];
}>();

const open = ref(false);
const searchText = ref("");
const searchInput = ref<InstanceType<typeof Input>>();
const listContainer = ref<HTMLDivElement>();
const highlightIndex = ref(-1);

const selectedLabel = computed(() => {
  if (!props.modelValue && !props.options.includes("")) return props.placeholder;
  return props.displayName(props.modelValue);
});

const filteredOptions = computed(() => filterDatabaseOptions(props.options, searchText.value, props.displayName));
const customOptionValue = computed(() => props.normalizeCustom(searchText.value.trim()));
const canSelectCustom = computed(
  () => props.allowCustom && !!customOptionValue.value && !props.options.includes(customOptionValue.value),
);

watch(open, async (value) => {
  emit("update:open", value);
  if (!value) {
    searchText.value = "";
    highlightIndex.value = -1;
    return;
  }
  await nextTick();
  const input = searchInput.value?.$el as HTMLInputElement | undefined;
  input?.focus();
});

watch(searchText, () => {
  highlightIndex.value = 0;
});

watch(highlightIndex, async () => {
  await nextTick();
  const container = listContainer.value;
  if (!container || highlightIndex.value < 0) return;
  const buttons = container.querySelectorAll("button");
  const target = buttons[highlightIndex.value];
  target?.scrollIntoView({ block: "nearest" });
});

function selectOption(option: string) {
  emit("update:modelValue", option);
  open.value = false;
}

function selectCustomOption() {
  if (!canSelectCustom.value) return;
  selectOption(customOptionValue.value);
}

function optionCount() {
  return filteredOptions.value.length + (canSelectCustom.value ? 1 : 0);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    const total = optionCount();
    if (total === 0) return;
    highlightIndex.value = highlightIndex.value < total - 1 ? highlightIndex.value + 1 : 0;
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    const total = optionCount();
    if (total === 0) return;
    highlightIndex.value = highlightIndex.value > 0 ? highlightIndex.value - 1 : total - 1;
  } else if (event.key === "Enter") {
    if (highlightIndex.value < 0 || highlightIndex.value >= optionCount()) return;
    event.preventDefault();
    if (highlightIndex.value < filteredOptions.value.length) {
      selectOption(filteredOptions.value[highlightIndex.value]);
    } else {
      selectCustomOption();
    }
  } else if (event.key === "Escape") {
    open.value = false;
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        :class="
          cn(
            'h-6 w-auto max-w-56 justify-between gap-1 border-0 bg-transparent px-1 text-xs font-normal shadow-none hover:bg-muted/50 focus-visible:ring-0',
            triggerClass,
          )
        "
      >
        <slot name="trigger-label" :value="modelValue" :label="selectedLabel" :loading="loading">
          <!-- Keep showing the selected value while options refresh; swapping to
               the loading text resizes the trigger and makes the toolbar jump.
               The popover list already shows its own loading row. -->
          <span class="min-w-0 truncate">{{ loading && !modelValue ? loadingText : selectedLabel }}</span>
        </slot>
        <ChevronDown
          class="h-3 w-3 shrink-0 opacity-60 transition-transform duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
          :class="{ 'rotate-180': open }"
        />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" :class="cn('ds-popover w-52 gap-1 p-1.5', contentClass)">
      <div class="-mx-1.5 -mt-1.5 flex h-8 shrink-0 items-center gap-2 border-b border-[var(--ds-border-soft)] px-2.5">
        <Search class="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-3)]" />
        <Input
          ref="searchInput"
          :model-value="searchText"
          :placeholder="searchPlaceholder"
          class="h-7 rounded-none border-0 bg-transparent dark:bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0 placeholder:text-[var(--ds-text-3)]"
          @update:model-value="(value) => (searchText = String(value))"
          @keydown="handleKeydown"
        />
      </div>
      <div ref="listContainer" class="max-h-64 overflow-y-auto py-1">
        <div v-if="loading" class="px-2 py-2 text-[13px] text-[var(--ds-text-3)]">
          {{ loadingText }}
        </div>
        <template v-else-if="filteredOptions.length">
          <button
            v-for="(option, index) in filteredOptions"
            :key="option"
            type="button"
            :class="
              cn(
                'flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-[13px] text-[var(--ds-text-2)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] focus-visible:bg-[var(--ds-accent-soft)] focus-visible:text-[var(--ds-text-1)] focus-visible:outline-none',
                index === highlightIndex && 'bg-[var(--ds-accent-soft)] text-[var(--ds-text-1)]',
              )
            "
            @click="selectOption(option)"
          >
            <Check
              :class="
                cn('h-3.5 w-3.5 shrink-0 text-[var(--ds-accent)]', option === modelValue ? 'opacity-100' : 'opacity-0')
              "
            />
            <slot name="option-label" :option="option" :label="displayName(option)">
              <span class="truncate">{{ displayName(option) }}</span>
            </slot>
          </button>
          <button
            v-if="canSelectCustom"
            type="button"
            :class="
              cn(
                'flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-[13px] text-[var(--ds-text-2)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] focus-visible:bg-[var(--ds-accent-soft)] focus-visible:text-[var(--ds-text-1)] focus-visible:outline-none',
                filteredOptions.length === highlightIndex && 'bg-[var(--ds-accent-soft)] text-[var(--ds-text-1)]',
              )
            "
            @click="selectCustomOption"
          >
            <Check class="h-3.5 w-3.5 shrink-0 opacity-0" />
            <slot name="custom-option-label" :value="customOptionValue">
              <span class="truncate">{{ customOptionValue }}</span>
            </slot>
          </button>
        </template>
        <button
          v-else-if="canSelectCustom"
          type="button"
          :class="
            cn(
              'flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-[13px] text-[var(--ds-text-2)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)] focus-visible:bg-[var(--ds-accent-soft)] focus-visible:text-[var(--ds-text-1)] focus-visible:outline-none',
              0 === highlightIndex && 'bg-[var(--ds-accent-soft)] text-[var(--ds-text-1)]',
            )
          "
          @click="selectCustomOption"
        >
          <Check class="h-3.5 w-3.5 shrink-0 opacity-0" />
          <slot name="custom-option-label" :value="customOptionValue">
            <span class="truncate">{{ customOptionValue }}</span>
          </slot>
        </button>
        <div v-else class="px-2 py-2 text-[13px] text-[var(--ds-text-3)]">
          {{ emptyText }}
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
