<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DsDialog } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import LightDropdown from "@/components/ui/LightDropdown.vue";
import CustomContextMenu, { type ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import DatabaseIcon from "@/components/icons/DatabaseIcon.vue";
import { connectionIconType } from "@/lib/connectionPresentation";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { useSavedSqlStore } from "@/stores/savedSqlStore";
import { useToast } from "@/composables/useToast";
import type { SavedSqlFile, SavedSqlFolder } from "@/types/database";

const props = defineProps<{
  open: boolean;
  bodyHeight: number;
}>();

const emit = defineEmits<{
  toggle: [];
  startResize: [event: MouseEvent];
}>();

const { t } = useI18n();
const connectionStore = useConnectionStore();
const queryStore = useQueryStore();
const savedSqlStore = useSavedSqlStore();
const { toast } = useToast();

interface FolderGroup {
  folder: SavedSqlFolder;
  files: SavedSqlFile[];
}

interface ConnectionGroup {
  id: string;
  name: string;
  iconType: string;
  rootFiles: SavedSqlFile[];
  folders: FolderGroup[];
  count: number;
}

// Connections that have at least one saved folder or file, grouped for display.
// Reads savedSqlStore.version so it recomputes after any CRUD mutation.
const groups = computed<ConnectionGroup[]>(() => {
  void savedSqlStore.version;
  const result: ConnectionGroup[] = [];
  for (const connection of connectionStore.connections) {
    const rootFiles = savedSqlStore.listFiles(connection.id);
    const folders = savedSqlStore
      .listFolders(connection.id)
      .map((folder) => ({ folder, files: savedSqlStore.listFiles(connection.id, folder.id) }));
    const count = rootFiles.length + folders.reduce((sum, group) => sum + group.files.length, 0);
    if (rootFiles.length === 0 && folders.length === 0) continue;
    result.push({
      id: connection.id,
      name: connection.name,
      iconType: connectionIconType(connection),
      rootFiles,
      folders,
      count,
    });
  }
  return result;
});

// Connections expand by default; folders collapse by default.
const collapsedConnections = ref<Set<string>>(new Set());
const expandedFolders = ref<Set<string>>(new Set());

function isConnectionOpen(id: string) {
  return !collapsedConnections.value.has(id);
}

function toggleConnection(id: string) {
  const next = new Set(collapsedConnections.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedConnections.value = next;
}

function isFolderOpen(id: string) {
  return expandedFolders.value.has(id);
}

function toggleFolder(id: string) {
  const next = new Set(expandedFolders.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedFolders.value = next;
}

function openFile(file: SavedSqlFile) {
  queryStore.openSavedSql(file);
  connectionStore.activeConnectionId = file.connectionId;
}

function ensureSqlExtension(name: string) {
  return /\.sql$/i.test(name) ? name : `${name}.sql`;
}

function defaultDatabase(connectionId: string) {
  return connectionStore.getConfig(connectionId)?.database ?? "";
}

// ---- Name dialog (create folder / create file / rename folder / rename file) ----

type NameMode = "folder-create" | "file-create" | "folder-rename" | "file-rename";

const nameDialogOpen = ref(false);
const nameMode = ref<NameMode>("folder-create");
const nameInput = ref("");
const nameTarget = ref<{ connectionId: string; folderId?: string; id?: string }>({ connectionId: "" });
// When true (header "add"), the dialog leads with a connection picker; context-menu
// adds keep their fixed connection and hide it.
const connectionPickerVisible = ref(false);

const nameDialogTitle = computed(() => {
  switch (nameMode.value) {
    case "folder-create":
      return t("savedSql.newFolder");
    case "file-create":
      return t("savedSql.newFile");
    case "folder-rename":
      return t("savedSql.renameFolder");
    default:
      return t("savedSql.renameFile");
  }
});

const nameDialogIcon = computed(() => {
  switch (nameMode.value) {
    case "folder-create":
      return FolderPlus;
    case "file-create":
      return FilePlus;
    default:
      return Pencil;
  }
});

const nameDialogConfirmLabel = computed(() =>
  nameMode.value === "folder-create" || nameMode.value === "file-create" ? t("common.create") : t("common.rename"),
);

function openNameDialog(
  mode: NameMode,
  target: { connectionId: string; folderId?: string; id?: string },
  initial: string,
  opts?: { pickConnection?: boolean },
) {
  nameMode.value = mode;
  nameTarget.value = target;
  nameInput.value = initial;
  connectionPickerVisible.value = opts?.pickConnection ?? false;
  nameDialogOpen.value = true;
}

async function confirmName() {
  const name = nameInput.value.trim();
  const target = nameTarget.value;
  if (!name || !target.connectionId) return;
  try {
    if (nameMode.value === "folder-create") {
      await savedSqlStore.createFolder(target.connectionId, name);
    } else if (nameMode.value === "file-create") {
      const saved = await savedSqlStore.saveFile({
        connectionId: target.connectionId,
        folderId: target.folderId,
        name: ensureSqlExtension(name),
        database: defaultDatabase(target.connectionId),
        sql: "",
      });
      openFile(saved);
    } else if (nameMode.value === "folder-rename" && target.id) {
      await savedSqlStore.renameFolder(target.id, name);
    } else if (nameMode.value === "file-rename" && target.id) {
      await savedSqlStore.renameFile(target.id, ensureSqlExtension(name));
    }
    connectionStore.refreshSavedSqlTree(target.connectionId);
    nameDialogOpen.value = false;
  } catch (e: any) {
    toast(t("savedSql.saveFailed", { message: e?.message || String(e) }), 5000);
  }
}

// ---- Delete confirm dialog ----

const deleteDialogOpen = ref(false);
const deleteMode = ref<"file" | "folder">("file");
const deleteTarget = ref<{ id: string; connectionId: string; label: string }>({ id: "", connectionId: "", label: "" });

function openDeleteDialog(mode: "file" | "folder", target: { id: string; connectionId: string; label: string }) {
  deleteMode.value = mode;
  deleteTarget.value = target;
  deleteDialogOpen.value = true;
}

async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target.id) return;
  try {
    if (deleteMode.value === "file") {
      await savedSqlStore.deleteFile(target.id);
    } else {
      await savedSqlStore.deleteFolder(target.id);
    }
    connectionStore.refreshSavedSqlTree(target.connectionId);
    deleteDialogOpen.value = false;
  } catch (e: any) {
    toast(t("savedSql.saveFailed", { message: e?.message || String(e) }), 5000);
  }
}

// ---- Add actions ----

const addItems = computed(() => [
  { value: "folder", label: t("savedSql.newFolder"), icon: FolderPlus },
  { value: "file", label: t("savedSql.newFile"), icon: FilePlus },
]);

// Resolve which connection a header "add" applies to: the active connection,
// otherwise the only connection if there is exactly one.
function resolveAddConnectionId(): string | undefined {
  const active = connectionStore.activeConnectionId;
  if (active && connectionStore.connections.some((connection) => connection.id === active)) return active;
  if (connectionStore.connections.length === 1) return connectionStore.connections[0]!.id;
  return undefined;
}

function onHeaderAdd(value: string) {
  if (connectionStore.connections.length === 0) {
    toast(t("savedSql.selectConnectionFirst"), 4000);
    return;
  }
  // Lead with a connection picker, pre-selecting the active (or only) connection.
  const connectionId = resolveAddConnectionId() ?? connectionStore.connections[0]!.id;
  if (value === "folder") {
    openNameDialog("folder-create", { connectionId }, t("savedSql.newFolderDefault"), { pickConnection: true });
  } else {
    openNameDialog("file-create", { connectionId }, t("savedSql.newFileDefault"), { pickConnection: true });
  }
}

// ---- Context menus ----

function connectionMenuItems(group: ConnectionGroup): ContextMenuItem[] {
  return [
    {
      label: t("savedSql.newFolder"),
      icon: FolderPlus,
      action: () => openNameDialog("folder-create", { connectionId: group.id }, t("savedSql.newFolderDefault")),
    },
    {
      label: t("savedSql.newFile"),
      icon: FilePlus,
      action: () => openNameDialog("file-create", { connectionId: group.id }, t("savedSql.newFileDefault")),
    },
  ];
}

function folderMenuItems(connectionId: string, folder: SavedSqlFolder): ContextMenuItem[] {
  return [
    {
      label: t("savedSql.newFile"),
      icon: FilePlus,
      action: () => openNameDialog("file-create", { connectionId, folderId: folder.id }, t("savedSql.newFileDefault")),
    },
    {
      label: t("savedSql.renameFolder"),
      icon: Pencil,
      action: () => openNameDialog("folder-rename", { connectionId, id: folder.id }, folder.name),
    },
    {
      label: t("savedSql.deleteFolder"),
      icon: Trash2,
      variant: "destructive",
      action: () => openDeleteDialog("folder", { id: folder.id, connectionId, label: folder.name }),
    },
  ];
}

function fileMenuItems(file: SavedSqlFile): ContextMenuItem[] {
  return [
    { label: t("savedSql.open"), icon: FileCode, action: () => openFile(file) },
    {
      label: t("savedSql.renameFile"),
      icon: Pencil,
      action: () =>
        openNameDialog(
          "file-rename",
          { connectionId: file.connectionId, id: file.id },
          file.name.replace(/\.sql$/i, ""),
        ),
    },
    {
      label: t("savedSql.deleteFile"),
      icon: Trash2,
      variant: "destructive",
      action: () => openDeleteDialog("file", { id: file.id, connectionId: file.connectionId, label: file.name }),
    },
  ];
}
</script>

<template>
  <div class="flex flex-col overflow-hidden border-t border-[var(--ds-border)]">
    <!-- Resize handle (drag to resize the body height) -->
    <div v-if="open" class="sql-library-resize" @mousedown="emit('startResize', $event)" />

    <!-- Section header -->
    <div class="sql-library-header flex items-center gap-0.5 px-3 h-9 cursor-pointer" @click="emit('toggle')">
      <ChevronDown
        class="size-3.5 shrink-0 text-[var(--ds-text-3)] transition-transform"
        :class="{ '-rotate-90': !open }"
      />
      <span class="sidebar-section-label ml-1 flex-1 truncate">{{ t("sidebar.sqlLibrary") }}</span>
      <span class="inline-flex" @click.stop>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-flex">
              <LightDropdown
                model-value=""
                :items="addItems"
                :aria-label="t('savedSql.add')"
                :trigger-icon="Plus"
                trigger-class="inline-flex size-6 items-center justify-center rounded-sm text-[var(--ds-text-3)] outline-none transition-colors duration-[var(--ds-speed)] hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)] focus-visible:ring-0"
                trigger-icon-class="size-3.5"
                content-class="w-44"
                :show-trigger-label="false"
                :show-chevron="false"
                :highlight-selected="false"
                check-position="none"
                align="end"
                @update:model-value="onHeaderAdd"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ t("savedSql.add") }}</TooltipContent>
        </Tooltip>
      </span>
    </div>

    <!-- Section body -->
    <div v-if="open" class="overflow-y-auto overflow-x-hidden px-1 py-1" :style="{ height: bodyHeight + 'px' }">
      <div
        v-if="groups.length === 0"
        class="flex h-full items-center justify-center px-3 text-center text-xs text-[var(--ds-text-4)]"
      >
        {{ t("savedSql.empty") }}
      </div>

      <template v-for="group in groups" :key="group.id">
        <!-- Connection group row -->
        <CustomContextMenu :items="connectionMenuItems(group)" v-slot="{ onContextMenu }">
          <div
            class="sql-row group/row"
            style="padding-left: 6px"
            @click="toggleConnection(group.id)"
            @contextmenu="onContextMenu"
          >
            <component
              :is="isConnectionOpen(group.id) ? ChevronDown : ChevronRight"
              class="size-3.5 shrink-0 text-[var(--ds-text-3)]"
            />
            <DatabaseIcon :db-type="group.iconType" class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate font-medium text-[var(--ds-text-1)]">{{ group.name }}</span>
            <span class="sql-row-actions shrink-0">
              <button
                class="sql-row-action"
                :title="t('savedSql.newFolder')"
                @click.stop="
                  openNameDialog('folder-create', { connectionId: group.id }, t('savedSql.newFolderDefault'))
                "
              >
                <FolderPlus class="size-3.5" />
              </button>
              <button
                class="sql-row-action"
                :title="t('savedSql.newFile')"
                @click.stop="openNameDialog('file-create', { connectionId: group.id }, t('savedSql.newFileDefault'))"
              >
                <FilePlus class="size-3.5" />
              </button>
            </span>
            <span class="sql-row-count shrink-0 text-[11px] tabular-nums text-[var(--ds-text-4)]">{{
              group.count
            }}</span>
          </div>
        </CustomContextMenu>

        <template v-if="isConnectionOpen(group.id)">
          <!-- Folders -->
          <template v-for="folderGroup in group.folders" :key="folderGroup.folder.id">
            <CustomContextMenu :items="folderMenuItems(group.id, folderGroup.folder)" v-slot="{ onContextMenu }">
              <div
                class="sql-row group/row"
                style="padding-left: 22px"
                @click="toggleFolder(folderGroup.folder.id)"
                @contextmenu="onContextMenu"
              >
                <component
                  :is="isFolderOpen(folderGroup.folder.id) ? ChevronDown : ChevronRight"
                  class="size-3.5 shrink-0 text-[var(--ds-text-3)]"
                />
                <component
                  :is="isFolderOpen(folderGroup.folder.id) ? FolderOpen : Folder"
                  class="size-3.5 shrink-0 text-[var(--ds-amber,var(--ds-text-3))]"
                />
                <span class="min-w-0 flex-1 truncate">{{ folderGroup.folder.name }}</span>
                <span class="sql-row-actions shrink-0">
                  <button
                    class="sql-row-action"
                    :title="t('savedSql.newFile')"
                    @click.stop="
                      openNameDialog(
                        'file-create',
                        { connectionId: group.id, folderId: folderGroup.folder.id },
                        t('savedSql.newFileDefault'),
                      )
                    "
                  >
                    <FilePlus class="size-3.5" />
                  </button>
                  <button
                    class="sql-row-action"
                    :title="t('savedSql.renameFolder')"
                    @click.stop="
                      openNameDialog(
                        'folder-rename',
                        { connectionId: group.id, id: folderGroup.folder.id },
                        folderGroup.folder.name,
                      )
                    "
                  >
                    <Pencil class="size-3.5" />
                  </button>
                  <button
                    class="sql-row-action sql-row-action--danger"
                    :title="t('savedSql.deleteFolder')"
                    @click.stop="
                      openDeleteDialog('folder', {
                        id: folderGroup.folder.id,
                        connectionId: group.id,
                        label: folderGroup.folder.name,
                      })
                    "
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                </span>
              </div>
            </CustomContextMenu>

            <template v-if="isFolderOpen(folderGroup.folder.id)">
              <CustomContextMenu
                v-for="file in folderGroup.files"
                :key="file.id"
                :items="fileMenuItems(file)"
                v-slot="{ onContextMenu }"
              >
                <div
                  class="sql-row group/row"
                  style="padding-left: 44px"
                  @click="openFile(file)"
                  @dblclick="openFile(file)"
                  @contextmenu="onContextMenu"
                >
                  <FileCode class="size-3.5 shrink-0 text-[var(--ds-text-3)]" />
                  <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
                  <span class="sql-row-actions shrink-0">
                    <button
                      class="sql-row-action"
                      :title="t('savedSql.renameFile')"
                      @click.stop="
                        openNameDialog(
                          'file-rename',
                          { connectionId: file.connectionId, id: file.id },
                          file.name.replace(/\.sql$/i, ''),
                        )
                      "
                    >
                      <Pencil class="size-3.5" />
                    </button>
                    <button
                      class="sql-row-action sql-row-action--danger"
                      :title="t('savedSql.deleteFile')"
                      @click.stop="
                        openDeleteDialog('file', { id: file.id, connectionId: file.connectionId, label: file.name })
                      "
                    >
                      <Trash2 class="size-3.5" />
                    </button>
                  </span>
                </div>
              </CustomContextMenu>
            </template>
          </template>

          <!-- Root-level files -->
          <CustomContextMenu
            v-for="file in group.rootFiles"
            :key="file.id"
            :items="fileMenuItems(file)"
            v-slot="{ onContextMenu }"
          >
            <div
              class="sql-row group/row"
              style="padding-left: 28px"
              @click="openFile(file)"
              @dblclick="openFile(file)"
              @contextmenu="onContextMenu"
            >
              <FileCode class="size-3.5 shrink-0 text-[var(--ds-text-3)]" />
              <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
              <span class="sql-row-actions shrink-0">
                <button
                  class="sql-row-action"
                  :title="t('savedSql.renameFile')"
                  @click.stop="
                    openNameDialog(
                      'file-rename',
                      { connectionId: file.connectionId, id: file.id },
                      file.name.replace(/\.sql$/i, ''),
                    )
                  "
                >
                  <Pencil class="size-3.5" />
                </button>
                <button
                  class="sql-row-action sql-row-action--danger"
                  :title="t('savedSql.deleteFile')"
                  @click.stop="
                    openDeleteDialog('file', { id: file.id, connectionId: file.connectionId, label: file.name })
                  "
                >
                  <Trash2 class="size-3.5" />
                </button>
              </span>
            </div>
          </CustomContextMenu>
        </template>
      </template>
    </div>
  </div>

  <!-- Name dialog -->
  <DsDialog v-model:open="nameDialogOpen" :title="nameDialogTitle" :icon="nameDialogIcon">
    <div class="space-y-3">
      <div v-if="connectionPickerVisible" class="space-y-1.5">
        <label class="text-xs font-medium text-[var(--ds-text-3)]">{{ t("savedSql.connection") }}</label>
        <Select v-model="nameTarget.connectionId">
          <SelectTrigger class="h-8 w-full">
            <SelectValue :placeholder="t('editor.selectConnection')" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem v-for="connection in connectionStore.connections" :key="connection.id" :value="connection.id">
              <span class="flex min-w-0 items-center gap-2">
                <DatabaseIcon :db-type="connectionIconType(connection)" class="size-3.5 shrink-0" />
                <span class="truncate">{{ connection.name }}</span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Input v-model="nameInput" @keydown.enter.prevent="confirmName" />
    </div>
    <template #footer>
      <Button variant="outline" @click="nameDialogOpen = false">{{ t("common.cancel") }}</Button>
      <Button
        :disabled="!nameInput.trim() || (connectionPickerVisible && !nameTarget.connectionId)"
        @click="confirmName"
      >
        {{ nameDialogConfirmLabel }}
      </Button>
    </template>
  </DsDialog>

  <!-- Delete confirm -->
  <DsDialog
    v-model:open="deleteDialogOpen"
    :title="deleteMode === 'file' ? t('savedSql.deleteFile') : t('savedSql.deleteFolder')"
    :icon="Trash2"
  >
    <p class="text-sm text-[var(--ds-text-2)]">
      {{
        deleteMode === "file"
          ? t("savedSql.deleteFileConfirm", { name: deleteTarget.label })
          : t("savedSql.deleteFolderConfirm", { name: deleteTarget.label })
      }}
    </p>
    <template #footer>
      <Button variant="outline" @click="deleteDialogOpen = false">{{ t("common.cancel") }}</Button>
      <Button variant="destructive" @click="confirmDelete">
        {{ deleteMode === "file" ? t("savedSql.deleteFile") : t("savedSql.deleteFolder") }}
      </Button>
    </template>
  </DsDialog>
</template>

<style scoped>
.sql-library-header {
  color: var(--ds-text-3);
}

.sidebar-section-label {
  font-family: var(--ds-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.sql-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 26px;
  padding-right: 6px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 18px;
  color: var(--ds-text-2);
  cursor: default;
  user-select: none;
}

.sql-row:hover {
  background: var(--ds-bg-active);
}

.sql-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--ds-speed) var(--ds-ease);
}

.sql-row:hover .sql-row-actions {
  opacity: 1;
}

/* Hide the trailing count once the action icons appear, to avoid crowding. */
.sql-row:hover .sql-row-count {
  display: none;
}

.sql-row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--ds-text-3);
  transition:
    color var(--ds-speed) var(--ds-ease),
    background-color var(--ds-speed) var(--ds-ease);
}

.sql-row-action:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-1);
}

.sql-row-action--danger:hover {
  color: var(--ds-red);
}

.sql-library-resize {
  height: 6px;
  cursor: row-resize;
  flex-shrink: 0;
}
</style>
