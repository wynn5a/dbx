// Built-in CodeMirror themes, inlined from the @uiw/codemirror-theme-* packages
// (MIT, github.com/uiwjs/react-codemirror). The packages' ESM builds import
// @babel/runtime helpers without declaring the dependency, which broke the
// rolldown production build; inlining the color configs drops six packages
// (and the babel runtime chain) from the bundle. Loaded by editorThemes.ts
// via dynamic import so the themes stay off the startup path.

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

type ThemeSpec = {
  variant: "light" | "dark";
  settings: {
    background: string;
    foreground: string;
    caret: string;
    selection: string;
    lineHighlight: string;
    gutterBackground: string;
    gutterForeground: string;
  };
  styles: Array<[unknown, Record<string, string>]>;
};

function buildTheme(spec: ThemeSpec): Extension {
  const theme = EditorView.theme(
    {
      "&": { backgroundColor: spec.settings.background, color: spec.settings.foreground },
      ".cm-content": { caretColor: spec.settings.caret },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: spec.settings.caret },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: spec.settings.selection },
      ".cm-activeLine": { backgroundColor: spec.settings.lineHighlight },
      ".cm-gutters": {
        backgroundColor: spec.settings.gutterBackground,
        color: spec.settings.gutterForeground,
        border: "none",
      },
    },
    { dark: spec.variant === "dark" },
  );
  const highlight = HighlightStyle.define(spec.styles.map(([tag, style]) => ({ tag: tag as never, ...style })));
  return [theme, syntaxHighlighting(highlight)];
}

const vscodeDark: ThemeSpec = {
  variant: "dark",
  settings: {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    caret: "#c6c6c6",
    selection: "#6199ff2f",
    lineHighlight: "#ffffff0f",
    gutterBackground: "#1e1e1e",
    gutterForeground: "#858585",
  },
  styles: [
    [t.keyword, { color: "#569cd6" }],
    [t.controlKeyword, { color: "#c586c0" }],
    [t.moduleKeyword, { color: "#c586c0" }],
    [t.operator, { color: "#d4d4d4" }],
    [t.variableName, { color: "#9cdcfe" }],
    [t.typeName, { color: "#4ec9b0" }],
    [t.tagName, { color: "#569cd6" }],
    [t.attributeName, { color: "#9cdcfe" }],
    [t.propertyName, { color: "#9cdcfe" }],
    [t.attributeValue, { color: "#ce9178" }],
    [t.string, { color: "#ce9178" }],
    [t.number, { color: "#b5cea8" }],
    [t.bool, { color: "#569cd6" }],
    [t.null, { color: "#569cd6" }],
    [t.comment, { color: "#6a9955" }],
    [t.function(t.variableName), { color: "#dcdcaa" }],
    [t.className, { color: "#4ec9b0" }],
    [t.namespace, { color: "#4ec9b0" }],
    [t.regexp, { color: "#d16969" }],
    [t.escape, { color: "#d7ba7d" }],
    [t.invalid, { color: "#f44747" }],
  ],
};

const vscodeLight: ThemeSpec = {
  variant: "light",
  settings: {
    background: "#ffffff",
    foreground: "#000000",
    caret: "#000000",
    selection: "#add6ff",
    lineHighlight: "#f0f0f0",
    gutterBackground: "#ffffff",
    gutterForeground: "#237893",
  },
  styles: [
    [t.keyword, { color: "#0000ff" }],
    [t.controlKeyword, { color: "#af00db" }],
    [t.moduleKeyword, { color: "#af00db" }],
    [t.operator, { color: "#000000" }],
    [t.variableName, { color: "#001080" }],
    [t.typeName, { color: "#267f99" }],
    [t.tagName, { color: "#800000" }],
    [t.attributeName, { color: "#ff0000" }],
    [t.propertyName, { color: "#0451a5" }],
    [t.attributeValue, { color: "#a31515" }],
    [t.string, { color: "#a31515" }],
    [t.number, { color: "#098658" }],
    [t.bool, { color: "#0000ff" }],
    [t.null, { color: "#0000ff" }],
    [t.comment, { color: "#008000" }],
    [t.function(t.variableName), { color: "#795e26" }],
    [t.className, { color: "#267f99" }],
    [t.namespace, { color: "#267f99" }],
    [t.regexp, { color: "#811f3f" }],
    [t.escape, { color: "#ee0000" }],
    [t.invalid, { color: "#cd3131" }],
  ],
};

