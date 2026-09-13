import type { AppThemeAppearance } from "@/lib/appTheme";
import { loadShikiHighlighter, SHIKI_THEMES, type ShikiHighlighter } from "@/lib/shikiCore";

export type SqlHighlighter = (content: string, appearance?: AppThemeAppearance) => string;

interface ShikiSqlHighlighterOptions {
  appearance: () => AppThemeAppearance;
}

let highlighterPromise: Promise<ShikiHighlighter> | undefined;

export async function createShikiSqlHighlighter(options: ShikiSqlHighlighterOptions): Promise<SqlHighlighter> {
  const highlighter = await getShikiSqlHighlighter();
  return (content, appearance = options.appearance()) =>
    highlighter.codeToHtml(content, {
      lang: "sql",
      structure: "inline",
      theme: SHIKI_THEMES[appearance],
    });
}

function getShikiSqlHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= loadShikiSqlHighlighter();
  return highlighterPromise;
}

async function loadShikiSqlHighlighter(): Promise<ShikiHighlighter> {
  const sql = await import("shiki/langs/sql.mjs");
  return loadShikiHighlighter([sql.default]);
}
