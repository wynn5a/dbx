import { defineStore } from "pinia";
import { uuid } from "@/lib/utils";
import { ref, shallowRef, computed, watch } from "vue";
import type {
  ColumnInfo,
  ConnectionConfig,
  ObjectInfo,
  SchemaCompletionGroup,
  SidebarLayout,
  TreeNode,
} from "@/types/database";
import { applyPinnedTreeNodeState, orderPinnedFirst } from "@/lib/pinnedItems";
import {
  reconcileLayout,
  buildTreeNodesFromLayout,
  emptyLayout,
  appendConnectionToLayout,
  removeConnectionFromSidebarLayout,
  createGroup as createGroupOp,
  renameGroup as renameGroupOp,
  deleteGroup as deleteGroupOp,
  toggleGroupCollapsed as toggleGroupCollapsedOp,
  moveConnectionToGroup as moveConnectionToGroupOp,
  reorderEntry as reorderEntryOp,
  type DropPosition,
} from "@/lib/sidebarLayout";
import type { SqlCompletionColumn, SqlCompletionObject, SqlCompletionTable } from "@/lib/sqlCompletion";

// Indexed completion entries carry pre-computed lowercase names so the
// per-keystroke fuzzy scan never re-allocates `toLowerCase()` strings.
type IndexedCompletionTable = SqlCompletionTable & { nameLower: string; schemaLower?: string };
type IndexedCompletionObject = SqlCompletionObject & { nameLower: string; schemaLower?: string };
import * as api from "@/lib/api";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import {
  isSchemaAware,
  normalizeSidebarObjectKind,
  sidebarObjectKindsForDatabase,
  usesTreeSchemaMode,
} from "@/lib/databaseCapabilities";
import {
  connectionObjectTreeNodeSchema,
  connectionObjectTreeQuerySchema,
  connectionUsesDatabaseObjectTreeMode,
  effectiveDatabaseTypeForConnection,
} from "@/lib/jdbcDialect";
import {
  buildDatabaseTreeNodes,
  buildDuckDbConnectionTreeNodes,
  sortSidebarNames,
  shouldIncludeDefaultDatabaseNode,
} from "@/lib/databaseTree";
import { buildSqlServerDatabaseTreeNodes, SQLSERVER_DEFAULT_SCHEMA } from "@/lib/sqlServerTree";
import { findDatabaseTreeNode } from "@/lib/treeRefreshTarget";
import { shouldMarkDisconnected } from "@/lib/connectionHealth";
import {
  connectionAttemptTimeoutMessage,
  connectionAttemptTimeoutMs,
  metadataLoadTimeoutMessage,
  metadataLoadTimeoutMs,
} from "@/lib/connectionAttemptTimeout";
import {
  filterDatabaseNamesForConnection,
  filterVisibleDatabaseNames,
  normalizeVisibleDatabaseSelection,
} from "@/lib/visibleDatabases";
import {
  buildObjectGroupPlaceholderNodes,
  buildGroupedObjectTreeNodes,
  buildSimpleObjectTreeNodes,
  buildTableTreeNodes,
  expandCachedObjectBrowserNodes,
  mergeTableInfosIntoObjects,
  objectGroupRefreshParentId,
  objectTypesForGroupNode,
  tablePartitionGroups,
  type DatabaseObjectTreeKind,
} from "@/lib/tableTree";
import {
  hasTreeNodeDatabaseContext,
  normalizeCataloglessDatabaseNodes,
  treeNodeSchemaCachePrefix,
} from "@/lib/treeNodeContext";
import { decodeSchemaTreeCache, encodeSchemaTreeCache } from "@/lib/schemaTreeCache";
import { sortSidebarTreeChildrenForParent } from "@/lib/sidebarNodeOrdering";
import { prunePinnedTreeNodeIdsForConnection } from "@/lib/pinnedTreeNodeIds";
import { useSavedSqlStore } from "@/stores/savedSqlStore";
import { supportsDatabaseUserAdmin } from "@/lib/databaseUserAdmin";
import type { CompletionCacheInvalidation } from "@/lib/completionCacheInvalidation";
import { useSettingsStore } from "@/stores/settingsStore";

const PINNED_TREE_NODES_STORAGE_KEY = "dbx-pinned-tree-nodes";
const ACTIVE_CONNECTION_STORAGE_KEY = "dbx-active-connection";
const CONNECTION_LAST_USED_STORAGE_KEY = "dbx-connection-last-used";
type ImportSource = "dbx" | "navicat" | "dbeaver";

interface TreeClipboardTableStructure {
  kind: "table-structure";
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
}

interface LoadTreeOptions {
  force?: boolean;
}

/**
 * Rejected by `connectionStore.connect` when the in-flight attempt was
 * cancelled by the user (E5 cancellable connect). Callers that surface connect
 * failures as toasts check for it so a deliberate cancel stays silent — same
 * UX contract as query cancel.
 */
export class ConnectionAttemptCancelledError extends Error {
  constructor() {
    super("Connection attempt cancelled.");
    this.name = "ConnectionAttemptCancelledError";
  }
}

interface PersistedTreeChildrenLoadResult {
  hit: boolean;
  isStale: boolean;
}

function redisDbLabel(db: number, loadedKeyCount?: number, totalKeyCount?: number): string {
  if (totalKeyCount == null) return `db${db}`;
  return `db${db} (${loadedKeyCount ?? 0}/${totalKeyCount})`;
}

