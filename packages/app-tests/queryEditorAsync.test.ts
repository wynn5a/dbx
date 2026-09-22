import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// T39 (improvement-plan-2026-09 §6 E9-3): CodeMirror used to load at boot
// through the static chain App.vue → ContentArea.vue → QueryEditor.vue. The
// editor now mounts through a defineAsyncComponent wrapper so browse-only
// sessions never pull the CodeMirror chunk. These source contracts keep the
// import points lazy and the exposed editor methods wired.
const contentAreaSource = readFileSync(
  new URL("../../apps/desktop/src/components/layout/ContentArea.vue", import.meta.url),
  "utf8",
);
const objectBrowserSource = readFileSync(
  new URL("../../apps/desktop/src/components/objects/ObjectBrowser.vue", import.meta.url),
  "utf8",
);
const loaderSource = readFileSync(
  new URL("../../apps/desktop/src/components/editor/queryEditorAsync.ts", import.meta.url),
  "utf8",
);
const queryEditorSource = readFileSync(
  new URL("../../apps/desktop/src/components/editor/QueryEditor.vue", import.meta.url),
  "utf8",
);

describe("QueryEditor async loading contract (T39)", () => {
  it("queryEditorAsync wraps QueryEditor.vue via a memoized dynamic import, never a static one", () => {
    expect(loaderSource).toMatch(/import\("\.\/QueryEditor\.vue"\)/);
    expect(loaderSource).not.toMatch(/from "\.\/QueryEditor\.vue"/);
    expect(loaderSource).toMatch(/let queryEditorComponentPromise/);
    expect(loaderSource).toMatch(/if \(!queryEditorComponentPromise\)/);
    expect(loaderSource).toMatch(/defineAsyncComponent\(\{/);
    expect(loaderSource).toMatch(/loader: loadQueryEditorComponent/);
    expect(loaderSource).toMatch(/loadingComponent: QueryEditorLoadingPlaceholder/);
  });

  it("the async wrapper itself stays CodeMirror-free", () => {
    expect(loaderSource).not.toMatch(/@codemirror/);
    expect(loaderSource).not.toMatch(/@\/lib\/editorThemes/);
    expect(loaderSource).not.toMatch(/@\/lib\/builtinEditorThemes/);
  });

  it("ContentArea mounts QueryEditor through the async wrapper with no static import left", () => {
    expect(contentAreaSource).not.toMatch(/from "@\/components\/editor\/QueryEditor\.vue"/);
    expect(contentAreaSource).toMatch(/import \{ QueryEditor \} from "@\/components\/editor\/queryEditorAsync";/);
    expect(contentAreaSource).toMatch(/ref="queryEditorRef"/);
  });

  it("ContentArea keeps the exposed editor methods reachable through an explicit handle", () => {
    expect(queryEditorSource).toMatch(/defineExpose\(\{ openSearch, openReplace, scrollCursorIntoView \}\)/);
    expect(contentAreaSource).toMatch(
      /type QueryEditorHandle = \{\s*openSearch: \(\) => boolean;\s*openReplace: \(\) => boolean;\s*scrollCursorIntoView: \(\) => void;\s*\}/,
    );
    expect(contentAreaSource).toMatch(/const queryEditorRef = ref<QueryEditorHandle>\(\)/);
    expect(contentAreaSource).toMatch(/queryEditorRef\.value\?\.openSearch\(\)/);
    expect(contentAreaSource).toMatch(/queryEditorRef\.value\?\.openReplace\(\)/);
    expect(contentAreaSource).toMatch(/queryEditorRef\.value\?\.scrollCursorIntoView\(\)/);
  });

  it("ObjectBrowser mounts QueryEditor through the async wrapper with no static import left", () => {
    expect(objectBrowserSource).not.toMatch(/from "@\/components\/editor\/QueryEditor\.vue"/);
    expect(objectBrowserSource).toMatch(/import \{ QueryEditor \} from "@\/components\/editor\/queryEditorAsync";/);
  });
});
