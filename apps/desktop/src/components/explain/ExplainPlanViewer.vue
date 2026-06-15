<script setup lang="ts">
import { computed, provide, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlertCircle,
  Braces,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileText,
  GitBranch,
  Network,
  Table2,
} from "@lucide/vue";
import type { ExplainPlanNode, ParsedExplainPlan } from "@/lib/explainPlan";
import {
  explainMaxCost,
  explainNodeActualRows,
  explainNodeCost,
  explainNodeRows,
  flattenExplainPlanNodes,
} from "@/lib/explainPlan";
import ExplainPlanNodeTree from "./ExplainPlanNodeTree.vue";
import { EXPLAIN_COLLAPSE_KEY } from "./explainCollapse";

const props = defineProps<{
  plan?: ParsedExplainPlan;
  error?: string;
  loading?: boolean;
  sourceSql?: string;
  explainSql?: string;
}>();

const { t } = useI18n();
const activeView = ref<"tree" | "summary" | "raw">("tree");

const flatNodes = computed(() => (props.plan ? flattenExplainPlanNodes(props.plan.nodes) : []));
const flatRows = computed(() => {
  const rows: Array<{ node: ExplainPlanNode; depth: number }> = [];
  function visit(node: ExplainPlanNode, depth: number) {
    rows.push({ node, depth });
    node.children.forEach((child) => visit(child, depth + 1));
  }
  props.plan?.nodes.forEach((node) => visit(node, 0));
  return rows;
});

const nodeCount = computed(() => flatNodes.value.length);
const maxCost = computed(() => (props.plan ? explainMaxCost(props.plan.nodes) : 0));

// The single costliest node — surfaced as a headline metric.
const hotspot = computed(() => {
  if (!props.plan || maxCost.value <= 0) return null;
  return flatNodes.value.find((n) => explainNodeCost(n) === maxCost.value) ?? null;
});
const hasActualStats = computed(() => flatNodes.value.some((n) => explainNodeActualRows(n) !== null));

const rawContent = computed(() => {
  if (!props.plan?.raw) return "";
  if (typeof props.plan.raw === "string") return props.plan.raw;
  return JSON.stringify(props.plan.raw, null, 2);
});
const isRawString = computed(() => typeof props.plan?.raw === "string");
const isAutotrace = computed(
  () => props.plan?.databaseType === "dameng" && isRawString.value && rawContent.value.includes("->"),
);

// ── shared collapse state for the tree ────────────────────────────────
const collapsedIds = reactive(new Set<string>());
provide(EXPLAIN_COLLAPSE_KEY, {
  isCollapsed: (id: string) => collapsedIds.has(id),
  toggle: (id: string) => {
    if (collapsedIds.has(id)) collapsedIds.delete(id);
    else collapsedIds.add(id);
  },
});
const parentIds = computed(() => flatNodes.value.filter((n) => n.children.length > 0).map((n) => n.id));
const allExpanded = computed(() => collapsedIds.size === 0);
function expandAll() {
  collapsedIds.clear();
}
function collapseAll() {
  collapsedIds.clear();
  parentIds.value.forEach((id) => collapsedIds.add(id));
}
// Reset collapse state when a new plan loads.
watch(
  () => props.plan,
  () => collapsedIds.clear(),
);

