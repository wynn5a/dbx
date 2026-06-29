export interface AiMessageTextSegment {
  type: "text";
  content: string;
  html: string;
}

export interface AiMessageCodeSegment {
  type: "code";
  content: string;
  lang: string;
  html: string;
  isSql: boolean;
}

export type AiMessageRenderSegment = AiMessageTextSegment | AiMessageCodeSegment;

interface MessageSegment {
  type: "text" | "code";
  content: string;
  lang?: string;
}

export interface AiMessageRendererOptions {
  maxEntries?: number;
  markdown: (text: string) => string;
  highlightCode?: (content: string, lang: string) => string;
}

const DEFAULT_MAX_ENTRIES = 100;
const SQL_LANGUAGES = new Map([
  ["sql", "SQL"],
  ["mysql", "MYSQL"],
  ["postgres", "POSTGRESQL"],
  ["postgresql", "POSTGRESQL"],
  ["sqlite", "SQLITE"],
  ["tsql", "TSQL"],
  ["clickhouse", "CLICKHOUSE"],
  ["mongodb", "MONGODB"],
  ["mongo", "MONGODB"],
]);
const SHELL_LANGUAGES = new Map([
  ["bash", "BASH"],
  ["sh", "SHELL"],
  ["shell", "SHELL"],
  ["zsh", "ZSH"],
]);
const SQL_LANGUAGE_LABELS = new Set(SQL_LANGUAGES.values());

export function createAiMessageRenderer(options: AiMessageRendererOptions) {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const cache = new Map<string, AiMessageRenderSegment[]>();

  function render(content: string): AiMessageRenderSegment[] {
    const cached = cache.get(content);
    if (cached) {
      cache.delete(content);
      cache.set(content, cached);
      return cached;
    }

    const rendered = parseAiMessage(content).map((segment): AiMessageRenderSegment => {
      if (segment.type === "text") {
        return { type: "text", content: segment.content, html: options.markdown(segment.content) };
      }
      const lang = normalizeAiCodeLanguage(segment.lang);
      return {
        type: "code",
        content: segment.content,
        html: options.highlightCode?.(segment.content, lang) ?? escapeHtml(segment.content),
        lang,
        isSql: isSqlAiCodeLanguage(lang),
      };
    });

    cache.set(content, rendered);
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    return rendered;
  }

  function clear() {
    cache.clear();
  }

  return { render, clear };
}

export function parseAiMessage(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```([a-zA-Z0-9_+.-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "sql";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        // A closing fence is any line starting with ```. Streamed agent output
        // can glue prose onto the closing fence (e.g. "```No results...") when a
        // tool call splits two text runs; that trailing text is split back out so
        // it renders as prose instead of being swallowed into the code block.
        const closeMatch = lines[i].match(/^```\s*(.*)$/);
        if (closeMatch) {
          i++;
          const trailing = closeMatch[1];
          if (trailing.trim()) lines.splice(i, 0, trailing);
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      const content = codeLines.join("\n").trim();
      if (content) segments.push({ type: "code", lang, content });
    } else {
      const textLines: string[] = [];
      while (i < lines.length && !/^```([a-zA-Z0-9_+.-]*)\s*$/.test(lines[i])) {
        textLines.push(lines[i]);
        i++;
      }
      const content = textLines.join("\n");
      if (content.trim()) segments.push({ type: "text", content });
    }
  }

  return segments;
}

export function normalizeAiCodeLanguage(lang?: string): string {
  const key = (lang || "sql").trim().toLowerCase();
  if (!key) return "SQL";
  return SQL_LANGUAGES.get(key) || SHELL_LANGUAGES.get(key) || (key === "json" ? "JSON" : key.toUpperCase());
}

export function isSqlAiCodeLanguage(lang: string): boolean {
  return SQL_LANGUAGE_LABELS.has(lang);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
