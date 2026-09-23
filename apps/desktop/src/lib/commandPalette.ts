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
 */

export interface CommandPaletteContext {
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
  | "settings";

export interface CommandDefinition {
  /** Unique command id; also matched by the search filter. */
  id: string;
  /** i18n key of the display label, resolved through the injected translate. */
  labelKey: string;
  /** i18n key of the category shown next to the label. */
  categoryKey: string;
  /** Optional icon name resolved by the palette UI. */
  icon?: CommandIconName;
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
    run: (context) => context.newQuery(),
  },
  {
    id: "newConnection",
    labelKey: "commandPalette.newConnection",
    categoryKey: COMMAND_CATEGORY_WORKSPACE,
    icon: "database",
    run: (context) => context.newConnection(),
  },
  {
    id: "openSqlFile",
    labelKey: "commandPalette.openSqlFile",
    categoryKey: COMMAND_CATEGORY_WORKSPACE,
    icon: "fileCode",
    run: (context) => context.openSqlFile(),
  },
  {
    id: "dataTransfer",
    labelKey: "commandPalette.dataTransfer",
    categoryKey: COMMAND_CATEGORY_TOOLS,
    icon: "transfer",
    run: (context) => context.openTransfer(),
  },
  {
    id: "schemaDiff",
    labelKey: "commandPalette.schemaDiff",
    categoryKey: COMMAND_CATEGORY_TOOLS,
    icon: "diff",
    run: (context) => context.openSchemaDiff(),
  },
  {
    id: "dataCompare",
    labelKey: "commandPalette.dataCompare",
    categoryKey: COMMAND_CATEGORY_TOOLS,
    icon: "compare",
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
    run: (context) => context.openSettings(),
  },
];

/** Registers one more palette command; the one-line extension point. */
export function registerCommand(definition: CommandDefinition): void {
  COMMAND_DEFINITIONS.push(definition);
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
