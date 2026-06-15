<script setup lang="ts">
import { computed, inject } from "vue";
import { ChevronRight } from "@lucide/vue";
import type { ExplainNodeCategory, ExplainPlanNode } from "@/lib/explainPlan";
import { explainNodeActualRows, explainNodeCategory, explainNodeCost, explainNodeRows } from "@/lib/explainPlan";
import { EXPLAIN_COLLAPSE_KEY } from "./explainCollapse";

const props = defineProps<{
  node: ExplainPlanNode;
  depth?: number;
  /** Largest node cost in the whole plan — denominator for the heat bar. */
  maxCost: number;
}>();

const collapse = inject(EXPLAIN_COLLAPSE_KEY);
const hasChildren = computed(() => props.node.children.length > 0);
const isCollapsed = computed(() => !!collapse?.isCollapsed(props.node.id));

function toggle() {
  if (hasChildren.value) collapse?.toggle(props.node.id);
}

const category = computed<ExplainNodeCategory>(() => explainNodeCategory(props.node.nodeType));
// Each operation family owns a fixed hue (mirrors the data-type colour idea).
const CATEGORY_HUE: Record<ExplainNodeCategory, string> = {
  scan: "var(--ds-amber)", // full/seq scans — usually the thing to watch
  index: "var(--ds-teal)",
  join: "var(--ds-purple)",
  sort: "var(--ds-blue)",
  aggregate: "var(--ds-t-json)",
  other: "var(--ds-text-3)",
};
const hue = computed(() => CATEGORY_HUE[category.value]);

const cost = computed(() => explainNodeCost(props.node));
const estRows = computed(() => explainNodeRows(props.node));
const actualRows = computed(() => explainNodeActualRows(props.node));
const hasActual = computed(() => actualRows.value !== null);

// Relative cost (0–1) drives both the bar width and its heat colour.
const costRatio = computed(() => (props.maxCost > 0 && cost.value !== null ? cost.value / props.maxCost : 0));
const heatHue = computed(() => {
  if (costRatio.value >= 0.66) return "var(--ds-red)";
  if (costRatio.value >= 0.33) return "var(--ds-amber)";
  return "var(--ds-green)";
});
const isHotspot = computed(() => props.maxCost > 0 && cost.value !== null && cost.value === props.maxCost);

// Estimate accuracy: how far actual rows drifted from the estimate.
const rowDriftPct = computed(() => {
  if (actualRows.value === null || estRows.value === null || estRows.value === 0) return null;
  return Math.round((actualRows.value / estRows.value) * 100);
});
const rowDriftBad = computed(
  () => rowDriftPct.value !== null && (rowDriftPct.value >= 1000 || rowDriftPct.value <= 10),
);

// Details minus the "Actual Rows" entry (shown as its own metric).
const extraDetails = computed(() => props.node.details.filter((d) => !/^Actual Rows:/i.test(d)));

const fmt = (n: number | null) =>
  n === null ? "" : n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(n);
</script>

<template>
  <div>
    <div
      class="group relative flex items-center gap-2 rounded-[var(--ds-radius-sm)] py-[5px] pr-2 pl-[6px] text-[12.5px] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)]"
      :class="hasChildren ? 'cursor-pointer' : 'cursor-default'"
      @click="toggle"
    >
      <!-- hotspot marker: a thin accent rail on the costliest node -->
      <span
        v-if="isHotspot"
        class="absolute left-0 top-1/2 h-[60%] w-[2px] -translate-y-1/2 rounded-full"
        :style="{ background: 'var(--ds-red)' }"
      />

      <!-- collapse chevron (reserves width even when leaf, for alignment) -->
      <span class="flex h-4 w-4 shrink-0 items-center justify-center">
        <ChevronRight
          v-if="hasChildren"
          class="h-3.5 w-3.5 text-[var(--ds-text-3)] transition-transform duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
          :class="{ 'rotate-90': !isCollapsed }"
        />
        <span v-else class="h-[3px] w-[3px] rounded-full bg-[var(--ds-text-4)]" />
      </span>

      <!-- operation badge — fixed hue per category, 14%-tint fill -->
      <span
        class="shrink-0 whitespace-nowrap rounded-[4px] px-1.5 py-[2px] font-mono text-[10.5px] font-medium uppercase tracking-[0.02em]"
        :style="{ color: hue, background: `color-mix(in srgb, ${hue} 14%, transparent)` }"
      >
        {{ node.nodeType }}
      </span>

      <!-- relation (machine-shaped → mono) -->
      <span
        v-if="node.relation"
        class="min-w-0 shrink truncate font-mono text-[12px] text-[var(--ds-text-1)]"
        :title="node.relation"
      >
        {{ node.relation }}
      </span>

      <!-- index tag (constraint-tag style) -->
      <span
        v-if="node.index"
        class="shrink-0 rounded-[4px] px-1 py-[1px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em]"
        :style="{ color: 'var(--ds-teal)', background: 'color-mix(in srgb, var(--ds-teal) 13%, transparent)' }"
        :title="node.index"
      >
        {{ node.index }}
      </span>

      <!-- extra details, faint + truncated, full text on hover -->
      <span
        v-if="extraDetails.length"
        class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--ds-text-4)]"
        :title="extraDetails.join('\n')"
      >
        {{ extraDetails.join(" · ") }}
      </span>
      <span v-else class="flex-1" />

      <!-- metrics: rows (est → actual) and cost, mono tabular -->
      <span
        v-if="estRows !== null"
        class="shrink-0 font-mono text-[11px] tabular-nums text-[var(--ds-text-3)]"
        :title="hasActual ? `Estimated ${fmt(estRows)} rows` : 'Estimated rows'"
      >
        {{ fmt(estRows) }}<span class="text-[var(--ds-text-4)]"> rows</span>
      </span>
      <span
        v-if="hasActual"
        class="shrink-0 rounded-[4px] px-1 py-[1px] font-mono text-[11px] tabular-nums"
        :style="{
          color: rowDriftBad ? 'var(--ds-red)' : 'var(--ds-green)',
          background: `color-mix(in srgb, ${rowDriftBad ? 'var(--ds-red)' : 'var(--ds-green)'} 13%, transparent)`,
        }"
        :title="`Actual ${fmt(actualRows)} rows${rowDriftPct !== null ? ` (${rowDriftPct}% of estimate)` : ''}`"
      >
        {{ fmt(actualRows) }}<span v-if="rowDriftPct !== null" class="opacity-70"> · {{ rowDriftPct }}%</span>
      </span>

      <!-- cost heat bar -->
      <span v-if="cost !== null && maxCost > 0" class="flex shrink-0 items-center gap-1.5">
        <span
          class="font-mono text-[11px] tabular-nums"
          :style="{ color: isHotspot ? 'var(--ds-red)' : 'var(--ds-text-2)' }"
          :title="`Cost ${node.cost}`"
        >
          {{ fmt(cost) }}
        </span>
        <span class="h-[5px] w-[56px] overflow-hidden rounded-full bg-[var(--ds-bg-active)]">
          <span
            class="block h-full rounded-full"
            :style="{ width: `${Math.max(costRatio * 100, 3)}%`, background: heatHue }"
          />
        </span>
      </span>
    </div>

    <!-- children -->
    <div v-if="hasChildren && !isCollapsed" class="ml-[14px] border-l border-[var(--ds-border-soft)] pl-1">
      <ExplainPlanNodeTree
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :max-cost="maxCost"
        :depth="(depth || 0) + 1"
      />
    </div>
  </div>
</template>
