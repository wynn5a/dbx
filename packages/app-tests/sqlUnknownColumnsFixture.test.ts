import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import { buildUnknownColumnDiagnostics, type SqlTableResolution } from "../../apps/desktop/src/lib/sqlUnknownColumns.ts";
import type { SqlReferenceAnalysis } from "../../apps/desktop/src/types/database.ts";

// Real parser output → gate. `analysis` in the fixture is what the backend's
// analyze_sql_references returns for each SQL (kept current by the dbx-core
// test `unknown_column_gate_fixture_is_current`), so these cases exercise the
// same shapes QueryEditor feeds the gate — not hand-built analyses.
interface GateCase {
  name: string;
  dialect: string;
  sql: string;
  schema: Record<string, string[]>;
  expectedUnknown: string[];
  analysis: SqlReferenceAnalysis | null;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/unknown-column-gate-cases.json", import.meta.url), "utf8"),
) as { cases: GateCase[] };

for (const gateCase of fixture.cases) {
  test(`unknown-column gate on real analysis: ${gateCase.name}`, async () => {
    assert.ok(gateCase.analysis, "fixture analysis missing — regenerate it (see the fixture's _comment)");
    const analysis = gateCase.analysis;
    const diagnostics = await buildUnknownColumnDiagnostics(analysis, {
      cteNames: analysis.cte_definitions.map((cte) => cte.name),
      resolveTable: async (tableRef): Promise<SqlTableResolution> => {
        const columns = gateCase.schema[tableRef.name.toLowerCase()];
        return columns ? { status: "resolved", columns } : { status: "unresolved" };
      },
      formatMessage: (column) => column,
    });
    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.message),
      gateCase.expectedUnknown,
      gateCase.sql,
    );
  });
}
