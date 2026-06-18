<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick, type Component } from "vue";
import { ChevronRight } from "@lucide/vue";

export interface ContextMenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  icon?: Component;
  iconClass?: string;
  shortcut?: string;
  variant?: "default" | "destructive";
  visible?: boolean;
  children?: ContextMenuItem[];
}

const props = defineProps<{
  items: ContextMenuItem[];
}>();

// ---- module-level singleton state ----
const openMenus = new Set<() => void>();
let globalSetup = false;

function ensureGlobalListeners() {
  if (globalSetup) return;
  globalSetup = true;
  const closeAll = () => {
    for (const c of openMenus) c();
    openMenus.clear();
  };
  document.addEventListener("contextmenu", closeAll, true);
  document.addEventListener("scroll", closeAll, true);
  window.addEventListener("resize", closeAll);
}
ensureGlobalListeners();
// -------------------------------------

const show = ref(false);
const x = ref(0);
const y = ref(0);
const menuRef = ref<HTMLElement>();

// Submenu state
const activeSubIndex = ref<number | null>(null);
const subRef = ref<HTMLElement>();
const subX = ref(0);
const subY = ref(0);
let subCloseTimer: ReturnType<typeof setTimeout> | null = null;

function close() {
  activeSubIndex.value = null;
  show.value = false;
}

function onMouseDownOutside(e: MouseEvent) {
  const target = e.target as Node;
  const inMenu = menuRef.value?.contains(target);
  const inSub = subRef.value?.contains(target);
  if (!inMenu && !inSub) {
    close();
  }
}

function onScroll() {
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function onResize() {
  close();
}

watch(show, (val) => {
  if (val) {
    openMenus.add(close);
    // Dismiss on `mousedown`, not `click`: the macOS Ctrl+click gesture that opens
    // the menu fires a trailing `click` from the same gesture, which `click`-based
    // dismissal would treat as an outside click and close the menu instantly.
    // `mousedown` fires before `contextmenu` within the opening gesture, so the
    // listener added here never sees the opening gesture's own mousedown; only a
    // later mousedown elsewhere dismisses. (mousedown is also more reliable than
    // pointerdown in the macOS WKWebView.)
    document.addEventListener("mousedown", onMouseDownOutside, true);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
  } else {
    openMenus.delete(close);
    document.removeEventListener("mousedown", onMouseDownOutside, true);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
  }
});

function handleItemClick(item: ContextMenuItem) {
  if (item.disabled) return;
  if (item.children?.length) return; // submenu trigger — do nothing on click
  close();
  item.action?.();
}

function handleSubItemClick(item: ContextMenuItem) {
  if (item.disabled) return;
  close();
  item.action?.();
}

function onContextMenu(event: MouseEvent) {
  if (props.items.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  x.value = event.clientX;
  y.value = event.clientY;
  show.value = true;
  nextTick(() => {
    if (!menuRef.value) return;
    const rect = menuRef.value.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) x.value = Math.max(0, vw - rect.width - 8);
    if (rect.bottom > vh) y.value = Math.max(0, vh - rect.height - 8);
  });
}

// ---- submenu ----

function onItemMouseEnter(index: number, event: MouseEvent) {
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
  const item = props.items[index];
  if (!item?.children?.length || item.disabled) {
    // Moving to an item without children — close submenu immediately, no delay needed
    activeSubIndex.value = null;
    return;
  }
  if (subCloseTimer) {
    clearTimeout(subCloseTimer);
    subCloseTimer = null;
  }
  const trigger = event.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  subX.value = rect.right + 4;
  subY.value = rect.top;
  activeSubIndex.value = index;
  nextTick(() => adjustSubPosition());
}

function onItemMouseLeave() {
  if (activeSubIndex.value !== null) {
    scheduleSubClose();
  }
}

// Last known mouse position (from hover events, without a global mousemove listener)
let lastMouseX = 0;
let lastMouseY = 0;

function isMouseOverSub(): boolean {
  if (!subRef.value) return false;
  const rect = subRef.value.getBoundingClientRect();
  return lastMouseX >= rect.left && lastMouseX <= rect.right && lastMouseY >= rect.top && lastMouseY <= rect.bottom;
}

function scheduleSubClose() {
  if (subCloseTimer) clearTimeout(subCloseTimer);
  subCloseTimer = setTimeout(() => {
    if (!isMouseOverSub()) {
      activeSubIndex.value = null;
    }
  }, 150);
}

function onSubMouseEnter() {
  if (subCloseTimer) {
    clearTimeout(subCloseTimer);
    subCloseTimer = null;
  }
}

function onSubMouseLeave() {
  activeSubIndex.value = null;
}

function adjustSubPosition() {
  if (!subRef.value) return;
  const rect = subRef.value.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (rect.right > vw) {
    subX.value = Math.max(0, vw - rect.width - 8);
  }
  if (rect.bottom > vh) {
    subY.value = Math.max(0, vh - rect.height - 8);
  }
  // When the submenu flips left due to right-edge overflow, it may land
  // under the mouse cursor. Since the mouse didn't move, mouseenter won't
  // fire — cancel any pending close to prevent the submenu from flashing.
  nextTick(() => {
    if (isMouseOverSub() && subCloseTimer) {
      clearTimeout(subCloseTimer);
      subCloseTimer = null;
    }
  });
}

// DS command-palette item recipe: 13.5px, hover/active = accent-soft fill +
// text-1 + accent icon; destructive = --ds-red with 14%-tint fill.
function itemButtonClass(variant?: "default" | "destructive") {
  return [
    "group/ctx w-full gap-2 rounded-sm px-2 py-1.5 text-[13.5px] leading-4 outline-hidden select-none text-left cursor-default flex items-center disabled:pointer-events-none disabled:opacity-50 transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]",
    variant === "destructive"
      ? "text-[var(--ds-red)] hover:bg-[color-mix(in_srgb,var(--ds-red)_14%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--ds-red)_14%,transparent)]"
      : "text-[var(--ds-text-2)] hover:bg-[var(--ds-accent-soft)] hover:text-[var(--ds-text-1)] focus-visible:bg-[var(--ds-accent-soft)] focus-visible:text-[var(--ds-text-1)]",
  ];
}

function itemIconWrapClass(item: ContextMenuItem, active = false) {
  if (item.variant === "destructive") return "";
  return active
    ? "text-[var(--ds-accent)]"
    : "text-[var(--ds-text-3)] group-hover/ctx:text-[var(--ds-accent)] group-focus-visible/ctx:text-[var(--ds-accent)]";
}

function shortcutKeyLabel(part: string): string {
  if (part === "Cmd") return "⌘";
  if (part === "Meta") return "⌘";
  if (part === "Alt") return "⌥";
  if (part === "Shift") return "⇧";
  if (part === "Delete") return "Del";
  if (part === "Backspace") return "⌫";
  if (part === "Enter") return "↵";
  if (part === "Escape") return "Esc";
  return part;
}

function shortcutKeys(shortcut?: string): string[] {
  return shortcut?.split("+").filter(Boolean).map(shortcutKeyLabel) || [];
}

onBeforeUnmount(() => {
  openMenus.delete(close);
  document.removeEventListener("mousedown", onMouseDownOutside, true);
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onResize);
});
</script>