export const useConnectionStore = defineStore("connection", () => {
  const settingsStore = useSettingsStore();
  const connections = ref<ConnectionConfig[]>([]);
  // True from store creation until the startup disk load (initFromDisk) settles,
  // and again while any later initFromDisk reload is in flight. The Welcome
  // screen and the sidebar gate their "no connections" empty state on this, so
  // a slow disk read never renders a false "you have no connections" state.
  const connectionsLoading = ref(true);
  const isDesktop = isTauriRuntime();
  const activeConnectionId = ref<string | null>(localStorage.getItem(ACTIVE_CONNECTION_STORAGE_KEY));
  const selectedTreeNodeId = ref<string | null>(null);
  const selectedTreeNodeIds = ref<string[]>([]);
  const treeSelectionAnchorId = ref<string | null>(null);
  const treeClipboard = ref<TreeClipboardTableStructure | null>(null);

  watch(activeConnectionId, (id) => {
    if (id) localStorage.setItem(ACTIVE_CONNECTION_STORAGE_KEY, id);
    else localStorage.removeItem(ACTIVE_CONNECTION_STORAGE_KEY);
  });
  // The tree is shallow-reactive: nodes are plain (non-proxied) objects, so
  // reads during tree walks and rendering pay no proxy overhead. Every write
  // MUST go through commitTreeNode / commitTreeNodes, which re-commit the
  // root array by cloning only the path down to the changed node — mutating a
  // captured node instance in place would edit a detached clone and never
  // reach the UI.
  const treeNodes = shallowRef<TreeNode[]>([]);

  function commitTreeNodes(transform: (nodes: TreeNode[]) => TreeNode[]) {
    treeNodes.value = transform(treeNodes.value);
  }

  function commitTreeNode(instanceOrId: TreeNode | string, update: (draft: TreeNode) => void): boolean {
    const id = typeof instanceOrId === "string" ? instanceOrId : instanceOrId.id;
    let touched = false;
    commitTreeNodes((nodes) => {
      const walk = (current: TreeNode[]): TreeNode[] => {
        let next: TreeNode[] | null = null;
        for (let i = 0; i < current.length; i++) {
          const node = current[i];
          if (node.id === id) {
            const draft = { ...node };
            update(draft);
            touched = true;
            if (!next) next = current.slice();
            next[i] = draft;
            continue;
          }
          if (node.children?.length) {
            const children = walk(node.children);
            if (children !== node.children) {
              if (!next) next = current.slice();
              next[i] = { ...node, children };
            }
          }
        }
        return next ?? current;
      };
      return walk(nodes);
    });
    return touched;
  }

  const pinnedTreeNodeIds = ref<Set<string>>(new Set());
  const connectedIds = ref<Set<string>>(new Set());
  // Per-connection "last used" timestamps (epoch ms), kept frontend-only in
  // localStorage so the Welcome screen can surface and sort by recency without
  // touching the backend ConnectionConfig schema.
  const connectionLastUsedAt = ref<Record<string, number>>(loadConnectionLastUsedFromLocalStorage());
  const loadedTreeNodeChildrenIds = ref<Set<string>>(new Set());
  const connectionErrors = ref<Record<string, string>>({});
  const editingConnectionId = ref<string | null>(null);
  const newConnectionGroupId = ref<string | null>(null);
  // Unfiltered (schema, limit) table listings for completion (B2). The cache
  // key carries the scope + limit but never the typed filter, so keystrokes are
  // answered from one superset entry instead of growing the cache per key.
  // `truncated` marks a listing capped at `limit` — the only case where a typed
  // filter still repeats a server-side filtered call (a capped superset cannot
  // prove it holds every match).
  const completionTablesSupersetCache = ref<Record<string, { tables: SqlCompletionTable[]; truncated: boolean }>>({});
  const completionObjectsCache = ref<Record<string, SqlCompletionObject[]>>({});
  const completionColumnsCache = ref<Record<string, ColumnInfo[]>>({});
  // Unfiltered per-schema completion metadata (tables + routines), fetched with
  // one invoke per (connection, database) instead of one per schema (B1).
  const completionMetadataCache = ref<Record<string, SchemaCompletionGroup[]>>({});
  const elasticsearchCompletionIndicesCache = ref<Record<string, string[]>>({});
  // Last completion-cache invalidation, watched by QueryEditor to drop its own
  // per-editor caches (see completionCacheInvalidation.ts).
  const completionCacheInvalidation = ref<CompletionCacheInvalidation | null>(null);
  const schemaListCache = ref<Record<string, string[]>>({});
  const completionTableIndex = new Map<string, { touched: number; tables: IndexedCompletionTable[] }>();
  const completionObjectIndex = new Map<string, { touched: number; objects: IndexedCompletionObject[] }>();
  const completionColumnIndex = new Map<string, { touched: number; columns: SqlCompletionColumn[] }>();
  // Cross-keystroke narrowing cache for table completion. Keyed by lookup scope.
  // When the user extends a previous filter and the prior result was not truncated,
  // we re-score only those candidates instead of rescanning every indexed table.
  const tableNarrowCache = new Map<
    string,
    { filter: string; candidates: IndexedCompletionTable[]; truncated: boolean }
  >();
  const completionInFlight = new Map<string, Promise<unknown>>();
  // Server-filtered table listings for a TRUNCATED superset (the only path
  // where a typed filter still round-trips), keyed by scope + limit + filter.
  // A small LRU so backspace/retype over a very large schema reuses answers
  // instead of paying one IPC per keystroke; invalidated with the rest.
  const completionFilteredTablesCache = new Map<string, SqlCompletionTable[]>();
  const COMPLETION_FILTERED_TABLES_MAX = 64;
  const createTableSource = ref<{ connectionId: string; database: string; schema?: string } | null>(null);
  const transferSource = ref<{ connectionId: string; database: string } | null>(null);
  const schemaDiffSource = ref<{ connectionId: string; database: string; schema?: string } | null>(null);
  const dataCompareSource = ref<{
    connectionId: string;
    database: string;
    schema?: string;
    tableName?: string;
  } | null>(null);
  const sqlFileSource = ref<{ connectionId: string; database: string } | null>(null);
  const diagramSource = ref<{
    connectionId: string;
    database: string;
    schema?: string;
    tableName?: string;
  } | null>(null);
  const tableImportSource = ref<{
    connectionId: string;
    database: string;
    schema?: string;
    tableName: string;
  } | null>(null);
  const fieldLineageSource = ref<{
    connectionId: string;
    database: string;
    schema?: string;
    tableName: string;
    columnName: string;
  } | null>(null);
  const databaseSearchSource = ref<{
    connectionId: string;
    database: string;
    schema?: string;
  } | null>(null);
  const databaseExportSource = ref<{
    connectionId: string;
    database: string;
    schema?: string;
    tableName?: string;
    tableNames?: string[];
  } | null>(null);
  const sidebarLayout = ref<SidebarLayout>(emptyLayout());
  let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;
  const staleTreeRefreshIds = new Set<string>();
  let initFromDiskPromise: Promise<void> | null = null;
  // Set when the startup read of the saved connections failed: `connections`
  // is then empty/incomplete, and save_connections replaces the whole stored
  // set (connections + secrets), so a save would silently delete them all.
  let connectionsLoadFailed = false;

  function startEditing(id: string) {
    editingConnectionId.value = id;
  }

  function stopEditing() {
    editingConnectionId.value = null;
  }

  function startCreatingConnectionInGroup(groupId: string) {
    stopEditing();
    newConnectionGroupId.value = groupId;
  }

  function stopCreatingConnectionInGroup() {
    newConnectionGroupId.value = null;
  }

  const configById = computed(() => new Map(connections.value.map((c) => [c.id, c])));

  function getConfig(connectionId: string) {
    return configById.value.get(connectionId);
  }

  function connectionErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  function setConnectionError(connectionId: string, message: string) {
    connectionErrors.value[connectionId] = message;
  }

  function clearConnectionError(connectionId: string) {
    if (!connectionErrors.value[connectionId]) return;
    delete connectionErrors.value[connectionId];
  }

  function recordConnectionError(connectionId: string, error: unknown): string {
    const message = connectionErrorMessage(error);
    setConnectionError(connectionId, message);
    return message;
  }

  function recordMetadataLoadError(connectionId: string, error: unknown) {
    if (shouldMarkDisconnected(error)) {
      connectedIds.value.delete(connectionId);
      if (activeConnectionId.value === connectionId) activeConnectionId.value = null;
    }
    recordConnectionError(connectionId, error);
  }

  async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function withConnectionAttemptTimeout<T>(
    promise: Promise<T>,
    config: ConnectionConfig,
    attemptId?: string,
  ): Promise<T> {
    const timeoutMs = connectionAttemptTimeoutMs(config);
    const timeoutMessage = connectionAttemptTimeoutMessage(timeoutMs);
    return raceWithTimeout(promise, timeoutMs, timeoutMessage).catch((error) => {
      // Our own timeout fired while the backend connect is still dialing with
      // no one listening — fire-and-forget cancel so it doesn't run to
      // completion behind the scenes (same pattern as the query-timeout cancel
      // in queryStore). Background callers pass no attempt id and keep the old
      // abandon-only behavior.
      if (attemptId && error instanceof Error && error.message === timeoutMessage) {
        void api.cancelConnectionAttempt(attemptId).catch(() => undefined);
      }
      throw error;
    });
  }

  // One in-flight attempt per tree node (E5): kind "connect" is cancellable on
  // the backend via `cancel_connection_attempt` (the attempt id registers a
  // CancellationToken there); kind "load" is cancelled by discarding the
  // future — metadata reads have no server-side statement to kill. The guard
  // is what makes late results dead: once an attempt is cancelled or
  // superseded by a retry, `attemptIsActive` turns false and the loader drops
  // its result instead of writing it into state.
  interface NodeAttempt {
    nodeId: string;
    kind: "connect" | "load";
    attemptId?: string;
    inactive: boolean;
  }
  const nodeAttempts = new Map<string, NodeAttempt>();

  function beginNodeAttempt(nodeId: string, kind: NodeAttempt["kind"], attemptId?: string): NodeAttempt {
    // Supersede any previous attempt on this node so its late results stay dead.
    const previous = nodeAttempts.get(nodeId);
    if (previous) previous.inactive = true;
    const attempt: NodeAttempt = { nodeId, kind, attemptId, inactive: false };
    nodeAttempts.set(nodeId, attempt);
    return attempt;
  }

  function attemptIsActive(attempt: NodeAttempt): boolean {
    return !attempt.inactive && nodeAttempts.get(attempt.nodeId) === attempt;
  }

  function endNodeAttempt(attempt: NodeAttempt) {
    if (nodeAttempts.get(attempt.nodeId) === attempt) nodeAttempts.delete(attempt.nodeId);
  }

  // End `attempt` and clear its spinner — unless a newer attempt already owns
  // the node (cancel + re-expand while the old one was still in flight): the
  // spinner (and its cancel X) now belongs to that attempt and must stay.
  function settleNodeAttempt(attempt: NodeAttempt, target: TreeNode | string) {
    const current = nodeAttempts.get(attempt.nodeId);
    endNodeAttempt(attempt);
    if (current && current !== attempt) return;
    commitTreeNode(target, (draft) => {
      draft.isLoading = false;
    });
  }

  // Cancel whatever attempt is showing the spinner on `nodeId` and put the row
  // back to idle immediately, so a new attempt can start right away. For a
  // connect this also tells the backend to abort the dial; the in-flight
  // promise settles later and is discarded by the attempt guard. Returns
  // whether there was an attempt to cancel.
  function cancelTreeNodeLoading(nodeId: string): boolean {
    const attempt = nodeAttempts.get(nodeId);
    if (!attempt) return false;
    attempt.inactive = true;
    nodeAttempts.delete(nodeId);
    if (attempt.kind === "connect" && attempt.attemptId) {
      void api.cancelConnectionAttempt(attempt.attemptId).catch(() => undefined);
    }
    commitTreeNode(nodeId, (draft) => {
      draft.isLoading = false;
    });
    return true;
  }

  // Dedupes concurrent transparent reconnects: when a burst of metadata queries
  // all fail on the same stale pool, they share one reconnect instead of each
  // tearing down and rebuilding the pool.
  const metadataReconnectInFlight = new Map<string, Promise<void>>();

  // Rebuild a connection's pool in place (connect_db discards the old pool and
  // opens fresh sockets) without going through ensureConnected — which would
  // short-circuit, since the connection is still marked connected at this point.
  function reconnectForMetadata(connectionId: string): Promise<void> {
    const existing = metadataReconnectInFlight.get(connectionId);
    if (existing) return existing;
    const config = getConfig(connectionId);
    if (!config) return Promise.reject(new Error("Connection config not found"));
    const attempt = (async () => {
      const id = await withConnectionAttemptTimeout(api.connectDb(config), config);
      connectedIds.value.add(id);
      clearConnectionError(connectionId);
      if (id !== connectionId) clearConnectionError(id);
    })();
    const tracked = attempt.finally(() => {
      metadataReconnectInFlight.delete(connectionId);
    });
    metadataReconnectInFlight.set(connectionId, tracked);
    return tracked;
  }

  // Bound the metadata/catalog queries that run after a connection is verified
  // (listDatabases, listSchemas, listTables, …). These are not covered by the
  // connect timeout, so a pooler that accepts the socket but never answers the
  // first query would otherwise spin the sidebar forever.
  //
  // On a transient connection error (a stale socket after the machine/VPN was
  // idle), transparently rebuild the pool and retry the read once before
  // surfacing the failure — this is why `factory` is a thunk rather than a
  // started promise. Only a genuine connection error retries: our own load
  // timeout does not, since that signals a stalled pooler (not a dead socket)
  // and retrying would just double the wait. If the reconnect or the retry also
  // fails, the error propagates and the caller marks the connection disconnected
  // as before — so we only avoid the slow on-demand reconnect for errors that a
  // fresh pool actually recovers from.
  async function withMetadataLoadTimeout<T>(connectionId: string, factory: () => Promise<T>): Promise<T> {
    const timeoutMs = metadataLoadTimeoutMs(getConfig(connectionId));
    const timeoutMessage = metadataLoadTimeoutMessage(timeoutMs);
    try {
      return await raceWithTimeout(factory(), timeoutMs, timeoutMessage);
    } catch (error) {
      const isOwnTimeout = error instanceof Error && error.message === timeoutMessage;
      if (isOwnTimeout || !shouldMarkDisconnected(error) || !getConfig(connectionId)) throw error;
      await reconnectForMetadata(connectionId);
      return await raceWithTimeout(factory(), timeoutMs, timeoutMessage);
    }
  }

  function normalizeConnection(config: ConnectionConfig): ConnectionConfig {
    const labelMap: Record<string, string> = {
      mysql: "MySQL",
      postgres: "PostgreSQL",
      sqlite: "SQLite",
      redis: "Redis",
      etcd: "etcd",
      duckdb: "DuckDB",
      clickhouse: "ClickHouse",
      sqlserver: "SQL Server",
      mongodb: "MongoDB",
      oracle: "Oracle",
      elasticsearch: "Elasticsearch",
      doris: "Doris",
      starrocks: "StarRocks",
      redshift: "Redshift",
      dameng: "DM (Dameng)",
      gaussdb: "GaussDB",
      kwdb: "KWDB",
      kingbase: "KingBase",
      highgo: "瀚高 HighGo",
      yashandb: "崖山 YashanDB",
      vastbase: "Vastbase",
      goldendb: "GoldenDB",
      access: "Microsoft Access",
      h2: "H2",
      snowflake: "Snowflake",
      trino: "Trino",
      hive: "Hive",
      db2: "DB2",
      informix: "Informix",
      neo4j: "Neo4j",
      cassandra: "Cassandra",
      bigquery: "BigQuery",
      kylin: "Kylin",
      sundb: "SunDB",
    };

    const profile = config.driver_profile || config.db_type;
    let dbType = config.db_type;
    if ((profile === "gaussdb" || profile === "opengauss") && dbType === "postgres") {
      dbType = "gaussdb" as ConnectionConfig["db_type"];
    } else if (profile === "kwdb" && dbType === "postgres") {
      dbType = "kwdb" as ConnectionConfig["db_type"];
    } else if (profile === "redshift" && dbType === "postgres") {
      dbType = "redshift" as ConnectionConfig["db_type"];
    } else if (profile === "kingbase" && dbType === "postgres") {
      dbType = "kingbase" as ConnectionConfig["db_type"];
    } else if (profile === "highgo" && dbType === "postgres") {
      dbType = "highgo" as ConnectionConfig["db_type"];
    } else if (profile === "vastbase" && dbType === "postgres") {
      dbType = "vastbase" as ConnectionConfig["db_type"];
    } else if (profile === "goldendb" && dbType === "mysql") {
      dbType = "goldendb" as ConnectionConfig["db_type"];
    }

    return {
      ...config,
      db_type: dbType,
      driver_profile: profile,
      driver_label: config.driver_label || labelMap[profile] || config.db_type,
      url_params: config.url_params || "",
      attached_databases: Array.isArray(config.attached_databases)
        ? config.attached_databases.filter((database) => database.name?.trim() && database.path?.trim())
        : [],
      transport_layers: Array.isArray(config.transport_layers) ? config.transport_layers : [],
      connect_timeout_secs: config.connect_timeout_secs || 5,
      query_timeout_secs: config.query_timeout_secs ?? 30,
      idle_timeout_secs: config.idle_timeout_secs ?? 60,
    };
  }

  function loadConnectionLastUsedFromLocalStorage(): Record<string, number> {
    try {
      if (typeof localStorage === "undefined") return {};
      const saved = localStorage.getItem(CONNECTION_LAST_USED_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : {};
      if (!parsed || typeof parsed !== "object") return {};
      const result: Record<string, number> = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value)) result[id] = value;
      }
      return result;
    } catch {
      return {};
    }
  }

  function persistConnectionLastUsed() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(CONNECTION_LAST_USED_STORAGE_KEY, JSON.stringify(connectionLastUsedAt.value));
    } catch {
      // Ignore quota/serialization errors — last-used ordering is best-effort.
    }
  }

  function recordConnectionUsed(connectionId: string) {
    connectionLastUsedAt.value = { ...connectionLastUsedAt.value, [connectionId]: Date.now() };
    persistConnectionLastUsed();
  }

  function loadPinnedTreeNodeIdsFromLocalStorage(): Set<string> {
    try {
      if (typeof localStorage === "undefined") return new Set();
      const saved = localStorage.getItem(PINNED_TREE_NODES_STORAGE_KEY);
      const ids = saved ? JSON.parse(saved) : [];
      return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  }

  async function loadPinnedTreeNodeIds(): Promise<Set<string>> {
    if (!isDesktop) return loadPinnedTreeNodeIdsFromLocalStorage();
    const ids = await api.loadPinnedTreeNodeIds().catch(() => []);
    const valid = ids.filter((id) => typeof id === "string");
    if (valid.length > 0) return new Set(valid);

    // Migrate legacy localStorage values for existing desktop users.
    const legacy = loadPinnedTreeNodeIdsFromLocalStorage();
    if (legacy.size > 0) {
      await api.savePinnedTreeNodeIds([...legacy]).catch(() => undefined);
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(PINNED_TREE_NODES_STORAGE_KEY);
      }
    }
    return legacy;
  }

  function persistPinnedTreeNodeIds() {
    if (isDesktop) {
      void api.savePinnedTreeNodeIds([...pinnedTreeNodeIds.value]).catch(() => undefined);
      return;
    }
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PINNED_TREE_NODES_STORAGE_KEY, JSON.stringify([...pinnedTreeNodeIds.value]));
  }

  function isTreeNodePinned(id: string): boolean {
    return pinnedTreeNodeIds.value.has(id);
  }

  function setChildren(parent: TreeNode, children: TreeNode[]) {
    commitTreeNode(parent, (draft) => {
      if (draft.children && draft.children.length > 0) {
        const oldMap = new Map(draft.children.map((c) => [c.id, c] as const));
        children = children.map((child) => {
          const old = oldMap.get(child.id);
          if (old && old.isExpanded && old.children && old.children.length > 0) {
            return { ...child, isExpanded: true, children: old.children };
          }
          return child;
        });
      }
      draft.children = applyPinnedTreeNodeState(children, pinnedTreeNodeIds.value);
      loadedTreeNodeChildrenIds.value.add(draft.id);
    });
  }

  function removeTreeNode(nodeId: string) {
    commitTreeNodes((nodes) => {
      const strip = (current: TreeNode[]): TreeNode[] =>
        current
          .filter((node) => node.id !== nodeId)
          .map((node) => (node.children?.length ? { ...node, children: strip(node.children) } : node));
      return strip(nodes);
    });
    if (selectedTreeNodeId.value === nodeId) selectedTreeNodeId.value = null;
    selectedTreeNodeIds.value = selectedTreeNodeIds.value.filter((id) => id !== nodeId);
    if (treeSelectionAnchorId.value === nodeId) treeSelectionAnchorId.value = null;
  }

  function buildSavedSqlRootNode(connectionId: string, existingRoot?: TreeNode): TreeNode | undefined {
    const savedSqlStore = useSavedSqlStore();
    const folders = savedSqlStore.listFolders(connectionId);
    const files = savedSqlStore.listFiles(connectionId);

    if (folders.length === 0 && files.length === 0) return undefined;

    const existingById = new Map<string, TreeNode>();
    const collectExisting = (node?: TreeNode) => {
      if (!node) return;
      existingById.set(node.id, node);
      node.children?.forEach(collectExisting);
    };
    collectExisting(existingRoot);

    const fileNode = (file: ReturnType<typeof savedSqlStore.listFiles>[number]): TreeNode => ({
      id: `${connectionId}:__saved_sql:file:${file.id}`,
      label: file.name,
      type: "saved-sql-file",
      connectionId,
      database: file.database,
      schema: file.schema,
      savedSqlId: file.id,
    });

    const folderNodes = folders.map((folder) => {
      const id = `${connectionId}:__saved_sql:folder:${folder.id}`;
      const existing = existingById.get(id);
      return {
        id,
        label: folder.name,
        type: "saved-sql-folder" as const,
        connectionId,
        savedSqlFolderId: folder.id,
        isExpanded: existing?.isExpanded ?? true,
        children: savedSqlStore.listFiles(connectionId, folder.id).map(fileNode),
      };
    });

    const rootId = `${connectionId}:__saved_sql`;
    return {
      id: rootId,
      label: "tree.savedSql",
      type: "saved-sql-root",
      connectionId,
      isExpanded: existingRoot?.isExpanded ?? true,
      children: [...folderNodes, ...files.map(fileNode)],
    };
  }

  function buildUserAdminNode(connectionId: string, existingConnectionNode?: TreeNode): TreeNode | undefined {
    const config = getConfig(connectionId);
    if (!supportsDatabaseUserAdmin(effectiveDatabaseTypeForConnection(config))) return undefined;
    const existing = existingConnectionNode?.children?.find((child) => child.type === "user-admin");
    return {
      id: `${connectionId}:__user_admin`,
      label: "tree.userAdmin",
      type: "user-admin",
      connectionId,
      database: "",
      isExpanded: existing?.isExpanded ?? false,
    };
  }

  function withConnectionUtilityNodes(
    connectionId: string,
    children: TreeNode[],
    existingConnectionNode?: TreeNode,
  ): TreeNode[] {
    const existingRoot = existingConnectionNode?.children?.find((child) => child.type === "saved-sql-root");
    const nonUtilityChildren = children.filter(
      (child) => child.type !== "saved-sql-root" && child.type !== "user-admin",
    );
    const userAdminNode = buildUserAdminNode(connectionId, existingConnectionNode);
    const savedSqlRoot = buildSavedSqlRootNode(connectionId, existingRoot);
    return [savedSqlRoot, ...nonUtilityChildren, userAdminNode].filter(Boolean) as TreeNode[];
  }

  function withSavedSqlRoot(connectionId: string, children: TreeNode[], existingConnectionNode?: TreeNode): TreeNode[] {
    return withConnectionUtilityNodes(connectionId, children, existingConnectionNode);
  }

  function refreshSavedSqlTree(connectionId?: string) {
    const refresh = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((node) => {
        let next = node;
        if (node.type === "connection" && node.connectionId && (!connectionId || node.connectionId === connectionId)) {
          next = {
            ...node,
            children: withSavedSqlRoot(
              node.connectionId,
              (node.children || []).filter((child) => child.type !== "saved-sql-root" && child.type !== "user-admin"),
              node,
            ),
          };
        }
        if (next.children) {
          return { ...next, children: refresh(next.children) };
        }
        return next;
      });
    commitTreeNodes(refresh);
  }

  function schemaCacheKey(...parts: string[]): string {
    return parts.map((part) => encodeURIComponent(part)).join(":");
  }

  function supportedSidebarObjectTypes(config?: ConnectionConfig): DatabaseObjectTreeKind[] {
    const dbType = effectiveDatabaseTypeForConnection(config);
    return sidebarObjectKindsForDatabase(dbType);
  }

  function refreshStaleTreeNode(node: TreeNode) {
    if (staleTreeRefreshIds.has(node.id)) return;
    staleTreeRefreshIds.add(node.id);
    const expandedIds = collectExpandedNodeIds([node]);
    clearLoadedChildrenCache(node.id);
    void loadTreeNodeChildren(node, { force: true })
      .then(() => {
        // Loading replaced the node instance in the committed tree; restore
        // expansion from the fresh one, not the captured reference.
        const fresh = findNode(treeNodes.value, node.id) ?? node;
        return restoreExpandedChildren(fresh, expandedIds, { force: true });
      })
      .finally(() => staleTreeRefreshIds.delete(node.id));
  }

  async function loadPersistedTreeChildren(node: TreeNode, cacheKey: string): Promise<PersistedTreeChildrenLoadResult> {
    const payload = await api.loadSchemaCache<unknown>(cacheKey).catch(() => null);
    const decoded = decodeSchemaTreeCache<TreeNode[]>(payload);
    if (!decoded) return { hit: false, isStale: false };
    const normalizedChildren = sortSidebarTreeChildrenForParent(
      node,
      normalizeCataloglessDatabaseNodes(expandCachedObjectBrowserNodes(decoded.children)),
      node.connectionId ? getConfig(node.connectionId)?.db_type : undefined,
    );
    setChildren(
      node,
      node.type === "connection" && node.connectionId
        ? withSavedSqlRoot(node.connectionId, normalizedChildren, node)
        : normalizedChildren,
    );
    commitTreeNode(node, (draft) => {
      draft.isExpanded = true;
    });
    return { hit: true, isStale: decoded.isStale };
  }

  async function savePersistedTreeChildren(cacheKey: string, children: TreeNode[]) {
    await api.saveSchemaCache(cacheKey, encodeSchemaTreeCache(children)).catch(() => undefined);
  }

  function useCachedChildren(node: TreeNode, options?: LoadTreeOptions): boolean {
    if (options?.force || !loadedTreeNodeChildrenIds.value.has(node.id)) return false;
    if (node.type === "connection" && node.connectionId) {
      const normalizedChildren = sortSidebarTreeChildrenForParent(
        node,
        withSavedSqlRoot(node.connectionId, node.children || [], node),
        getConfig(node.connectionId)?.db_type,
      );
      setChildren(node, normalizedChildren);
    }
    commitTreeNode(node, (draft) => {
      draft.isExpanded = true;
    });
    return true;
  }

  function isTreeNodeChildrenLoaded(nodeId: string): boolean {
    return loadedTreeNodeChildrenIds.value.has(nodeId);
  }

  function clearLoadedChildrenCache(prefix: string) {
    for (const id of loadedTreeNodeChildrenIds.value) {
      if (id === prefix || id.startsWith(`${prefix}:`)) {
        loadedTreeNodeChildrenIds.value.delete(id);
      }
    }
    const rawPrefix = `${prefix}:`;
    const encodedPrefix = `${schemaCacheKey(prefix)}:`;
    if (rawPrefix === encodedPrefix) {
      api.deleteSchemaCachePrefix(rawPrefix).catch(() => undefined);
    } else {
      Promise.all([api.deleteSchemaCachePrefix(rawPrefix), api.deleteSchemaCachePrefix(encodedPrefix)]).catch(
        () => undefined,
      );
    }
  }

  function schemaCachePrefixForNode(node: TreeNode): string | null {
    return treeNodeSchemaCachePrefix(node);
  }

  async function clearPersistedTreeCacheForNode(node: TreeNode) {
    const prefix = schemaCachePrefixForNode(node);
    if (!prefix) return;
    await api.deleteSchemaCachePrefix(prefix).catch(() => undefined);
  }

  function findParentNode(nodes: TreeNode[], id: string, parent: TreeNode | null = null): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return parent;
      if (node.children) {
        const found = findParentNode(node.children, id, node);
        if (found) return found;
      }
    }
    return null;
  }

  function toggleTreeNodePin(id: string) {
    const next = new Set(pinnedTreeNodeIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    pinnedTreeNodeIds.value = next;
    persistPinnedTreeNodeIds();

    commitTreeNode(id, (draft) => {
      draft.pinned = next.has(id);
    });

    const isConnectionOrGroup =
      treeNodes.value.some((n) => n.id === id) ||
      treeNodes.value.some((n) => n.type === "connection-group" && n.children?.some((c) => c.id === id));
    if (isConnectionOrGroup) {
      rebuildTreeNodes();
    } else {
      const parent = findParentNode(treeNodes.value, id);
      if (parent?.children) {
        commitTreeNode(parent, (draft) => {
          let children = orderPinnedFirst(draft.children || [], (child) => !!child.pinned);
          const sqlRootIdx = children.findIndex((c) => c.type === "saved-sql-root");
          if (sqlRootIdx > 0) {
            children = [...children];
            children.unshift(...children.splice(sqlRootIdx, 1));
          }
          draft.children = children;
        });
      }
    }
  }

  async function addConnection(config: ConnectionConfig) {
    const normalized = normalizeConnection(config);
    const existing = connections.value.findIndex((c) => c.id === normalized.id);
    const nextConnections = [...connections.value];
    if (existing >= 0) {
      nextConnections[existing] = normalized;
    } else {
      nextConnections.push(normalized);
      sidebarLayout.value = appendConnectionToLayout(sidebarLayout.value, normalized.id, newConnectionGroupId.value);
    }
    await persistConnections(nextConnections);
    connections.value = nextConnections;
    rebuildTreeNodes();
    persistSidebarLayoutDebounced();
    stopCreatingConnectionInGroup();
  }

  function invalidateCompletionCache(connectionId: string, database?: string) {
    completionCacheInvalidation.value = {
      seq: (completionCacheInvalidation.value?.seq ?? 0) + 1,
      connectionId,
      database,
    };
    const cachePrefix = database == null ? `${connectionId}:` : `${connectionId}:${database}:`;
    const exactCacheKey = database == null ? null : `${connectionId}:${database}`;
    for (const key of Object.keys(completionTablesSupersetCache.value)) {
      if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionTablesSupersetCache.value[key];
    }
    for (const key of Object.keys(completionObjectsCache.value)) {
      if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionObjectsCache.value[key];
    }
    for (const key of Object.keys(completionColumnsCache.value)) {
      if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionColumnsCache.value[key];
    }
    for (const key of Object.keys(completionMetadataCache.value)) {
      if (key === exactCacheKey || key.startsWith(cachePrefix)) delete completionMetadataCache.value[key];
    }
    for (const key of Object.keys(schemaListCache.value)) {
      if (key === exactCacheKey || key.startsWith(cachePrefix)) delete schemaListCache.value[key];
    }
    for (const key of Object.keys(elasticsearchCompletionIndicesCache.value)) {
      if (key === exactCacheKey || key.startsWith(cachePrefix)) delete elasticsearchCompletionIndicesCache.value[key];
    }
    for (const key of completionTableIndex.keys()) {
      if (key.startsWith(cachePrefix)) completionTableIndex.delete(key);
    }
    for (const key of completionObjectIndex.keys()) {
      if (key.startsWith(cachePrefix)) completionObjectIndex.delete(key);
    }
    for (const key of completionColumnIndex.keys()) {
      if (key.startsWith(cachePrefix)) completionColumnIndex.delete(key);
    }
    for (const key of completionInFlight.keys()) {
      if (key.startsWith(cachePrefix)) completionInFlight.delete(key);
    }
    for (const key of completionFilteredTablesCache.keys()) {
      if (key.startsWith(cachePrefix)) completionFilteredTablesCache.delete(key);
    }
  }

  async function removeConnections(ids: Iterable<string>) {
    const connectionIds = [...new Set(ids)].filter((id) => connections.value.some((c) => c.id === id));
    if (!connectionIds.length) return;

    const removedIds = new Set(connectionIds);
    const nextConnections = connections.value.filter((c) => !removedIds.has(c.id));
    await persistConnections(nextConnections);
    connections.value = nextConnections;
    for (const id of removedIds) {
      pinnedTreeNodeIds.value = prunePinnedTreeNodeIdsForConnection(pinnedTreeNodeIds.value, id);
    }
    persistPinnedTreeNodeIds();
    let removedLastUsed = false;
    const nextLastUsed = { ...connectionLastUsedAt.value };
    for (const id of removedIds) {
      clearConnectionError(id);
      connectedIds.value.delete(id);
      sidebarLayout.value = removeConnectionFromSidebarLayout(sidebarLayout.value, id);
      if (id in nextLastUsed) {
        delete nextLastUsed[id];
        removedLastUsed = true;
      }
    }
    if (removedLastUsed) {
      connectionLastUsedAt.value = nextLastUsed;
      persistConnectionLastUsed();
    }
    rebuildTreeNodes();
    persistSidebarLayoutDebounced();
    if (activeConnectionId.value && removedIds.has(activeConnectionId.value)) {
      activeConnectionId.value = null;
    }
    selectedTreeNodeIds.value = selectedTreeNodeIds.value.filter((id) => !removedIds.has(id));
    if (selectedTreeNodeId.value && removedIds.has(selectedTreeNodeId.value)) selectedTreeNodeId.value = null;
    if (treeSelectionAnchorId.value && removedIds.has(treeSelectionAnchorId.value)) treeSelectionAnchorId.value = null;
    for (const id of removedIds) {
      invalidateCompletionCache(id);
      clearLoadedChildrenCache(id);
    }
  }

  async function removeConnection(id: string) {
    await removeConnections([id]);
  }

  async function updateConnection(config: ConnectionConfig) {
    config = normalizeConnection(config);
    const idx = connections.value.findIndex((c) => c.id === config.id);
    if (idx < 0) return;
    const nextConnections = [...connections.value];
    nextConnections[idx] = config;
    await persistConnections(nextConnections);
    connections.value = nextConnections;
    rebuildTreeNodes();
    connectedIds.value.delete(config.id);
    invalidateCompletionCache(config.id);
    clearLoadedChildrenCache(config.id);
  }

  async function setDefaultDatabase(connectionId: string, database: string) {
    const config = getConfig(connectionId);
    if (!config || config.database === database) return;
    await updateConnection({
      ...config,
      database,
    });
  }

  async function clearDefaultDatabase(connectionId: string) {
    const config = getConfig(connectionId);
    if (!config || !config.database) return;
    await updateConnection({
      ...config,
      database: undefined,
    });
  }

  function isDefaultDatabase(connectionId: string, database: string): boolean {
    return getConfig(connectionId)?.database === database && database !== "";
  }

  async function setVisibleDatabases(connectionId: string, databaseNames: string[]) {
    const config = getConfig(connectionId);
    if (!config) return;
    await updateVisibleDatabasesConfig(connectionId, normalizeVisibleDatabaseSelection(databaseNames, databaseNames));
    await reloadConnectionDatabaseChildren(connectionId);
  }

  async function clearVisibleDatabases(connectionId: string) {
    const config = getConfig(connectionId);
    if (!config || !Array.isArray(config.visible_databases)) return;
    await updateVisibleDatabasesConfig(connectionId, undefined);
    await reloadConnectionDatabaseChildren(connectionId);
  }

  async function updateVisibleDatabasesConfig(connectionId: string, visibleDatabases: string[] | undefined) {
    const idx = connections.value.findIndex((connection) => connection.id === connectionId);
    if (idx < 0) return;
    const nextConnections = [...connections.value];
    nextConnections[idx] = {
      ...nextConnections[idx],
      visible_databases: visibleDatabases,
    };
    await persistConnections(nextConnections);
    connections.value = nextConnections;
    rebuildTreeNodes();
  }

  async function reloadConnectionDatabaseChildren(connectionId: string) {
    const config = getConfig(connectionId);
    if (!config) return;
    clearLoadedChildrenCache(connectionId);
    if (config.db_type === "redis") {
      await loadRedisDatabases(connectionId);
    } else if (config.db_type === "etcd") {
      await loadEtcdRoot(connectionId);
    } else if (config.db_type === "mongodb") {
      await loadMongoDatabases(connectionId);
    } else {
      await loadDatabases(connectionId, { force: true });
    }
  }

  async function connect(config: ConnectionConfig) {
    config = normalizeConnection(config);
    // Cancellable attempt (E5): the attempt id registers a backend token so
    // Cancel aborts the connect future instead of leaving it dialing behind
    // the spinner (which the timeout race alone did).
    const attemptId = uuid();
    const attempt = beginNodeAttempt(config.id, "connect", attemptId);
    commitTreeNode(config.id, (draft) => {
      draft.isLoading = true;
    });
    try {
      const id = await withConnectionAttemptTimeout(api.connectDb(config, attemptId), config, attemptId);
      if (!attemptIsActive(attempt)) throw new ConnectionAttemptCancelledError();
      activeConnectionId.value = id;
      connectedIds.value.add(id);
      recordConnectionUsed(id);
      clearConnectionError(config.id);
      if (id !== config.id) clearConnectionError(id);

      const existing = findNode(treeNodes.value, id);
      if (existing) {
        commitTreeNode(id, (draft) => {
          draft.label = config.name;
          draft.type = "connection";
          draft.connectionId = id;
          draft.children = draft.children || [];
        });
      } else {
        commitTreeNodes((nodes) => [
          ...nodes,
          {
            id,
            label: config.name,
            type: "connection" as const,
            connectionId: id,
            isExpanded: false,
            children: [],
          },
        ]);
      }
      return id;
    } catch (e) {
      // A cancelled attempt resets the UI at cancel time and must stay
      // silent: no error entry, and its late outcome (success or failure) is
      // discarded so it can never leak into state.
      if (!attemptIsActive(attempt)) throw new ConnectionAttemptCancelledError();
      recordConnectionError(config.id, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, config.id);
    }
  }

  async function disconnect(connectionId: string) {
    const shouldRemoveOneTimeConnection = getConfig(connectionId)?.one_time === true;
    await api.disconnectDb(connectionId);
    clearConnectionError(connectionId);
    const { useQueryStore } = await import("@/stores/queryStore");
    const queryStore = useQueryStore();
    switch (settingsStore.editorSettings.disconnectTabHandlingMode) {
      case "close-tabs":
        queryStore.closeConnectionTabs(connectionId);
        break;
      case "keep-tabs-clear-results":
        queryStore.releaseConnectionTabs(connectionId);
        break;
      case "keep-tabs-keep-results":
        break;
    }
    connectedIds.value.delete(connectionId);
    commitTreeNode(connectionId, (draft) => {
      draft.isExpanded = false;
      draft.children = [];
    });
    clearLoadedChildrenCache(connectionId);
    if (activeConnectionId.value === connectionId) {
      activeConnectionId.value = null;
    }
    invalidateCompletionCache(connectionId);
    if (shouldRemoveOneTimeConnection) {
      await removeConnection(connectionId);
    }
  }

  async function closeDatabaseConnection(connectionId: string, database: string) {
    await api.closeDatabaseConnection(connectionId, database);
    const { useQueryStore } = await import("@/stores/queryStore");
    const queryStore = useQueryStore();
    switch (settingsStore.editorSettings.disconnectTabHandlingMode) {
      case "close-tabs":
        queryStore.closeDatabaseTabs(connectionId, database);
        break;
      case "keep-tabs-clear-results":
        queryStore.releaseDatabaseTabs(connectionId, database);
        break;
      case "keep-tabs-keep-results":
        break;
    }
    const node = findDatabaseTreeNode(treeNodes.value, connectionId, database);
    if (node) {
      const nodeId = node.id;
      commitTreeNode(nodeId, (draft) => {
        draft.isExpanded = false;
        draft.children = [];
      });
      clearLoadedChildrenCache(nodeId);
    }
    invalidateCompletionCache(connectionId, database);
  }

  // `attempt` is the tree-node attempt of a loader that needs the connection
  // first (sidebar expand of an unconnected connection). The dial then runs as
  // that attempt's cancellable connect: Cancel aborts it on the backend, and a
  // cancelled/superseded dial never marks the connection connected nor records
  // an error — it rejects with ConnectionAttemptCancelledError instead.
  async function ensureConnected(connectionId: string, attempt?: NodeAttempt) {
    if (connectedIds.value.has(connectionId)) return;
    let config = getConfig(connectionId);
    if (!config) {
      await initFromDisk();
      config = getConfig(connectionId);
    }
    if (!config) {
      const error = new Error("Connection config not found");
      recordConnectionError(connectionId, error);
      throw error;
    }
    if (attempt && !attemptIsActive(attempt)) throw new ConnectionAttemptCancelledError();
    const attemptId = attempt ? uuid() : undefined;
    if (attempt) {
      attempt.kind = "connect";
      attempt.attemptId = attemptId;
    }
    try {
      await withConnectionAttemptTimeout(api.connectDb(config, attemptId), config, attemptId);
      if (attempt && !attemptIsActive(attempt)) throw new ConnectionAttemptCancelledError();
      connectedIds.value.add(connectionId);
      activeConnectionId.value = connectionId;
      recordConnectionUsed(connectionId);
      clearConnectionError(connectionId);
    } catch (e) {
      if (attempt && !attemptIsActive(attempt)) throw new ConnectionAttemptCancelledError();
      recordConnectionError(connectionId, e);
      throw e;
    } finally {
      // The rest of the loader is a plain metadata read again.
      if (attempt) {
        attempt.kind = "load";
        attempt.attemptId = undefined;
      }
    }
  }

  async function loadDatabases(connectionId: string, options?: LoadTreeOptions) {
    const node = findNode(treeNodes.value, connectionId);
    if (!node) return;
    const attempt = beginNodeAttempt(node.id, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      if (useCachedChildren(node, options)) return;

      const config = getConfig(connectionId);
      if (config?.db_type === "duckdb") {
        const cacheKey = schemaCacheKey(connectionId, "duckdb-root");
        if (!options?.force) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }
        const [databases, schemas] = await withMetadataLoadTimeout(connectionId, () =>
          Promise.all([api.listDatabases(connectionId), api.listSchemas(connectionId, "main")]),
        );
        if (!attemptIsActive(attempt)) return;
        const children = withSavedSqlRoot(
          connectionId,
          buildDuckDbConnectionTreeNodes(connectionId, databases, schemas),
          node,
        );
        setChildren(node, children);
        await savePersistedTreeChildren(cacheKey, children);
      } else if (config?.db_type === "dameng" || config?.db_type === "oracle") {
        const effectiveDb = config.database || "";
        const cacheKey = schemaCacheKey(connectionId, effectiveDb, "schemas");
        if (!options?.force) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }
        const schemas = await withMetadataLoadTimeout(connectionId, () => api.listSchemas(connectionId, effectiveDb));
        if (!attemptIsActive(attempt)) return;
        const visibleSchemas = filterDatabaseNamesForConnection(schemas, config);
        const schemaNodes: TreeNode[] = sortSidebarNames(visibleSchemas).map((s) => ({
          id: `${connectionId}:${s}:${s}`,
          label: s,
          type: "schema" as const,
          connectionId,
          database: s,
          schema: s,
          isExpanded: false,
          children: [],
        }));
        setChildren(node, withSavedSqlRoot(connectionId, schemaNodes, node));
        await savePersistedTreeChildren(cacheKey, schemaNodes);
      } else {
        const cacheKey = schemaCacheKey(connectionId, "databases");
        if (!options?.force) {
          const cached = await loadPersistedTreeChildren(node, cacheKey);
          if (cached.hit) {
            if (cached.isStale) refreshStaleTreeNode(node);
            return;
          }
        }
        const databases = await withMetadataLoadTimeout(connectionId, () => api.listDatabases(connectionId));
        if (!attemptIsActive(attempt)) return;
        const visibleNames = filterDatabaseNamesForConnection(
          databases.map((database) => database.name),
          config,
        );
        const visibleNameSet = new Set(visibleNames);
        const visibleDatabases = databases.filter((database) => visibleNameSet.has(database.name));
        const children = withSavedSqlRoot(
          connectionId,
          buildDatabaseTreeNodes(connectionId, visibleDatabases, {
            includeDefaultWhenEmpty:
              usesTreeSchemaMode(config?.db_type) || shouldIncludeDefaultDatabaseNode(config, visibleDatabases),
          }),
          node,
        );
        setChildren(node, children);
        await savePersistedTreeChildren(cacheKey, children);
      }
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadRedisDatabases(connectionId: string) {
    const node = findNode(treeNodes.value, connectionId);
    if (!node) return;

    const attempt = beginNodeAttempt(node.id, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      const dbs = await withMetadataLoadTimeout(connectionId, () => api.redisListDatabases(connectionId));
      if (!attemptIsActive(attempt)) return;
      const config = getConfig(connectionId);
      const visibleNames = filterVisibleDatabaseNames(
        dbs.map((db) => String(db.db)),
        config?.visible_databases,
      );
      const visibleNameSet = new Set(visibleNames);
      setChildren(
        node,
        withSavedSqlRoot(
          connectionId,
          dbs
            .filter((db) => visibleNameSet.has(String(db.db)))
            .map((db) => ({
              id: `${connectionId}:db${db.db}`,
              label: redisDbLabel(db.db, 0, db.keys),
              type: "redis-db" as const,
              connectionId,
              database: String(db.db),
              loadedKeyCount: 0,
              totalKeyCount: db.keys,
              isExpanded: false,
              children: [],
            })),
          node,
        ),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadEtcdRoot(connectionId: string) {
    const node = findNode(treeNodes.value, connectionId);
    if (!node) return;

    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId);
      setChildren(
        node,
        withSavedSqlRoot(
          connectionId,
          [
            {
              id: `${connectionId}:etcd`,
              label: "Keys",
              type: "etcd-root" as const,
              connectionId,
              database: "",
              isExpanded: false,
              children: [],
            },
          ],
          node,
        ),
      );
      commitTreeNode(node, (draft) => {
        draft.isExpanded = true;
      });
    } catch (e) {
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      commitTreeNode(node, (draft) => {
        draft.isLoading = false;
      });
    }
  }

  function updateRedisDbKeyStats(
    connectionId: string,
    db: number,
    stats: { loaded?: number; total?: number; totalDelta?: number },
  ) {
    const node = findNode(treeNodes.value, `${connectionId}:db${db}`);
    if (!node || node.type !== "redis-db") return;
    commitTreeNode(node, (draft) => {
      if (stats.loaded != null) draft.loadedKeyCount = stats.loaded;
      if (stats.total != null) draft.totalKeyCount = stats.total;
      if (stats.totalDelta != null && draft.totalKeyCount != null) {
        draft.totalKeyCount = Math.max(0, draft.totalKeyCount + stats.totalDelta);
      }
      draft.label = redisDbLabel(db, draft.loadedKeyCount, draft.totalKeyCount);
    });
  }

  async function loadMongoDatabases(connectionId: string) {
    const node = findNode(treeNodes.value, connectionId);
    if (!node) return;

    const attempt = beginNodeAttempt(node.id, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      const dbs = await withMetadataLoadTimeout(connectionId, () => api.mongoListDatabases(connectionId));
      if (!attemptIsActive(attempt)) return;
      const config = getConfig(connectionId);
      const visibleDbs = filterDatabaseNamesForConnection(dbs, config);
      setChildren(
        node,
        withSavedSqlRoot(
          connectionId,
          sortSidebarNames(visibleDbs).map((db) => ({
            id: `${connectionId}:${db}`,
            label: db,
            type: "mongo-db" as const,
            connectionId,
            database: db,
            isExpanded: false,
            children: [],
          })),
          node,
        ),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadMongoCollections(connectionId: string, database: string) {
    const nodeId = `${connectionId}:${database}`;
    const node = findNode(treeNodes.value, nodeId);
    if (!node) return;

    const attempt = beginNodeAttempt(nodeId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      const collections = await withMetadataLoadTimeout(connectionId, () =>
        api.mongoListCollections(connectionId, database),
      );
      if (!attemptIsActive(attempt)) return;
      setChildren(
        node,
        sortSidebarNames(collections).map((col) => ({
          id: `${nodeId}:${col}`,
          label: col,
          type: "mongo-collection" as const,
          connectionId,
          database,
          isExpanded: false,
        })),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadSchemas(connectionId: string, database: string, options?: LoadTreeOptions) {
    const nodeId = `${connectionId}:${database}`;
    const node = findNode(treeNodes.value, nodeId);
    if (!node) return;
    const attempt = beginNodeAttempt(nodeId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      if (useCachedChildren(node, options)) return;
      const cacheKey = schemaCacheKey(connectionId, database, "schemas");
      if (!options?.force) {
        const cached = await loadPersistedTreeChildren(node, cacheKey);
        if (cached.hit) {
          if (cached.isStale) refreshStaleTreeNode(node);
          return;
        }
      }

      const schemas = sortSidebarNames(
        await withMetadataLoadTimeout(connectionId, () => api.listSchemas(connectionId, database)),
      );
      if (!attemptIsActive(attempt)) return;
      const children = schemas.map((s) => ({
        id: `${connectionId}:${database}:${s}`,
        label: s,
        type: "schema" as const,
        connectionId,
        database,
        schema: s,
        isExpanded: false,
        children: [],
      }));
      setChildren(node, children);
      await savePersistedTreeChildren(cacheKey, children);
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadSqlServerDatabaseObjects(connectionId: string, database: string, options?: LoadTreeOptions) {
    const nodeId = `${connectionId}:${database}`;
    const node = findNode(treeNodes.value, nodeId);
    if (!node) return;
    const attempt = beginNodeAttempt(nodeId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      if (useCachedChildren(node, options)) return;
      const simpleObjectDisplay = useSettingsStore().editorSettings.sidebarObjectDisplay === "simple";
      const cacheKey = schemaCacheKey(
        connectionId,
        database,
        simpleObjectDisplay ? "sqlserver-objects-simple-v2" : "sqlserver-objects-grouped-v2",
      );
      if (!options?.force) {
        const cached = await loadPersistedTreeChildren(node, cacheKey);
        if (cached.hit) {
          if (cached.isStale) refreshStaleTreeNode(node);
          return;
        }
      }

      const config = getConfig(connectionId);
      const schemas = await withMetadataLoadTimeout(connectionId, () => api.listSchemas(connectionId, database));
      const defaultSchemaObjects = simpleObjectDisplay
        ? await withMetadataLoadTimeout(connectionId, () =>
            api.listObjects(connectionId, database, SQLSERVER_DEFAULT_SCHEMA),
          )
        : [];
      if (!attemptIsActive(attempt)) return;
      const children = buildSqlServerDatabaseTreeNodes(connectionId, database, schemas, defaultSchemaObjects, {
        lazyObjectTypes: simpleObjectDisplay ? undefined : supportedSidebarObjectTypes(config),
        simpleObjectDisplay,
      });
      setChildren(node, children);
      await savePersistedTreeChildren(cacheKey, children);
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadTables(connectionId: string, database: string, schema?: string, options?: LoadTreeOptions) {
    const nodeId = schema ? `${connectionId}:${database}:${schema}` : `${connectionId}:${database}`;
    const node = findNode(treeNodes.value, nodeId);
    if (!node) return;
    const attempt = beginNodeAttempt(nodeId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      if (useCachedChildren(node, options)) return;
      const simpleObjectDisplay = useSettingsStore().editorSettings.sidebarObjectDisplay === "simple";
      const cacheKey = schemaCacheKey(
        connectionId,
        database,
        schema || "",
        simpleObjectDisplay ? "objects-simple-v2" : "objects-grouped-v2",
      );
      if (!options?.force) {
        const cached = await loadPersistedTreeChildren(node, cacheKey);
        if (cached.hit) {
          if (cached.isStale) refreshStaleTreeNode(node);
          return;
        }
      }

      const config = getConfig(connectionId);
      const querySchema = connectionObjectTreeQuerySchema(config, database, schema);
      const effectiveSchema = connectionObjectTreeNodeSchema(config, database, schema);
      let children: TreeNode[];
      if (simpleObjectDisplay) {
        try {
          const [objects, tables] = await withMetadataLoadTimeout(connectionId, () =>
            Promise.all([
              api.listObjects(connectionId, database, querySchema),
              api.listTables(connectionId, database, querySchema),
            ]),
          );
          if (!attemptIsActive(attempt)) return;
          children = buildSimpleObjectTreeNodes({
            nodeId,
            connectionId,
            database,
            schema: effectiveSchema,
            objects: mergeTableInfosIntoObjects(objects, tables, effectiveSchema),
          });
        } catch {
          const tables = await withMetadataLoadTimeout(connectionId, () =>
            api.listTables(connectionId, database, querySchema),
          );
          if (!attemptIsActive(attempt)) return;
          children = buildTableTreeNodes({ nodeId, connectionId, database, schema: effectiveSchema, tables });
        }
      } else {
        children = buildObjectGroupPlaceholderNodes({
          nodeId,
          connectionId,
          database,
          schema: effectiveSchema,
          objectTypes: supportedSidebarObjectTypes(config),
        });
      }
      setChildren(node, children);
      await savePersistedTreeChildren(cacheKey, children);
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadObjectGroupChildren(node: TreeNode, options?: LoadTreeOptions) {
    if (!node.connectionId || !hasTreeNodeDatabaseContext(node)) return;
    const attempt = beginNodeAttempt(node.id, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      await ensureConnected(node.connectionId, attempt);
      if (!attemptIsActive(attempt)) return;
      if (useCachedChildren(node, options)) return;
      const objectTypes = objectTypesForGroupNode(node.type);
      const parentNodeId = objectGroupRefreshParentId(node);
      if (!objectTypes || !parentNodeId) return;

      const config = getConfig(node.connectionId);
      const querySchema = connectionObjectTreeQuerySchema(config, node.database, node.schema);
      const effectiveSchema = connectionObjectTreeNodeSchema(config, node.database, node.schema);
      const cacheKey = schemaCacheKey(node.connectionId, node.database, node.schema || "", node.type, "objects-v1");
      if (!options?.force) {
        const cached = await loadPersistedTreeChildren(node, cacheKey);
        if (cached.hit) {
          if (cached.isStale) refreshStaleTreeNode(node);
          return;
        }
      }

      // Capture the guard-narrowed identifiers into locals so the retry thunks
      // below stay typed as `string` (a closure over the mutable node props
      // would widen them back to `string | undefined`).
      const nodeConnectionId = node.connectionId;
      const nodeDatabase = node.database;
      const wantsOnlyTablesOrViews = objectTypes.every((objectType) => objectType === "TABLE" || objectType === "VIEW");
      const objects = wantsOnlyTablesOrViews
        ? mergeTableInfosIntoObjects(
            [],
            await withMetadataLoadTimeout(nodeConnectionId, () =>
              api.listTables(nodeConnectionId, nodeDatabase, querySchema),
            ),
            effectiveSchema,
          )
        : await withMetadataLoadTimeout(nodeConnectionId, () =>
            api.listObjects(nodeConnectionId, nodeDatabase, querySchema, objectTypes),
          );
      if (!attemptIsActive(attempt)) return;
      const grouped = buildGroupedObjectTreeNodes({
        nodeId: parentNodeId,
        connectionId: node.connectionId,
        database: node.database,
        schema: effectiveSchema,
        objects: objects.filter((object) => objectTypes.includes(normalizedObjectTreeKind(object.object_type))),
      });
      const refreshedGroup = grouped.find((group) => group.type === node.type);
      const children = refreshedGroup?.children ?? [];
      commitTreeNode(node, (draft) => {
        draft.objectCount = refreshedGroup?.objectCount ?? children.length;
      });
      setChildren(node, children);
      await savePersistedTreeChildren(cacheKey, children);
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(node.connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  function normalizedObjectTreeKind(type: string): DatabaseObjectTreeKind {
    return normalizeSidebarObjectKind(type);
  }

  async function loadTableGroups(
    connectionId: string,
    database: string,
    table: string,
    schema?: string,
    nodeId?: string,
  ) {
    const parentId =
      nodeId ?? (schema ? `${connectionId}:${database}:${schema}:${table}` : `${connectionId}:${database}:${table}`);
    const node = findNode(treeNodes.value, parentId);
    if (!node) return;

    const children: TreeNode[] = [
      ...tablePartitionGroups(node),
      {
        id: `${parentId}:__columns`,
        label: "tree.columns",
        type: "group-columns",
        connectionId,
        database,
        schema,
        tableName: table,
        isExpanded: false,
        children: [],
      },
    ];

    if (node.type === "table") {
      children.push(
        {
          id: `${parentId}:__indexes`,
          label: "tree.indexes",
          type: "group-indexes",
          connectionId,
          database,
          schema,
          tableName: table,
          isExpanded: false,
          children: [],
        },
        {
          id: `${parentId}:__fkeys`,
          label: "tree.foreignKeys",
          type: "group-fkeys",
          connectionId,
          database,
          schema,
          tableName: table,
          isExpanded: false,
          children: [],
        },
        {
          id: `${parentId}:__triggers`,
          label: "tree.triggers",
          type: "group-triggers",
          connectionId,
          database,
          schema,
          tableName: table,
          isExpanded: false,
          children: [],
        },
      );
    }

    setChildren(node, children);
    commitTreeNode(node, (draft) => {
      draft.isExpanded = true;
    });
  }

  async function loadColumns(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
    const parentId =
      nodeId ??
      (schema
        ? `${connectionId}:${database}:${schema}:${table}:__columns`
        : `${connectionId}:${database}:${table}:__columns`);
    const node = findNode(treeNodes.value, parentId);
    if (!node) return;

    const attempt = beginNodeAttempt(parentId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      const querySchema = metadataQuerySchema(connectionId, database, schema);
      const columns = await withMetadataLoadTimeout(connectionId, () =>
        api.getColumns(connectionId, database, querySchema, table),
      );
      if (!attemptIsActive(attempt)) return;
      setChildren(
        node,
        columns.map((col) => ({
          id: `${parentId}:${col.name}`,
          label: `${col.name} (${col.data_type})`,
          type: "column" as const,
          connectionId,
          database,
          schema,
          tableName: table,
          meta: col,
        })),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadIndexes(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
    const parentId =
      nodeId ??
      (schema
        ? `${connectionId}:${database}:${schema}:${table}:__indexes`
        : `${connectionId}:${database}:${table}:__indexes`);
    const node = findNode(treeNodes.value, parentId);
    if (!node) return;

    const attempt = beginNodeAttempt(parentId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      const querySchema = metadataQuerySchema(connectionId, database, schema);
      const indexes = await withMetadataLoadTimeout(connectionId, () =>
        api.listIndexes(connectionId, database, querySchema, table),
      );
      if (!attemptIsActive(attempt)) return;
      setChildren(
        node,
        indexes.map((idx) => ({
          id: `${parentId}:${idx.name}`,
          label: `${idx.name} (${idx.columns.join(", ")})`,
          type: "index" as const,
          connectionId,
          database,
          schema,
          tableName: table,
          meta: idx,
        })),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadForeignKeys(
    connectionId: string,
    database: string,
    table: string,
    schema?: string,
    nodeId?: string,
  ) {
    const parentId =
      nodeId ??
      (schema
        ? `${connectionId}:${database}:${schema}:${table}:__fkeys`
        : `${connectionId}:${database}:${table}:__fkeys`);
    const node = findNode(treeNodes.value, parentId);
    if (!node) return;

    const attempt = beginNodeAttempt(parentId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      const querySchema = metadataQuerySchema(connectionId, database, schema);
      const fkeys = await withMetadataLoadTimeout(connectionId, () =>
        api.listForeignKeys(connectionId, database, querySchema, table),
      );
      if (!attemptIsActive(attempt)) return;
      setChildren(
        node,
        fkeys.map((fk) => ({
          id: `${parentId}:${fk.name}`,
          label: `${fk.column} → ${fk.ref_table}.${fk.ref_column}`,
          type: "fkey" as const,
          connectionId,
          database,
          schema,
          tableName: table,
          meta: fk,
        })),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  async function loadTriggers(connectionId: string, database: string, table: string, schema?: string, nodeId?: string) {
    const parentId =
      nodeId ??
      (schema
        ? `${connectionId}:${database}:${schema}:${table}:__triggers`
        : `${connectionId}:${database}:${table}:__triggers`);
    const node = findNode(treeNodes.value, parentId);
    if (!node) return;

    const attempt = beginNodeAttempt(parentId, "load");
    commitTreeNode(node, (draft) => {
      draft.isLoading = true;
    });
    try {
      const querySchema = metadataQuerySchema(connectionId, database, schema);
      const triggers = await withMetadataLoadTimeout(connectionId, () =>
        api.listTriggers(connectionId, database, querySchema, table),
      );
      if (!attemptIsActive(attempt)) return;
      setChildren(
        node,
        triggers.map((tr) => ({
          id: `${parentId}:${tr.name}`,
          label: `${tr.name} (${tr.timing} ${tr.event})`,
          type: "trigger" as const,
          connectionId,
          database,
          schema,
          tableName: table,
          meta: tr,
        })),
      );
      if (attemptIsActive(attempt)) {
        commitTreeNode(node, (draft) => {
          draft.isExpanded = true;
        });
      }
    } catch (e) {
      if (!attemptIsActive(attempt)) return;
      recordMetadataLoadError(connectionId, e);
      throw e;
    } finally {
      settleNodeAttempt(attempt, node);
    }
  }

  function collectExpandedNodeIds(nodes: TreeNode[], ids = new Set<string>()): Set<string> {
    for (const node of nodes) {
      if (node.isExpanded) ids.add(node.id);
      if (node.children) collectExpandedNodeIds(node.children, ids);
    }
    return ids;
  }

  async function loadTreeNodeChildren(node: TreeNode, options?: LoadTreeOptions) {
    if (node.type === "connection" && node.connectionId) {
      const config = getConfig(node.connectionId);
      if (config?.db_type === "redis") {
        await loadRedisDatabases(node.connectionId);
      } else if (config?.db_type === "etcd") {
        await loadEtcdRoot(node.connectionId);
      } else if (config?.db_type === "mongodb" || config?.db_type === "elasticsearch") {
        await loadMongoDatabases(node.connectionId);
      } else {
        await loadDatabases(node.connectionId, options);
      }
    } else if (node.type === "mongo-db" && node.connectionId && node.database) {
      await loadMongoCollections(node.connectionId, node.database);
    } else if (node.type === "database" && node.connectionId && hasTreeNodeDatabaseContext(node)) {
      const config = getConfig(node.connectionId);
      if (config?.db_type === "sqlserver") {
        await loadSqlServerDatabaseObjects(node.connectionId, node.database, options);
      } else if (usesTreeSchemaMode(config?.db_type) && !connectionUsesDatabaseObjectTreeMode(config)) {
        await loadSchemas(node.connectionId, node.database, options);
      } else {
        await loadTables(node.connectionId, node.database, undefined, options);
      }
    } else if (node.type === "schema" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.schema) {
      await loadTables(node.connectionId, node.database, node.schema, options);
    } else if (
      (node.type === "table" || node.type === "view") &&
      node.connectionId &&
      hasTreeNodeDatabaseContext(node)
    ) {
      await loadTableGroups(node.connectionId, node.database, node.label, node.schema, node.id);
    } else if (
      node.type === "group-columns" &&
      node.connectionId &&
      hasTreeNodeDatabaseContext(node) &&
      node.tableName
    ) {
      await loadColumns(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (
      node.type === "group-indexes" &&
      node.connectionId &&
      hasTreeNodeDatabaseContext(node) &&
      node.tableName
    ) {
      await loadIndexes(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (node.type === "group-fkeys" && node.connectionId && hasTreeNodeDatabaseContext(node) && node.tableName) {
      await loadForeignKeys(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (
      node.type === "group-triggers" &&
      node.connectionId &&
      hasTreeNodeDatabaseContext(node) &&
      node.tableName
    ) {
      await loadTriggers(node.connectionId, node.database, node.tableName, node.schema, node.id);
    } else if (
      node.type === "group-tables" ||
      node.type === "group-views" ||
      node.type === "group-procedures" ||
      node.type === "group-functions" ||
      node.type === "group-sequences" ||
      node.type === "group-packages"
    ) {
      await loadObjectGroupChildren(node, options);
    } else if (node.type === "group-partitions") {
      commitTreeNode(node, (draft) => {
        draft.isExpanded = true;
      });
    }
  }

  async function restoreExpandedChildren(node: TreeNode, expandedIds: Set<string>, options?: LoadTreeOptions) {
    if (!node.children) return;
    for (const child of node.children) {
      if (!expandedIds.has(child.id)) continue;
      await loadTreeNodeChildren(child, options);
      // Loading replaced the child instance in the committed tree; recurse from
      // the fresh one so its new children are visible to the next level.
      const fresh = findNode(treeNodes.value, child.id) ?? child;
      await restoreExpandedChildren(fresh, expandedIds, options);
    }
  }

  async function refreshTreeNode(node: TreeNode) {
    if (objectTypesForGroupNode(node.type)) {
      clearLoadedChildrenCache(node.id);
      await loadObjectGroupChildren(node, { force: true });
      return;
    }

    const parentId = objectGroupRefreshParentId(node);
    const parentNode = parentId ? findNode(treeNodes.value, parentId) : null;
    if (parentNode) {
      await refreshTreeNode(parentNode);
      return;
    }

    if (node.connectionId && !connectedIds.value.has(node.connectionId)) return;
    const expandedIds = collectExpandedNodeIds([node]);
    expandedIds.add(node.id);
    await clearPersistedTreeCacheForNode(node);
    clearLoadedChildrenCache(node.id);
    if (node.type !== "connection-group") {
      commitTreeNode(node, (draft) => {
        draft.children = [];
      });
    }
    await loadTreeNodeChildren(node, { force: true });
    const fresh = findNode(treeNodes.value, node.id) ?? node;
    await restoreExpandedChildren(fresh, expandedIds, { force: true });
  }

  async function refreshDatabaseTreeNode(connectionId: string, database: string) {
    const node = findDatabaseTreeNode(treeNodes.value, connectionId, database);
    if (node) {
      await refreshTreeNode(node);
      return;
    }
    await loadDatabases(connectionId, { force: true });
  }

  async function refreshObjectListTreeNode(connectionId: string, database: string, schema?: string) {
    const config = getConfig(connectionId);
    const shouldRefreshSchemaNode = schema && !(config?.db_type === "sqlserver" && schema.toLowerCase() === "dbo");
    const node = shouldRefreshSchemaNode ? findNode(treeNodes.value, `${connectionId}:${database}:${schema}`) : null;
    if (node) {
      await refreshTreeNode(node);
      return;
    }
    await refreshDatabaseTreeNode(connectionId, database);
  }

  function isSchemaAwareDatabase(connectionId: string): boolean {
    return isSchemaAware(getConfig(connectionId)?.db_type);
  }

  function metadataQuerySchema(connectionId: string, database: string, schema?: string): string {
    return connectionObjectTreeQuerySchema(getConfig(connectionId), database, schema);
  }

  const COMPLETION_CACHE_MAX = 50;

  function evictOldestCacheEntries(cache: Record<string, unknown>, max: number) {
    const keys = Object.keys(cache);
    if (keys.length <= max) return;
    const toRemove = keys.slice(0, keys.length - max);
    for (const key of toRemove) {
      delete cache[key];
    }
  }

  function completionScopeKey(connectionId: string, database: string, schema?: string): string {
    return `${connectionId}:${database}:${schema ?? ""}`;
  }

  function completionColumnsKey(connectionId: string, database: string, table: string, schema?: string): string {
    return `${completionScopeKey(connectionId, database, schema)}:${table.toLowerCase()}`;
  }

  function touchCompletionIndex<T>(
    index: Map<string, { touched: number } & T>,
    key: string,
    value: T,
    max = COMPLETION_CACHE_MAX,
  ) {
    index.set(key, { ...value, touched: Date.now() });
    if (index.size <= max) return;
    const oldest = [...index.entries()].sort(([, a], [, b]) => a.touched - b.touched).slice(0, index.size - max);
    for (const [oldKey] of oldest) index.delete(oldKey);
  }

  function withCompletionInFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = completionInFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = load().finally(() => {
      if (completionInFlight.get(key) === promise) completionInFlight.delete(key);
    });
    completionInFlight.set(key, promise);
    return promise;
  }

  // `normalized` must already be trimmed + lowercased; `preferredSchemaLower`
  // must already be lowercased. Callers hoist this work out of the per-table loop.
  function tableMatchScore(
    table: { name: string; schema?: string; nameLower?: string; schemaLower?: string },
    normalized: string,
    preferredSchemaLower?: string,
  ): number {
    const text = table.nameLower ?? table.name.toLowerCase();
    const schema = table.schemaLower ?? table.schema?.toLowerCase();
    let score = schema && preferredSchemaLower && schema === preferredSchemaLower ? 10_000 : 0;
    if (!normalized) return score;
    if (text === normalized) return score + 9_000 - text.length;
    if (text.startsWith(normalized)) return score + 7_000 - text.length;
    if (text.includes(normalized)) return score + 4_000 - text.length;
    let index = 0;
    for (const ch of normalized) {
      index = text.indexOf(ch, index);
      if (index < 0) return -1;
      index++;
    }
    return score + 1_000 - text.length;
  }

  function objectMatchScore(
    object: IndexedCompletionObject,
    normalized: string,
    preferredSchemaLower?: string,
  ): number {
    return tableMatchScore(object, normalized, preferredSchemaLower);
  }

  function indexCompletionTables(
    connectionId: string,
    database: string,
    schema: string | undefined,
    tables: SqlCompletionTable[],
  ) {
    const groups = new Map<string, IndexedCompletionTable[]>();
    for (const table of tables) {
      const tableSchema = table.schema ?? schema;
      const key = completionScopeKey(connectionId, database, tableSchema);
      const list = groups.get(key) ?? [];
      list.push({
        ...table,
        schema: tableSchema,
        nameLower: table.name.toLowerCase(),
        schemaLower: tableSchema?.toLowerCase(),
      });
      groups.set(key, list);
    }
    for (const [key, group] of groups) {
      const previous = completionTableIndex.get(key)?.tables ?? [];
      touchCompletionIndex(completionTableIndex, key, {
        tables: dedupeCompletionTables([...previous, ...group]),
      });
    }
    // Indexed tables changed — drop the narrowing cache so stale candidate lists
    // are never reused. Indexing happens on (debounced) metadata refresh, not per
    // keystroke, so clearing wholesale is cheap and safe.
    tableNarrowCache.clear();
  }

  function indexCompletionObjects(
    connectionId: string,
    database: string,
    schema: string | undefined,
    objects: SqlCompletionObject[],
  ) {
    const groups = new Map<string, IndexedCompletionObject[]>();
    for (const object of objects) {
      const objectSchema = object.schema ?? schema;
      const key = completionScopeKey(connectionId, database, objectSchema);
      const list = groups.get(key) ?? [];
      list.push({
        ...object,
        schema: objectSchema,
        nameLower: object.name.toLowerCase(),
        schemaLower: objectSchema?.toLowerCase(),
      });
      groups.set(key, list);
    }
    for (const [key, group] of groups) {
      const previous = completionObjectIndex.get(key)?.objects ?? [];
      touchCompletionIndex(completionObjectIndex, key, {
        objects: dedupeCompletionObjects([...previous, ...group]),
      });
    }
  }

  function indexCompletionColumns(
    connectionId: string,
    database: string,
    table: string,
    schema: string | undefined,
    columns: SqlCompletionColumn[],
  ) {
    touchCompletionIndex(completionColumnIndex, completionColumnsKey(connectionId, database, table, schema), {
      columns,
    });
  }

  function lookupLocalCompletionTables(
    connectionId: string,
    database: string,
    filter = "",
    limit?: number,
    schema?: string,
  ): SqlCompletionTable[] {
    const cap = limit ?? 200;
    const normalized = filter.trim().toLowerCase();
    const preferredSchemaLower = schema?.toLowerCase();
    const scopeKey = completionScopeKey(connectionId, database, schema);

    // Score a candidate list, rank by score then name, and dedupe. Returns the
    // full ranked candidate set (pre-slice) so it can seed the narrowing cache.
    const rankCandidates = (candidates: IndexedCompletionTable[]): IndexedCompletionTable[] => {
      const scored: Array<{ table: IndexedCompletionTable; score: number }> = [];
      for (const table of candidates) {
        const score = tableMatchScore(table, normalized, preferredSchemaLower);
        if (score >= 0) scored.push({ table, score });
      }
      scored.sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name));
      return dedupeCompletionTables(scored.map((entry) => entry.table));
    };

    // Fast path: when the new filter extends the previous one and that result was
    // not truncated, every still-matching candidate is a subset of the cached set,
    // so we re-score only those instead of rescanning the entire index.
    const cached = tableNarrowCache.get(scopeKey);
    if (cached && !cached.truncated && cached.filter && normalized.startsWith(cached.filter)) {
      const narrowed = rankCandidates(cached.candidates);
      tableNarrowCache.set(scopeKey, { filter: normalized, candidates: narrowed, truncated: false });
      return narrowed.slice(0, cap);
    }

    // Cold path: single-pass scan over the connection/database scopes, preferred
    // schema first (matching the previous ordering before sort).
    const scopePrefix = `${connectionId}:${database}:`;
    const preferred = schema ? completionTableIndex.get(scopeKey) : undefined;
    const all: IndexedCompletionTable[] = [];
    if (preferred) all.push(...preferred.tables);
    for (const [key, entry] of completionTableIndex) {
      if (entry === preferred || !key.startsWith(scopePrefix)) continue;
      all.push(...entry.tables);
    }
    const ranked = rankCandidates(all);
    tableNarrowCache.set(scopeKey, {
      filter: normalized,
      candidates: ranked,
      truncated: ranked.length > cap,
    });
    return ranked.slice(0, cap);
  }

  function lookupLocalCompletionObjects(
    connectionId: string,
    database: string,
    filter = "",
    limit?: number,
    schema?: string,
  ): SqlCompletionObject[] {
    const normalized = filter.trim().toLowerCase();
    const preferredSchemaLower = schema?.toLowerCase();
    const scopePrefix = `${connectionId}:${database}:`;
    const preferred = schema
      ? completionObjectIndex.get(completionScopeKey(connectionId, database, schema))
      : undefined;
    const scored: Array<{ object: IndexedCompletionObject; score: number }> = [];
    const visit = (entry?: { objects: IndexedCompletionObject[] }) => {
      if (!entry) return;
      for (const object of entry.objects) {
        const score = objectMatchScore(object, normalized, preferredSchemaLower);
        if (score >= 0) scored.push({ object, score });
      }
    };
    if (preferred) visit(preferred);
    for (const [key, entry] of completionObjectIndex) {
      if (entry === preferred || !key.startsWith(scopePrefix)) continue;
      visit(entry);
    }
    scored.sort((a, b) => b.score - a.score || a.object.name.localeCompare(b.object.name));
    return dedupeCompletionObjects(scored.map((entry) => entry.object)).slice(0, limit ?? 200);
  }

  function lookupLocalCompletionSchemas(connectionId: string, database: string, filter = "", limit = 50): string[] {
    const schemas = schemaListCache.value[`${connectionId}:${database}`] ?? [];
    const normalized = filter.trim().toLowerCase();
    return schemas
      .filter((schema) => fuzzyTextMatch(schema, normalized))
      .sort((a, b) => tableMatchScore({ name: b }, normalized) - tableMatchScore({ name: a }, normalized))
      .slice(0, limit);
  }

  function lookupLocalCompletionColumns(
    connectionId: string,
    database: string,
    table: string,
    schema?: string,
  ): SqlCompletionColumn[] {
    return completionColumnIndex.get(completionColumnsKey(connectionId, database, table, schema))?.columns ?? [];
  }

  async function listCompletionSchemas(connectionId: string, database: string): Promise<string[]> {
    const cacheKey = `${connectionId}:${database}`;
    if (schemaListCache.value[cacheKey]) {
      return schemaListCache.value[cacheKey];
    }
    return withCompletionInFlight(`${cacheKey}:schemas`, async () => {
      const schemas = await api.listSchemas(connectionId, database);
      schemaListCache.value[cacheKey] = schemas;
      return schemas;
    });
  }

  async function listElasticsearchCompletionIndices(connectionId: string, database: string): Promise<string[]> {
    const cacheKey = `${connectionId}:${database}`;
    if (elasticsearchCompletionIndicesCache.value[cacheKey]) {
      return elasticsearchCompletionIndicesCache.value[cacheKey];
    }
    await ensureConnected(connectionId);
    const indices = await api.mongoListCollections(connectionId, database);
    elasticsearchCompletionIndicesCache.value[cacheKey] = indices;
    evictOldestCacheEntries(elasticsearchCompletionIndicesCache.value, COMPLETION_CACHE_MAX);
    return elasticsearchCompletionIndicesCache.value[cacheKey];
  }

  /**
   * Bulk completion metadata for schema-aware databases (B1): one
   * `list_completion_metadata` invoke returns tables + routines for every
   * schema, cached per (connection, database). Falls back to repeating the
   * per-schema calls when the bulk invoke fails, so engines/drivers without
   * bulk support behave exactly as before.
   */
  async function loadCompletionMetadataGroups(
    connectionId: string,
    database: string,
  ): Promise<SchemaCompletionGroup[]> {
    const cacheKey = `${connectionId}:${database}`;
    if (completionMetadataCache.value[cacheKey]) {
      return completionMetadataCache.value[cacheKey];
    }
    return withCompletionInFlight(`${cacheKey}:metadata`, async () => {
      const cached = completionMetadataCache.value[cacheKey];
      if (cached) return cached;
      await ensureConnected(connectionId);
      const schemas = await listCompletionSchemas(connectionId, database);
      let groups: SchemaCompletionGroup[] = [];
      try {
        groups = await api.listCompletionMetadata(connectionId, database, schemas);
      } catch {
        groups = [];
      }
      if (groups.length === 0 && schemas.length > 0) {
        groups = await Promise.all(
          schemas.map(async (schema) => {
            try {
              const [tables, objects] = await Promise.all([
                api.listTables(connectionId, database, schema),
                api.listCompletionObjects(connectionId, database, schema),
              ]);
              return { schema, tables, objects };
            } catch {
              return { schema, tables: [], objects: [] };
            }
          }),
        );
      }
      completionMetadataCache.value[cacheKey] = groups;
      evictOldestCacheEntries(completionMetadataCache.value, COMPLETION_CACHE_MAX);
      return groups;
    });
  }

  /**
   * Unfiltered (schema, capped) table listing for completion (B2), cached per
   * scope. The cache key never contains the typed filter, so one entry serves
   * every keystroke. Schema-aware databases without a pinned schema read the
   * bulk metadata (B1) — a complete listing, never truncated. Anything else is
   * a single unfiltered `list_tables` call capped at the expanded limit
   * (`expandedCompletionLimit`, the same bound the relaxed retry uses);
   * `truncated` marks that matches may exist beyond that cap.
   */
  async function loadCompletionTablesSuperset(
    connectionId: string,
    database: string,
    schema: string | undefined,
    limit: number | undefined,
  ): Promise<{ tables: SqlCompletionTable[]; truncated: boolean }> {
    const supersetLimit = expandedCompletionLimit(limit);
    const cacheKey = `${connectionId}:${database}:${schema ?? ""}:${supersetLimit ?? ""}`;
    const cached = completionTablesSupersetCache.value[cacheKey];
    if (cached) return cached;
    return withCompletionInFlight(`${cacheKey}:superset`, async () => {
      const cached = completionTablesSupersetCache.value[cacheKey];
      if (cached) return cached;
      await ensureConnected(connectionId);
      const schemaAware = isSchemaAwareDatabase(connectionId);
      let tables: SqlCompletionTable[];
      let truncated: boolean;
      if (schemaAware && !schema) {
        const groups = await loadCompletionMetadataGroups(connectionId, database);
        tables = groups.flatMap((group) =>
          group.tables.map((table) => ({
            name: table.name,
            schema: group.schema,
            type: table.table_type === "VIEW" ? ("view" as const) : ("table" as const),
          })),
        );
        // The bulk metadata is the complete listing — never truncated, no
        // matter how it compares to the cap.
        truncated = false;
      } else {
        // Schema-aware listings take the pinned schema; single-database
        // engines always list under the database itself (as before).
        const scope = schemaAware && schema ? schema : database;
        const listed = await api.listTables(connectionId, database, scope, undefined, supersetLimit);
        tables = listed.map((table) => {
          const mapped: SqlCompletionTable = {
            name: table.name,
            type: table.table_type === "VIEW" ? ("view" as const) : ("table" as const),
          };
          if (schemaAware) mapped.schema = scope;
          return mapped;
        });
        truncated = supersetLimit != null && tables.length >= supersetLimit;
      }
      const superset = { tables, truncated };
      completionTablesSupersetCache.value[cacheKey] = superset;
      indexCompletionTables(connectionId, database, schema, superset.tables);
      evictOldestCacheEntries(completionTablesSupersetCache.value, COMPLETION_CACHE_MAX);
      return superset;
    });
  }

  /**
   * Client-side mirror of the backend's table filtering (`filter_table_infos`):
   * case-insensitive `contains` on the name, listing order preserved, cap
   * applied last; a zero-match strict filter retries with the relaxed
   * two-character filter exactly like the server round-trip did.
   */
  function filterCompletionTablesFromSuperset(
    superset: SqlCompletionTable[],
    normalizedFilter: string,
    relaxedFilter: string | undefined,
    limit: number | undefined,
    dedupe: boolean,
  ): SqlCompletionTable[] {
    let tables = normalizedFilter
      ? superset.filter((table) => table.name.toLowerCase().includes(normalizedFilter))
      : superset;
    if (tables.length === 0 && relaxedFilter) {
      tables = superset.filter((table) => table.name.toLowerCase().includes(relaxedFilter));
    }
    if (!limit) return tables;
    if (dedupe) tables = dedupeCompletionTables(tables);
    return tables.slice(0, limit);
  }

  /**
   * Server-side filtered listing, repeated only when the cached superset was
   * capped at `limit` and a filter is typed (B2): matches may live beyond the
   * cap, so only the backend can produce the exact top-N. Same per-path
   * semantics as before (schema-aware tables carry their schema and dedupe;
   * single-database engines return the raw listing).
   */
  async function listFilteredCompletionTablesFromServer(
    connectionId: string,
    database: string,
    schema: string | undefined,
    normalizedFilter: string,
    relaxedFilter: string | undefined,
    limit: number | undefined,
  ): Promise<SqlCompletionTable[]> {
    await ensureConnected(connectionId);
    const schemaAware = isSchemaAwareDatabase(connectionId);
    const scope = schemaAware && schema ? schema : database;
    const toCompletionTables = (tables: Awaited<ReturnType<typeof api.listTables>>) =>
      tables.map((table) => {
        const mapped: SqlCompletionTable = {
          name: table.name,
          type: table.table_type === "VIEW" ? ("view" as const) : ("table" as const),
        };
        if (schemaAware) mapped.schema = scope;
        return mapped;
      });
    let results = toCompletionTables(await api.listTables(connectionId, database, scope, normalizedFilter, limit));
    if (results.length === 0 && relaxedFilter) {
      results = toCompletionTables(
        await api.listTables(connectionId, database, scope, relaxedFilter, expandedCompletionLimit(limit)),
      );
    }
    indexCompletionTables(connectionId, database, schema, results);
    if (limit) {
      const deduped = schemaAware ? dedupeCompletionTables(results) : results;
      return deduped.slice(0, limit);
    }
    return results;
  }

  /**
   * Completion table listing (B2): one cached unfiltered (schema, capped)
   * superset per scope, filtered and capped client-side with the backend's
   * exact semantics. Only a capped superset with a typed filter — matches may
   * exist beyond the cap — repeats a server-side filtered listing.
   */
  async function listCompletionTables(
    connectionId: string,
    database: string,
    filter = "",
    limit?: number,
    schema?: string,
  ): Promise<SqlCompletionTable[]> {
    const normalizedFilter = filter.trim().toLowerCase();
    const relaxedFilter = relaxedCompletionTableFilter(normalizedFilter);
    const superset = await loadCompletionTablesSuperset(connectionId, database, schema, limit);

    // Complete superset (or no typed filter): the client-side contains filter
    // over the listing equals the backend's filtered + capped result, so
    // keystrokes never re-invoke.
    if (!superset.truncated || !normalizedFilter) {
      return filterCompletionTablesFromSuperset(
        superset.tables,
        normalizedFilter,
        relaxedFilter,
        limit,
        isSchemaAwareDatabase(connectionId),
      );
    }

    const filteredKey = `${connectionId}:${database}:${schema ?? ""}:${limit ?? ""}:${normalizedFilter}:filtered`;
    const cachedFiltered = completionFilteredTablesCache.get(filteredKey);
    if (cachedFiltered) {
      // LRU touch: re-insert as the newest entry.
      completionFilteredTablesCache.delete(filteredKey);
      completionFilteredTablesCache.set(filteredKey, cachedFiltered);
      return cachedFiltered;
    }
    return withCompletionInFlight(filteredKey, async () => {
      const generation = completionCacheInvalidation.value?.seq;
      const tables = await listFilteredCompletionTablesFromServer(
        connectionId,
        database,
        schema,
        normalizedFilter,
        relaxedFilter,
        limit,
      );
      // An invalidation while the listing was in flight makes it stale.
      if (completionCacheInvalidation.value?.seq !== generation) return tables;
      completionFilteredTablesCache.set(filteredKey, tables);
      while (completionFilteredTablesCache.size > COMPLETION_FILTERED_TABLES_MAX) {
        const oldest = completionFilteredTablesCache.keys().next().value;
        if (oldest === undefined) break;
        completionFilteredTablesCache.delete(oldest);
      }
      return tables;
    });
  }

  function relaxedCompletionTableFilter(filter: string): string | undefined {
    if (filter.length < 3) return undefined;
    return filter.slice(0, 2);
  }

  function expandedCompletionLimit(limit?: number): number | undefined {
    if (!limit) return limit;
    return Math.min(Math.max(limit * 3, limit), 1000);
  }

  function dedupeCompletionTables<T extends SqlCompletionTable>(tables: T[]): T[] {
    const seen = new Set<string>();
    const deduped: T[] = [];
    for (const table of tables) {
      const key = `${table.schema ?? ""}.${table.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(table);
    }
    return deduped;
  }

  async function listCompletionObjects(
    connectionId: string,
    database: string,
    filter = "",
    limit?: number,
    schema?: string,
  ): Promise<SqlCompletionObject[]> {
    const normalizedFilter = filter.trim().toLowerCase();
    const cacheKey = `${connectionId}:${database}:${schema ?? ""}`;
    if (!completionObjectsCache.value[cacheKey]) {
      await withCompletionInFlight(`${cacheKey}:objects`, async () => {
        await ensureConnected(connectionId);
        const objects = isSchemaAwareDatabase(connectionId)
          ? await listSchemaAwareCompletionObjects(connectionId, database, schema)
          : await api.listCompletionObjects(connectionId, database, schema || database);
        completionObjectsCache.value[cacheKey] = dedupeCompletionObjects(
          objects.map(toSqlCompletionObject).filter((object): object is SqlCompletionObject => object != null),
        );
        indexCompletionObjects(connectionId, database, schema, completionObjectsCache.value[cacheKey]);
        evictOldestCacheEntries(completionObjectsCache.value, COMPLETION_CACHE_MAX);
      });
    }

    const objects = completionObjectsCache.value[cacheKey];
    const filtered = normalizedFilter
      ? objects.filter((object) => fuzzyCompletionObjectMatch(object, normalizedFilter))
      : objects;
    return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
  }

  async function listSchemaAwareCompletionObjects(
    connectionId: string,
    database: string,
    schema?: string,
  ): Promise<ObjectInfo[]> {
    // Explicit schema: keep the single per-schema call (already one invoke).
    if (schema) {
      try {
        return await api.listCompletionObjects(connectionId, database, schema);
      } catch {
        return [];
      }
    }
    // No explicit schema: one bulk invoke for every schema (B1) instead of one
    // `listCompletionObjects` call per schema; the bulk loader owns the
    // per-schema fallback.
    const groups = await loadCompletionMetadataGroups(connectionId, database);
    return groups.flatMap((group) => group.objects);
  }

  function toSqlCompletionObject(object: ObjectInfo): SqlCompletionObject | null {
    const objectType = object.object_type.toUpperCase();
    const type = objectType.includes("PROCEDURE")
      ? "procedure"
      : objectType.includes("FUNCTION")
        ? "function"
        : objectType.includes("TRIGGER")
          ? "trigger"
          : null;
    if (!type) return null;
    return {
      name: object.name,
      schema: object.schema ?? undefined,
      type,
      parentSchema: object.parent_schema ?? undefined,
      parentName: object.parent_name ?? undefined,
    };
  }

  function fuzzyCompletionObjectMatch(object: SqlCompletionObject, filter: string): boolean {
    return fuzzyTextMatch(object.name, filter) || (!!object.schema && fuzzyTextMatch(object.schema, filter));
  }

  function fuzzyTextMatch(value: string, filter: string): boolean {
    if (!filter) return true;
    const text = value.toLowerCase();
    if (text.includes(filter)) return true;
    let index = 0;
    for (const ch of filter) {
      index = text.indexOf(ch, index);
      if (index < 0) return false;
      index++;
    }
    return true;
  }

  function dedupeCompletionObjects<T extends SqlCompletionObject>(objects: T[]): T[] {
    const seen = new Set<string>();
    const deduped: T[] = [];
    for (const object of objects) {
      const key = `${object.type}:${object.schema ?? ""}:${object.name}:${object.parentName ?? ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(object);
    }
    return deduped;
  }

  async function listCompletionColumns(
    connectionId: string,
    database: string,
    table: string,
    schema?: string,
  ): Promise<SqlCompletionColumn[]> {
    if (
      isSchemaAwareDatabase(connectionId) &&
      !connectionUsesDatabaseObjectTreeMode(getConfig(connectionId)) &&
      !schema
    ) {
      return [];
    }
    const cacheKey = `${connectionId}:${database}:${schema || ""}:${table}`;
    if (!completionColumnsCache.value[cacheKey]) {
      await withCompletionInFlight(`${cacheKey}:columns`, async () => {
        await ensureConnected(connectionId);
        const querySchema = metadataQuerySchema(connectionId, database, schema);
        completionColumnsCache.value[cacheKey] = await api.getColumns(connectionId, database, querySchema, table);
        evictOldestCacheEntries(completionColumnsCache.value, COMPLETION_CACHE_MAX);
      });
    }

    const columns = completionColumnsCache.value[cacheKey].map((column) => ({
      name: column.name,
      table,
      schema,
      dataType: column.data_type,
      isNullable: column.is_nullable,
      comment: column.comment,
    }));
    indexCompletionColumns(connectionId, database, table, schema, columns);
    return columns;
  }

  function refreshCompletionTables(
    connectionId: string,
    database: string,
    filter = "",
    limit?: number,
    schema?: string,
  ): Promise<SqlCompletionTable[]> {
    return listCompletionTables(connectionId, database, filter, limit, schema);
  }

  function refreshCompletionObjects(
    connectionId: string,
    database: string,
    filter = "",
    limit?: number,
    schema?: string,
  ): Promise<SqlCompletionObject[]> {
    return listCompletionObjects(connectionId, database, filter, limit, schema);
  }

  function refreshCompletionSchemas(connectionId: string, database: string): Promise<string[]> {
    return listCompletionSchemas(connectionId, database);
  }

  function refreshCompletionColumns(
    connectionId: string,
    database: string,
    table: string,
    schema?: string,
  ): Promise<SqlCompletionColumn[]> {
    return listCompletionColumns(connectionId, database, table, schema);
  }

  function findNode(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  async function persistConnections(nextConnections: ConnectionConfig[] = connections.value) {
    if (connectionsLoadFailed) {
      throw new Error(
        "Saved connections failed to load; not saving so they are not overwritten. Restart DBX to retry.",
      );
    }
    await api.saveConnections(nextConnections);
  }

  function persistSidebarLayoutDebounced() {
    if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
    layoutPersistTimer = setTimeout(() => {
      api.saveSidebarLayout(sidebarLayout.value).catch(() => {});
      layoutPersistTimer = null;
    }, 300);
  }

  function rebuildTreeNodes() {
    const existingNodesMap = new Map<string, TreeNode>();
    const collectExisting = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        existingNodesMap.set(node.id, node);
        if (node.children) collectExisting(node.children);
      }
    };
    collectExisting(treeNodes.value);

    const freshNodes = buildTreeNodesFromLayout(sidebarLayout.value, connections.value, pinnedTreeNodeIds.value);
    const mergeState = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((node) => {
        const existing = existingNodesMap.get(node.id);
        if (node.type === "connection-group") {
          return { ...node, children: mergeState(node.children || []) };
        }
        if (existing && node.type === "connection") {
          // Rebuilds produce a fresh instance carrying over the previous state.
          // That is safe here because loader mutations are committed by id —
          // a finalizer clearing `isLoading` applies to whichever instance is
          // currently in the tree, not to a captured reference.
          return {
            ...existing,
            label: node.label,
            pinned: node.pinned,
            children: withSavedSqlRoot(node.connectionId!, existing.children || [], existing),
          };
        }
        if (node.type === "connection" && node.connectionId) {
          return { ...node, children: withSavedSqlRoot(node.connectionId, node.children || []) };
        }
        return node;
      });
    treeNodes.value = mergeState(freshNodes);
  }

  function updateLayoutAndRebuild(nextLayout: SidebarLayout) {
    sidebarLayout.value = nextLayout;
    rebuildTreeNodes();
    persistSidebarLayoutDebounced();
  }

  async function refreshAllTree() {
    const expandedIds = collectExpandedNodeIds(treeNodes.value);
    const refreshExpandedNodes = async (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "connection-group") {
          if (node.children) await refreshExpandedNodes(node.children);
          continue;
        }
        if (!expandedIds.has(node.id)) continue;
        if (node.connectionId && !connectedIds.value.has(node.connectionId)) continue;
        clearLoadedChildrenCache(node.id);
        commitTreeNode(node, (draft) => {
          draft.children = [];
        });
        await loadTreeNodeChildren(node, { force: true });
        const fresh = findNode(treeNodes.value, node.id);
        if (fresh) await restoreExpandedChildren(fresh, expandedIds, { force: true });
      }
    };
    await refreshExpandedNodes(treeNodes.value);
  }

  async function exportConnectionsToFile(passphrase: string) {
    const { encryptConfig } = await import("@/lib/configCrypto");
    const exportData = { connections: connections.value, layout: sidebarLayout.value };
    const json = JSON.stringify(exportData);
    const payload = await encryptConfig(json, passphrase);
    const content = JSON.stringify(payload, null, 2);

    if (isTauriRuntime()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: "dbx-connections.json",
      });
      if (!path) return;
      await writeTextFile(path, content);
    } else {
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dbx-connections.json";
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function siblingCredentialsPath(path: string) {
    const fileName = path.split(/[\\/]/).pop() || "";
    const credentialsFile = fileName.startsWith("data-sources-")
      ? fileName.replace(/^data-sources/, "credentials-config")
      : "credentials-config.json";
    return path.replace(/[^\\/]+$/, credentialsFile);
  }

  async function readDbeaverImportFile(): Promise<{ content: string; encrypted: boolean } | null> {
    let dataSources: string;
    let credentialsBase64 = "";

    if (isTauriRuntime()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile, readFile } = await import("@tauri-apps/plugin-fs");
      const path = await open({
        filters: [{ name: "DBeaver Data Sources", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return null;
      const dataSourcesPath = path as string;
      dataSources = await readTextFile(dataSourcesPath);
      try {
        credentialsBase64 = bytesToBase64(await readFile(siblingCredentialsPath(dataSourcesPath)));
      } catch {
        credentialsBase64 = "";
      }
    } else {
      const files = await new Promise<FileList>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.multiple = true;
        input.onchange = () => {
          if (!input.files?.length) {
            reject(new Error("No file selected"));
            return;
          }
          resolve(input.files);
        };
        input.click();
      });
      const fileList = Array.from(files);
      const dataSourcesFile =
        fileList.find((file) => /^data-sources.*\.json$/i.test(file.name)) ||
        fileList.find((file) => !/^credentials-config.*\.json$/i.test(file.name));
      const credentialsFile = fileList.find((file) => /^credentials-config.*\.json$/i.test(file.name));
      if (!dataSourcesFile) throw new Error("Select DBeaver data-sources.json");
      dataSources = await dataSourcesFile.text();
      if (credentialsFile) {
        credentialsBase64 = bytesToBase64(new Uint8Array(await credentialsFile.arrayBuffer()));
      }
    }

    return {
      content: JSON.stringify({ format: "dbeaver-import", dataSources, credentialsBase64 }),
      encrypted: false,
    };
  }

  async function readImportFile(source: ImportSource = "dbx"): Promise<{ content: string; encrypted: boolean } | null> {
    if (source === "dbeaver") return readDbeaverImportFile();

    let content: string;

    if (isTauriRuntime()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const path = await open({
        filters:
          source === "navicat"
            ? [{ name: "Navicat Connection Export", extensions: ["ncx", "xml"] }]
            : [{ name: "DBX JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (!path) return null;
      content = await readTextFile(path as string);
    } else {
      content = await new Promise<string>((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = source === "navicat" ? ".ncx,.xml" : ".json";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            reject(new Error("No file selected"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsText(file);
        };
        input.click();
      });
    }

    if (content.trimStart().startsWith("<")) {
      return { content, encrypted: false };
    }

    const { isEncryptedConfig } = await import("@/lib/configCrypto");
    const parsed = JSON.parse(content);
    return { content, encrypted: isEncryptedConfig(parsed) };
  }

  async function importConnectionsFromFile(
    content: string,
    passphrase: string | null,
  ): Promise<{ count: number; layout?: SidebarLayout }> {
    let imported: ConnectionConfig[] = [];
    let importedLayout: SidebarLayout | undefined;

    if (!passphrase && content.trimStart().startsWith("<")) {
      const { parseNavicatConnections } = await import("@/lib/navicatImport");
      imported = await parseNavicatConnections(content);
    } else if (!passphrase) {
      const { isDbeaverImportPayload, parseDbeaverConnections } = await import("@/lib/dbeaverImport");
      if (isDbeaverImportPayload(content)) {
        imported = await parseDbeaverConnections(content);
      } else {
        const parsed = JSON.parse(content);

        if (Array.isArray(parsed)) {
          imported = parsed;
        } else if (parsed.format === "dbx-config" && Array.isArray(parsed.connections)) {
          imported = parsed.connections;
        } else if (parsed.connections && Array.isArray(parsed.connections)) {
          imported = parsed.connections;
          if (parsed.layout?.groups && parsed.layout?.order) {
            importedLayout = parsed.layout;
          }
        } else {
          imported = [];
        }
      }
    } else {
      const parsed = JSON.parse(content);

      if (passphrase) {
        const { decryptConfig } = await import("@/lib/configCrypto");
        const json = await decryptConfig(parsed, passphrase);
        const decrypted = JSON.parse(json);
        if (Array.isArray(decrypted)) {
          imported = decrypted;
        } else if (decrypted.connections) {
          imported = decrypted.connections;
          if (decrypted.layout?.groups && decrypted.layout?.order) {
            importedLayout = decrypted.layout;
          }
        } else {
          imported = [];
        }
      }
    }

    let count = 0;
    for (const config of imported) {
      const duplicate = connections.value.find(
        (c) => c.name === config.name && c.host === config.host && c.port === config.port,
      );
      if (!duplicate) {
        config.id = uuid();
        const normalized = normalizeConnection(config);
        await addConnection(normalized);
        count++;
      }
    }
    return { count, layout: importedLayout };
  }

  function applySidebarLayout(layout: SidebarLayout) {
    const reconciledLayout = reconcileLayout(
      connections.value.map((c) => c.id),
      layout,
    );
    updateLayoutAndRebuild(reconciledLayout);
  }

  async function initFromDisk() {
    if (!initFromDiskPromise) {
      connectionsLoading.value = true;
      initFromDiskPromise = (async () => {
        // The three disk reads are independent — fetch them concurrently so
        // startup waits on the slowest, not on their sum. loadPinnedTreeNodeIds
        // self-catches its IPC, and a failed (e.g. corrupt) sidebar layout
        // degrades to the default layout (reconcileLayout accepts null): the
        // layout is cosmetic, while dropping the connections over it would
        // leave `connections` empty and the next save would wipe every stored
        // connection. Only a loadConnections failure propagates (App.vue
        // toasts connection.loadFailed); it then blocks saves until a later
        // load succeeds (see persistConnections).
        // Assignments keep the original order: reconcileLayout needs the
        // loaded connections, and rebuildTreeNodes needs both.
        const [pinnedIds, saved, savedLayout] = await Promise.all([
          loadPinnedTreeNodeIds(),
          api.loadConnections().catch((error: unknown) => {
            connectionsLoadFailed = true;
            throw error;
          }),
          api.loadSidebarLayout().catch((error: unknown) => {
            console.warn("Failed to load the sidebar layout; falling back to the default layout", error);
            return null;
          }),
        ]);
        connectionsLoadFailed = false;
        pinnedTreeNodeIds.value = pinnedIds;
        connections.value = saved.map(normalizeConnection);
        sidebarLayout.value = reconcileLayout(
          connections.value.map((c) => c.id),
          savedLayout,
        );
        rebuildTreeNodes();
      })().finally(() => {
        connectionsLoading.value = false;
        initFromDiskPromise = null;
      });
    }
    await initFromDiskPromise;
  }

  function addEphemeralConnection(config: ConnectionConfig) {
    const normalized = normalizeConnection(config);
    if (!connections.value.find((c) => c.id === normalized.id)) {
      connections.value.push(normalized);
    }
    connectedIds.value.add(normalized.id);
    clearConnectionError(normalized.id);
  }

  return {
    connections,
    connectionsLoading,
    activeConnectionId,
    selectedTreeNodeId,
    selectedTreeNodeIds,
    treeSelectionAnchorId,
    treeClipboard,
    treeNodes,
    setTreeNodeExpanded(node: TreeNode, expanded: boolean) {
      commitTreeNode(node, (draft) => {
        draft.isExpanded = expanded;
      });
    },
    resetTreeNodeChildren(node: TreeNode) {
      commitTreeNode(node, (draft) => {
        draft.isExpanded = false;
        draft.children = [];
      });
    },
    expandTreeNodes(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (!node.isExpanded) {
          commitTreeNode(node, (draft) => {
            draft.isExpanded = true;
          });
        }
      }
    },
    removeTreeNode,
    refreshAllTree,
    refreshSavedSqlTree,
    refreshTreeNode,
    refreshDatabaseTreeNode,
    refreshObjectListTreeNode,
    connectedIds,
    connectionLastUsedAt,
    recordConnectionUsed,
    connectionErrors,
    setConnectionError,
    clearConnectionError,
    recordConnectionError,
    sidebarLayout,
    getConfig,
    isTreeNodePinned,
    toggleTreeNodePin,
    addConnection,
    addEphemeralConnection,
    updateConnection,
    setDefaultDatabase,
    clearDefaultDatabase,
    isDefaultDatabase,
    setVisibleDatabases,
    clearVisibleDatabases,
    removeConnection,
    removeConnections,
    editingConnectionId,
    newConnectionGroupId,
    startEditing,
    stopEditing,
    startCreatingConnectionInGroup,
    stopCreatingConnectionInGroup,
    connect,
    cancelTreeNodeLoading,
    disconnect,
    closeDatabaseConnection,
    ensureConnected,
    isTreeNodeChildrenLoaded,
    initFromDisk,
    loadDatabases,
    loadRedisDatabases,
    loadEtcdRoot,
    updateRedisDbKeyStats,
    loadMongoDatabases,
    loadMongoCollections,
    loadSchemas,
    loadSqlServerDatabaseObjects,
    loadTables,
    loadObjectGroupChildren,
    loadTableGroups,
    loadColumns,
    loadIndexes,
    loadForeignKeys,
    loadTriggers,
    listCompletionTables,
    listCompletionObjects,
    listCompletionColumns,
    listCompletionSchemas,
    lookupLocalCompletionTables,
    lookupLocalCompletionObjects,
    lookupLocalCompletionColumns,
    lookupLocalCompletionSchemas,
    refreshCompletionTables,
    refreshCompletionObjects,
    refreshCompletionColumns,
    refreshCompletionSchemas,
    invalidateCompletionCache,
    completionCacheInvalidation,
    listElasticsearchCompletionIndices,
    exportConnectionsToFile,
    readImportFile,
    importConnectionsFromFile,
    applySidebarLayout,
    transferSource,
    createTableSource,
    schemaDiffSource,
    dataCompareSource,
    sqlFileSource,
    diagramSource,
    tableImportSource,
    fieldLineageSource,
    databaseSearchSource,
    databaseExportSource,
    createConnectionGroup(name: string) {
      const result = createGroupOp(sidebarLayout.value, name);
      updateLayoutAndRebuild(result.layout);
      return result.groupId;
    },
    renameConnectionGroup(groupId: string, name: string) {
      updateLayoutAndRebuild(renameGroupOp(sidebarLayout.value, groupId, name));
    },
    deleteConnectionGroup(groupId: string) {
      updateLayoutAndRebuild(deleteGroupOp(sidebarLayout.value, groupId));
    },
    toggleConnectionGroupCollapsed(groupId: string) {
      updateLayoutAndRebuild(toggleGroupCollapsedOp(sidebarLayout.value, groupId));
    },
    moveConnectionToGroup(connectionId: string, groupId: string | null) {
      updateLayoutAndRebuild(moveConnectionToGroupOp(sidebarLayout.value, connectionId, groupId));
    },
    reorderSidebarEntry(draggedId: string, targetId: string, position: DropPosition) {
      updateLayoutAndRebuild(reorderEntryOp(sidebarLayout.value, draggedId, targetId, position));
    },
    reorderSidebarEntries(draggedIds: string[], targetId: string, position: DropPosition) {
      // Apply each dragged entry in turn so a multi-selection moves together,
      // not just the single grabbed row (issue #681).
      let layout = sidebarLayout.value;
      let changed = false;
      for (const id of draggedIds) {
        if (id === targetId) continue;
        layout = reorderEntryOp(layout, id, targetId, position);
        changed = true;
      }
      if (changed) updateLayoutAndRebuild(layout);
    },
  };
});
