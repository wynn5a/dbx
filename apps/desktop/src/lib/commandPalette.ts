/**
 * Command palette action registry (framework-free).
 *
 * Built-ins are plain data; the palette UI (CommandPalette.vue) renders them
 * and App.vue supplies the CommandPaletteContext that gives `run` access to
 * app-level capabilities (opening dialogs, panels, settings). Keeping the
 * registry free of Vue/pinia imports lets packages/app-tests drive it with an
 * injected stub context.
 *
 * Extending the palette is one line: `registerCommand({ id, labelKey,
 * categoryKey, run })`.
 *
 * Commands that mirror a keyboard shortcut carry its `shortcutId` so the
 * palette shows the user's current binding, and an optional `enabled`
 * predicate mirrors the toolbar's disable rules so the palette never runs an
 * action the rest of the shell refuses in the same state.
 */

import {
  formatShortcut,
  normalizeShortcutSettings,
  type ShortcutActionId,
  type ShortcutSettings,
} from "@/lib/shortcutRegistry";

export interface CommandPaletteContext {
  /** At least one saved connection exists (toolbar: New Query / Transfer / Diff / Compare). */
  hasConnections(): boolean;
  /** A saved connection can run SQL files (toolbar: Execute SQL File). */
  hasSqlFileConnections(): boolean;
  /** The active tab is a query tab with SQL to format. */
  canFormatSql(): boolean;
  /** There is at least one open tab to switch to. */
  hasTabs(): boolean;
  /** The active tab shows a result grid that can be refreshed. */
  canRefreshData(): boolean;
  newQuery(): void;
  newConnection(): void;
  openTransfer(): void;
  openSchemaDiff(): void;
  openDataCompare(): void;
  openDriverStore(): void;
  openSqlLibrary(): void;
  openSqlFile(): void;
  toggleQueryHistory(): void;
  toggleAiAssistant(): void;
  openSettings(): void;
  formatSql(): void;
  toggleSidebar(): void;
  nextTab(): void;
  prevTab(): void;
  refreshData(): void;
}

export type CommandIconName =
  | "terminal"
  | "database"
  | "transfer"
  | "diff"
  | "compare"
  | "package"
  | "folder"
  | "fileCode"
  | "history"
  | "bot"
  | "settings"
  | "format"
  | "sidebar"
  | "next"
  | "prev"
  | "refresh";

export interface CommandDefinition {
  /** Unique command id; also matched by the search filter. */
  id: string;
  /** i18n key of the display label, resolved through the injected translate. */
  labelKey: string;
  /** i18n key of the category shown next to the label. */
  categoryKey: string;
  /** Optional icon name resolved by the palette UI. */
  icon?: CommandIconName;
  /** Shortcut-registry action this command mirrors; its current binding is shown as a key hint. */
  shortcutId?: ShortcutActionId;
  /** Whether the command can run in the current state; omitted means always enabled. */
  enabled?(context: CommandPaletteContext): boolean;
  /** Runs against the context injected by App.vue. */
  run(context: CommandPaletteContext): void;
}

export const COMMAND_CATEGORY_WORKSPACE = "commandPalette.categoryWorkspace";
export const COMMAND_CATEGORY_TOOLS = "commandPalette.categoryTools";
export const COMMAND_CATEGORY_DATA = "commandPalette.categoryData";
export const COMMAND_CATEGORY_VIEW = "commandPalette.categoryView";

