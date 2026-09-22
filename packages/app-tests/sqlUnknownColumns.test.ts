import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  buildUnknownColumnDiagnostics,
  gateUnknownColumnDiagnostics,
  tableRefKey,
  type SqlTableResolution,
} from "../../apps/desktop/src/lib/sqlUnknownColumns.ts";
import type { SqlColumnReference, SqlReferenceAnalysis, SqlTableReference } from "../../apps/desktop/src/types/database.ts";

const SPAN = { start_line: 1, start_column: 8, end_line: 1, end_column: 14 };

function table(overrides: Partial<SqlTableReference> = {}): SqlTableReference {
  return { name: "users", span: SPAN, ...overrides };
}

function column(overrides: Partial<SqlColumnReference> = {}): SqlColumnReference {
  return { name: "usr_nme", span: SPAN, ...overrides };
}

function resolved(schema?: string, columns: string[] = ["id", "name"]): SqlTableResolution {
  return { status: "resolved", schema, columns };
}

interface ConfidenceOverrides {
  tables?: SqlTableReference[];
  columns?: SqlColumnReference[];
  resolutions?: Map<string, SqlTableResolution>;
  cteNames?: string[];
  scopeAliases?: string[];
  formatMessage?: (column: string, table: string) => string;
}

function confidence(overrides: ConfidenceOverrides) {
  const tables = overrides.tables ?? [table()];
  const columns = overrides.columns ?? [column()];
  return {
    tables,
    columns,
    resolutions:
      overrides.resolutions ??
      new Map(tables.map((t) => [tableRefKey(t), resolved(t.schema ?? undefined)] as const)),
    cteNames: overrides.cteNames,
    scopeAliases: overrides.scopeAliases,
    formatMessage: overrides.formatMessage,
  };
}

function analysis(overrides: {
  tables?: SqlTableReference[];
  columns?: SqlColumnReference[];
  select_aliases?: string[];
  alias_columns?: string[];
} = {}): SqlReferenceAnalysis {
  return {
    tables: overrides.tables ?? [table()],
    columns: overrides.columns ?? [column()],
    select_aliases: overrides.select_aliases ?? [],
    alias_columns: overrides.alias_columns ?? [],
  };
}

test("flags a misspelled column on a fully-loaded single table", () => {
  const diagnostics = gateUnknownColumnDiagnostics(confidence({}));

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "warning");
  assert.deepEqual(diagnostics[0].span, SPAN);
  assert.equal(diagnostics[0].message, 'Unknown column "usr_nme" in "users"');
});

test("keeps quiet when every column exists", () => {
  const diagnostics = gateUnknownColumnDiagnostics(
    confidence({ columns: [column({ name: "id" }), column({ name: "name" })] }),
  );
  assert.deepEqual(diagnostics, []);
});

test("matches column names case-insensitively in both directions", () => {
  // PG lower-folds unquoted identifiers: a mixed-case source spelling and a
  // differently-cased schema column are the same column.
  const sqlSide = gateUnknownColumnDiagnostics(confidence({ columns: [column({ name: "ID" })] }));
  assert.deepEqual(sqlSide, []);

  const schemaSide = gateUnknownColumnDiagnostics(
    confidence({
      columns: [column({ name: "name" })],
      resolutions: new Map([[tableRefKey(table()), resolved(undefined, ["ID", "Name"])]]) ,
    }),
  );
  assert.deepEqual(schemaSide, []);
});

test("resolved schema participates in the resolution key", () => {
  const tables = [table({ name: "users", schema: "public" })];
  const wrongSchema = new Map([[tableRefKey({ name: "users", schema: "analytics" }), resolved("analytics")]]);
  assert.deepEqual(gateUnknownColumnDiagnostics(confidence({ tables, resolutions: wrongSchema })), []);

  const rightSchema = new Map([[tableRefKey({ name: "users", schema: "public" }), resolved("public")]]);
  assert.equal(gateUnknownColumnDiagnostics(confidence({ tables, resolutions: rightSchema })).length, 1);
});

test("ambiguous table names produce zero diagnostics", () => {
  const resolutions = new Map<string, SqlTableResolution>([["\u0000users", { status: "ambiguous" }]]);
  assert.deepEqual(gateUnknownColumnDiagnostics(confidence({ resolutions })), []);
});

test("unresolved tables (missing or partially cached columns) produce zero diagnostics", () => {
  const unresolved = new Map<string, SqlTableResolution>([["\u0000users", { status: "unresolved" }]]);
  assert.deepEqual(gateUnknownColumnDiagnostics(confidence({ resolutions: unresolved })), []);

  // A resolution that never arrived behaves the same.
  assert.deepEqual(gateUnknownColumnDiagnostics(confidence({ resolutions: new Map() })), []);
});

