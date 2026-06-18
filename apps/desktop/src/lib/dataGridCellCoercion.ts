import type { GridCellValue } from "@/lib/dataGridSql";
import type { DatabaseType, ColumnInfo } from "@/types/database";

export interface CoerceDataGridCellValueOptions {
  value: string;
  oldValue: GridCellValue | undefined;
  databaseType: DatabaseType | undefined;
  columnInfo: Pick<ColumnInfo, "data_type"> | undefined;
}

export function coerceDataGridCellValue(options: CoerceDataGridCellValueOptions): GridCellValue {
  const { value, oldValue } = options;
  if (value.toUpperCase() === "NULL") return null;
  if (value === "") {
    // An empty cell means "clear this value" → NULL. The only exception is a
    // text-like column that already holds a string, where an empty string is a
    // meaningful, distinct value the user may want to keep (type "NULL" above to
    // force null there). Without this, clearing a previously-filled cell stored
    // "" — e.g. INSERT ... VALUES ('', ...) on an int `id` — and clearing a
    // numeric cell coerced to 0 via Number("").
    if (typeof oldValue === "string" && isTextLikeColumn(options.columnInfo)) return "";
    return null;
  }
  const postgresArrayValue = coercePostgresArrayValue(options);
  if (postgresArrayValue !== undefined) return postgresArrayValue;
  if (typeof oldValue === "number") {
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }
  if (typeof oldValue === "boolean") {
    return value === "true" || value === "1";
  }
  return normalizeSmartQuotedJsonInput(value);
}

export function dataGridCellEditorText(options: {
  value: GridCellValue | undefined;
  databaseType: DatabaseType | undefined;
  columnInfo: Pick<ColumnInfo, "data_type"> | undefined;
}): string {
  const value = options.value ?? null;
  if (value === null) return "";
  if (Array.isArray(value) && options.databaseType === "postgres" && isPostgresArrayColumn(options.columnInfo, value)) {
    return formatPostgresArrayText(value);
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function dataGridCellDisplayText(options: {
  value: GridCellValue;
  databaseType: DatabaseType | undefined;
  columnInfo: Pick<ColumnInfo, "data_type"> | undefined;
}): string | undefined {
  if (
    Array.isArray(options.value) &&
    options.databaseType === "postgres" &&
    isPostgresArrayColumn(options.columnInfo, options.value)
  ) {
    return formatPostgresArrayText(options.value);
  }
  return undefined;
}

function coercePostgresArrayValue(options: CoerceDataGridCellValueOptions): unknown[] | undefined {
  if (options.databaseType !== "postgres") return undefined;
  if (!isPostgresArrayColumn(options.columnInfo, options.oldValue)) return undefined;
  const trimmed = options.value.trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalizeSmartQuotes(trimmed));
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = parsePostgresArrayText(trimmed);
      if (Array.isArray(options.oldValue) && deepEqual(parsed, options.oldValue)) {
        return options.oldValue;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Types where an empty string is a valid, distinct value (vs. NULL). Anything
// else — numeric, temporal, boolean, uuid, json, blob, array — can't hold ''
// meaningfully, so clearing such a cell should yield NULL.
function isTextLikeColumn(columnInfo: Pick<ColumnInfo, "data_type"> | undefined): boolean {
  const dataType = columnInfo?.data_type.trim().toLowerCase() ?? "";
  if (!dataType) return false;
  return /char|text|string|clob|enum|set|\bname\b/.test(dataType);
}

function isPostgresArrayColumn(
  columnInfo: Pick<ColumnInfo, "data_type"> | undefined,
  oldValue: GridCellValue | undefined,
): boolean {
  if (Array.isArray(oldValue)) return true;
  const dataType = columnInfo?.data_type.trim().toLowerCase() ?? "";
  return dataType === "array" || dataType.endsWith("[]") || dataType.startsWith("_");
}

// Smart double-quote variants that input methods substitute for ASCII `"`:
// curly “ ” (Chinese/macOS), low-9 „, high-reversed-9 ‟, and fullwidth ＂.
// Matched by char code rather than a regex literal so the smart-quote chars
// don't have to survive the source toolchain for this to keep working.
const SMART_DOUBLE_QUOTE_CODES = new Set([0x201c, 0x201d, 0x201e, 0x201f, 0xff02]);

function hasSmartDoubleQuotes(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (SMART_DOUBLE_QUOTE_CODES.has(value.charCodeAt(i))) return true;
  }
  return false;
}

function normalizeSmartQuotedJsonInput(value: string): string {
  // Input methods (Chinese IME, macOS smart punctuation) can replace the ASCII
  // quotes in hand-typed JSON with smart-quote variants, breaking the parse.
  if (!hasSmartDoubleQuotes(value)) return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  const normalized = normalizeSmartQuotes(value);
  try {
    JSON.parse(normalized);
    return normalized;
  } catch {
    // Normalization didn't yield valid JSON (e.g. the smart quotes are part of a
    // string value, not delimiters) — leave the original input untouched.
    return value;
  }
}

function normalizeSmartQuotes(value: string): string {
  if (!hasSmartDoubleQuotes(value)) return value;
  let result = "";
  for (let i = 0; i < value.length; i++) {
    result += SMART_DOUBLE_QUOTE_CODES.has(value.charCodeAt(i)) ? '"' : value[i];
  }
  return result;
}

function formatPostgresArrayText(value: unknown[]): string {
  return `{${value.map(formatPostgresArrayElement).join(",")}}`;
}

function formatPostgresArrayElement(value: unknown): string {
  if (Array.isArray(value)) return formatPostgresArrayText(value);
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "";
  if (!needsQuotedPostgresArrayElement(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function needsQuotedPostgresArrayElement(value: string): boolean {
  return value === "" || /[\s,"{}\\]/.test(value) || value.toUpperCase() === "NULL";
}

function parsePostgresArrayText(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("Invalid PG array literal");
  }
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return [];

  const elements: unknown[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && inner[i] === " ") i++;
    if (i >= inner.length) break;

    let element: unknown;
    if (inner[i] === '"') {
      i++;
      let str = "";
      while (i < inner.length) {
        if (inner[i] === "\\" && i + 1 < inner.length) {
          i++;
          str += inner[i];
          i++;
        } else if (inner[i] === '"') {
          i++;
          break;
        } else {
          str += inner[i];
          i++;
        }
      }
      element = str;
    } else if (inner[i] === "{") {
      let depth = 0;
      const start = i;
      while (i < inner.length) {
        if (inner[i] === "{") depth++;
        else if (inner[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      element = parsePostgresArrayText(inner.slice(start, i));
    } else {
      let start = i;
      while (i < inner.length && inner[i] !== "," && inner[i] !== "}") i++;
      const token = inner.slice(start, i).trim();
      if (token.toUpperCase() === "NULL") {
        element = null;
      } else if (/^(true|false)$/i.test(token)) {
        element = token.toLowerCase() === "true";
      } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
        element = Number(token);
      } else {
        element = token;
      }
    }

    elements.push(element);

    while (i < inner.length && inner[i] === " ") i++;
    if (i < inner.length && inner[i] === ",") i++;
  }

  return elements;
}