<template>
  <slot :on-context-menu="onContextMenu" />
  <!-- Main menu -->
  <Teleport to="body">
    <div
      v-if="show"
      ref="menuRef"
      :style="{ position: 'fixed', left: x + 'px', top: y + 'px', zIndex: 9999 }"
      class="ds-popover min-w-40 p-1 overflow-x-hidden overflow-y-auto"
    >
      <template v-for="(item, index) in items" :key="index">
        <template v-if="item.visible !== false">
          <div v-if="item.separator" class="-mx-1 my-1 flex items-center px-1">
            <div class="h-px flex-1 bg-[var(--ds-border)]" />
          </div>
          <button
            v-else
            :disabled="item.disabled"
            :class="[
              ...itemButtonClass(item.variant),
              activeSubIndex === index ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-text-1)]' : '',
            ]"
            @click="handleItemClick(item)"
            @mouseenter="(e) => onItemMouseEnter(index, e)"
            @mouseleave="onItemMouseLeave"
          >
            <span
              class="flex size-4 shrink-0 items-center justify-center transition-colors duration-[var(--ds-speed)]"
              :class="itemIconWrapClass(item, activeSubIndex === index)"
            >
              <component :is="item.icon" v-if="item.icon" :class="['size-4', item.iconClass]" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <span v-if="item.shortcut" class="ml-8 inline-flex shrink-0 items-center gap-1">
              <kbd v-for="key in shortcutKeys(item.shortcut)" :key="key" class="ds-kbd min-w-4 text-center">{{
                key
              }}</kbd>
            </span>
            <ChevronRight v-if="item.children?.length" class="ml-auto size-4 text-[var(--ds-text-3)]" />
          </button>
        </template>
      </template>
    </div>
  </Teleport>
  <!-- Submenu -->
  <Teleport to="body">
    <div
      v-if="show && activeSubIndex !== null && items[activeSubIndex]?.children?.length"
      ref="subRef"
      :style="{ position: 'fixed', left: subX + 'px', top: subY + 'px', zIndex: 10000 }"
      class="ds-popover min-w-40 p-1 overflow-x-hidden overflow-y-auto"
      @mouseenter="onSubMouseEnter"
      @mouseleave="onSubMouseLeave"
    >
      <template v-for="(child, ci) in items[activeSubIndex]!.children!" :key="ci">
        <template v-if="child.visible !== false">
          <div v-if="child.separator" class="-mx-1 my-1 flex items-center px-1">
            <div class="h-px flex-1 bg-[var(--ds-border)]" />
          </div>
          <button
            v-else
            :disabled="child.disabled"
            :class="itemButtonClass(child.variant)"
            @click="handleSubItemClick(child)"
          >
            <span
              class="flex size-4 shrink-0 items-center justify-center transition-colors duration-[var(--ds-speed)]"
              :class="itemIconWrapClass(child)"
            >
              <component :is="child.icon" v-if="child.icon" :class="['size-4', child.iconClass]" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ child.label }}</span>
            <span v-if="child.shortcut" class="ml-8 inline-flex shrink-0 items-center gap-1">
              <kbd v-for="key in shortcutKeys(child.shortcut)" :key="key" class="ds-kbd min-w-4 text-center">{{
                key
              }}</kbd>
            </span>
          </button>
        </template>
      </template>
    </div>
  </Teleport>
</template>