test("one bad reference drops the whole batch (global gate)", () => {
  const tables = [table({ name: "orders", alias: "o" }), table({ name: "ghost" })];
  const resolutions = new Map<string, SqlTableResolution>([
    [tableRefKey({ name: "orders" }), resolved(undefined, ["id", "total"])],
    [tableRefKey({ name: "ghost" }), { status: "unresolved" }],
  ]);
  const diagnostics = gateUnknownColumnDiagnostics(
    confidence({ tables, resolutions, columns: [column({ name: "nope", qualifier: "o" })] }),
  );
  assert.deepEqual(diagnostics, []);
});

test("no table references (derived/table-function sources) produce zero diagnostics", () => {
  assert.deepEqual(gateUnknownColumnDiagnostics(confidence({ tables: [] })), []);
  assert.deepEqual(gateUnknownColumnDiagnostics(confidence({ columns: [] })), []);
});

test("CTE-named references block the batch", () => {
  const diagnostics = gateUnknownColumnDiagnostics(
    confidence({ tables: [table({ name: "totals" })], cteNames: ["totals"] }),
  );
  assert.deepEqual(diagnostics, []);
});

test("select aliases are never flagged", () => {
  const diagnostics = gateUnknownColumnDiagnostics(
    confidence({ columns: [column({ name: "user_id" })], scopeAliases: ["user_id"] }),
  );
  assert.deepEqual(diagnostics, []);
});

test("table-alias column lists are skipped, qualified or not", () => {
  const diagnostics = gateUnknownColumnDiagnostics(
    confidence({
      columns: [column({ name: "a" }), column({ name: "b", qualifier: "t" })],
      scopeAliases: ["a", "b"],
    }),
  );
  assert.deepEqual(diagnostics, []);
});

test("qualified columns attribute through alias or table name", () => {
  const byAlias = gateUnknownColumnDiagnostics(
    confidence({ tables: [table({ alias: "u" })], columns: [column({ name: "usr_nme", qualifier: "u" })] }),
  );
  assert.equal(byAlias.length, 1);

  const byName = gateUnknownColumnDiagnostics(
    confidence({ columns: [column({ name: "usr_nme", qualifier: "users" })] }),
  );
  assert.equal(byName.length, 1);

  const qualifiedOk = gateUnknownColumnDiagnostics(
    confidence({ columns: [column({ name: "name", qualifier: "U" })] }),
  );
  assert.deepEqual(qualifiedOk, []);
});

test("qualifiers matching zero or several references are not attributable", () => {
  // Zero: derived-table alias that never appears as a reference.
  assert.deepEqual(
    gateUnknownColumnDiagnostics(confidence({ columns: [column({ name: "usr_nme", qualifier: "d" })] })),
    [],
  );
  // Several: `u` is both an alias of one reference and the name of another.
  const clash = gateUnknownColumnDiagnostics(
    confidence({
      tables: [table({ alias: "u" }), table({ name: "u" })],
      columns: [column({ name: "usr_nme", qualifier: "u" })],
    }),
  );
  assert.deepEqual(clash, []);
});

test("unqualified columns need a single table reference (joins, scripts)", () => {
  const join = gateUnknownColumnDiagnostics(confidence({ tables: [table(), table({ name: "orders" })] }));
  assert.deepEqual(join, []);
});

test("self joins keep qualified attribution but stay silent unqualified", () => {
  const tables = [table({ alias: "a" }), table({ alias: "b" })];
  const resolutions = new Map<string, SqlTableResolution>([[tableRefKey({ name: "users" }), resolved(undefined)]]);

  const unqualified = gateUnknownColumnDiagnostics(confidence({ tables, resolutions }));
  assert.deepEqual(unqualified, []);

  const qualified = gateUnknownColumnDiagnostics(
    confidence({ tables, resolutions, columns: [column({ name: "usr_nme", qualifier: "a" })] }),
  );
  assert.equal(qualified.length, 1);
});

test("custom formatter receives the column and the resolved display name", () => {
  const diagnostics = gateUnknownColumnDiagnostics(
    confidence({
      tables: [table({ schema: "public" })],
      formatMessage: (col, tbl) => `${col}!${tbl}`,
    }),
  );
  assert.equal(diagnostics[0].message, "usr_nme!public.users");
});

test("buildUnknownColumnDiagnostics resolves each distinct reference once", async () => {
  const seen: string[] = [];
  const diagnostics = await buildUnknownColumnDiagnostics(
    analysis({
      tables: [table({ alias: "a" }), table({ alias: "b" })],
      columns: [column({ name: "usr_nme", qualifier: "a" })],
    }),
    {
      resolveTable: (ref) => {
        seen.push(tableRefKey(ref));
        return Promise.resolve(resolved(undefined, ["id"]));
      },
    },
  );
  assert.equal(seen.length, 1, "duplicate references share one resolution");
  assert.equal(diagnostics.length, 1, "the column missing from the listing is still flagged");
});

