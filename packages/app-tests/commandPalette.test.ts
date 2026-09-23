import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  COMMAND_DEFINITIONS,
  clampPaletteSelection,
  commandShortcutHint,
  filterCommands,
  isCommandEnabled,
  isModalDialogOpen,
  movePaletteSelection,
  registerCommand,
  resolveCommandPaletteToggle,
  runPaletteCommand,
  type CommandPaletteContext,
} from "../../apps/desktop/src/lib/commandPalette.ts";
import { SHORTCUT_DEFINITIONS } from "../../apps/desktop/src/lib/shortcutRegistry.ts";
import en from "../../apps/desktop/src/i18n/locales/en.ts";
import es from "../../apps/desktop/src/i18n/locales/es.ts";
import it from "../../apps/desktop/src/i18n/locales/it.ts";
import ptBR from "../../apps/desktop/src/i18n/locales/pt-BR.ts";
import zhCN from "../../apps/desktop/src/i18n/locales/zh-CN.ts";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.ts";

const LOCALES: Record<string, any> = { en, es, it, "pt-BR": ptBR, "zh-CN": zhCN, "zh-TW": zhTW };

// Resolves palette keys against the English messages so the filter tests run
// against real labels rather than a hand-written stub.
function enTranslate(key: string): string {
  const [section, name] = key.split(".");
  const value = (en as any)[section]?.[name];
  return typeof value === "string" ? value : key;
}

function commandsByIds(ids: string[]) {
  return ids.map((id) => {
    const command = COMMAND_DEFINITIONS.find((item) => item.id === id);
    assert.ok(command, `missing command: ${id}`);
    return command;
  });
}

test("built-in manifest covers the plan's actions in registry order", () => {
  assert.deepEqual(
    COMMAND_DEFINITIONS.map((command) => command.id),
    [
      "newQuery",
      "newConnection",
      "openSqlFile",
      "dataTransfer",
      "schemaDiff",
      "dataCompare",
      "driverStore",
      "sqlLibrary",
      "queryHistory",
      "aiAssistant",
      "openSettings",
      "formatSql",
      "refreshData",
      "toggleSidebar",
      "nextTab",
      "prevTab",
    ],
  );
});

test("filterCommands keeps every command in registry order for an empty query", () => {
  assert.deepEqual(
    filterCommands(COMMAND_DEFINITIONS, "", enTranslate).map((command) => command.id),
    COMMAND_DEFINITIONS.map((command) => command.id),
  );
});

test("filterCommands treats a whitespace-only query like an empty one", () => {
  assert.deepEqual(
    filterCommands(COMMAND_DEFINITIONS, "   \t\n ", enTranslate).map((command) => command.id),
    COMMAND_DEFINITIONS.map((command) => command.id),
  );
});

test("filterCommands matches labels case-insensitively as substrings", () => {
  assert.deepEqual(
    filterCommands(COMMAND_DEFINITIONS, "new que", enTranslate).map((command) => command.id),
    ["newQuery"],
  );
  assert.deepEqual(
    filterCommands(COMMAND_DEFINITIONS, "DRIVER MANAGER", enTranslate).map((command) => command.id),
    ["driverStore"],
  );
});

test("filterCommands matches the category label too", () => {
  assert.deepEqual(
    filterCommands(COMMAND_DEFINITIONS, "tools", enTranslate).map((command) => command.id),
    ["dataTransfer", "schemaDiff", "dataCompare"],
  );
});

test("filterCommands falls back to the raw command id", () => {
  // "driverstore" is only in the id — the English label is "Driver Manager".
  assert.deepEqual(
    filterCommands(COMMAND_DEFINITIONS, "driverstore", enTranslate).map((command) => command.id),
    ["driverStore"],
  );
});

test("filterCommands returns nothing for a query no field contains", () => {
  assert.deepEqual(filterCommands(COMMAND_DEFINITIONS, "zzz-not-a-command", enTranslate), []);
});

test("movePaletteSelection wraps in both directions and reports -1 on an empty list", () => {
  assert.equal(movePaletteSelection(0, 1, 3), 1);
  assert.equal(movePaletteSelection(2, 1, 3), 0);
  assert.equal(movePaletteSelection(0, -1, 3), 2);
  assert.equal(movePaletteSelection(1, -1, 3), 0);
  assert.equal(movePaletteSelection(0, 1, 1), 0);
  assert.equal(movePaletteSelection(0, -1, 1), 0);
  assert.equal(movePaletteSelection(4, 1, 0), -1);
  assert.equal(movePaletteSelection(4, -1, 0), -1);
});

