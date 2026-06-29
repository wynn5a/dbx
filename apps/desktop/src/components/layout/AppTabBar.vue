<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from "vue";
import type { CSSProperties } from "vue";
import { useI18n } from "vue-i18n";
import {
  X,
  Pin,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Table2,
  Code2,
  TableProperties,
  PencilRuler,
  KeyRound,
  Pencil,
  Package,
  Check,
} from "@lucide/vue";
import CustomContextMenu, { type ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import LightDropdown from "@/components/ui/LightDropdown.vue";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useQueryStore } from "@/stores/queryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabScroll } from "@/composables/useTabScroll";
import { useTabDrag } from "@/composables/useTabDrag";
import {
  connectionColor,
  shouldShowTabOverflowControls,
  tabDisplayTitle,
  tabTooltipLines,
} from "@/lib/tabPresentation";
import { hexToRgba } from "@/lib/color";
import type { QueryTab } from "@/types/database";

const props = defineProps<{
  showDriverStore?: boolean;
  agentDriverUpdateCount?: number;
}>();

const emit = defineEmits<{
  "toggle-driver-store": [];
  "close-driver-store": [];
}>();

const { t } = useI18n();
const queryStore = useQueryStore();
const settingsStore = useSettingsStore();
const tabDrag = useTabDrag((draggedId, targetId, position) => {
  queryStore.reorderTab(draggedId, targetId, position);
});
const editingTabId = ref<string | null>(null);
const editingTitle = ref("");
const compactTabTitle = computed({
  get: () => settingsStore.editorSettings.compactTabTitle,
  set: (checked: boolean | "indeterminate") => {
    settingsStore.updateEditorSettings({ compactTabTitle: checked === true });
  },
});

function toggleCompactTabTitle() {
  compactTabTitle.value = !compactTabTitle.value;
}

function canRenameTab(tab: QueryTab) {
  return tab.mode === "query";
}

