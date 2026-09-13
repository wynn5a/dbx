import type { LanguageInput } from "shiki/core";

export const SHIKI_THEMES = {
  dark: "github-dark",
  light: "github-light",
} as const;

export type ShikiHighlighter = Awaited<ReturnType<typeof import("shiki/core").createHighlighterCore>>;

/**
 * Builds a Shiki highlighter with the shared GitHub dark/light theme pair and
 * the JavaScript regex engine. Callers keep their own lazy singletons so each
 * feature only loads the languages it actually renders.
 */
export async function loadShikiHighlighter(langs: LanguageInput[]): Promise<ShikiHighlighter> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, githubDark, githubLight] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-dark.mjs"),
    import("shiki/themes/github-light.mjs"),
  ]);

  return createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs,
    themes: [githubDark.default, githubLight.default],
  });
}
