import { ref, type Ref, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import { useQueryStore } from "@/stores/queryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToast } from "@/composables/useToast";
import { classifySqlActivityKind } from "@/lib/historyActivityKind";
import { sqlMetadataRefreshTarget } from "@/lib/sqlMetadataRefresh";
import type { ConnectionConfig, QueryTab } from "@/types/database";

const DANGER_RE = /^\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE|MERGE|REPLACE)\b/i;

export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}

export function isDangerousSql(sql: string): boolean {
  const cleaned = stripSqlComments(sql);
  return cleaned.split(";").some((stmt) => DANGER_RE.test(stmt));
}

function primarySqlOperation(sql: string): string {
  const cleaned = stripSqlComments(sql);
  const statement = cleaned
    .split(";")
    .map((part) => part.trim())
    .find(Boolean);
  return statement?.match(/^([a-z]+)/i)?.[1]?.toUpperCase() || "SQL";
}

type MetadataRefreshingStore = Pick<
  ReturnType<typeof useConnectionStore>,
  "invalidateCompletionCache" | "loadDatabases" | "refreshObjectListTreeNode"
>;

/**
 * After an editor execution, drop the caches a successful statement may have
 * made stale. DDL detection reuses `sqlMetadataRefreshTarget` — the same
 * classification that drives the sidebar tree refresh — so CREATE/ALTER/DROP/
 * RENAME on database/schema/table-like objects (comments stripped) trigger and
 * pure SELECT/DML does not. TRUNCATE stays data-only there on purpose: it
 * changes table contents, not structure, so completion listings remain valid.
 * On DDL, the completion caches for the affected connection + database are
 * invalidated alongside the tree refresh, so new objects are completable on
 * the next completion request without reconnecting or refreshing by hand.
 */
export async function refreshMetadataAfterExecution(
  connectionStore: MetadataRefreshingStore,
  tab: { connectionId: string; database: string; schema?: string },
  sql: string,
  success: boolean,
): Promise<void> {
  if (!success) return;
  const refreshTarget = sqlMetadataRefreshTarget(sql, tab.schema);
  if (refreshTarget.scope === "connection") {
    connectionStore.invalidateCompletionCache(tab.connectionId);
    await connectionStore.loadDatabases(tab.connectionId, { force: true });
  } else if (refreshTarget.scope === "database") {
    connectionStore.invalidateCompletionCache(tab.connectionId, tab.database);
    await connectionStore.refreshObjectListTreeNode(tab.connectionId, tab.database, refreshTarget.schema);
  }
}

export function useSqlExecution(deps: {
  activeTab: ComputedRef<QueryTab | undefined>;
  activeConnection: ComputedRef<ConnectionConfig | undefined>;
  executableSql: ComputedRef<string>;
  resolveExecutableSql?: () => Promise<string>;
  activeOutputView: Ref<"result" | "summary" | "explain" | "chart">;
}) {
  const { t } = useI18n();
  const queryStore = useQueryStore();
  const historyStore = useHistoryStore();
  const connectionStore = useConnectionStore();
  const settingsStore = useSettingsStore();
  const { toast } = useToast();

  const dangerSql = ref("");
  const pendingDangerSql = ref("");
  const showDangerDialog = ref(false);
  const suppressDangerConfirm = ref(false);
  const explainMode = ref<"explain" | "autotrace">("explain");

  async function resolvedExecutableSql(): Promise<string> {
    return deps.resolveExecutableSql ? await deps.resolveExecutableSql() : deps.executableSql.value;
  }

  async function tryExecute(sqlOverride?: string) {
    const tab = deps.activeTab.value;
    const sql = sqlOverride ?? (await resolvedExecutableSql());
    if (!tab || !sql.trim()) return;
    if (isDangerousSql(sql) && settingsStore.editorSettings.confirmDangerousSqlExecution) {
      dangerSql.value = sql;
      pendingDangerSql.value = sql;
      suppressDangerConfirm.value = false;
      showDangerDialog.value = true;
    } else {
      doExecute(sql);
    }
  }

  async function doExecute(sql?: string) {
    sql ??= await resolvedExecutableSql();
    const tab = deps.activeTab.value;
    if (!tab || !sql.trim()) return;
    deps.activeOutputView.value = "result";
    const connName = connectionStore.getConfig(tab.connectionId)?.name || "";
    const start = Date.now();
    await queryStore.executeCurrentSql(sql);
    if (tab.result && !tab.result.columns.length && !tab.results?.some((result) => result.columns.length > 0)) {
      deps.activeOutputView.value = "summary";
    }
    const elapsed = Date.now() - start;
    const success = !tab.result?.columns.includes("Error");
    historyStore.add({
      connection_id: tab.connectionId,
      connection_name: connName,
      database: tab.database,
      sql,
      execution_time_ms: elapsed,
      success,
      error: success ? undefined : String(tab.result?.rows?.[0]?.[0] ?? ""),
      activity_kind: classifySqlActivityKind(sql),
      operation: primarySqlOperation(sql),
      affected_rows: success ? tab.result?.affected_rows : undefined,
    });
    await refreshMetadataAfterExecution(connectionStore, tab, sql, success);
  }

  function cancelActiveExecution() {
    const tab = deps.activeTab.value;
    if (!tab) return;
    if (tab.isExecuting) void queryStore.cancelTabExecution(tab.id);
    else if (tab.isExplaining) void queryStore.cancelTabExplain(tab.id);
  }

  function explainReasonMessage(reason: string): string {
    if (reason === "unsupported") return t("explain.unsupported");
    if (reason === "unsafe") return t("explain.unsafe");
    return t("explain.emptySql");
  }

  async function tryExplain(sqlOverride?: string) {
    const tab = deps.activeTab.value;
    const sql = sqlOverride ?? (await resolvedExecutableSql());
    if (!tab || !sql.trim()) {
      toast(t("explain.emptySql"));
      return;
    }

    deps.activeOutputView.value = "explain";
    const result = await queryStore.explainTabSql(tab.id, sql, deps.activeConnection.value?.db_type, explainMode.value);
    if (!result.ok) {
      toast(explainReasonMessage(result.reason), 5000);
      return;
    }

    const current = deps.activeTab.value;
    if (current?.explainError) toast(current.explainError, 5000);
  }

  async function onDangerConfirm() {
    const sql = pendingDangerSql.value || (await resolvedExecutableSql());
    if (suppressDangerConfirm.value) {
      settingsStore.updateEditorSettings({ confirmDangerousSqlExecution: false });
    }
    suppressDangerConfirm.value = false;
    pendingDangerSql.value = "";
    await doExecute(sql);
  }

  return {
    dangerSql,
    pendingDangerSql,
    showDangerDialog,
    suppressDangerConfirm,
    tryExecute,
    doExecute,
    cancelActiveExecution,
    tryExplain,
    onDangerConfirm,
    explainMode,
  };
}