const nord: ThemeSpec = {
  variant: "dark",
  settings: {
    background: "#2e3440",
    foreground: "#d8dee9",
    caret: "#d8dee9",
    selection: "#434c5ecc",
    lineHighlight: "#3b4252",
    gutterBackground: "#2e3440",
    gutterForeground: "#4c566a",
  },
  styles: [
    [t.keyword, { color: "#81a1c1" }],
    [t.controlKeyword, { color: "#81a1c1" }],
    [t.operator, { color: "#81a1c1" }],
    [t.variableName, { color: "#d8dee9" }],
    [t.typeName, { color: "#8fbcbb" }],
    [t.tagName, { color: "#81a1c1" }],
    [t.attributeName, { color: "#8fbcbb" }],
    [t.propertyName, { color: "#88c0d0" }],
    [t.string, { color: "#a3be8c" }],
    [t.number, { color: "#b48ead" }],
    [t.bool, { color: "#81a1c1" }],
    [t.null, { color: "#81a1c1" }],
    [t.comment, { color: "#616e88" }],
    [t.function(t.variableName), { color: "#88c0d0" }],
    [t.className, { color: "#8fbcbb" }],
    [t.regexp, { color: "#ebcb8b" }],
    [t.escape, { color: "#ebcb8b" }],
    [t.invalid, { color: "#bf616a" }],
  ],
};

const okaidia: ThemeSpec = {
  variant: "dark",
  settings: {
    background: "#272822",
    foreground: "#f8f8f2",
    caret: "#f8f8f0",
    selection: "#49483e",
    lineHighlight: "#3e3d32",
    gutterBackground: "#272822",
    gutterForeground: "#75715e",
  },
  styles: [
    [t.keyword, { color: "#f92672" }],
    [t.operator, { color: "#f92672" }],
    [t.variableName, { color: "#f8f8f2" }],
    [t.typeName, { color: "#66d9ef" }],
    [t.tagName, { color: "#f92672" }],
    [t.attributeName, { color: "#a6e22e" }],
    [t.propertyName, { color: "#a6e22e" }],
    [t.string, { color: "#e6db74" }],
    [t.number, { color: "#ae81ff" }],
    [t.bool, { color: "#ae81ff" }],
    [t.null, { color: "#ae81ff" }],
    [t.comment, { color: "#75715e" }],
    [t.function(t.variableName), { color: "#a6e22e" }],
    [t.className, { color: "#a6e22e" }],
    [t.regexp, { color: "#fd971f" }],
    [t.invalid, { color: "#f92672" }],
  ],
};

const material: ThemeSpec = {
  variant: "dark",
  settings: {
    background: "#263238",
    foreground: "#eeffff",
    caret: "#ffcc00",
    selection: "#3c4c5577",
    lineHighlight: "#00000059",
    gutterBackground: "#263238",
    gutterForeground: "#546e7a",
  },
  styles: [
    [t.keyword, { color: "#c792ea" }],
    [t.controlKeyword, { color: "#c792ea" }],
    [t.operator, { color: "#89ddff" }],
    [t.variableName, { color: "#f07178" }],
    [t.typeName, { color: "#ffcb6b" }],
    [t.tagName, { color: "#f07178" }],
    [t.attributeName, { color: "#c792ea" }],
    [t.propertyName, { color: "#80cbc4" }],
    [t.string, { color: "#c3e88d" }],
    [t.number, { color: "#f78c6c" }],
    [t.bool, { color: "#ff9cac" }],
    [t.null, { color: "#ff9cac" }],
    [t.comment, { color: "#546e7a" }],
    [t.function(t.variableName), { color: "#82aaff" }],
    [t.className, { color: "#ffcb6b" }],
    [t.regexp, { color: "#89ddff" }],
    [t.invalid, { color: "#f07178" }],
  ],
};

