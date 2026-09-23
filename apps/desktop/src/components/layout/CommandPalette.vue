<script setup lang="ts">
import type { Component } from "vue";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlignLeft,
  ArrowLeftRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  Database,
  FileCode,
  FolderOpen,
  GitCompareArrows,
  History,
  Package,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  SquareTerminal,
  TableProperties,
} from "@lucide/vue";
import Dialog from "@/components/ui/dialog/Dialog.vue";
import DialogContent from "@/components/ui/dialog/DialogContent.vue";
import {
  COMMAND_DEFINITIONS,
  clampPaletteSelection,
  commandShortcutHint,
  filterCommands,
  isCommandEnabled,
  movePaletteSelection,
  runPaletteCommand,
  type CommandDefinition,
  type CommandIconName,
  type CommandPaletteContext,
} from "@/lib/commandPalette";
import { useSettingsStore } from "@/stores/settingsStore";

// Palette-side icon resolution: the registry stays UI-agnostic by carrying
// only an icon name; this table maps every name to its component (the
// Record<CommandIconName, Component> annotation fails the build if one is
// missing).
const COMMAND_ICONS: Record<CommandIconName, Component> = {
  terminal: SquareTerminal,
  database: Database,
  transfer: ArrowLeftRight,
  diff: TableProperties,
  compare: GitCompareArrows,
  package: Package,
  folder: FolderOpen,
  fileCode: FileCode,
  history: History,
  bot: Bot,
  settings: Settings,
  format: AlignLeft,
  sidebar: PanelLeft,
  next: ChevronRight,
  prev: ChevronLeft,
  refresh: RefreshCw,
};

const props = defineProps<{
  context: CommandPaletteContext;
}>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();
const settingsStore = useSettingsStore();
const query = ref("");
const selectedIndex = ref(0);
const listRef = ref<HTMLElement | null>(null);

const filtered = computed(() => filterCommands(COMMAND_DEFINITIONS, query.value, t));

watch(filtered, (items) => {
  selectedIndex.value = clampPaletteSelection(selectedIndex.value, items.length);
});

// App mounts the palette with v-if, so each open is a fresh instance: the
// query/selection start empty and reka's DialogContent auto-focuses the input.

watch(selectedIndex, async () => {
  await nextTick();
  listRef.value?.querySelector('[data-palette-selected="true"]')?.scrollIntoView({ block: "nearest" });
});

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = movePaletteSelection(selectedIndex.value, 1, filtered.value.length);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value = movePaletteSelection(selectedIndex.value, -1, filtered.value.length);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    runSelected();
  }
}

function iconFor(command: CommandDefinition): Component | undefined {
  return command.icon ? COMMAND_ICONS[command.icon] : undefined;
}

function enabledFor(command: CommandDefinition): boolean {
  return isCommandEnabled(command, props.context);
}

function shortcutHintFor(command: CommandDefinition): string | null {
  return commandShortcutHint(command, settingsStore.editorSettings.shortcuts);
}

function runCommand(command: CommandDefinition) {
  // Disabled rows (same rules as the toolbar) do nothing and keep the palette open.
  if (!enabledFor(command)) return;
  open.value = false;
  runPaletteCommand(command, props.context);
}

function runSelected() {
  const command = filtered.value[selectedIndex.value];
  if (command) runCommand(command);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent :show-close-button="false" class="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
      <div class="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] px-3.5">
        <Search class="size-4 shrink-0 text-[var(--ds-text-3)]" />
        <input
          v-model="query"
          type="text"
          role="combobox"
          aria-controls="command-palette-list"
          :aria-expanded="filtered.length > 0"
          :aria-activedescendant="
            filtered[selectedIndex] ? `command-palette-option-${filtered[selectedIndex].id}` : undefined
          "
          :placeholder="t('commandPalette.searchPlaceholder')"
          class="h-full w-full bg-transparent text-[13px] text-[var(--ds-text-1)] outline-none placeholder:text-[var(--ds-text-3)]"
          @keydown="onSearchKeydown"
        />
      </div>
      <div ref="listRef" class="max-h-[min(420px,calc(100dvh-12rem))] min-h-0 overflow-y-auto p-1.5">
        <div v-if="filtered.length === 0" class="px-3 py-8 text-center text-[12.5px] text-[var(--ds-text-3)]">
          {{ t("commandPalette.noResults") }}
        </div>
        <button
          v-for="(command, index) in filtered"
          :id="`command-palette-option-${command.id}`"
          :key="command.id"
          type="button"
          role="option"
          :aria-selected="index === selectedIndex"
          :aria-disabled="enabledFor(command) ? undefined : 'true'"
          :data-palette-selected="index === selectedIndex ? 'true' : undefined"
          class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-[var(--ds-speed)]"
          :class="[
            index === selectedIndex ? 'bg-[var(--ds-bg-active)]' : 'hover:bg-[var(--ds-bg-active)]/60',
            enabledFor(command) ? '' : 'cursor-not-allowed opacity-50',
          ]"
          @mouseenter="selectedIndex = index"
          @click="runCommand(command)"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]"
          >
            <component :is="iconFor(command)" class="size-3.5" />
          </span>
          <span class="min-w-0 flex-1 truncate text-[13px] text-[var(--ds-text-1)]">
            {{ t(command.labelKey) }}
          </span>
          <kbd
            v-if="shortcutHintFor(command)"
            class="shrink-0 rounded border border-[var(--ds-border)] px-1.5 py-px font-mono text-[10.5px] text-[var(--ds-text-2)]"
          >
            {{ shortcutHintFor(command) }}
          </kbd>
          <span class="shrink-0 text-[11px] text-[var(--ds-text-3)]">
            {{ t(command.categoryKey) }}
          </span>
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
