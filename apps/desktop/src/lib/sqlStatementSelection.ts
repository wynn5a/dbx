export interface SqlStatementRange {
  from: number;
  to: number;
}

/**
 * Range of the SQL statement containing `pos`, for whole-statement selection.
 * Statements are split on top-level semicolons — semicolons inside string
 * literals, quoted identifiers, line comments, and block comments do not count.
 * The returned range is trimmed of surrounding whitespace but keeps the
 * trailing semicolon. When `pos` sits in trailing whitespace after the last
 * semicolon, the preceding statement is returned.
 */
export function sqlStatementRangeAt(sql: string, pos: number): SqlStatementRange | null {
  if (!sql.trim()) return null;
  const cursor = Math.max(0, Math.min(pos, sql.length));

  // Segment starts: index 0 plus the position after every top-level semicolon.
  const starts = [0];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (ch === "*" && sql[i + 1] === "/") {
        inBlockComment = false;
        i++;
      }
    } else if (inSingleQuote) {
      if (ch === "\\" && sql[i + 1] === "'") i++;
      else if (ch === "'") {
        if (sql[i + 1] === "'") i++;
        else inSingleQuote = false;
      }
    } else if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
    } else if (inBacktick) {
      if (ch === "`") inBacktick = false;
    } else if (ch === "'") inSingleQuote = true;
    else if (ch === '"') inDoubleQuote = true;
    else if (ch === "`") inBacktick = true;
    else if (ch === "-" && sql[i + 1] === "-") inLineComment = true;
    else if (ch === "/" && sql[i + 1] === "*") inBlockComment = true;
    else if (ch === ";") starts.push(i + 1);
  }

  let index = starts.length - 1;
  while (index > 0 && starts[index] > cursor) index--;

  let candidate: SqlStatementRange | null = null;
  for (; index >= 0; index--) {
    const range = trimmedRange(sql, starts[index], starts[index + 1] ?? sql.length);
    if (!range) continue;
    // A cursor past a statement's semicolon falls into the next segment. When
    // the next statement only begins on a later line, the click was still on
    // the previous statement's line — prefer that statement.
    if (candidate === null && cursor < range.from && sql.slice(cursor, range.from).includes("\n")) {
      candidate = range;
      continue;
    }
    return range;
  }
  return candidate;
}

function trimmedRange(sql: string, start: number, end: number): SqlStatementRange | null {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(sql[from])) from++;
  while (to > from && /\s/.test(sql[to - 1])) to--;
  return from < to ? { from, to } : null;
}