const duotoneLight: ThemeSpec = {
  variant: "light",
  settings: {
    background: "#faf8f5",
    foreground: "#2d2424",
    caret: "#063289",
    selection: "#e3dcce",
    lineHighlight: "#efefe4",
    gutterBackground: "#faf8f5",
    gutterForeground: "#cdc8b8",
  },
  styles: [
    [t.keyword, { color: "#063289" }],
    [t.operator, { color: "#063289" }],
    [t.variableName, { color: "#2d2424" }],
    [t.typeName, { color: "#896724" }],
    [t.tagName, { color: "#063289" }],
    [t.propertyName, { color: "#b29762" }],
    [t.string, { color: "#1659df" }],
    [t.number, { color: "#896724" }],
    [t.bool, { color: "#063289" }],
    [t.null, { color: "#063289" }],
    [t.comment, { color: "#a8a397" }],
    [t.function(t.variableName), { color: "#896724" }],
    [t.regexp, { color: "#1659df" }],
    [t.invalid, { color: "#d3382e" }],
  ],
};

const duotoneDark: ThemeSpec = {
  variant: "dark",
  settings: {
    background: "#2a2734",
    foreground: "#6c6783",
    caret: "#ffad5c",
    selection: "#54516780",
    lineHighlight: "#36334280",
    gutterBackground: "#2a2734",
    gutterForeground: "#545167",
  },
  styles: [
    [t.keyword, { color: "#ffad5c" }],
    [t.operator, { color: "#ffad5c" }],
    [t.variableName, { color: "#6c6783" }],
    [t.typeName, { color: "#eeebff" }],
    [t.tagName, { color: "#ffad5c" }],
    [t.propertyName, { color: "#9a86fd" }],
    [t.string, { color: "#ffb870" }],
    [t.number, { color: "#ffad5c" }],
    [t.bool, { color: "#ffad5c" }],
    [t.null, { color: "#ffad5c" }],
    [t.comment, { color: "#545167" }],
    [t.function(t.variableName), { color: "#eeebff" }],
    [t.regexp, { color: "#ffb870" }],
    [t.invalid, { color: "#ff6666" }],
  ],
};

const xcodeLight: ThemeSpec = {
  variant: "light",
  settings: {
    background: "#ffffff",
    foreground: "#262626",
    caret: "#262626",
    selection: "#b3d7ff",
    lineHighlight: "#e8f2ff",
    gutterBackground: "#ffffff",
    gutterForeground: "#a6a6a6",
  },
  styles: [
    [t.keyword, { color: "#ad3da4" }],
    [t.operator, { color: "#262626" }],
    [t.variableName, { color: "#3f6e75" }],
    [t.typeName, { color: "#703daa" }],
    [t.tagName, { color: "#78492a" }],
    [t.propertyName, { color: "#3f6e75" }],
    [t.string, { color: "#d12f1b" }],
    [t.number, { color: "#272ad8" }],
    [t.bool, { color: "#ad3da4" }],
    [t.null, { color: "#ad3da4" }],
    [t.comment, { color: "#707f8c" }],
    [t.function(t.variableName), { color: "#326d74" }],
    [t.regexp, { color: "#d12f1b" }],
    [t.invalid, { color: "#d12f1b" }],
  ],
};

export const builtinEditorThemes: Record<string, () => Extension> = {
  "vscode-dark": () => buildTheme(vscodeDark),
  "vscode-light": () => buildTheme(vscodeLight),
  nord: () => buildTheme(nord),
  okaidia: () => buildTheme(okaidia),
  material: () => buildTheme(material),
  "duotone-light": () => buildTheme(duotoneLight),
  "duotone-dark": () => buildTheme(duotoneDark),
  xcode: () => buildTheme(xcodeLight),
};
