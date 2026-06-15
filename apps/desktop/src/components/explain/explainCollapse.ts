import type { InjectionKey } from "vue";

/**
 * Shared collapse state for the explain-plan tree. The viewer owns the set of
 * collapsed node ids and provides this; recursive {@link ExplainPlanNodeTree}
 * nodes read/toggle it. Lifting it out of the node lets the viewer drive
 * "expand all" / "collapse all".
 */
export interface ExplainCollapseApi {
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
}

export const EXPLAIN_COLLAPSE_KEY: InjectionKey<ExplainCollapseApi> = Symbol("explainCollapse");
