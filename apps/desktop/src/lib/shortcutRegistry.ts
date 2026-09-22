export type ShortcutActionId =
  | "executeSql"
  | "saveSql"
  | "formatSql"
  | "acceptCompletion"
  | "copyCurrentRow"
  | "deleteCurrentRow"
  | "newQuery"
  | "newConnection"
  | "openSettings"
  | "closeTab"
  | "nextTab"
  | "prevTab"
  | "gotoTab1"
  | "gotoTab2"
  | "gotoTab3"
  | "gotoTab4"
  | "gotoTab5"
  | "gotoTab6"
  | "gotoTab7"
  | "gotoTab8"
  | "gotoTab9"
  | "focusSearch"
  | "zoomInUi"
  | "zoomOutUi"
  | "resetUiZoom"
  | "find"
  | "replace"
  | "refreshData"
  | "toggleTranspose"
  | "cancelSearch"
  | "toggleSidebar";

export type ShortcutScope = "global" | "editor" | "grid" | "search";

/** Number of `gotoTabN` bindings; N = 9 follows the browser convention "jump to the last tab". */
export const GOTO_TAB_ACTION_COUNT = 9;

const gotoTabDefinitions: ShortcutDefinition[] = Array.from({ length: GOTO_TAB_ACTION_COUNT }, (_, index) => {
  const position = index + 1;
  if (position === GOTO_TAB_ACTION_COUNT) {
    return {
      id: `gotoTab${position}` as ShortcutActionId,
      labelKey: "settings.shortcutGotoLastTab",
      scope: "global",
      defaultShortcut: `Mod+${position}`,
    };
  }
  return {
    id: `gotoTab${position}` as ShortcutActionId,
    labelKey: "settings.shortcutGotoTabN",
    labelParams: { n: position },
    scope: "global",
    defaultShortcut: `Mod+${position}`,
  };
});

export interface ShortcutDefinition {
  id: ShortcutActionId;
  labelKey: string;
  scope: ShortcutScope;
  defaultShortcut: string;
  /** Named interpolation params for labelKey (vue-i18n named args), e.g. { n: 3 }. */
  labelParams?: Record<string, unknown>;
}

export type ShortcutSettings = Record<ShortcutActionId, string>;

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "executeSql",
    labelKey: "settings.shortcutExecuteSql",
    scope: "editor",
    defaultShortcut: "Mod+Enter",
  },
  {
    id: "saveSql",
    labelKey: "settings.shortcutSaveSql",
    scope: "editor",
    defaultShortcut: "Mod+S",
  },
  {
    id: "formatSql",
    labelKey: "settings.shortcutFormatSql",
    scope: "editor",
    defaultShortcut: "Mod+Shift+F",
  },
  {
    id: "acceptCompletion",
    labelKey: "settings.shortcutAcceptCompletion",
    scope: "editor",
    defaultShortcut: "Tab",
  },
  {
    id: "copyCurrentRow",
    labelKey: "settings.shortcutCopyCurrentRow",
    scope: "grid",
    defaultShortcut: "Mod+D",
  },
  {
    id: "deleteCurrentRow",
    labelKey: "settings.shortcutDeleteCurrentRow",
    scope: "grid",
    defaultShortcut: "Delete",
  },
  {
    id: "newQuery",
    labelKey: "settings.shortcutNewQuery",
    scope: "global",
    defaultShortcut: "Mod+T",
  },
  {
    id: "newConnection",
    labelKey: "settings.shortcutNewConnection",
    scope: "global",
    defaultShortcut: "Mod+N",
  },
  {
    id: "openSettings",
    labelKey: "settings.shortcutOpenSettings",
    scope: "global",
    defaultShortcut: "Mod+,",
  },
  {
    id: "closeTab",
    labelKey: "settings.shortcutCloseTab",
    scope: "global",
    defaultShortcut: "Meta+W",
  },
  {
    id: "nextTab",
    labelKey: "settings.shortcutNextTab",
    scope: "global",
    defaultShortcut: "Mod+Alt+ArrowRight",
  },
  {
    id: "prevTab",
    labelKey: "settings.shortcutPrevTab",
    scope: "global",
    defaultShortcut: "Mod+Alt+ArrowLeft",
  },
  ...gotoTabDefinitions,
  {
    id: "focusSearch",
    labelKey: "settings.shortcutFocusSearch",
    scope: "global",
    defaultShortcut: "Mod+F",
  },
  {
    id: "zoomInUi",
    labelKey: "settings.shortcutZoomInUi",
    scope: "global",
    defaultShortcut: "Mod+=",
  },
  {
    id: "zoomOutUi",
    labelKey: "settings.shortcutZoomOutUi",
    scope: "global",
    defaultShortcut: "Mod+-",
  },
  {
    id: "resetUiZoom",
    labelKey: "settings.shortcutResetUiZoom",
    scope: "global",
    defaultShortcut: "Mod+0",
  },
  {
    id: "find",
    labelKey: "settings.shortcutFind",
    scope: "editor",
    defaultShortcut: "Mod+F",
  },
  {
    id: "replace",
    labelKey: "settings.shortcutReplace",
    scope: "editor",
    defaultShortcut: "Mod+R",
  },
  {
    id: "refreshData",
    labelKey: "settings.shortcutRefreshData",
    scope: "global",
    defaultShortcut: "F5",
  },
  {
    id: "toggleTranspose",
    labelKey: "settings.shortcutToggleTranspose",
    scope: "grid",
    defaultShortcut: "Tab",
  },
  {
    id: "cancelSearch",
    labelKey: "settings.shortcutCancelSearch",
    scope: "search",
    defaultShortcut: "Escape",
  },
  {
    id: "toggleSidebar",
    labelKey: "settings.shortcutToggleSidebar",
    scope: "global",
    defaultShortcut: "Mod+B",
  },
];

export const DEFAULT_SHORTCUT_SETTINGS: ShortcutSettings = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.defaultShortcut]),
) as ShortcutSettings;

export function normalizeShortcutSettings(settings?: Partial<ShortcutSettings>): ShortcutSettings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [
      definition.id,
      typeof settings?.[definition.id] === "string" && settings[definition.id]?.trim()
        ? settings[definition.id]
        : definition.defaultShortcut,
    ]),
  ) as ShortcutSettings;
}

export function shortcutToCodeMirrorKey(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => (part.length === 1 ? part.toLowerCase() : part))
    .join("-");
}

export function formatShortcut(shortcut: string, platform = globalThis.navigator?.platform || ""): string {
  const isMac = platform.toLowerCase().includes("mac");
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "Mod") return isMac ? "Cmd" : "Ctrl";
      if (part === "Meta") return isMac ? "Cmd" : "Meta";
      return part;
    })
    .join("+");
}

export function findShortcutConflict(
  actionId: ShortcutActionId,
  shortcut: string,
  shortcuts: ShortcutSettings,
): ShortcutActionId | null {
  const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === actionId);
  if (!definition) return null;

  const conflict = SHORTCUT_DEFINITIONS.find(
    (item) => item.id !== actionId && item.scope === definition.scope && shortcuts[item.id] === shortcut,
  );
  return conflict?.id ?? null;
}
