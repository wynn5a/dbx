import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  DEFAULT_SHORTCUT_SETTINGS,
  GOTO_TAB_ACTION_COUNT,
  SHORTCUT_DEFINITIONS,
  findShortcutConflict,
} from "../../apps/desktop/src/lib/shortcutRegistry.ts";
import en from "../../apps/desktop/src/i18n/locales/en.ts";
import es from "../../apps/desktop/src/i18n/locales/es.ts";
import it from "../../apps/desktop/src/i18n/locales/it.ts";
import ptBR from "../../apps/desktop/src/i18n/locales/pt-BR.ts";
import zhCN from "../../apps/desktop/src/i18n/locales/zh-CN.ts";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.ts";

const LOCALES: Record<string, any> = { en, es, it, "pt-BR": ptBR, "zh-CN": zhCN, "zh-TW": zhTW };

function definition(id: string) {
  const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === id);
  assert.ok(definition, `missing shortcut definition: ${id}`);
  return definition;
}

test("registry contains the next/prev tab bindings", () => {
  const nextTab = definition("nextTab");
  assert.equal(nextTab.scope, "global");
  assert.equal(nextTab.defaultShortcut, "Mod+Alt+ArrowRight");

  const prevTab = definition("prevTab");
  assert.equal(prevTab.scope, "global");
  assert.equal(prevTab.defaultShortcut, "Mod+Alt+ArrowLeft");
});

test("registry contains Mod+1..Mod+9 goto-tab bindings", () => {
  assert.equal(
    SHORTCUT_DEFINITIONS.filter((item) => item.id.startsWith("gotoTab")).length,
    GOTO_TAB_ACTION_COUNT,
  );
  for (let position = 1; position <= GOTO_TAB_ACTION_COUNT; position++) {
    const gotoTab = definition(`gotoTab${position}`);
    assert.equal(gotoTab.scope, "global");
    assert.equal(gotoTab.defaultShortcut, `Mod+${position}`);
  }
});

test("goto-tab labels name the position, the 9th names the last tab", () => {
  const gotoTab3 = definition("gotoTab3");
  assert.equal(gotoTab3.labelKey, "settings.shortcutGotoTabN");
  assert.deepEqual(gotoTab3.labelParams, { n: 3 });

  const gotoTab9 = definition(`gotoTab${GOTO_TAB_ACTION_COUNT}`);
  assert.equal(gotoTab9.labelKey, "settings.shortcutGotoLastTab");
  assert.equal(gotoTab9.labelParams, undefined);
});

test("default shortcuts are unique within each scope (no binding conflicts)", () => {
  const scopes = new Set(SHORTCUT_DEFINITIONS.map((item) => item.scope));
  for (const scope of scopes) {
    const seen = new Map<string, string>();
    for (const item of SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === scope)) {
      const owner = seen.get(item.defaultShortcut);
      assert.equal(owner, undefined, `${scope} scope: ${item.id} duplicates ${owner} on ${item.defaultShortcut}`);
      seen.set(item.defaultShortcut, item.id);
    }
  }
});

test("findShortcutConflict reports no conflict for any default binding", () => {
  for (const item of SHORTCUT_DEFINITIONS) {
    const conflict = findShortcutConflict(item.id, DEFAULT_SHORTCUT_SETTINGS[item.id], DEFAULT_SHORTCUT_SETTINGS);
    assert.equal(conflict, null, `${item.id} conflicts with ${conflict} on ${item.defaultShortcut}`);
  }
});

test("every binding is rendered by the shortcut panel and labeled in all six locales", () => {
  for (const item of SHORTCUT_DEFINITIONS) {
    // The panel groups by these four scopes and renders label + keycap from the registry.
    assert.ok(["global", "editor", "grid", "search"].includes(item.scope), item.id);
    assert.ok(item.labelKey.startsWith("settings."), item.id);
    assert.ok(item.defaultShortcut.length > 0, item.id);

    const section = item.labelKey.split(".")[1];
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const label = (messages as any).settings?.[section];
      assert.equal(typeof label, "string", `${item.labelKey} is not a string in locale ${locale}`);
      for (const param of Object.keys(item.labelParams ?? {})) {
        assert.ok(label.includes(`{${param}}`), `${item.labelKey} in ${locale} lacks {${param}} placeholder`);
      }
    }
  }
});