test("clampPaletteSelection keeps the selection inside the filtered list", () => {
  assert.equal(clampPaletteSelection(0, 0), -1);
  assert.equal(clampPaletteSelection(3, 0), -1);
  assert.equal(clampPaletteSelection(-1, 3), 0);
  assert.equal(clampPaletteSelection(1, 3), 1);
  assert.equal(clampPaletteSelection(2, 3), 2);
  assert.equal(clampPaletteSelection(9, 3), 2);
});

test("registerCommand is a one-line extension point and is filterable", () => {
  const before = COMMAND_DEFINITIONS.length;
  registerCommand({
    id: "testOnlyPaletteCommand",
    labelKey: "commandPalette.openSettings",
    categoryKey: "commandPalette.categoryView",
    run: () => {},
  });
  try {
    assert.equal(COMMAND_DEFINITIONS.length, before + 1);
    assert.deepEqual(
      filterCommands(COMMAND_DEFINITIONS, "testonlypalettecommand", enTranslate).map((command) => command.id),
      ["testOnlyPaletteCommand"],
    );
  } finally {
    // The registry is a shared mutable array; remove the test command so the
    // rest of the suite always sees only the built-ins.
    const index = COMMAND_DEFINITIONS.findIndex((command) => command.id === "testOnlyPaletteCommand");
    if (index >= 0) COMMAND_DEFINITIONS.splice(index, 1);
  }
  assert.equal(COMMAND_DEFINITIONS.length, before);
});

const PREDICATES = ["hasConnections", "hasSqlFileConnections", "canFormatSql", "hasTabs", "canRefreshData"] as const;
type PredicateName = (typeof PREDICATES)[number];

function recordingContext(state: Partial<Record<PredicateName, boolean>> = {}): {
  context: CommandPaletteContext;
  calls: string[];
} {
  const calls: string[] = [];
  const context: Record<string, () => unknown> = {};
  for (const name of PREDICATES) context[name] = () => state[name] ?? true;
  for (const name of [
    "newQuery",
    "newConnection",
    "openTransfer",
    "openSchemaDiff",
    "openDataCompare",
    "openDriverStore",
    "openSqlLibrary",
    "openSqlFile",
    "toggleQueryHistory",
    "toggleAiAssistant",
    "openSettings",
    "formatSql",
    "toggleSidebar",
    "nextTab",
    "prevTab",
    "refreshData",
  ]) {
    context[name] = () => calls.push(name);
  }
  return { context: context as unknown as CommandPaletteContext, calls };
}

test("each built-in command runs against exactly one context capability", () => {
  const expected: Record<string, string> = {
    newQuery: "newQuery",
    newConnection: "newConnection",
    openSqlFile: "openSqlFile",
    dataTransfer: "openTransfer",
    schemaDiff: "openSchemaDiff",
    dataCompare: "openDataCompare",
    driverStore: "openDriverStore",
    sqlLibrary: "openSqlLibrary",
    queryHistory: "toggleQueryHistory",
    aiAssistant: "toggleAiAssistant",
    openSettings: "openSettings",
    formatSql: "formatSql",
    refreshData: "refreshData",
    toggleSidebar: "toggleSidebar",
    nextTab: "nextTab",
    prevTab: "prevTab",
  };
  assert.deepEqual(Object.keys(expected).sort(), COMMAND_DEFINITIONS.map((command) => command.id).sort());
  for (const command of commandsByIds(Object.keys(expected))) {
    const { context, calls } = recordingContext();
    command.run(context);
    assert.deepEqual(calls, [expected[command.id]], command.id);
  }
});

test("every palette label, category and chrome string exists in all six locales", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    const section = messages.commandPalette;
    assert.ok(section, `locale ${locale} lacks the commandPalette section`);
    for (const key of ["searchPlaceholder", "noResults"]) {
      assert.ok(typeof section[key] === "string" && section[key].length > 0, `commandPalette.${key} in ${locale}`);
    }
    for (const command of COMMAND_DEFINITIONS) {
      for (const key of [command.labelKey, command.categoryKey]) {
        const [sectionName, name] = key.split(".");
        const value = messages[sectionName]?.[name];
        assert.ok(typeof value === "string" && value.length > 0, `${key} in locale ${locale}`);
      }
    }
    const shortcutLabel = messages.settings?.shortcutCommandPalette;
    assert.ok(
      typeof shortcutLabel === "string" && shortcutLabel.length > 0,
      `settings.shortcutCommandPalette in locale ${locale}`,
    );
  }
});

test("with no connections the palette refuses what the toolbar disables", () => {
  const { context, calls } = recordingContext({ hasConnections: false, hasSqlFileConnections: false });
  const disabled = ["newQuery", "openSqlFile", "dataTransfer", "schemaDiff", "dataCompare"];
  for (const command of commandsByIds(disabled)) {
    assert.equal(isCommandEnabled(command, context), false, command.id);
    assert.equal(runPaletteCommand(command, context), false, command.id);
  }
  assert.deepEqual(calls, [], "a disabled command must not reach the context");
  // Actions the toolbar keeps enabled without connections stay runnable.
  for (const command of commandsByIds(["newConnection", "driverStore", "openSettings", "aiAssistant"])) {
    assert.equal(runPaletteCommand(command, context), true, command.id);
  }
  assert.deepEqual(calls, ["newConnection", "openDriverStore", "openSettings", "toggleAiAssistant"]);
});