const copied = ref(false);
async function copyRaw() {
  try {
    await navigator.clipboard.writeText(rawContent.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    // clipboard unavailable — silently no-op
  }
}

const fmt = (n: number | null) =>
  n === null ? "—" : n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(n);

const views = [
  { id: "tree", label: () => t("explain.tree"), icon: Network },
  { id: "summary", label: () => t("explain.summary"), icon: Table2 },
  { id: "raw", label: () => t("explain.raw"), icon: null },
] as const;
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[var(--ds-bg-base)]">
    <!-- toolbar -->
    <div
      class="flex h-[38px] shrink-0 items-center gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-bg-canvas)] px-3"
    >
      <span class="ds-section-label">
        <GitBranch class="h-3.5 w-3.5" />
        {{ t("explain.title") }}
      </span>

      <span
        v-if="plan"
        class="rounded-[var(--ds-radius-pill)] px-2 py-[2px] font-mono text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--ds-text-2)]"
        :style="{ background: 'var(--ds-bg-active)' }"
      >
        {{ plan.databaseType }}
      </span>
      <span
        v-if="isAutotrace"
        class="inline-flex items-center gap-1 rounded-[var(--ds-radius-pill)] px-2 py-[2px] text-[10.5px] font-semibold uppercase tracking-[0.04em]"
        :style="{ color: 'var(--ds-green)', background: 'color-mix(in srgb, var(--ds-green) 14%, transparent)' }"
      >
        <span class="h-[5px] w-[5px] rounded-full" :style="{ background: 'var(--ds-green)' }" />
        A-Trace
      </span>

      <span class="flex-1" />

      <!-- tree controls -->
      <template v-if="plan && activeView === 'tree' && parentIds.length">
        <button
          type="button"
          class="inline-flex h-[26px] items-center gap-1.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] px-2 text-[12px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
          @click="allExpanded ? collapseAll() : expandAll()"
        >
          <component :is="allExpanded ? ChevronsDownUp : ChevronsUpDown" class="h-3.5 w-3.5" />
          {{ allExpanded ? t("explain.collapseAll") : t("explain.expandAll") }}
        </button>
        <span class="mx-0.5 h-4 w-px bg-[var(--ds-border)]" />
      </template>

      <!-- raw copy -->
      <button
        v-if="plan && activeView === 'raw'"
        type="button"
        class="inline-flex h-[26px] items-center gap-1.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] px-2 text-[12px] text-[var(--ds-text-2)] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]"
        @click="copyRaw"
      >
        <Check v-if="copied" class="h-3.5 w-3.5" :style="{ color: 'var(--ds-green)' }" />
        <Copy v-else class="h-3.5 w-3.5" />
        {{ copied ? t("explain.copied") : t("explain.copy") }}
      </button>
      <span v-if="plan && activeView === 'raw'" class="mx-0.5 h-4 w-px bg-[var(--ds-border)]" />

      <!-- view toggle -->
      <div
        v-if="plan"
        class="inline-flex items-center gap-0.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] bg-[var(--ds-bg-input)] p-0.5"
      >
        <button
          v-for="v in views"
          :key="v.id"
          type="button"
          class="inline-flex h-[22px] items-center gap-1.5 rounded-[5px] px-2 text-[12px] transition-colors duration-[var(--ds-speed)] ease-[var(--ds-ease)]"
          :class="
            activeView === v.id
              ? 'bg-[var(--ds-bg-active)] text-[var(--ds-text-1)] font-medium'
              : 'text-[var(--ds-text-3)] hover:text-[var(--ds-text-1)]'
          "
          @click="activeView = v.id"
        >
          <component v-if="v.id === 'raw'" :is="isRawString ? FileText : Braces" class="h-3.5 w-3.5" />
          <component v-else :is="v.icon" class="h-3.5 w-3.5" />
          {{ v.label() }}
        </button>
      </div>
    </div>

    <!-- summary stat bar (tree/summary views) -->
    <div
      v-if="plan && activeView !== 'raw'"
      class="flex shrink-0 items-center gap-5 border-b border-[var(--ds-border-soft)] bg-[var(--ds-bg-base)] px-4 py-2"
    >
      <div class="flex flex-col">
        <span class="ds-section-label !text-[var(--ds-text-4)]">{{ t("explain.nodesLabel") }}</span>
        <span class="font-mono text-[14px] tabular-nums text-[var(--ds-text-1)]">{{ nodeCount }}</span>
      </div>
      <span class="h-7 w-px bg-[var(--ds-border-soft)]" />
      <div class="flex min-w-0 flex-col">
        <span class="ds-section-label !text-[var(--ds-text-4)]">{{ t("explain.hotspotLabel") }}</span>
        <span v-if="hotspot" class="flex items-center gap-1.5 truncate">
          <span class="font-mono text-[13px] tabular-nums" :style="{ color: 'var(--ds-red)' }">
            {{ fmt(maxCost) }}
          </span>
          <span class="truncate text-[12.5px] text-[var(--ds-text-2)]">
            {{ hotspot.nodeType }}<template v-if="hotspot.relation"> · {{ hotspot.relation }}</template>
          </span>
        </span>
        <span v-else class="text-[13px] text-[var(--ds-text-4)]">—</span>
      </div>
      <template v-if="hasActualStats">
        <span class="h-7 w-px bg-[var(--ds-border-soft)]" />
        <div class="flex flex-col">
          <span class="ds-section-label !text-[var(--ds-text-4)]">{{ t("explain.modeLabel") }}</span>
          <span class="text-[12.5px]" :style="{ color: 'var(--ds-green)' }">{{ t("explain.analyzed") }}</span>
        </div>
      </template>
    </div>

    <!-- loading: skeleton bars -->
    <div v-if="loading" class="flex-1 min-h-0 space-y-2 p-4">
      <div
        v-for="i in 6"
        :key="i"
        class="h-7 animate-pulse rounded-[var(--ds-radius-sm)] bg-[var(--ds-bg-elevated)]"
        :style="{ width: `${92 - i * 9}%`, marginLeft: `${(i % 3) * 16}px` }"
      />
    </div>

    <!-- error: inline banner -->
    <div v-else-if="error" class="flex-1 min-h-0 flex items-start justify-center p-6">
      <div
        class="flex max-w-xl items-start gap-2.5 rounded-[var(--ds-radius)] px-3.5 py-3 text-[13px]"
        :style="{
          color: 'var(--ds-red)',
          background: 'color-mix(in srgb, var(--ds-red) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--ds-red) 30%, transparent)',
        }"
      >
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
        <span class="leading-relaxed">{{ error }}</span>
      </div>
    </div>

    <!-- empty -->
    <div v-else-if="!plan" class="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
      <Network class="h-7 w-7 text-[var(--ds-text-4)]" />
      <p class="text-[13px] text-[var(--ds-text-2)]">{{ t("explain.empty") }}</p>
      <p class="max-w-sm text-[11.5px] leading-relaxed text-[var(--ds-text-3)]">{{ t("explain.emptyHint") }}</p>
    </div>

    <!-- content -->
    <div v-else class="flex-1 min-h-0 overflow-auto">
      <!-- tree -->
      <div v-if="activeView === 'tree'" class="mx-auto max-w-5xl p-2.5">
        <ExplainPlanNodeTree v-for="node in plan.nodes" :key="node.id" :node="node" :max-cost="maxCost" />
      </div>

      <!-- summary table -->
      <div v-else-if="activeView === 'summary'" class="p-3">
        <div class="ds-card overflow-hidden">
          <table class="w-full min-w-[760px] text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-[var(--ds-border)]">
                <th class="px-3 py-2 font-medium text-[var(--ds-text-2)]">{{ t("explain.node") }}</th>
                <th class="px-3 py-2 font-medium text-[var(--ds-text-2)]">{{ t("explain.relation") }}</th>
                <th class="px-3 py-2 font-medium text-[var(--ds-text-2)]">{{ t("explain.index") }}</th>
                <th class="px-3 py-2 text-right font-medium text-[var(--ds-text-2)]">{{ t("explain.cost") }}</th>
                <th class="px-3 py-2 text-right font-medium text-[var(--ds-text-2)]">{{ t("explain.rows") }}</th>
                <th class="px-3 py-2 font-medium text-[var(--ds-text-2)]">{{ t("explain.details") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in flatRows"
                :key="row.node.id"
                class="border-b border-[var(--ds-border-soft)] last:border-0 hover:bg-[var(--ds-bg-hover)]"
              >
                <td class="px-3 py-2 text-[var(--ds-text-1)]" :style="{ paddingLeft: `${12 + row.depth * 16}px` }">
                  <span class="font-mono text-[11.5px]">{{ row.node.nodeType }}</span>
                </td>
                <td class="px-3 py-2 font-mono text-[11.5px] text-[var(--ds-text-2)]">
                  {{ row.node.relation || "—" }}
                </td>
                <td class="px-3 py-2 font-mono text-[11.5px]" :style="{ color: 'var(--ds-teal)' }">
                  {{ row.node.index || "—" }}
                </td>
                <td
                  class="px-3 py-2 text-right font-mono tabular-nums"
                  :style="{
                    color: explainNodeCost(row.node) === maxCost && maxCost > 0 ? 'var(--ds-red)' : 'var(--ds-text-2)',
                  }"
                >
                  {{ fmt(explainNodeCost(row.node)) }}
                </td>
                <td class="px-3 py-2 text-right font-mono tabular-nums text-[var(--ds-text-2)]">
                  {{ fmt(explainNodeRows(row.node)) }}
                </td>
                <td class="px-3 py-2 text-[11.5px] text-[var(--ds-text-3)]">
                  {{ row.node.details.join(" · ") || "—" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- raw -->
      <pre
        v-else
        class="m-3 overflow-auto whitespace-pre rounded-[var(--ds-radius)] border border-[var(--ds-border)] bg-[var(--ds-bg-canvas)] p-3.5 font-mono text-[12px] leading-relaxed text-[var(--ds-text-2)]"
        >{{ rawContent }}</pre
      >
    </div>
  </div>
</template>