export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  {
    id: "newQuery",
    labelKey: "commandPalette.newQuery",
    categoryKey: COMMAND_CATEGORY_WORKSPACE,
    icon: "terminal",
    shortcutId: "newQuery",
    enabled: (context) => context.hasConnections(),
    run: (context) => context.newQuery(),
  },
  {
    id: "newConnection",
    labelKey: "commandPalette.newConnection",
    categoryKey: COMMAND_CATEGORY_WORKSPACE,
    icon: "database",
    shortcutId: "newConnection",
    run: (context) => context.newConnection(),
  },
  {
    id: "openSqlFile",
    labelKey: "commandPalette.openSqlFile",
    categoryKey: COMMAND_CATEGORY_WORKSPACE,
    icon: "fileCode",
    enabled: (context) => context.hasSqlFileConnections(),
    run: (context) => context.openSqlFile(),
  },
  {
    id: "dataTransfer",
    labelKey: "commandPalette.dataTransfer",
    categoryKey: COMMAND_CATEGORY_TOOLS,
    icon: "transfer",
    enabled: (context) => context.hasConnections(),
    run: (context) => context.openTransfer(),
  },
  {
    id: "schemaDiff",
    labelKey: "commandPalette.schemaDiff",
    categoryKey: COMMAND_CATEGORY_TOOLS,
    icon: "diff",
    enabled: (context) => context.hasConnections(),
    run: (context) => context.openSchemaDiff(),
  },
  {
    id: "dataCompare",
    labelKey: "commandPalette.dataCompare",
    categoryKey: COMMAND_CATEGORY_TOOLS,
    icon: "compare",
    enabled: (context) => context.hasConnections(),
    run: (context) => context.openDataCompare(),
  },
  {
    id: "driverStore",
    labelKey: "commandPalette.driverStore",
    categoryKey: COMMAND_CATEGORY_DATA,
    icon: "package",
    run: (context) => context.openDriverStore(),
  },
  {
    id: "sqlLibrary",
    labelKey: "commandPalette.sqlLibrary",
    categoryKey: COMMAND_CATEGORY_DATA,
    icon: "folder",
    run: (context) => context.openSqlLibrary(),
  },
  {
    id: "queryHistory",
    labelKey: "commandPalette.queryHistory",
    categoryKey: COMMAND_CATEGORY_VIEW,
    icon: "history",
    run: (context) => context.toggleQueryHistory(),
  },
  {
    id: "aiAssistant",
    labelKey: "commandPalette.aiAssistant",
    categoryKey: COMMAND_CATEGORY_VIEW,
    icon: "bot",
    run: (context) => context.toggleAiAssistant(),
  },
  {
    id: "openSettings",
    labelKey: "commandPalette.openSettings",
    categoryKey: COMMAND_CATEGORY_VIEW,
    icon: "settings",
    shortcutId: "openSettings",
    run: (context) => context.openSettings(),
  },
  {
    id: "formatSql",
    labelKey: "settings.shortcutFormatSql",
    categoryKey: COMMAND_CATEGORY_WORKSPACE,
    icon: "format",
    shortcutId: "formatSql",
    enabled: (context) => context.canFormatSql(),
    run: (context) => context.formatSql(),
  },
  {
    id: "refreshData",
    labelKey: "settings.shortcutRefreshData",
    categoryKey: COMMAND_CATEGORY_DATA,
    icon: "refresh",
    shortcutId: "refreshData",
    enabled: (context) => context.canRefreshData(),
    run: (context) => context.refreshData(),
  },
  {
    id: "toggleSidebar",
    labelKey: "settings.shortcutToggleSidebar",
    categoryKey: COMMAND_CATEGORY_VIEW,
    icon: "sidebar",
    shortcutId: "toggleSidebar",
    run: (context) => context.toggleSidebar(),
  },
  {
    id: "nextTab",
    labelKey: "settings.shortcutNextTab",
    categoryKey: COMMAND_CATEGORY_VIEW,
    icon: "next",
    shortcutId: "nextTab",
    enabled: (context) => context.hasTabs(),
    run: (context) => context.nextTab(),
  },
  {
    id: "prevTab",
    labelKey: "settings.shortcutPrevTab",
    categoryKey: COMMAND_CATEGORY_VIEW,
    icon: "prev",
    shortcutId: "prevTab",
    enabled: (context) => context.hasTabs(),
    run: (context) => context.prevTab(),
  },
];

/** Registers one more palette command; the one-line extension point. */
export function registerCommand(definition: CommandDefinition): void {
  COMMAND_DEFINITIONS.push(definition);
}

/** Whether a command may run right now (no predicate = always enabled). */
export function isCommandEnabled(command: CommandDefinition, context: CommandPaletteContext): boolean {
  return command.enabled ? command.enabled(context) : true;
}

/**
 * Runs a command only when it is enabled; returns whether it ran, so the UI
 * keeps the palette open (and does nothing) on a disabled row.
 */
export function runPaletteCommand(command: CommandDefinition, context: CommandPaletteContext): boolean {
  if (!isCommandEnabled(command, context)) return false;
  command.run(context);
  return true;
}

/**
 * Display text of the user's current binding for a command's shortcut, via
 * the same formatter as the settings page; null when the command has none.
 */
export function commandShortcutHint(
  command: CommandDefinition,
  shortcuts?: Partial<ShortcutSettings>,
  platform?: string,
): string | null {
  if (!command.shortcutId) return null;
  const binding = normalizeShortcutSettings(shortcuts)[command.shortcutId];
  return binding ? formatShortcut(binding, platform) : null;
}

/**
 * Selectors for an open modal surface (shadcn-vue dialog / sheet content or a
 * reka alert dialog). Popovers also carry role="dialog", so match the modal
 * data-slot rather than the role.
 */
const OPEN_MODAL_SELECTOR = [
  '[data-slot="dialog-content"][data-state="open"]',
  '[data-slot="sheet-content"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(", ");

export function isModalDialogOpen(root: Pick<ParentNode, "querySelector"> | null | undefined): boolean {
  return !!root?.querySelector(OPEN_MODAL_SELECTOR);
}

export type CommandPaletteToggle = "open" | "close" | "ignore";

/**
 * Mod+K decision: close an open palette (it is a dialog itself, so this check
 * comes first), and otherwise refuse to stack the palette over another modal.
 */
export function resolveCommandPaletteToggle(paletteOpen: boolean, otherModalOpen: boolean): CommandPaletteToggle {
  if (paletteOpen) return "close";
  return otherModalOpen ? "ignore" : "open";
}

export type CommandTranslate = (key: string) => string;

/**
 * Case-insensitive substring filter over the translated label, category and
 * the raw id. An empty/whitespace query keeps every command, in registry
 * order (Array.filter is stable, so the panel never reorders).
 */
export function filterCommands(
  commands: CommandDefinition[],
  query: string,
  translate: CommandTranslate,
): CommandDefinition[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...commands];
  return commands.filter((command) => {
    if (command.id.toLowerCase().includes(needle)) return true;
    if (translate(command.labelKey).toLowerCase().includes(needle)) return true;
    return translate(command.categoryKey).toLowerCase().includes(needle);
  });
}

/**
 * Next/prev selection with wrap-around in both directions; -1 for an empty
 * list (the "no results" state).
 */
export function movePaletteSelection(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  return (((current + delta) % length) + length) % length;
}

/** Keeps a selection valid when the filtered list shrinks or grows; -1 when empty. */
export function clampPaletteSelection(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  return Math.min(index, length - 1);
}
