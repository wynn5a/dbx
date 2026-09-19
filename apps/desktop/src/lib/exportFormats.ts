import type { DatabaseType } from "@/types/database";
import * as api from "@/lib/api";

export type ExportCellValue = string | number | boolean | null;

export function formatCsv(columns: string[], rows: ExportCellValue[][]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = columns.map(esc).join(",");
  const parts = [header];
  for (const row of rows) {
    parts.push(row.map((c) => esc(c === null ? "" : String(c))).join(","));
  }
  return parts.join("\n");
}

export interface FormatSqlInsertOptions {
  databaseType?: DatabaseType;
  schema?: string;
  tableName?: string;
  qualifiedTableName?: string;
  columns: string[];
  columnTypes?: Array<string | null | undefined>;
  rows: ExportCellValue[][];
}

export function formatSqlInsert(options: FormatSqlInsertOptions): Promise<string> {
  return api.buildExportSqlInsert({
    ...options,
    batchSize: 1,
  });
}
