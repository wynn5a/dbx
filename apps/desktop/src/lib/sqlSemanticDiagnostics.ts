import { getSqlCompletionContext } from "@/lib/sqlCompletion";
import type { DatabaseType, SqlTextSpan } from "@/types/database";

export interface SqlSemanticDiagnostic {
  span: SqlTextSpan;
  message: string;
  severity: "error" | "warning";
}

export function buildSqlParserErrorDiagnostic(error: unknown, sql: string): SqlSemanticDiagnostic | null {
  const message = errorMessage(error);
  const location = /\bat Line:\s*(\d+),\s*Column:\s*(\d+)\b/i.exec(message);
  if (!location) return null;

  const startLine = Number.parseInt(location[1], 10);
  const startColumn = Number.parseInt(location[2], 10);
  if (!Number.isFinite(startLine) || !Number.isFinite(startColumn) || startLine < 1 || startColumn < 1) return null;

  const lineText = sql.split(/\r?\n/)[startLine - 1] ?? "";
  const startIndex = Math.max(startColumn - 1, 0);
  const token = /^[\w$]+/.exec(lineText.slice(startIndex))?.[0];
  const tokenLength = Math.max(token?.length ?? 1, 1);

  return {
    span: {
      start_line: startLine,
      start_column: startColumn,
      end_line: startLine,
      end_column: startColumn + tokenLength - 1,
    },
    message,
    severity: "error",
  };
}

export function areSqlSemanticDiagnosticsEqual(
  left: readonly SqlSemanticDiagnostic[],
  right: readonly SqlSemanticDiagnostic[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      !!other &&
      item.message === other.message &&
      item.severity === other.severity &&
      item.span.start_line === other.span.start_line &&
      item.span.start_column === other.span.start_column &&
      item.span.end_line === other.span.end_line &&
      item.span.end_column === other.span.end_column
    );
  });
}

export function shouldRunSqlSemanticDiagnostics(
  sql: string,
  cursor: number,
  options: { databaseType?: DatabaseType } = {},
): boolean {
  if (options.databaseType === "elasticsearch") return false;
  const context = getSqlCompletionContext(sql, cursor);
  if (context.suggestTables || context.exclusiveTableSuggestions || context.exclusiveColumnSuggestions) return false;
  if (context.qualifier) return false;
  return true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
