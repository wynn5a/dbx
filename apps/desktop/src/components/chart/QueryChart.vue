<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import VChart from "vue-echarts";
import { BarChart3 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { QueryResult } from "@/types/database";
import { useTheme } from "@/composables/useTheme";

use([CanvasRenderer, LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent]);

const props = defineProps<{
  result: QueryResult;
}>();

const { t } = useI18n();
const { isDark } = useTheme();

type ChartType = "line" | "bar" | "pie";
const chartType = ref<ChartType>("bar");
const xColumn = ref("");
const yColumns = ref<string[]>([]);

const numericColumns = computed(() =>
  props.result.columns.filter((_, idx) => props.result.rows.some((row) => typeof row[idx] === "number")),
);

const allColumns = computed(() => props.result.columns);

watch(
  () => props.result,
  () => {
    const cols = props.result.columns;
    const numCols = numericColumns.value;
    xColumn.value = cols.find((c) => !numCols.includes(c)) || cols[0] || "";
    yColumns.value = numCols.length > 0 ? [numCols[0]] : [];
  },
  { immediate: true },
);

function toggleYColumn(col: string) {
  const idx = yColumns.value.indexOf(col);
  if (idx >= 0) {
    yColumns.value = yColumns.value.filter((c) => c !== col);
  } else {
    yColumns.value = [...yColumns.value, col];
  }
}

// Mirror the .ds-tooltip surface (globals.css) — ECharts renders its tooltip
// as inline-styled DOM, so the shared class can't be applied directly.
const dsTooltipStyle = computed(() => ({
  backgroundColor: "transparent",
  borderWidth: 0,
  padding: 0,
  textStyle: { color: "var(--ds-text-1)" },
  extraCssText: [
    "display:inline-flex",
    "align-items:center",
    "gap:8px",
    "max-width:36ch",
    "padding:4.5px 9px",
    "border:1px solid var(--ds-border-strong)",
    "border-radius:6px",
    "background:linear-gradient(180deg,rgb(255 255 255 / 0.02),transparent 40%),var(--ds-bg-elevated)",
    "font-size:11.5px",
    "font-weight:500",
    "line-height:1.4",
    isDark.value
      ? "box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.07),0 4px 12px -2px rgb(0 0 0 / 0.5)"
      : "box-shadow:inset 0 1px 0 rgb(255 255 255 / 0.6),0 4px 12px -2px rgb(0 0 0 / 0.12)",
  ].join(";"),
}));

const chartOption = computed(() => {
  const xIdx = props.result.columns.indexOf(xColumn.value);
  if (xIdx < 0 || yColumns.value.length === 0) return null;

  const xData = props.result.rows.map((row) => String(row[xIdx] ?? ""));

  if (chartType.value === "pie") {
    const yIdx = props.result.columns.indexOf(yColumns.value[0]);
    if (yIdx < 0) return null;
    return {
      tooltip: { trigger: "item", ...dsTooltipStyle.value },
      legend: { bottom: 0, textStyle: { color: isDark.value ? "#ccc" : "#333" } },
      series: [
        {
          type: "pie",
          radius: ["30%", "60%"],
          data: xData.map((name, i) => ({
            name,
            value: Number(props.result.rows[i][yIdx]) || 0,
          })),
        },
      ],
    };
  }

  const yIndices = yColumns.value.map((c) => props.result.columns.indexOf(c)).filter((i) => i >= 0);

  return {
    tooltip: { trigger: "axis", ...dsTooltipStyle.value },
    legend: {
      bottom: 0,
      textStyle: { color: isDark.value ? "#ccc" : "#333" },
    },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: {
      type: "category" as const,
      data: xData,
      axisLabel: { color: isDark.value ? "#aaa" : "#666" },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { color: isDark.value ? "#aaa" : "#666" },
    },
    series: yIndices.map((yIdx) => ({
      name: props.result.columns[yIdx],
      type: chartType.value,
      data: props.result.rows.map((row) => Number(row[yIdx]) || 0),
      smooth: chartType.value === "line",
    })),
  };
});

const hasData = computed(() => props.result.rows.length > 0 && numericColumns.value.length > 0);
</script>

<template>
  <div class="h-full flex flex-col">
    <div v-if="!hasData" class="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
      <BarChart3 class="h-10 w-10 opacity-30" />
      <span>{{ t("chart.noNumericData") }}</span>
    </div>
    <template v-else>
      <div class="h-9 shrink-0 border-b bg-muted/20 px-3 flex items-center gap-3 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground">{{ t("chart.type") }}</span>
          <div class="flex gap-0.5">
            <Button
              v-for="ct in ['bar', 'line', 'pie'] as ChartType[]"
              :key="ct"
              size="sm"
              :variant="chartType === ct ? 'secondary' : 'ghost'"
              class="h-6 px-2 text-xs"
              @click="chartType = ct"
            >
              {{ t(`chart.${ct}`) }}
            </Button>
          </div>
        </div>
        <span class="h-4 w-px bg-border" />
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground">X</span>
          <Select :model-value="xColumn" @update:model-value="(v: any) => (xColumn = v)">
            <SelectTrigger class="h-6 w-auto max-w-40 border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="col in allColumns" :key="col" :value="col">{{ col }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <span class="h-4 w-px bg-border" />
        <div class="flex items-center gap-1.5">
          <span class="text-muted-foreground">Y</span>
          <div class="flex gap-0.5">
            <Button
              v-for="col in numericColumns"
              :key="col"
              size="sm"
              :variant="yColumns.includes(col) ? 'secondary' : 'ghost'"
              class="h-6 px-2 text-xs"
              @click="toggleYColumn(col)"
            >
              {{ col }}
            </Button>
          </div>
        </div>
      </div>
      <div class="flex-1 min-h-0 p-2">
        <VChart v-if="chartOption" :option="chartOption" autoresize class="h-full w-full" />
      </div>
    </template>
  </div>
</template>