test("Execute SQL File follows the SQL-file-capable connection rule on its own", () => {
  const [openSqlFile, newQuery] = commandsByIds(["openSqlFile", "newQuery"]);
  const { context } = recordingContext({ hasConnections: true, hasSqlFileConnections: false });
  assert.equal(isCommandEnabled(openSqlFile, context), false);
  assert.equal(isCommandEnabled(newQuery, context), true);
});

test("state-dependent registry actions are gated like their shortcuts", () => {
  const { context, calls } = recordingContext({ canFormatSql: false, hasTabs: false, canRefreshData: false });
  for (const command of commandsByIds(["formatSql", "nextTab", "prevTab", "refreshData"])) {
    assert.equal(runPaletteCommand(command, context), false, command.id);
  }
  assert.deepEqual(calls, []);
  assert.equal(runPaletteCommand(commandsByIds(["toggleSidebar"])[0], context), true);
});

test("palette commands that mirror a shortcut name a real registry action", () => {
  const registry = new Set(SHORTCUT_DEFINITIONS.map((definition) => definition.id));
  const mirrored = COMMAND_DEFINITIONS.filter((command) => command.shortcutId);
  assert.deepEqual(
    mirrored.map((command) => command.id),
    ["newQuery", "newConnection", "openSettings", "formatSql", "refreshData", "toggleSidebar", "nextTab", "prevTab"],
  );
  for (const command of mirrored) assert.ok(registry.has(command.shortcutId!), command.id);
});

test("commandShortcutHint shows the user's binding with the settings formatter", () => {
  const [newQuery, settings, transfer] = commandsByIds(["newQuery", "openSettings", "dataTransfer"]);
  assert.equal(commandShortcutHint(newQuery, undefined, "MacIntel"), "Cmd+T");
  assert.equal(commandShortcutHint(newQuery, undefined, "Win32"), "Ctrl+T");
  assert.equal(commandShortcutHint(newQuery, { newQuery: "Mod+Shift+Q" }, "Win32"), "Ctrl+Shift+Q");
  assert.equal(commandShortcutHint(settings, {}, "MacIntel"), "Cmd+,");
  assert.equal(commandShortcutHint(transfer, undefined, "MacIntel"), null);
});

test("isModalDialogOpen matches open dialog/sheet/alert content but not popovers", () => {
  const seen: string[] = [];
  const root = (match: boolean) => ({
    querySelector: (selector: string) => {
      seen.push(selector);
      return match ? ({} as Element) : null;
    },
  });
  assert.equal(isModalDialogOpen(root(true)), true);
  assert.equal(isModalDialogOpen(root(false)), false);
  assert.equal(isModalDialogOpen(null), false);
  const selector = seen[0];
  assert.ok(selector.includes('[data-slot="dialog-content"][data-state="open"]'));
  assert.ok(selector.includes('[data-slot="sheet-content"][data-state="open"]'));
  assert.ok(selector.includes('[role="alertdialog"][data-state="open"]'));
  assert.ok(
    !/\[role="dialog"\]/.test(selector),
    "popover content also has role=dialog, so the role alone must not match",
  );
});

test("resolveCommandPaletteToggle closes an open palette and never stacks over another modal", () => {
  assert.equal(resolveCommandPaletteToggle(false, false), "open");
  assert.equal(resolveCommandPaletteToggle(false, true), "ignore");
  // The open palette is itself a modal; Mod+K must still close it.
  assert.equal(resolveCommandPaletteToggle(true, true), "close");
  assert.equal(resolveCommandPaletteToggle(true, false), "close");
});

// ---------------------------------------------------------------------------
// Source contracts: the palette wiring lives in plain .vue templates (no mount
// test facility), so it is asserted against the sources — same approach as the
// connectionStoreCancel/shortcutRegistry contract tests.
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("App.vue loads the palette asynchronously and toggles it on the Mod+K binding", () => {
  const source = readSource("../../apps/desktop/src/App.vue");
  assert.match(
    source,
    /const CommandPalette = defineAsyncComponent\(\(\) => import\("@\/components\/layout\/CommandPalette\.vue"\)\)/,
    "the palette must be an async component so it stays out of the startup chunk",
  );
  assert.match(
    source,
    /isCommandPaletteShortcut\(e, shortcuts\)[\s\S]{0,300}resolveCommandPaletteToggle\(showCommandPalette\.value, isModalDialogOpen\(document\)\)/,
    "the keydown path must toggle the palette on the binding, guarded against other modals",
  );
  assert.ok(
    source.includes(
      '<CommandPalette v-if="showCommandPalette" v-model:open="showCommandPalette" :context="commandPaletteContext"',
    ),
    "the template must mount the palette with the shared open flag and context",
  );
});

