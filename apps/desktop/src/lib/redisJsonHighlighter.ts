import type { AppThemeAppearance } from "@/lib/appTheme";
import { loadShikiHighlighter, SHIKI_THEMES, type ShikiHighlighter } from "@/lib/shikiCore";

export type RedisJsonHighlighter = (content: string, appearance?: AppThemeAppearance) => string;

interface RedisShikiJsonHighlighterOptions {
  appearance: () => AppThemeAppearance;
}

let highlighterPromise: Promise<ShikiHighlighter> | undefined;

export async function createRedisShikiJsonHighlighter(
  options: RedisShikiJsonHighlighterOptions,
): Promise<RedisJsonHighlighter> {
  const highlighter = await getRedisShikiHighlighter();
  return (content, appearance = options.appearance()) =>
    highlighter.codeToHtml(content, {
      lang: "json",
      structure: "inline",
      theme: SHIKI_THEMES[appearance],
    });
}

function getRedisShikiHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= loadRedisShikiHighlighter();
  return highlighterPromise;
}

async function loadRedisShikiHighlighter(): Promise<ShikiHighlighter> {
  const json = await import("shiki/langs/json.mjs");
  return loadShikiHighlighter([json.default]);
}