test("buildUnknownColumnDiagnostics treats a failing resolver as unresolved", async () => {
  const diagnostics = await buildUnknownColumnDiagnostics(analysis(), {
    resolveTable: () => Promise.reject(new Error("relation does not exist")),
  });
  assert.deepEqual(diagnostics, []);
});

test("buildUnknownColumnDiagnostics wires scope aliases, CTEs and messages", async () => {
  const diagnostics = await buildUnknownColumnDiagnostics(
    analysis({ columns: [column({ name: "usr_nme" }), column({ name: "user_id" })], select_aliases: ["user_id"] }),
    {
      resolveTable: () => Promise.resolve(resolved(undefined)),
      formatMessage: (col, tbl) => `${col}@${tbl}`,
    },
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].message, "usr_nme@users");

  const aliasColumns = await buildUnknownColumnDiagnostics(
    analysis({ columns: [column({ name: "tag" })], alias_columns: ["tag"] }),
    { resolveTable: () => Promise.resolve(resolved(undefined)) },
  );
  assert.deepEqual(aliasColumns, []);

  const cteBlocked = await buildUnknownColumnDiagnostics(
    analysis({ tables: [table({ name: "totals" })] }),
    { cteNames: ["totals"], resolveTable: () => Promise.resolve(resolved(undefined)) },
  );
  assert.deepEqual(cteBlocked, []);
});

test("buildUnknownColumnDiagnostics skips resolution entirely without columns", async () => {
  let called = false;
  const diagnostics = await buildUnknownColumnDiagnostics(analysis({ columns: [] }), {
    resolveTable: () => {
      called = true;
      return Promise.resolve(resolved(undefined));
    },
  });
  assert.deepEqual(diagnostics, []);
  assert.equal(called, false);
});

test("QueryEditor wires the confidence-gated diagnostics into the debounced pipeline", () => {
  const source = readFileSync(
    new URL("../../apps/desktop/src/components/editor/QueryEditor.vue", import.meta.url),
    "utf8",
  );
  // The gate comes from the lib module, not re-derived in the component.
  assert.match(
    source,
    /import \{ buildUnknownColumnDiagnostics, type SqlTableResolution \} from "@\/lib\/sqlUnknownColumns";/,
  );
  // The analyzer result feeds the gate; the run-id guard is re-checked after
  // both awaits (resolution is async, so a newer run must still win).
  assert.match(
    source,
    /const analysis = await api\.analyzeSqlReferences\(sql, props\.dialect \?\? props\.formatDialect \?\? "generic"\);\n\s+if \(runId !== semanticDiagnosticRunId\) return;\n\s+const unknownColumns = await buildUnknownColumnDiagnostics\(analysis, \{/,
  );
  assert.match(source, /if \(runId !== semanticDiagnosticRunId\) return;\n\s+setSemanticDiagnostics\(unknownColumns\);/);
  // CTE definitions shadow schema tables for the gate.
  assert.match(source, /cteNames: extractCteDefinitions\(sql\)\.map\(\(cte\) => cte\.name\)/);
  // Resolution goes through the loaded schema listing and the completion cache.
  assert.match(source, /resolveColumnDiagnosticTable\(tableRef\)/);
  assert.match(
    source,
    /connectionStore\.listCompletionTables\(\s*props\.connectionId,\s*props\.database,\s*"",\s*undefined,/,
  );
  assert.match(source, /await ensureColumnsForTable\(\{ name: matched\.name, schema \}\);/);
  // Messages are localized.
  assert.match(
    source,
    /formatMessage: \(column, table\) => t\("editor\.diagnostics\.unknownColumn", \{ column, table \}\)/,
  );
  // The pipeline keeps its debounce/run-id contract.
  assert.match(source, /function scheduleSemanticDiagnostics\(delay = 500\)/);
  assert.match(source, /const runId = \+\+semanticDiagnosticRunId;/);
});

test("all six locales carry the unknown-column diagnostic copy", () => {
  for (const locale of ["en", "es", "it", "pt-BR", "zh-CN", "zh-TW"]) {
    const source = readFileSync(new URL(`../../apps/desktop/src/i18n/locales/${locale}.ts`, import.meta.url), "utf8");
    const block = source.match(/diagnostics: \{[\s\S]*?\n    \},/);
    assert.ok(block, `${locale} has an editor.diagnostics block`);
    assert.match(block[0], /unknownColumn: ["'].+["']/, `${locale} defines editor.diagnostics.unknownColumn`);
  }
});