test("App.vue routes each context capability to the same opener the toolbar uses", () => {
  const source = readSource("../../apps/desktop/src/App.vue");
  const wirings: [string, string][] = [
    ["hasConnections", "hasConnections: () => hasConnections.value"],
    ["hasSqlFileConnections", "hasSqlFileConnections: () => hasSqlFileConnections.value"],
    ["newQuery", "newQuery: () => void newQuery()"],
    ["newConnection", "newConnection: openNewConnection"],
    ["openTransfer", "openTransfer: () => (dialogs.showTransferDialog.value = true)"],
    ["openSchemaDiff", "openSchemaDiff: () => (dialogs.showSchemaDiffDialog.value = true)"],
    ["openDataCompare", "openDataCompare: () => (dialogs.showDataCompareDialog.value = true)"],
    ["openDriverStore", "openDriverStore: () => (showDriverStore.value = true)"],
    ["openSqlLibrary", "appSidebarRef.value?.openSqlLibrary()"],
    ["openSqlFile", "openSqlFile: () => (dialogs.showSqlFileDialog.value = true)"],
    ["toggleQueryHistory", "toggleQueryHistory: () => (showHistory.value = !showHistory.value)"],
    ["toggleAiAssistant", "toggleAiAssistant: toggleAiPanel"],
    ["openSettings", "openSettings: openSettingsDialog"],
    ["formatSql", "formatSql: () => formatActiveSql()"],
    ["toggleSidebar", "  toggleSidebar,\n"],
    ["nextTab", 'nextTab: () => switchTab("next")'],
    ["prevTab", 'prevTab: () => switchTab("prev")'],
    ["refreshData", "refreshData: refreshActiveData"],
  ];
  for (const [name, snippet] of wirings) {
    assert.ok(source.includes(snippet), `context capability ${name} must be wired in App.vue`);
  }
  assert.ok(
    /openSqlLibrary: \(\) => \{[\s\S]{0,120}setSidebarOpen\(true\)/.test(source),
    "must expand the sidebar first",
  );
  // The keydown branches call the same shared handlers as the palette.
  assert.match(source, /isNewConnectionShortcut\(e, shortcuts\)[\s\S]{0,120}openNewConnection\(\)/);
  assert.match(source, /isToggleSidebarShortcut\(e, shortcuts\)[\s\S]{0,120}toggleSidebar\(\)/);
  assert.match(source, /isRefreshDataShortcut\(e, shortcuts\)[\s\S]{0,120}refreshActiveData\(\)/);
  assert.match(
    source,
    /isOpenSettingsShortcut\(e, shortcuts\)[\s\S]{0,200}if \(!isModalDialogOpen\(document\)\) openSettingsDialog\(\)/,
  );
});

test("CommandPalette.vue wires the pure helpers, keyboard navigation and run-to-close", () => {
  const source = readSource("../../apps/desktop/src/components/layout/CommandPalette.vue");
  assert.match(source, /filterCommands\(COMMAND_DEFINITIONS/, "filtering must go through the lib helper");
  assert.match(source, /clampPaletteSelection\(/, "selection must be clamped when the list shrinks");
  assert.match(source, /ArrowDown[\s\S]{0,200}?movePaletteSelection/, "ArrowDown must move the selection");
  assert.match(source, /ArrowUp[\s\S]{0,200}?movePaletteSelection/, "ArrowUp must move the selection");
  assert.match(source, /"Enter"[\s\S]{0,200}?runSelected\(\)/, "Enter must run the selected command");
  assert.match(source, /open\.value = false/, "running a command must close the palette");
  assert.match(
    source,
    /runPaletteCommand\(command, props\.context\)/,
    "commands must run through the enabled-aware helper",
  );
  assert.match(
    source,
    /if \(!enabledFor\(command\)\) return;\s*open\.value = false/,
    "a disabled row must not close or run",
  );
  assert.match(source, /:aria-disabled=/, "disabled rows must be marked for assistive tech");
  assert.match(
    source,
    /commandShortcutHint\(command, settingsStore\.editorSettings\.shortcuts\)/,
    "key hints use the live bindings",
  );
  assert.ok(!/watch\(open/.test(source), "the dead watch(open) must stay removed");
  assert.ok(source.includes("commandPalette.searchPlaceholder"), "the search input must be localized");
  assert.ok(source.includes("commandPalette.noResults"), "the empty state must be localized");
});
