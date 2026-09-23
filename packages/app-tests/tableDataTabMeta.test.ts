import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import { seedDataTabFilterState, tableMetaForDataTab } from "../../apps/desktop/src/lib/tableDataTabMeta.ts";
import type { QueryTab } from "../../apps/desktop/src/types/database.ts";

function tab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    id: "tab-1",
    title: "users",
    connectionId: "conn-1",
    database: "app",
    schema: "public",
    sql: "select * from users",
    isExecuting: false,
    isCancelling: false,
    isExplaining: false,
    mode: "data",
    ...overrides,
  };
}

test("returns persisted table metadata for a data tab", () => {
  const tableMeta = {
    schema: "public",
    tableName: "users",
    columns: [
      {
        name: "id",
        data_type: "integer",
        is_nullable: false,
        column_default: null,
        is_primary_key: true,
        extra: null,
      },
    ],
    primaryKeys: ["id"],
  };

  assert.equal(tableMetaForDataTab(tab({ tableMeta })), tableMeta);
});

test("builds fallback metadata from a data tab when column metadata is unavailable", () => {
  const meta = tableMetaForDataTab(
    tab({
      result: {
        columns: ["id", "name"],
        rows: [],
        affected_rows: 0,
        execution_time_ms: 1,
      },
    }),
  );

  assert.deepEqual(meta, {
    schema: "public",
    tableName: "users",
    columns: [
      {
        name: "id",
        data_type: "",
        is_nullable: true,
        column_default: null,
        is_primary_key: false,
        extra: null,
      },
      {
        name: "name",
        data_type: "",
        is_nullable: true,
        column_default: null,
        is_primary_key: false,
        extra: null,
      },
    ],
    primaryKeys: [],
  });
});

test("does not infer table metadata for query tabs", () => {
  assert.equal(tableMetaForDataTab(tab({ mode: "query" })), undefined);
});

test("seedDataTabFilterState sets the WHERE bar to the navigation filter and clears stale sort", () => {
  const target = tab({
    whereInput: "status = 'open'",
    orderByInput: "created_at DESC",
    resultSortColumn: "created_at",
    resultSortColumnIndex: 2,
    resultSortDirection: "desc",
  });
  seedDataTabFilterState(target, "`id` = 42");
  assert.equal(target.whereInput, "`id` = 42");
  assert.equal(target.orderByInput, "");
  assert.equal(target.resultSortColumn, undefined);
  assert.equal(target.resultSortColumnIndex, undefined);
  assert.equal(target.resultSortDirection, undefined);
  seedDataTabFilterState(target);
  assert.equal(target.whereInput, "");
});

test("sidebar table open seeds the tab filters and DataGrid follows re-seeded bar state", () => {
  const treeItem = readFileSync(
    new URL("../../apps/desktop/src/components/sidebar/TreeItem.vue", import.meta.url),
    "utf8",
  );
  const dataGrid = readFileSync(new URL("../../apps/desktop/src/components/grid/DataGrid.vue", import.meta.url), "utf8");
  assert.match(treeItem, /if \(openedTab\) seedDataTabFilterState\(openedTab\);/);
  assert.match(dataGrid, /\(\) => props\.initialWhereInput,/);
  assert.match(dataGrid, /\(\) => props\.initialOrderByInput,/);
});
