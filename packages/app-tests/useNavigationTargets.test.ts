import { strict as assert } from "node:assert";
import { beforeEach, test, vi } from "vitest";
import type { QueryTab } from "../../apps/desktop/src/types/database.ts";

// openTableTarget runs against the real composable with the stores/api stubbed,
// so the test covers the actual FK-navigation / database-search open path.
const state = vi.hoisted(() => ({
  tabs: [] as any[],
  activeTabId: null as string | null,
  executed: [] as string[],
  reuseDataTab: false,
}));

vi.mock("@/stores/queryStore", () => ({
  useQueryStore: () => ({
    get tabs() {
      return state.tabs;
    },
    get activeTabId() {
      return state.activeTabId;
    },
    set activeTabId(value: string | null) {
      state.activeTabId = value;
    },
    createTab(connectionId: string, database: string, title: string, mode: QueryTab["mode"], schema?: string) {
      const id = `tab-${state.tabs.length + 1}`;
      state.tabs.push({ id, title, connectionId, database, schema, mode, sql: "" });
      state.activeTabId = id;
      return id;
    },
    setExecuting() {},
    updateSql(tabId: string, sql: string) {
      state.tabs.find((tab) => tab.id === tabId).sql = sql;
    },
    setTableMeta(tabId: string, meta: unknown) {
      state.tabs.find((tab) => tab.id === tabId).tableMeta = meta;
    },
    async executeTabSql(_tabId: string, sql: string) {
      state.executed.push(sql);
    },
    setErrorResult(_tabId: string, error: unknown) {
      throw error;
    },
  }),
}));

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: () => ({
    activeConnectionId: null,
    getConfig: (id: string) => ({ id, name: id, db_type: "mysql", host: "h", port: 3306, username: "u", password: "" }),
    ensureConnected: async () => {},
  }),
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    editorSettings: {
      pageSize: 100,
      get reuseDataTab() {
        return state.reuseDataTab;
      },
    },
  }),
}));

vi.mock("@/lib/api", () => ({
  getColumns: async () => [],
  buildTableSelectSql: async (options: { tableName: string; whereInput?: string }) =>
    `SELECT * FROM ${options.tableName}${options.whereInput ? ` WHERE ${options.whereInput}` : ""}`,
}));

const { useNavigationTargets } = await import("../../apps/desktop/src/composables/useNavigationTargets.ts");

function openTableTarget() {
  return useNavigationTargets({ showFieldLineageDialog: { value: false }, showDatabaseSearchDialog: { value: false } })
    .openTableTarget;
}

beforeEach(() => {
  state.tabs = [];
  state.activeTabId = null;
  state.executed = [];
  state.reuseDataTab = false;
});

test("FK navigation seeds the tab's WHERE bar with the navigation filter", async () => {
  await openTableTarget()({
    connectionId: "c1",
    database: "shop",
    tableName: "customers",
    whereInput: "`id` = 42",
  });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].whereInput, "`id` = 42");
  assert.match(state.executed[0], /WHERE `id` = 42/);
});

test("a reused data tab takes the new filter and drops the previous table's filter and sort", async () => {
  state.reuseDataTab = true;
  state.tabs.push({
    id: "old",
    title: "orders",
    connectionId: "c1",
    database: "shop",
    mode: "data",
    sql: "",
    whereInput: "status = 'open'",
    orderByInput: "created_at DESC",
    resultSortColumn: "created_at",
    resultSortColumnIndex: 3,
    resultSortDirection: "desc",
  });
  await openTableTarget()({ connectionId: "c1", database: "shop", tableName: "customers", whereInput: "`id` = 7" });
  const reused = state.tabs[0];
  assert.equal(state.tabs.length, 1);
  assert.equal(reused.whereInput, "`id` = 7");
  assert.equal(reused.orderByInput, "");
  assert.equal(reused.resultSortColumn, undefined);
  assert.equal(reused.resultSortDirection, undefined);

  await openTableTarget()({ connectionId: "c1", database: "shop", tableName: "orders" });
  assert.equal(reused.whereInput, "");
});
