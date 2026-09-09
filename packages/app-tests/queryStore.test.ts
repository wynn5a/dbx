import { strict as assert } from "node:assert";
import { test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { isReactive } from "vue";
import { useConnectionStore } from "../../apps/desktop/src/stores/connectionStore.ts";
import { useQueryStore } from "../../apps/desktop/src/stores/queryStore.ts";
import type { ConnectionConfig } from "../../apps/desktop/src/types/database.ts";
import type { QueryResult } from "../../apps/desktop/src/types/database.ts";

function installMemoryStorage() {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

function conn(id: string): ConnectionConfig {
  return {
    id,
    name: id,
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    username: "postgres",
    password: "",
  };
}

function oracleConn(id: string): ConnectionConfig {
  return {
    ...conn(id),
    db_type: "oracle",
    port: 1521,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function installTauriInvokeStub(router: (cmd: string, args: Record<string, unknown>) => Promise<unknown>) {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    setTimeout: (handler: (...args: unknown[]) => void, timeout?: number) => setTimeout(handler, timeout),
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => router(cmd, args ?? {}),
    },
  };
  return () => {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis as any, "window");
    else (globalThis as any).window = originalWindow;
  };
}

test("setErrorResult stops loading and shows the error result", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();
  const tabId = store.createTab("conn-1", "db", "users", "data");

  store.setExecuting(tabId, true);
  store.setErrorResult(tabId, new Error("metadata failed"));

  const tab = store.tabs.find((item) => item.id === tabId);
  assert.equal(tab?.isExecuting, false);
  assert.equal(tab?.isCancelling, false);
  assert.equal(tab?.executionId, undefined);
  assert.deepEqual(tab?.result?.columns, ["Error"]);
  assert.deepEqual(tab?.result?.rows, [["metadata failed"]]);
});

test("renames query tab titles", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();
  const tabId = store.createTab("conn-1", "db");

  assert.equal(store.renameTab(tabId, " Revenue checks "), true);

  const tab = store.tabs.find((item) => item.id === tabId);
  assert.equal(tab?.title, "Revenue checks");
  assert.equal(tab?.customTitle, true);
});

test("editing query sql preserves the displayed result editability state", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();
  const tabId = store.createTab("conn-1", "db");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);

  tab.sql = "select id, name from users";
  tab.lastExecutedSql = tab.sql;
  tab.resultBaseSql = tab.sql;
  tab.resultSortedSql = "select id, name from users order by name";
  tab.result = {
    columns: ["id", "name"],
    rows: [[1, "Ada"]],
    affected_rows: 0,
    execution_time_ms: 1,
  };
  tab.tableMeta = {
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
  tab.queryAnalysis = {
    tableName: "users",
    selectStar: false,
    columns: [
      { sourceName: "id", resultName: "id", expression: "id" },
      { sourceName: "name", resultName: "name", expression: "name" },
    ],
  };
  tab.querySourceColumns = ["id", "name"];

  store.updateSql(tabId, "select id, name from users where active = true");

  assert.equal(tab.sql, "select id, name from users where active = true");
  assert.equal(tab.resultBaseSql, "select id, name from users");
  assert.equal(tab.resultSortedSql, "select id, name from users order by name");
  assert.deepEqual(tab.querySourceColumns, ["id", "name"]);
  assert.equal(tab.queryAnalysis?.tableName, "users");
  assert.equal(tab.tableMeta?.tableName, "users");
});

