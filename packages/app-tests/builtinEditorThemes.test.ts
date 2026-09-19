import { strict as assert } from "node:assert";
import { test } from "vitest";
import { builtinEditorThemes } from "../../apps/desktop/src/lib/builtinEditorThemes.ts";
import { loadEditorTheme } from "../../apps/desktop/src/lib/editorThemes.ts";

test("every built-in theme name resolves to a theme extension", () => {
  const expected = ["vscode-dark", "vscode-light", "nord", "okaidia", "material", "duotone-light", "duotone-dark", "xcode"];
  assert.deepEqual(Object.keys(builtinEditorThemes).sort(), expected.sort());
  for (const name of expected) {
    const extension = builtinEditorThemes[name]();
    assert.ok(Array.isArray(extension), `${name} must produce a CodeMirror extension`);
  }
});

test("loadEditorTheme resolves built-in themes without the @uiw packages", async () => {
  for (const name of ["vscode-dark", "vscode-light", "nord", "okaidia", "material", "duotone-light", "duotone-dark", "xcode"]) {
    const extension = await loadEditorTheme(name as never);
    assert.ok(extension, `${name} must load`);
  }
});
