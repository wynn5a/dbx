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
  // Structured output first (T42): an Ask-mode reply may end with the contract
  // JSON object {"sql": ..., "explanation": ...} — bare, in a ```json fence, or
  // with prose around it. When it parses, the SQL is the primary code segment
  // and the explanation/prose render as text. Anything else — no JSON,
  // malformed JSON, an object without a string `sql` field — falls through to
  // the legacy fence scan below, byte-for-byte the pre-T42 behavior.
  const structured = extractAiStructuredSql(text);
  if (structured) {
    const segments = structuredSegments(structured);
    if (segments.length) return segments;
  }
  return scanFencedSegments(text);
}

/**
 * Segments for a reply carrying the contract JSON. The prompt asks for prose, a
 * ```sql fence, then the JSON line — so the prose around the object is still
 * fence-scanned: its code blocks stay actionable code segments, and the fence
 * repeating the contract's SQL *is* the primary block (kept in place, not
 * rendered a second time). Only when no fence carries that SQL is it appended.
 */
function structuredSegments(structured: AiStructuredSql): MessageSegment[] {
  const before = scanFencedSegments(structured.proseBefore);
  const after = scanFencedSegments(structured.proseAfter);
  const explanation = structured.explanation.trim();

  if (!before.some(isCodeSegment) && !after.some(isCodeSegment)) {
    const prose = [structured.proseBefore, explanation, structured.proseAfter]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
    const segments: MessageSegment[] = [];
    if (prose) segments.push({ type: "text", content: prose });
    if (structured.sql) segments.push({ type: "code", lang: "sql", content: structured.sql });
    return segments;
  }

  const segments: MessageSegment[] = [...before];
  if (explanation) segments.push({ type: "text", content: explanation });
  segments.push(...after);
  const sqlKey = sqlCompareKey(structured.sql);
  if (structured.sql && !segments.some((s) => isCodeSegment(s) && sqlCompareKey(s.content) === sqlKey)) {
    segments.push({ type: "code", lang: "sql", content: structured.sql });
  }
  return mergeAdjacentText(segments);
}

function isCodeSegment(segment: MessageSegment): boolean {
  return segment.type === "code";
}

/** Whitespace- and trailing-semicolon-insensitive form for "is this the same SQL". */
function sqlCompareKey(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().replace(/;+$/, "").trim();
}

function mergeAdjacentText(segments: MessageSegment[]): MessageSegment[] {
  const merged: MessageSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (segment.type === "text" && last?.type === "text") {
      last.content = `${last.content.trim()}\n\n${segment.content.trim()}`;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

/** The legacy (pre-T42) parse: ``` fences become code segments, the rest text. */
function scanFencedSegments(text: string): MessageSegment[] {
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

// ---------------------------------------------------------------------------
// Structured SQL extraction (T42 / plan §5 D9)
// ---------------------------------------------------------------------------

export interface AiStructuredSql {
  /** The final SQL, with a wrapped code fence stripped when the model added one. */
  sql: string;
  /** Short explanation from the contract object; empty when absent. */
  explanation: string;
  /** Anything the model wrote before the JSON object. */
  proseBefore: string;
  /** Anything after it (usually empty; a dangling fence close is dropped). */
  proseAfter: string;
}

/**
 * Extract the Ask-mode structured SQL payload — a `{"sql": ..., "explanation": ...}`
 * JSON object — from a reply. The contract puts the object last, so candidates
 * are line-anchored `{` positions scanned from the end (bounded); each slice is
 * brace-balanced with string escapes honored, then JSON-parsed. Accepted only
 * when the value is an object carrying a string `sql` field. Returns null for
 * everything else so the fence scan stays the single fallback.
 */
export function extractAiStructuredSql(text: string): AiStructuredSql | null {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }

  let candidates = 0;
  for (let s = lineStarts.length - 1; s >= 0 && candidates < 50; s--) {
    const start = lineStarts[s];
    if (text[start] !== "{") continue;
    candidates++;
    const parsed = tryParseStructuredSqlAt(text, start);
    if (parsed) return parsed;
  }
  return null;
}

function tryParseStructuredSqlAt(text: string, start: number): AiStructuredSql | null {
  const end = balancedObjectEnd(text, start);
  if (end < 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.sql !== "string") return null;

  const sql = stripSqlFence(record.sql);
  const explanation = typeof record.explanation === "string" ? record.explanation : "";
  if (!sql && !explanation) return null;

  return {
    sql,
    explanation,
    proseBefore: dropDanglingFenceOpen(text.slice(0, start)),
    proseAfter: dropDanglingFenceClose(text.slice(end)),
  };
}

/** Index just past the `}` matching the `{` at `start`, or -1 when unbalanced. */
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Models sometimes wrap the SQL in a fence inside the string value; unwrap one. */
function stripSqlFence(sql: string): string {
  const trimmed = sql.trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9_+.-]*\s*\n?([\s\S]*?)\n?\s*```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * The JSON object's own ```json wrapper leaves its opener line glued to the
 * prose before it; that marker is not prose. Only an *unbalanced* trailing
 * fence line is the wrapper: after a complete ```sql block the last line is
 * that block's closing fence and stays.
 */
function dropDanglingFenceOpen(before: string): string {
  const trimmed = before.trim();
  if (!trimmed) return "";
  const lines = trimmed.split("\n");
  const fenceLines = lines.filter((line) => /^```/.test(line.trim())).length;
  if (fenceLines % 2 === 1 && /^```[a-zA-Z0-9_+.-]*$/.test(lines[lines.length - 1].trim())) lines.pop();
  return lines.join("\n");
}

/**
 * Trailing text after the JSON object. A bare ``` (or a ``` glued to following
 * prose, e.g. "```No results") is the wrapper's closing fence, not content; a
 * ```lang opener line starts a legitimate new fenced block and stays.
 */
function dropDanglingFenceClose(after: string): string {
  const trimmed = after.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split("\n")[0];
  const marker = firstLine.match(/^```([a-zA-Z0-9_+.-]*)(.*)$/);
  if (!marker) return after;
  const rest = trimmed.slice(firstLine.length).replace(/^\n/, "");
  if (marker[2].trim()) return [marker[2].trim(), rest].filter(Boolean).join("\n");
  if (marker[1]) return after;
  return rest;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