function startRenameTab(tab: QueryTab) {
  if (!canRenameTab(tab)) return;
  editingTabId.value = tab.id;
  editingTitle.value = tab.title;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-tab-title-input="${tab.id}"]`);
    input?.focus();
    input?.select();
  });
}

function commitRenameTab(tab: QueryTab) {
  if (editingTabId.value !== tab.id) return;
  const title = editingTitle.value.trim();
  if (title) queryStore.renameTab(tab.id, title);
  editingTabId.value = null;
}

function cancelRenameTab() {
  editingTabId.value = null;
}

function getTabMenuItems(tab: QueryTab): ContextMenuItem[] {
  return [
    {
      label: t("contextMenu.compactTabTitle"),
      action: toggleCompactTabTitle,
      icon: Check,
      iconClass: compactTabTitle.value ? "opacity-100" : "opacity-0",
    },
    {
      label: t("contextMenu.renameTab"),
      action: () => startRenameTab(tab),
      icon: Pencil,
      visible: canRenameTab(tab),
    },
    { label: "", separator: true },
    {
      label: tab.pinned ? t("contextMenu.unpin") : t("contextMenu.pin"),
      action: () => queryStore.togglePinnedTab(tab.id),
      icon: Pin,
      iconClass: tab.pinned ? "fill-current" : "",
    },
    { label: "", separator: true },
    { label: t("contextMenu.closeTab"), action: () => queryStore.closeTab(tab.id), icon: X },
    {
      label: t("contextMenu.closeOtherTabs"),
      action: () => queryStore.closeOtherTabs(tab.id),
      disabled: queryStore.tabs.length <= 1,
      icon: X,
    },
    {
      label: t("contextMenu.closeAllTabs"),
      action: () => queryStore.closeAllTabs(),
      variant: "destructive" as const,
      icon: X,
    },
  ];
}

const tabsContainerRef = ref<HTMLElement | null>(null);
// Stable element for resize detection: its width is fixed by the layout, not by the
// overflow controls we toggle — observing the inner scroller instead would loop forever.
const tabBarRootRef = ref<HTMLElement | null>(null);
const tabScrollBehavior = ref<ScrollBehavior>("smooth");

function scrollActiveTabIntoView(behavior: ScrollBehavior) {
  const container = tabsContainerRef.value;
  if (!container) return;
  const activeEl = container.querySelector('[data-active-tab="true"]');
  if (activeEl) {
    activeEl.scrollIntoView({ behavior, block: "nearest", inline: "center" });
  }
  updateScrollButtons();
}

const { hasTabOverflow, canScrollLeft, canScrollRight, updateScrollButtons, scrollTabs, onTabsWheel } = useTabScroll(
  tabsContainerRef,
  // Keep the active tab visible when the bar is resized (window resize, sidebar toggle).
  () => scrollActiveTabIntoView("auto"),
  tabBarRootRef,
);

onMounted(() => {
  // Restored tabs may place the active tab mid-list; reveal it instantly on load.
  nextTick(() => scrollActiveTabIntoView("auto"));
});

watch(
  () => queryStore.tabs.length,
  () => {
    // Closing a non-active tab shifts layout; keep the active tab in view.
    nextTick(() => scrollActiveTabIntoView("auto"));
  },
);

watch(
  () => queryStore.activeTabId,
  () => {
    nextTick(() => {
      scrollActiveTabIntoView(tabScrollBehavior.value);
      tabScrollBehavior.value = "smooth";
    });
  },
);

watch(
  () => props.showDriverStore,
  (show) => {
    if (!show) return;
    nextTick(() => {
      const container = tabsContainerRef.value;
      if (!container) return;
      const el = container.querySelector("[data-driver-store-tab]");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
      updateScrollButtons();
    });
  },
);

function tabColorStyle(tab: QueryTab) {
  const color = connectionColor(tab.connectionId);
  const isActive = tab.id === queryStore.activeTabId && !props.showDriverStore;
  if (!color) {
    return isActive
      ? {
          borderColor: "var(--ds-accent-line)",
        }
      : undefined;
  }

  return {
    backgroundColor: hexToRgba(color, isActive ? 0.16 : 0.09),
    borderColor: isActive ? hexToRgba(color, 0.72) : hexToRgba(color, 0.18),
  };
}

function tabIconClass(tab: QueryTab) {
  if (tab.mode === "data" || tab.mode === "objects" || tab.mode === "structure") return "text-[var(--ds-green)]";
  return "text-[var(--ds-blue)]";
}

const showTabOverflowControls = computed(() =>
  shouldShowTabOverflowControls(
    queryStore.tabs.length,
    hasTabOverflow.value,
    canScrollLeft.value,
    canScrollRight.value,
  ),
);

const openTabMenuItems = computed(() =>
  queryStore.tabs.map((tab) => ({
    value: tab.id,
    label: tabDisplayTitle(tab, t),
    title: tabDisplayTitle(tab, t),
    icon: tabMenuIcon(tab),
    iconClass: tabIconClass(tab),
  })),
);

function tabMenuIcon(tab: QueryTab) {
  if (tab.mode === "data") return Table2;
  if (tab.mode === "etcd") return KeyRound;
  if (tab.mode === "objects") return TableProperties;
  if (tab.mode === "structure") return PencilRuler;
  return Code2;
}

function handleTabClick(tab: QueryTab) {
  if (tabDrag.state.wasDragged) return;
  activateTab(tab.id);
}

function handleTabMouseDown(event: MouseEvent, tabId: string) {
  if (event.button === 0) {
    dispatchBeforeTabSwitch(tabId);
    event.preventDefault();
  }
  tabDrag.startDrag(event, tabId);
}

function tabDropStyle(tabId: string) {
  if (!tabDrag.state.active) return {};
  if (tabDrag.state.draggedId === tabId) return { opacity: 0.4 };
  if (tabDrag.state.targetId !== tabId) return {};
  const dropColor = `var(--ds-accent)`;
  if (tabDrag.state.dropPosition === "before") {
    return { boxShadow: `inset 3px 0 0 0 ${dropColor}` };
  }
  return { boxShadow: `inset -3px 0 0 0 ${dropColor}` };
}

const tabsContainerStyle = computed<CSSProperties>(() => ({
  msOverflowStyle: "none",
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
}));

const tabTailDragRegionClass = computed(() =>
  showTabOverflowControls.value ? "w-0 flex-none self-stretch" : "min-w-8 flex-1 self-stretch",
);

const tabOverflowControlClass =
  "h-7 w-7 rounded-md border border-[var(--ds-border)] bg-transparent text-[var(--ds-text-3)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]";

function dispatchBeforeTabSwitch(tabId: string) {
  if (tabId === queryStore.activeTabId) return;
  window.dispatchEvent(
    new CustomEvent("dbx:before-tab-switch", { detail: { tabId, fromTabId: queryStore.activeTabId } }),
  );
}

function activateTab(tabId: string) {
  dispatchBeforeTabSwitch(tabId);
  tabScrollBehavior.value = "auto";
  queryStore.activeTabId = tabId;
  emit("close-driver-store");
}
</script>

<template>
  <div
    v-if="queryStore.tabs.length > 0 || showDriverStore"
    ref="tabBarRootRef"
    class="relative flex border-b border-[var(--ds-border)] shrink-0 h-10 items-center bg-[var(--ds-bg-canvas)] px-2"
  >
    <button
      v-if="showTabOverflowControls"
      type="button"
      class="z-30 shrink-0 inline-flex items-center justify-center"
      :class="[tabOverflowControlClass, canScrollLeft ? '' : 'opacity-40']"
      :aria-label="t('tabs.scrollLeft')"
      :title="t('tabs.scrollLeft')"
      :disabled="!canScrollLeft"
      @click="scrollTabs('left')"
    >
      <ChevronLeft class="h-4 w-4 stroke-[2.5]" />
    </button>
    <div
      ref="tabsContainerRef"
      class="flex-1 flex items-center overflow-x-auto min-w-0 gap-1.5"
      :style="tabsContainerStyle"
      @scroll="updateScrollButtons"
      @wheel="onTabsWheel"
    >
      <CustomContextMenu
        v-for="tab in queryStore.tabs"
        :key="tab.id"
        :items="getTabMenuItems(tab)"
        v-slot="{ onContextMenu }"
      >
        <div @contextmenu="onContextMenu">
          <Tooltip>
            <TooltipTrigger as-child>
              <div
                class="group flex items-center gap-1 px-2 text-xs cursor-pointer transition-colors whitespace-nowrap select-none"
                :class="[
                  compactTabTitle ? 'min-w-24' : 'min-w-38',
                  'h-7 rounded-md border',
                  tab.id === queryStore.activeTabId && !showDriverStore
                    ? 'text-[var(--ds-text-1)] font-medium'
                    : 'border-[var(--ds-border)] text-[var(--ds-text-3)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]',
                ]"
                :style="[tabColorStyle(tab), tabDropStyle(tab.id)]"
                :data-active-tab="tab.id === queryStore.activeTabId && !showDriverStore"
                @click="handleTabClick(tab)"
                @dblclick.stop="startRenameTab(tab)"
                @mousedown.middle.prevent="queryStore.closeTab(tab.id)"
                @mousedown="handleTabMouseDown($event, tab.id)"
                @mouseenter="tabDrag.updateTarget($event, tab.id)"
                @mousemove="tabDrag.updateTarget($event, tab.id)"
                @mouseleave="tabDrag.clearTarget(tab.id)"
              >
                <span class="shrink-0" :class="tabIconClass(tab)">
                  <Table2 v-if="tab.mode === 'data'" class="h-3.5 w-3.5" />
                  <KeyRound v-else-if="tab.mode === 'etcd'" class="h-3.5 w-3.5" />
                  <TableProperties v-else-if="tab.mode === 'objects'" class="h-3.5 w-3.5" />
                  <PencilRuler v-else-if="tab.mode === 'structure'" class="h-3.5 w-3.5" />
                  <Code2 v-else class="h-3.5 w-3.5" />
                </span>
                <input
                  v-if="editingTabId === tab.id"
                  v-model="editingTitle"
                  :data-tab-title-input="tab.id"
                  :aria-label="t('contextMenu.renameTab')"
                  class="h-5 min-w-0 flex-1 rounded border border-[var(--ds-accent-line)] bg-[var(--ds-bg-input)] px-1.5 text-xs font-normal text-[var(--ds-text-1)] outline-none"
                  @click.stop
                  @mousedown.stop
                  @keydown.enter.prevent="commitRenameTab(tab)"
                  @keydown.escape.prevent="cancelRenameTab"
                  @blur="commitRenameTab(tab)"
                />
                <span v-else class="min-w-0 truncate flex-1">{{ tabDisplayTitle(tab, t) }}</span>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="inline-flex rounded p-0.5 text-[var(--ds-text-3)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)] focus:opacity-100"
                      :class="tab.pinned ? 'visible text-[var(--ds-accent)]' : 'invisible group-hover:visible'"
                      @click.stop="queryStore.togglePinnedTab(tab.id)"
                    >
                      <Pin class="h-3 w-3" :class="{ 'fill-current': tab.pinned }" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ tab.pinned ? t("contextMenu.unpin") : t("contextMenu.pin") }}</TooltipContent>
                </Tooltip>
                <button
                  class="rounded p-0.5 shrink-0 text-[var(--ds-text-3)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)]"
                  @click.stop="queryStore.closeTab(tab.id)"
                >
                  <X class="h-3 w-3" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" class="grid w-max max-w-none grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
              <template v-for="line in tabTooltipLines(tab, t)" :key="line.label">
                <span class="text-[var(--ds-text-3)]">{{ line.label }}</span>
                <span>{{ line.value }}</span>
              </template>
            </TooltipContent>
          </Tooltip>
        </div>
      </CustomContextMenu>

      <!-- Driver Store Tab -->
      <div
        v-if="showDriverStore"
        data-driver-store-tab
        class="group flex min-w-38 items-center gap-1 px-2 text-xs cursor-pointer transition-colors whitespace-nowrap h-7 rounded-md border text-[var(--ds-text-1)] font-medium border-[var(--ds-accent-line)]"
        @click="emit('toggle-driver-store')"
      >
        <span class="shrink-0 text-[var(--ds-amber)]">
          <Package class="h-3.5 w-3.5" />
        </span>
        <span class="min-w-0 truncate flex-1">{{ t("toolbar.driverManager") }}</span>
        <span
          v-if="(agentDriverUpdateCount ?? 0) > 0"
          class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--ds-red)] px-1 text-[10px] font-medium leading-none text-white"
          :aria-label="t('toolbar.updatableDriverCount')"
        >
          {{ (agentDriverUpdateCount ?? 0) > 99 ? "99+" : agentDriverUpdateCount }}
        </span>
        <button
          class="rounded p-0.5 shrink-0 text-[var(--ds-text-3)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)]"
          @click.stop="emit('close-driver-store')"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
      <div :class="tabTailDragRegionClass" data-tauri-drag-region />
    </div>
    <div v-if="showTabOverflowControls" class="relative z-30 flex shrink-0 items-center">
      <button
        v-if="showTabOverflowControls"
        type="button"
        class="inline-flex shrink-0 items-center justify-center"
        :class="[tabOverflowControlClass, canScrollRight ? '' : 'opacity-40']"
        :aria-label="t('tabs.scrollRight')"
        :title="t('tabs.scrollRight')"
        :disabled="!canScrollRight"
        @click="scrollTabs('right')"
      >
        <ChevronRight class="h-4 w-4 stroke-[2.5]" />
      </button>
      <LightDropdown
        :model-value="queryStore.activeTabId || ''"
        :items="openTabMenuItems"
        :aria-label="t('tabs.openTabs')"
        :trigger-title="t('tabs.openTabs')"
        :trigger-icon="ChevronDown"
        :trigger-class="['inline-flex shrink-0 items-center justify-center', tabOverflowControlClass].join(' ')"
        trigger-icon-class="h-4 w-4"
        item-icon-class="w-3.5 h-3.5 mr-2"
        item-class="max-w-full"
        content-class="w-auto min-w-48 max-w-72"
        :show-trigger-label="false"
        :show-chevron="false"
        :highlight-selected="false"
        :match-trigger-width="false"
        check-position="none"
        align="end"
        @update:model-value="activateTab"
      />
    </div>
  </div>
</template>
