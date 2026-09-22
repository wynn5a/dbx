import type { TabLike } from "@/lib/tabCloseActions";

/**
 * Tab-switch action resolved against the open-tab list:
 * "next" / "prev" walk the visible tab order with wrap-around,
 * a number is the 1-based tab position (9 = last tab, browser convention).
 */
export type TabSwitchAction = "next" | "prev" | number;

/** The registry position whose binding jumps to the last tab instead of the 9th. */
export const GOTO_TAB_LAST_POSITION = 9;

/**
 * Resolve the tab a switch action should activate. Returns the target tab id,
 * or null when the action is a no-op (no tabs at all, or a goto position
 * beyond the open-tab count).
 */
export function resolveTabSwitchTarget<T extends TabLike>(
  tabs: readonly T[],
  activeTabId: string | null,
  action: TabSwitchAction,
): string | null {
  const count = tabs.length;
  if (count === 0) return null;

  if (typeof action === "number") {
    const index = action === GOTO_TAB_LAST_POSITION ? count - 1 : action - 1;
    const target = index >= 0 ? tabs[index] : undefined;
    return target?.id ?? null;
  }

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  if (activeIndex === -1) {
    // No active tab (e.g. only the driver store is showing): next enters at the
    // first tab, prev at the last one.
    const fallback = action === "next" ? tabs[0] : tabs[count - 1];
    return fallback?.id ?? null;
  }
  const target = tabs[(activeIndex + (action === "next" ? 1 : -1) + count) % count];
  return target?.id ?? null;
}
