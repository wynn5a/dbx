import type { QueryTab, ColumnInfo } from "@/types/database";

export type DataTabTableMeta = NonNullable<QueryTab["tableMeta"]>;

function fallbackColumnInfo(name: string): ColumnInfo {
  return {
    name,
    data_type: "",
    is_nullable: true,
    column_default: null,
    is_primary_key: false,
    extra: null,
  };
}

export function tableMetaForDataTab(tab: QueryTab | undefined): DataTabTableMeta | undefined {
  if (!tab || tab.mode !== "data") return undefined;
  if (tab.tableMeta) return tab.tableMeta;
  const tableName = tab.title.trim();
  if (!tableName) return undefined;

  return {
    schema: tab.schema,
    tableName,
    columns: (tab.result?.columns ?? []).map(fallbackColumnInfo),
    primaryKeys: [],
  };
}

export type DataTabFilterState = Pick<
  QueryTab,
  "whereInput" | "orderByInput" | "resultSortColumn" | "resultSortColumnIndex" | "resultSortDirection"
>;

/**
 * Seeds a data tab's filter/sort bar state for a freshly opened table so it
 * matches the SQL about to run. The grid's WHERE bar is seeded from
 * `tab.whereInput`, and paging/sorting/refresh rebuild the SQL from that bar —
 * so a filter baked only into the SQL (FK navigation, database search) would be
 * dropped on the first page/sort/refresh, and a reused tab would keep the
 * previous table's filter and sort.
 */
export function seedDataTabFilterState(tab: DataTabFilterState, whereInput?: string): void {
  tab.whereInput = whereInput ?? "";
  tab.orderByInput = "";
  tab.resultSortColumn = undefined;
  tab.resultSortColumnIndex = undefined;
  tab.resultSortDirection = undefined;
}
