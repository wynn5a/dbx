import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  APP_THEME_STORAGE_KEY,
  getTauriThemeForMode,
  normalizeAppThemeMode,
  resolveAppThemeAppearance,
  resolveBootThemeAppearance,
} from "../../apps/desktop/src/lib/appTheme.ts";

const indexHtml = readFileSync(new URL("../../apps/desktop/index.html", import.meta.url), "utf8");

test("normalizes stored app theme modes", () => {
  assert.equal(normalizeAppThemeMode("dark"), "dark");
  assert.equal(normalizeAppThemeMode("light"), "light");
  assert.equal(normalizeAppThemeMode("system"), "system");
  assert.equal(normalizeAppThemeMode(null), "system");
  assert.equal(normalizeAppThemeMode("unexpected"), "system");
});

test("resolves system app theme from current system preference", () => {
  assert.equal(resolveAppThemeAppearance("light", true), "light");
  assert.equal(resolveAppThemeAppearance("dark", false), "dark");
  assert.equal(resolveAppThemeAppearance("system", true), "dark");
  assert.equal(resolveAppThemeAppearance("system", false), "light");
});

test("maps system app theme mode to native automatic theme", () => {
  assert.equal(getTauriThemeForMode("light"), "light");
  assert.equal(getTauriThemeForMode("dark"), "dark");
  assert.equal(getTauriThemeForMode("system"), null);
});

test("boot theme resolution matches applyTheme for all three modes", () => {
  assert.equal(resolveBootThemeAppearance("light", true), "light");
  assert.equal(resolveBootThemeAppearance("light", false), "light");
  assert.equal(resolveBootThemeAppearance("dark", true), "dark");
  assert.equal(resolveBootThemeAppearance("dark", false), "dark");
  assert.equal(resolveBootThemeAppearance("system", true), "dark");
  assert.equal(resolveBootThemeAppearance("system", false), "light");
  // missing or invalid stored values behave exactly like normalizeAppThemeMode
  assert.equal(resolveBootThemeAppearance(null, true), "dark");
  assert.equal(resolveBootThemeAppearance(null, false), "light");
  assert.equal(resolveBootThemeAppearance("unexpected", true), "dark");
  assert.equal(resolveBootThemeAppearance("unexpected", false), "light");
});

interface BootSandbox {
  localStorage: { getItem(key: string): string | null };
  matchMedia(query: string): { matches: boolean };
  document: {
    documentElement: {
      classList: { toggle(name: string, force: boolean): void };
      style: { colorScheme: string };
    };
  };
}

/** Extracts the inline theme boot script from index.html and runs it against DOM stubs. */
function runBootScript(options: { stored: string | null; systemPrefersDark: boolean }) {
  const start = indexHtml.indexOf("<script>");
  const end = indexHtml.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start, "index.html must keep an inline theme boot script");
  const source = indexHtml.slice(start + "<script>".length, end);

  const readKeys: string[] = [];
  const mediaQueries: string[] = [];
  const htmlClasses = new Set<string>();
  const sandbox: BootSandbox = {
    localStorage: {
      getItem: (key: string) => {
        readKeys.push(key);
        return options.stored;
      },
    },
    matchMedia: (query: string) => {
      mediaQueries.push(query);
      return { matches: options.systemPrefersDark };
    },
    document: {
      documentElement: {
        classList: {
          toggle: (name: string, force: boolean) => {
            if (force) htmlClasses.add(name);
            else htmlClasses.delete(name);
          },
        },
        style: { colorScheme: "" },
      },
    },
  };
  new Function("localStorage", "matchMedia", "document", source)(sandbox.localStorage, sandbox.matchMedia, sandbox.document);
  return {
    readKeys,
    mediaQueries,
    htmlClasses,
    colorScheme: sandbox.document.documentElement.style.colorScheme,
  };
}

test("inline boot script reads the applyTheme key and sets the dark class before first paint", () => {
  // explicit dark on a light system
  let boot = runBootScript({ stored: "dark", systemPrefersDark: false });
  assert.deepEqual(boot.readKeys, [APP_THEME_STORAGE_KEY]);
  assert.deepEqual([...boot.htmlClasses], ["dark"]);
  assert.equal(boot.colorScheme, "dark");
  assert.deepEqual(boot.mediaQueries, []);

  // explicit light on a dark system: no dark class, stays light
  boot = runBootScript({ stored: "light", systemPrefersDark: true });
  assert.deepEqual(boot.readKeys, [APP_THEME_STORAGE_KEY]);
  assert.deepEqual([...boot.htmlClasses], []);
  assert.equal(boot.colorScheme, "light");

  // "system" follows the OS preference
  boot = runBootScript({ stored: "system", systemPrefersDark: true });
  assert.deepEqual(boot.readKeys, [APP_THEME_STORAGE_KEY]);
  assert.deepEqual([...boot.htmlClasses], ["dark"]);
  assert.deepEqual(boot.mediaQueries, ["(prefers-color-scheme: dark)"]);
  boot = runBootScript({ stored: "system", systemPrefersDark: false });
  assert.deepEqual([...boot.htmlClasses], []);
  assert.equal(boot.colorScheme, "light");

  // missing key behaves like "system"
  boot = runBootScript({ stored: null, systemPrefersDark: true });
  assert.deepEqual([...boot.htmlClasses], ["dark"]);
  boot = runBootScript({ stored: null, systemPrefersDark: false });
  assert.deepEqual([...boot.htmlClasses], []);

  // invalid stored value behaves like "system" instead of trusting it
  boot = runBootScript({ stored: "unexpected", systemPrefersDark: true });
  assert.deepEqual([...boot.htmlClasses], ["dark"]);
});

test("index.html keeps the boot script in <head> and a dark #root:empty fallback", () => {
  const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
  const bootStart = indexHtml.indexOf("<script>");
  assert.ok(bootStart >= 0 && bootStart < indexHtml.indexOf("</head>"), "boot script must run from <head> before first paint");
  assert.ok(head.includes(`localStorage.getItem("${APP_THEME_STORAGE_KEY}")`), "boot script must read APP_THEME_STORAGE_KEY");
  assert.ok(head.includes('classList.toggle("dark"'), "boot script must toggle the dark root class like applyTheme");
  // the module bundle must not run before the boot script
  assert.ok(bootStart < indexHtml.indexOf('src="/src/main.ts"'), "boot script must run before the app bundle");

  assert.match(indexHtml, /html\.dark #root:empty/, "#root:empty needs a dark pre-mount background for the booted class");
  assert.match(indexHtml, /@media \(prefers-color-scheme: dark\)/, "#root:empty needs a system-dark no-JS fallback");
  assert.match(indexHtml, /html:not\(\.dark\) #root:empty/, "explicit light mode must not inherit the system-dark fallback");
  // :empty matches only elements without any child node — a <style> child inside #root would make the
  // selector never match and the pre-mount frame would paint the default white canvas (the boot flash).
  assert.ok(indexHtml.includes('<div id="root"></div>'), "#root must stay empty in the served HTML");
});
