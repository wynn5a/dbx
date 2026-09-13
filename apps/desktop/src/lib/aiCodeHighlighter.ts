import type { AppThemeAppearance } from "@/lib/appTheme";
import { loadShikiHighlighter, SHIKI_THEMES, type ShikiHighlighter } from "@/lib/shikiCore";

export type AiCodeHighlighter = (content: string, lang: string, appearance?: AppThemeAppearance) => string;

interface AiShikiCodeHighlighterOptions {
  appearance: () => AppThemeAppearance;
}

const SHIKI_LANGUAGES = [
  "bash",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "markdown",
  "php",
  "python",
  "rust",
  "shellscript",
  "sql",
  "tsx",
  "typescript",
  "vue",
  "xml",
  "yaml",
] as const;

const SHIKI_LANG_BY_AI_LABEL: Record<string, (typeof SHIKI_LANGUAGES)[number] | "text"> = {
  BASH: "bash",
  CLICKHOUSE: "sql",
  CSS: "css",
  GO: "go",
  HTML: "html",
  JAVA: "java",
  JAVASCRIPT: "javascript",
  JS: "javascript",
  JSON: "json",
  MARKDOWN: "markdown",
  MYSQL: "sql",
  PHP: "php",
  POSTGRESQL: "sql",
  PYTHON: "python",
  RUST: "rust",
  SHELL: "shellscript",
  SH: "shellscript",
  SQL: "sql",
  SQLITE: "sql",
  TS: "typescript",
  TSQL: "sql",
  TSX: "tsx",
  TYPESCRIPT: "typescript",
  VUE: "vue",
  XML: "xml",
  YAML: "yaml",
  YML: "yaml",
  ZSH: "shellscript",
};

let highlighterPromise: Promise<ShikiHighlighter> | undefined;

export async function createAiShikiCodeHighlighter(options: AiShikiCodeHighlighterOptions): Promise<AiCodeHighlighter> {
  const highlighter = await getAiShikiHighlighter();
  return (content, lang, appearance = options.appearance()) =>
    highlighter.codeToHtml(content, {
      lang: resolveShikiLanguage(lang),
      structure: "inline",
      theme: SHIKI_THEMES[appearance],
    });
}

function getAiShikiHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= loadAiShikiHighlighter();
  return highlighterPromise;
}

async function loadAiShikiHighlighter(): Promise<ShikiHighlighter> {
  const langModules = await Promise.all([
    import("shiki/langs/bash.mjs"),
    import("shiki/langs/css.mjs"),
    import("shiki/langs/go.mjs"),
    import("shiki/langs/html.mjs"),
    import("shiki/langs/java.mjs"),
    import("shiki/langs/javascript.mjs"),
    import("shiki/langs/json.mjs"),
    import("shiki/langs/markdown.mjs"),
    import("shiki/langs/php.mjs"),
    import("shiki/langs/python.mjs"),
    import("shiki/langs/rust.mjs"),
    import("shiki/langs/shellscript.mjs"),
    import("shiki/langs/sql.mjs"),
    import("shiki/langs/tsx.mjs"),
    import("shiki/langs/typescript.mjs"),
    import("shiki/langs/vue.mjs"),
    import("shiki/langs/xml.mjs"),
    import("shiki/langs/yaml.mjs"),
  ]);

  return loadShikiHighlighter(langModules.map((lang) => lang.default));
}

function resolveShikiLanguage(lang: string): (typeof SHIKI_LANGUAGES)[number] | "text" {
  return SHIKI_LANG_BY_AI_LABEL[lang.toUpperCase()] ?? "text";
}