test("normalizes unquoted Oracle query identifiers before loading editable metadata", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  const columnRequests: Array<{ schema: string | null; table: string | null }> = [];

  connectionStore.addEphemeralConnection(oracleConn("oracle-1"));

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "execute_multi") {
      return [
        {
          columns: ["ID", "NAME"],
          rows: [[1, "Ada"]],
          affected_rows: 0,
          execution_time_ms: 1,
        },
      ];
    }
    if (cmd === "analyze_editable_query_editability") {
      assert.equal(args.sql, "select id, name from users");
      return {
        editable: true,
        analysis: {
          schema: undefined,
          schemaQuoted: false,
          tableName: "users",
          tableNameQuoted: false,
          tableAlias: undefined,
          selectStar: false,
          columns: [
            { sourceName: "id", sourceNameQuoted: false, resultName: "id", expression: "id" },
            { sourceName: "name", sourceNameQuoted: false, resultName: "name", expression: "name" },
          ],
        },
      };
    }
    if (cmd === "get_columns") {
      columnRequests.push({ schema: (args.schema as string) ?? null, table: (args.table as string) ?? null });
      return [
        {
          name: "ID",
          data_type: "NUMBER",
          is_nullable: false,
          column_default: null,
          is_primary_key: true,
          extra: null,
          comment: "identifier",
        },
        {
          name: "NAME",
          data_type: "VARCHAR2",
          is_nullable: true,
          column_default: null,
          is_primary_key: false,
          extra: null,
          comment: "display name",
        },
      ];
    }
    if (cmd === "prepare_query_pagination_execution_plan") {
      const options = args.options as { sql: string };
      return { sqlToExecute: options.sql, useAgentResultSession: false };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const tabId = store.createTab("oracle-1", "ORCL", "Query 1", "query", "app");
    await store.executeTabSql(tabId, "select id, name from users");

    const tab = store.tabs.find((item) => item.id === tabId);
    await waitFor(() => columnRequests.length > 0 && tab?.tableMeta?.tableName === "USERS");
    assert.deepEqual(columnRequests, [{ schema: "APP", table: "USERS" }]);
    assert.equal(tab?.tableMeta?.schema, "APP");
    assert.equal(tab?.tableMeta?.tableName, "USERS");
    assert.deepEqual(tab?.querySourceColumns, ["ID", "NAME"]);
    assert.equal(tab?.queryEditabilityReason, undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("evicting cached tab results releases multi-result payloads and sessions", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  let executeCount = 0;
  const closedSessions: string[] = [];

  connectionStore.addEphemeralConnection(conn("conn-1"));

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "execute_multi") {
      executeCount++;
      const results: QueryResult[] = [
        {
          columns: ["id"],
          rows: [[executeCount]],
          affected_rows: 0,
          execution_time_ms: 1,
          session_id: `session-${executeCount}`,
        },
        {
          columns: ["detail"],
          rows: [[`payload-${executeCount}`]],
          affected_rows: 0,
          execution_time_ms: 1,
        },
      ];
      return results;
    }
    if (cmd === "close_query_session") {
      closedSessions.push(args.sessionId as string);
      return true;
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    if (cmd === "prepare_query_pagination_execution_plan") {
      const options = args.options as { sql: string };
      return {
        sqlToExecute: options.sql,
        useAgentResultSession: false,
      };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const tabIds: string[] = [];
    for (let i = 0; i < 7; i++) {
      const tabId = store.createTab("conn-1", "db", `Query ${i + 1}`);
      tabIds.push(tabId);
      await store.executeTabSql(tabId, `select ${i + 1}; select ${i + 1} as detail`);
    }

    const evicted = store.tabs.find((tab) => tab.id === tabIds[0]);
    assert.equal(executeCount, 7);
    assert.equal(evicted?.result, undefined);
    assert.equal(evicted?.results, undefined);
    assert.equal(evicted?.activeResultIndex, undefined);
    assert.equal(evicted?.resultSessionId, undefined);
    assert.equal(evicted?.resultEvicted, true);
    assert.deepEqual(closedSessions, ["session-1"]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("result cache eviction keeps recently accessed inactive tabs", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  let executeCount = 0;

  connectionStore.addEphemeralConnection(conn("conn-1"));

  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "execute_multi") {
      executeCount++;
      const results: QueryResult[] = [
        {
          columns: ["id"],
          rows: [[executeCount]],
          affected_rows: 0,
          execution_time_ms: 1,
          session_id: `session-${executeCount}`,
        },
      ];
      return results;
    }
    if (cmd === "close_query_session") {
      return true;
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    if (cmd === "prepare_query_pagination_execution_plan") {
      return { sqlToExecute: "select 1", useAgentResultSession: false };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const tabIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const tabId = store.createTab("conn-1", "db", `Query ${i + 1}`);
      tabIds.push(tabId);
      await store.executeTabSql(tabId, `select ${i + 1}`);
    }

    store.activeTabId = tabIds[0];
    await new Promise((resolve) => setTimeout(resolve, 1));

    const tabId = store.createTab("conn-1", "db", "Query 7");
    tabIds.push(tabId);
    await store.executeTabSql(tabId, "select 7");

    const recentlyViewed = store.tabs.find((tab) => tab.id === tabIds[0]);
    const leastRecentlyUsed = store.tabs.find((tab) => tab.id === tabIds[1]);
    assert.ok(recentlyViewed?.result);
    assert.equal(recentlyViewed?.resultEvicted, undefined);
    assert.equal(leastRecentlyUsed?.result, undefined);
    assert.equal(leastRecentlyUsed?.resultEvicted, true);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("closing tabs clears removed result payloads before dropping tab references", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => {
    return true;
  });
  try {
    setActivePinia(createPinia());
    const store = useQueryStore();
    const keepId = store.createTab("conn-1", "db", "keep");
    const closeId = store.createTab("conn-1", "db", "close");
    const closingTab = store.tabs.find((item) => item.id === closeId);

    assert.ok(closingTab);
    closingTab.result = {
      columns: ["payload"],
      rows: [[new Array(10_000).fill("x").join("")]],
      affected_rows: 0,
      execution_time_ms: 1,
      session_id: "session-close",
    };
    closingTab.results = [closingTab.result];
    closingTab.activeResultIndex = 0;
    closingTab.resultSessionId = "session-close";

    store.closeOtherTabs(keepId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(closingTab.result, undefined);
    assert.equal(closingTab.results, undefined);
    assert.equal(closingTab.activeResultIndex, undefined);
    assert.equal(closingTab.resultSessionId, undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("closing database tabs removes browser tabs for that database only", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => {
    return true;
  });

  try {
    setActivePinia(createPinia());
    const store = useQueryStore();
    const dataId = store.createTab("conn-1", "db", "users", "data", "public");
    const objectsId = store.openObjectBrowser("conn-1", "db", "public");
    const structureId = store.openTableStructure("conn-1", "db", "public", "users");
    const mongoId = store.createTab("conn-1", "db", "orders", "mongo");
    const queryId = store.createTab("conn-1", "db", "draft query", "query");
    const otherDbId = store.createTab("conn-1", "analytics", "users", "data", "public");
    const otherConnectionId = store.createTab("conn-2", "db", "users", "data", "public");
    const structureTab = store.tabs.find((item) => item.id === structureId);

    assert.ok(structureTab);
    structureTab.result = {
      columns: ["payload"],
      rows: [["structure"]],
      affected_rows: 0,
      execution_time_ms: 1,
      session_id: "session-structure",
    };
    structureTab.resultSessionId = "session-structure";
    store.activeTabId = structureId;

    store.closeDatabaseTabs("conn-1", "db");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(
      store.tabs.map((tab) => tab.id),
      [otherDbId, otherConnectionId],
    );
    assert.equal(store.activeTabId, otherConnectionId);
    assert.equal(
      store.tabs.some((tab) => [dataId, objectsId, structureId, mongoId, queryId].includes(tab.id)),
      false,
    );
    assert.equal(structureTab.result, undefined);
    assert.equal(structureTab.resultSessionId, undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("closing connection tabs removes every tab for that connection only", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => {
    return true;
  });

  try {
    setActivePinia(createPinia());
    const store = useQueryStore();
    const queryId = store.createTab("conn-1", "db", "draft query", "query");
    const dataId = store.createTab("conn-1", "db", "users", "data", "public");
    const objectsId = store.openObjectBrowser("conn-1", "db", "public");
    const otherConnectionId = store.createTab("conn-2", "db", "users", "data", "public");
    const queryTab = store.tabs.find((item) => item.id === queryId);

    assert.ok(queryTab);
    queryTab.result = {
      columns: ["payload"],
      rows: [["query"]],
      affected_rows: 0,
      execution_time_ms: 1,
      session_id: "session-query",
    };
    queryTab.resultSessionId = "session-query";
    store.activeTabId = queryId;

    store.closeConnectionTabs("conn-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(
      store.tabs.map((tab) => tab.id),
      [otherConnectionId],
    );
    assert.equal(store.activeTabId, otherConnectionId);
    assert.equal(
      store.tabs.some((tab) => [queryId, dataId, objectsId].includes(tab.id)),
      false,
    );
    assert.equal(queryTab.result, undefined);
    assert.equal(queryTab.resultSessionId, undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("releasing connection tabs keeps SQL tabs and closes object tabs", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => {
    return true;
  });

  try {
    setActivePinia(createPinia());
    const store = useQueryStore();
    const queryId = store.createTab("conn-1", "db", "draft query", "query");
    const dataId = store.createTab("conn-1", "db", "users", "data", "public");
    const objectsId = store.openObjectBrowser("conn-1", "db", "public");
    const structureId = store.openTableStructure("conn-1", "db", "public", "users");
    const otherConnectionId = store.createTab("conn-2", "db", "users", "data", "public");
    const queryTab = store.tabs.find((item) => item.id === queryId);
    const dataTab = store.tabs.find((item) => item.id === dataId);

    assert.ok(queryTab);
    assert.ok(dataTab);
    queryTab.result = {
      columns: ["payload"],
      rows: [["query"]],
      affected_rows: 0,
      execution_time_ms: 1,
      session_id: "session-query",
    };
    queryTab.resultSessionId = "session-query";
    dataTab.result = {
      columns: ["payload"],
      rows: [["data"]],
      affected_rows: 0,
      execution_time_ms: 1,
      session_id: "session-data",
    };
    dataTab.resultSessionId = "session-data";
    store.activeTabId = dataId;

    store.releaseConnectionTabs("conn-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(
      store.tabs.map((tab) => tab.id),
      [queryId, otherConnectionId],
    );
    assert.equal(store.activeTabId, otherConnectionId);
    assert.equal(
      store.tabs.some((tab) => [dataId, objectsId, structureId].includes(tab.id)),
      false,
    );
    assert.equal(queryTab.result, undefined);
    assert.equal(queryTab.resultSessionId, undefined);
    assert.equal(dataTab.result, undefined);
    assert.equal(dataTab.resultSessionId, undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("releasing database tabs keeps SQL tabs and closes table tabs for that database only", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => {
    return true;
  });

  try {
    setActivePinia(createPinia());
    const store = useQueryStore();
    const queryId = store.createTab("conn-1", "db", "draft query", "query");
    const dataId = store.createTab("conn-1", "db", "users", "data", "public");
    const otherDbId = store.createTab("conn-1", "analytics", "orders", "data", "public");
    const otherConnectionId = store.createTab("conn-2", "db", "users", "data", "public");
    const queryTab = store.tabs.find((item) => item.id === queryId);

    assert.ok(queryTab);
    queryTab.result = {
      columns: ["payload"],
      rows: [["query"]],
      affected_rows: 0,
      execution_time_ms: 1,
      session_id: "session-query",
    };
    queryTab.resultSessionId = "session-query";

    store.releaseDatabaseTabs("conn-1", "db");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(
      store.tabs.map((tab) => tab.id),
      [queryId, otherDbId, otherConnectionId],
    );
    assert.equal(
      store.tabs.some((tab) => tab.id === dataId),
      false,
    );
    assert.equal(queryTab.result, undefined);
    assert.equal(queryTab.resultSessionId, undefined);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("disconnecting a connection closes every tab for that connection", async () => {
  const restoreStorage = installMemoryStorage();
  const restoreTauri = installTauriInvokeStub(async () => {
    return true;
  });

  try {
    setActivePinia(createPinia());
    const connectionStore = useConnectionStore();
    const queryStore = useQueryStore();
    connectionStore.addEphemeralConnection(conn("conn-1"));
    connectionStore.addEphemeralConnection(conn("conn-2"));
    const queryId = queryStore.createTab("conn-1", "db", "draft query", "query");
    const dataId = queryStore.createTab("conn-1", "db", "users", "data", "public");
    const otherConnectionId = queryStore.createTab("conn-2", "db", "users", "data", "public");

    queryStore.activeTabId = dataId;
    await connectionStore.disconnect("conn-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(
      queryStore.tabs.map((tab) => tab.id),
      [otherConnectionId],
    );
    assert.equal(queryStore.activeTabId, otherConnectionId);
    assert.equal(
      queryStore.tabs.some((tab) => [queryId, dataId].includes(tab.id)),
      false,
    );
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("starting a new query clears the previous result payload immediately", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);
  tab.result = {
    columns: ["old"],
    rows: [[new Array(10_000).fill("old").join("")]],
    affected_rows: 0,
    execution_time_ms: 1,
  };

  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return { sqlToExecute: "select 1", useAgentResultSession: false };
    }
    if (cmd === "execute_multi") {
      return [{ columns: ["new"], rows: [[1]], affected_rows: 0, execution_time_ms: 1 }];
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const execution = store.executeTabSql(tabId, "select 1");
    assert.equal(tab.result, undefined);
    assert.equal(tab.results, undefined);
    await execution;
    assert.deepEqual(tab.result?.columns, ["new"]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("grid refreshes can preserve the previous result while loading", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);
  const previousResult: QueryResult = {
    columns: ["id", "name"],
    rows: [[1, "Ada"]],
    affected_rows: 0,
    execution_time_ms: 1,
  };
  tab.result = previousResult;

  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return { sqlToExecute: "select 1 order by name", useAgentResultSession: false };
    }
    if (cmd === "execute_multi") {
      return [{ columns: ["id", "name"], rows: [[2, "Grace"]], affected_rows: 0, execution_time_ms: 1 }];
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const execution = store.executeTabSql(tabId, "select 1 order by name", {
      preserveResultDuringExecution: true,
    });
    assert.deepEqual(tab.result?.columns, previousResult.columns);
    assert.deepEqual(tab.result?.rows, previousResult.rows);
    assert.equal(tab.isExecuting, true);
    await execution;
    assert.deepEqual(tab.result?.rows, [[2, "Grace"]]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("data tab execution preserves pagination offset metadata", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  let executeBody: any;
  let preparedPagination = false;

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "users", "data", "public");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      preparedPagination = true;
      throw new Error("unexpected pagination plan request");
    }
    if (cmd === "execute_multi") {
      executeBody = args;
      return [{ columns: ["id"], rows: [[101]], affected_rows: 0, execution_time_ms: 1 }];
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.executeTabSql(tabId, 'SELECT * FROM "users" LIMIT 100 OFFSET 100;', {
      pagination: { limit: 100, offset: 100 },
    });

    assert.equal(preparedPagination, false);
    assert.equal(executeBody.sql, 'SELECT * FROM "users" LIMIT 100 OFFSET 100;');
    assert.equal(executeBody.maxRows, 100);
    assert.equal(executeBody.fetchSize, 100);
    assert.equal(executeBody.schema, undefined);
    assert.equal(tab.resultPageLimit, 100);
    assert.equal(tab.resultPageOffset, 100);
    assert.deepEqual(tab.result?.rows, [[101]]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("activating an empty data tab waits for explicit execution", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  let executeBody: any;

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "users", "data", "public");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);
  tab.sql = 'SELECT * FROM "public"."users" LIMIT 50 OFFSET 50;';
  tab.lastExecutedSql = tab.sql;
  tab.resultPageLimit = 50;
  tab.resultPageOffset = 50;

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "execute_multi") {
      executeBody = args;
      return [{ columns: ["id"], rows: [[51]], affected_rows: 0, execution_time_ms: 1 }];
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.reloadEvictedTab(tabId);

    assert.equal(executeBody, undefined);
    assert.equal(tab.result, undefined);
    assert.equal(tab.resultPageLimit, 50);
    assert.equal(tab.resultPageOffset, 50);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("query result export fetches every paginated page", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  const preparedOffsets: number[] = [];
  const executedSqls: string[] = [];
  const timeoutSecs: unknown[] = [];

  connectionStore.addEphemeralConnection({ ...conn("conn-1"), query_timeout_secs: 600 });
  const tabId = store.createTab("conn-1", "db");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);
  tab.lastExecutedSql = "select id from users";
  tab.resultPageLimit = 100;
  tab.resultPageOffset = 0;
  tab.result = {
    columns: ["id"],
    rows: [[1]],
    affected_rows: 0,
    execution_time_ms: 1,
    truncated: false,
    has_more: true,
  };

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      const options = args.options as { pagination: { offset: number; limit: number } };
      const offset = Number(options.pagination.offset);
      const limit = Number(options.pagination.limit);
      preparedOffsets.push(offset);
      return {
        sqlToExecute: `select id from users /* offset:${offset} */`,
        pageSql: `select id from users /* offset:${offset} */`,
        pageLimit: limit,
        pageOffset: offset,
        useAgentResultSession: false,
      };
    }
    if (cmd === "execute_multi") {
      executedSqls.push(args.sql as string);
      timeoutSecs.push(args.timeoutSecs);
      const rows = String(args.sql).includes("offset:0")
        ? Array.from({ length: 10_000 }, (_, index) => [index + 1])
        : [[10_001], [10_002]];
      return [{ columns: ["id"], rows, affected_rows: 0, execution_time_ms: 1 }];
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const exported = await store.fetchTabResultForExport(tabId);

    assert.deepEqual(preparedOffsets, [0, 10_000]);
    assert.deepEqual(executedSqls, ["select id from users /* offset:0 */", "select id from users /* offset:10000 */"]);
    assert.deepEqual(timeoutSecs, [600, 600]);
    assert.equal(exported?.rows.length, 10_002);
    assert.deepEqual(exported?.rows.at(-1), [10_002]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("table data export fetches every filtered page", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();
  const buildRequests: unknown[] = [];
  const executedSqls: string[] = [];

  connectionStore.addEphemeralConnection({ ...conn("conn-1"), db_type: "saphana" });
  const tabId = store.createTab("conn-1", "db", "users", "data", "public");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);
  tab.whereInput = "status = 'active'";
  tab.orderByInput = '"id" DESC';
  tab.result = {
    columns: ["id", "status"],
    rows: [[1, "active"]],
    affected_rows: 0,
    execution_time_ms: 1,
    truncated: false,
    has_more: true,
  };
  tab.tableMeta = {
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
      {
        name: "status",
        data_type: "varchar",
        is_nullable: true,
        column_default: null,
        is_primary_key: false,
        extra: null,
      },
    ],
    primaryKeys: ["id"],
  };

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "build_table_select_sql") {
      const options = args.options as { limit?: number; offset?: number };
      buildRequests.push(options);
      const { limit, offset } = options;
      return `SELECT * FROM "public"."users" WHERE (status = 'active') ORDER BY "id" DESC LIMIT ${limit} OFFSET ${offset ?? 0};`;
    }
    if (cmd === "execute_multi") {
      executedSqls.push(args.sql as string);
      const rows = String(args.sql).includes("OFFSET 0")
        ? Array.from({ length: 10_000 }, (_, index) => [index + 1, "active"])
        : [[10_001, "active"], [10_002, "active"]];
      return [{ columns: ["id", "status"], rows, affected_rows: 0, execution_time_ms: 1 }];
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    const exported = await store.fetchTabResultForExport(tabId);

    assert.deepEqual(
      buildRequests.map((request) => ({
        databaseType: (request as any).databaseType,
        schema: (request as any).schema,
        tableName: (request as any).tableName,
        whereInput: (request as any).whereInput,
        orderBy: (request as any).orderBy,
        limit: (request as any).limit,
        offset: (request as any).offset,
      })),
      [
        {
          databaseType: "saphana",
          schema: "public",
          tableName: "users",
          whereInput: "status = 'active'",
          orderBy: '"id" DESC',
          limit: 10_000,
          offset: 0,
        },
        {
          databaseType: "saphana",
          schema: "public",
          tableName: "users",
          whereInput: "status = 'active'",
          orderBy: '"id" DESC',
          limit: 10_000,
          offset: 10_000,
        },
      ],
    );
    assert.deepEqual(executedSqls, [
      'SELECT * FROM "public"."users" WHERE (status = \'active\') ORDER BY "id" DESC LIMIT 10000 OFFSET 0;',
      'SELECT * FROM "public"."users" WHERE (status = \'active\') ORDER BY "id" DESC LIMIT 10000 OFFSET 10000;',
    ]);
    assert.equal(exported?.rows.length, 10_002);
    assert.deepEqual(exported?.rows.at(-1), [10_002, "active"]);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("query execution finishes without waiting for metadata analysis", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);

  let resolveMetadata: ((value: unknown) => void) | undefined;
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return { sqlToExecute: "select id from users", useAgentResultSession: false };
    }
    if (cmd === "execute_multi") {
      return [{ columns: ["id"], rows: [[1]], affected_rows: 0, execution_time_ms: 1 }];
    }
    if (cmd === "analyze_editable_query_editability") {
      return new Promise<unknown>((resolve) => {
        resolveMetadata = resolve;
      });
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.executeTabSql(tabId, "select id from users");

    assert.equal(tab.isExecuting, false);
    assert.equal(tab.executionId, undefined);
    assert.deepEqual(tab.result?.columns, ["id"]);

    resolveMetadata?.({ editable: false, reason: "complex-source" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("query execution is scoped to the tab client session", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query");
  let executeBody: any;

  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return { sqlToExecute: "select 1", useAgentResultSession: false };
    }
    if (cmd === "execute_multi") {
      executeBody = args;
      return [{ columns: ["id"], rows: [[1]], affected_rows: 0, execution_time_ms: 1 }];
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.executeTabSql(tabId, "select 1");

    assert.equal(executeBody.clientSessionId, tabId);
    assert.equal(executeBody.timeoutSecs, 30);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("query execution keeps automatically counting total rows in the background", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query", "query", "public");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);

  let resolveCount: ((value: QueryResult) => void) | undefined;
  let countBody: any;
  const restoreTauri = installTauriInvokeStub(async (cmd, args) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return {
        sqlToExecute: "select id from users limit 100",
        pageSql: "select id from users limit 100",
        pageLimit: 100,
        pageOffset: 0,
        countSql: "select count(*) from users",
        useAgentResultSession: false,
      };
    }
    if (cmd === "execute_multi") {
      return [
        {
          columns: ["id"],
          rows: Array.from({ length: 100 }, (_, index) => [index + 1]),
          affected_rows: 0,
          execution_time_ms: 1,
        },
      ];
    }
    if (cmd === "execute_query") {
      countBody = args;
      return new Promise<QueryResult>((resolve) => {
        resolveCount = resolve;
      });
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.executeTabSql(tabId, "select id from users");

    assert.equal(tab.executionId, undefined);
    assert.equal(tab.resultTotalRowCount, undefined);
    assert.equal(tab.resultTotalRowCountLoading, true);
    assert.equal(countBody.sql, "select count(*) from users");
    assert.equal(countBody.schema, "public");

    resolveCount?.({
      columns: ["count"],
      rows: [[250]],
      affected_rows: 0,
      execution_time_ms: 1,
    });
    await waitFor(() => tab.resultTotalRowCount === 250);
    assert.equal(tab.resultTotalRowCountLoading, false);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("paginated query execution keeps the previous total while refreshing it in the background", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query", "query", "public");
  const tab = store.tabs.find((item) => item.id === tabId);
  assert.ok(tab);
  tab.resultTotalRowCount = 250;

  let resolveCount: ((value: QueryResult) => void) | undefined;
  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return {
        sqlToExecute: "select id from users limit 100 offset 100",
        pageSql: "select id from users limit 100 offset 100",
        pageLimit: 100,
        pageOffset: 100,
        countSql: "select count(*) from users",
        useAgentResultSession: false,
      };
    }
    if (cmd === "execute_multi") {
      return [
        {
          columns: ["id"],
          rows: Array.from({ length: 100 }, (_, index) => [index + 101]),
          affected_rows: 0,
          execution_time_ms: 1,
        },
      ];
    }
    if (cmd === "execute_query") {
      return new Promise<QueryResult>((resolve) => {
        resolveCount = resolve;
      });
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.executeTabSql(tabId, "select id from users", {
      pagination: { limit: 100, offset: 100 },
      preserveResultDuringExecution: true,
      preserveTotalRowCountDuringExecution: true,
    });

    assert.equal(tab.resultTotalRowCount, 250);
    assert.equal(tab.resultTotalRowCountLoading, true);

    resolveCount?.({
      columns: ["count"],
      rows: [[275]],
      affected_rows: 0,
      execution_time_ms: 1,
    });
    await waitFor(() => tab.resultTotalRowCount === 275);
    assert.equal(tab.resultTotalRowCountLoading, false);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("multi statement execution shows the first result set by default", async () => {
  const restoreStorage = installMemoryStorage();
  setActivePinia(createPinia());
  const connectionStore = useConnectionStore();
  const store = useQueryStore();

  connectionStore.addEphemeralConnection(conn("conn-1"));
  const tabId = store.createTab("conn-1", "db", "Query");

  const restoreTauri = installTauriInvokeStub(async (cmd) => {
    if (cmd === "prepare_query_pagination_execution_plan") {
      return { sqlToExecute: "set @id = 1; select @id", useAgentResultSession: false };
    }
    if (cmd === "execute_multi") {
      return [
        { columns: [], rows: [], affected_rows: 0, execution_time_ms: 1 },
        { columns: ["@id"], rows: [[1]], affected_rows: 0, execution_time_ms: 1 },
      ];
    }
    if (cmd === "analyze_editable_query_editability") {
      return { editable: false, reason: "complex-source" };
    }
    throw new Error("unexpected command: " + cmd);
  });

  try {
    await store.executeTabSql(tabId, "set @id = 1; select @id");

    const tab = store.tabs.find((item) => item.id === tabId);
    assert.equal(tab?.activeResultIndex, 1);
    assert.deepEqual(tab?.result?.columns, ["@id"]);
    assert.deepEqual(tab?.result?.rows, [[1]]);
    assert.equal(isReactive(tab?.result?.rows), false);
    assert.equal(isReactive(tab?.result?.rows[0]), false);
    assert.equal(tab?.results?.every((result) => !isReactive(result.rows)), true);
  } finally {
    restoreTauri();
    restoreStorage();
  }
});

test("tab reuse is scoped by mode and schema instead of title alone", () => {
  const restoreStorage = installMemoryStorage();
  try {
    setActivePinia(createPinia());
    const store = useQueryStore();

    const dataTabId = store.createTab("conn-1", "db", "users", "data", "public");
    const sourceTabId = store.createTab("conn-1", "db", "users", "query", "public");
    const otherSchemaTabId = store.createTab("conn-1", "db", "users", "data", "audit");
    const reusedDataTabId = store.createTab("conn-1", "db", "users", "data", "public");

    assert.notEqual(sourceTabId, dataTabId);
    assert.notEqual(otherSchemaTabId, dataTabId);
    assert.equal(reusedDataTabId, dataTabId);
    assert.equal(store.tabs.length, 3);
  } finally {
    restoreStorage();
  }
});

test("new table structure tabs can open multiple drafts while existing tables still reuse tabs", () => {
  const restoreStorage = installMemoryStorage();
  try {
    setActivePinia(createPinia());
    const store = useQueryStore();

    const firstDraftId = store.openTableStructure("conn-1", "db", "public", "");
    const secondDraftId = store.openTableStructure("conn-1", "db", "public", "");
    const firstEditId = store.openTableStructure("conn-1", "db", "public", "users");
    const secondEditId = store.openTableStructure("conn-1", "db", "public", "users");

    assert.notEqual(secondDraftId, firstDraftId);
    assert.equal(secondEditId, firstEditId);
    assert.equal(store.tabs.length, 3);
  } finally {
    restoreStorage();
  }
});

test("table structure refresh versions are scoped by table target", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();

  assert.equal(store.tableStructureRefreshVersion("conn-1", "db", "public", "users"), 0);

  store.invalidateTableStructure("conn-1", "db", "public", "users");
  store.invalidateTableStructure("conn-1", "db", "public", "users");
  store.invalidateTableStructure("conn-1", "db", undefined, "users");

  assert.equal(store.tableStructureRefreshVersion("conn-1", "db", "public", "users"), 2);
  assert.equal(store.tableStructureRefreshVersion("conn-1", "db", undefined, "users"), 1);
  assert.equal(store.tableStructureRefreshVersion("conn-1", "db", "public", "orders"), 0);
});

test("reorderTab keeps pinned tabs before unpinned tabs after reorder", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();

  const tabA = store.createTab("conn-1", "db", "A", "query");
  const tabB = store.createTab("conn-1", "db", "B", "query");
  const tabC = store.createTab("conn-1", "db", "C", "query");
  const tabD = store.createTab("conn-1", "db", "D", "query");

  store.tabs[0].pinned = false;
  store.tabs[1].pinned = true;
  store.tabs[2].pinned = false;
  store.tabs[3].pinned = true;

  // Force store to apply pinned ordering
  store.togglePinnedTab(tabB);
  store.togglePinnedTab(tabB);
  // Now tabs: D(b), B(b), A, C

  // Try dragging unpinned tab A before pinned tab B
  store.reorderTab(tabA, tabB, "before");
  const idsAfter = store.tabs.map((t) => t.id);
  const pinnedIndices = store.tabs.map((t, i) => ({ pinned: t.pinned, i })).filter((t) => t.pinned);
  const unpinnedIndices = store.tabs.map((t, i) => ({ pinned: t.pinned, i })).filter((t) => !t.pinned);

  // All pinned tabs should come before any unpinned tab
  assert.equal(Math.max(...pinnedIndices.map((t) => t.i)) < Math.min(...unpinnedIndices.map((t) => t.i)), true);
});

test("reorderTab preserves relative order within pinned group", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();

  const tabA = store.createTab("conn-1", "db", "A", "query");
  const tabB = store.createTab("conn-1", "db", "B", "query");
  const tabC = store.createTab("conn-1", "db", "C", "query");
  const tabD = store.createTab("conn-1", "db", "D", "query");
  const tabE = store.createTab("conn-1", "db", "E", "query");

  // Pin A, B, C — leave D, E unpinned
  store.togglePinnedTab(tabA);
  // toggle so orderPinnedFirst runs: [A, B, C, D, E]
  store.togglePinnedTab(tabB);
  // [A, B, C, D, E]
  assert.equal(store.tabs.filter((t) => t.pinned).length, 2);

  store.togglePinnedTab(tabC);
  // pinned = [A, B, C], unpinned = [D, E]
  assert.equal(store.tabs.filter((t) => t.pinned).length, 3);

  // Now: A, B, C (pinned), D, E (unpinned)
  // Drag C before A (within pinned group)
  store.reorderTab(tabC, tabA, "before");
  // After orderPinnedFirst: C, A, B, D, E
  const ids = store.tabs.map((t) => t.id);
  assert.equal(ids[0], tabC, "C should be first pinned tab");
  assert.equal(ids[1], tabA, "A should be second pinned tab");
  assert.equal(ids[2], tabB, "B should be third pinned tab");
  assert.equal(ids[3], tabD, "D should be first unpinned");
  assert.equal(ids[4], tabE, "E should be second unpinned");
});

test("reorderTab preserves relative order within unpinned group", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();

  const tabA = store.createTab("conn-1", "db", "A", "query");
  const tabB = store.createTab("conn-1", "db", "B", "query");
  const tabC = store.createTab("conn-1", "db", "C", "query");
  const tabD = store.createTab("conn-1", "db", "D", "query");

  store.tabs[0].pinned = true;
  store.tabs[1].pinned = false;
  store.tabs[2].pinned = false;
  store.tabs[3].pinned = false;

  store.togglePinnedTab(tabA);
  store.togglePinnedTab(tabA);

  // Now tabs: A(pinned), B, C, D(unpinned)
  // Drag D before B
  store.reorderTab(tabD, tabB, "before");
  // After orderPinnedFirst: A, D, B, C
  const ids = store.tabs.map((t) => t.id);
  assert.equal(ids[0], tabA, "A should stay pinned");
  assert.equal(ids[1], tabD, "D should be first unpinned");
  assert.equal(ids[2], tabB, "B should be second unpinned");
  assert.equal(ids[3], tabC, "C should be last unpinned");
});

test("reorderTab with after position places tab correctly", () => {
  setActivePinia(createPinia());
  const store = useQueryStore();

  const tabA = store.createTab("conn-1", "db", "A", "query");
  const tabB = store.createTab("conn-1", "db", "B", "query");
  const tabC = store.createTab("conn-1", "db", "C", "query");

  // Drag A after C
  store.reorderTab(tabA, tabC, "after");
  assert.deepEqual(
    store.tabs.map((t) => t.id),
    [tabB, tabC, tabA],
  );
});
