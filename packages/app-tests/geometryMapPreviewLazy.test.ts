import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test, vi } from "vitest";
import { getApplicablePreviewActions } from "../../apps/desktop/src/lib/resultPreviewRegistry.ts";
import type { QueryResult } from "../../apps/desktop/src/types/database.ts";

// Stub the SFC (vitest runs without the Vue plugin): the handler must reach the
// dialog through a dynamic import, which this replaces with a plain object.
vi.mock("@/components/grid/LayerPreviewDialog.vue", () => ({
  default: { name: "LayerPreviewDialogStub" },
}));

// The map preview handler self-registers on import; DataGrid loads it through a
// dynamic import so Leaflet stays out of the startup chunks (perf plan §3 B5).
await import("../../apps/desktop/src/lib/previewHandlers/geometryMapPreview.ts");

function resultWithColumnTypes(columnTypes: (string | null)[]): Pick<QueryResult, "columns" | "column_types"> {
  return {
    columns: columnTypes.map((_, i) => `col_${i}`),
    column_types: columnTypes,
  } as Pick<QueryResult, "columns" | "column_types">;
}

const dataGridSource = readFileSync(
  new URL("../../apps/desktop/src/components/grid/DataGrid.vue", import.meta.url),
  "utf8",
);
const handlerSource = readFileSync(
  new URL("../../apps/desktop/src/lib/previewHandlers/geometryMapPreview.ts", import.meta.url),
  "utf8",
);
const dialogSource = readFileSync(
  new URL("../../apps/desktop/src/components/grid/LayerPreviewDialog.vue", import.meta.url),
  "utf8",
);

test("the lazily loaded handler registers the geometry map preview action", () => {
  const actions = getApplicablePreviewActions(resultWithColumnTypes(["geometry", "text"]));
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.id, "geometry-map-preview");
});

test("the map preview is offered only for geometry and geography columns", () => {
  assert.equal(getApplicablePreviewActions(resultWithColumnTypes(["text", "integer"])).length, 0);
  assert.equal(getApplicablePreviewActions(resultWithColumnTypes([null, null])).length, 0);
  for (const type of ["geometry", "Geography", "geometry(Point, 4326)", "  geography"]) {
    assert.equal(getApplicablePreviewActions(resultWithColumnTypes([type])).length, 1, type);
  }
});

test("execute skips hex, NULL and duplicate geometries and returns null without usable features", async () => {
  const actions = getApplicablePreviewActions(resultWithColumnTypes(["geometry"]));
  assert.equal(actions.length, 1);
  const action = actions[0]!;
  const base = { columns: ["geom"], column_types: ["geometry"] } as any;
  // Hex-encoded (WKB) cells and all-NULL geometries produce no features, so the
  // dialog is never even loaded.
  for (const rows of [[[ "0x010200000002000000" ]], [[null]], [[undefined]]]) {
    const config = await action.execute({
      result: { ...base, rows },
      selectedRowIds: [],
      displayRowRefs: rows.map((_: any, i: number) => ({ id: i, sourceIndex: i, isNew: false })),
    });
    assert.equal(config, null);
  }
});

test("DataGrid loads the preview handler dynamically, never statically", () => {
  // No top-level side-effect import of the handler module.
  assert.doesNotMatch(dataGridSource, /^import "@\/lib\/previewHandlers\/geometryMapPreview";$/m);
  // The open-preview path pulls the handler in on demand.
  assert.match(dataGridSource, /import\("@\/lib\/previewHandlers\/geometryMapPreview"\)/);
  // The dialog component is never imported into the grid chunk.
  assert.doesNotMatch(dataGridSource, /import LayerPreviewDialog/);
});

test("DataGrid warms the handler for geometry results and awaits execute with a failure toast", () => {
  // Warm-up: a result with geometry columns triggers the (memoized) load so the
  // context-menu entry is registered by the time the user right-clicks.
  assert.match(
    dataGridSource,
    /watch\(\s*\(\) => props\.result\?\.column_types\?\.some\(\(t\) => isGeometryColumnType\(t \?\? ""\)\) \?\? false,\s*\(hasGeometryColumns\) => {\s*if \(hasGeometryColumns\) void ensurePreviewHandlersLoaded\(\)/,
  );
  // execute() may now resolve asynchronously (dialog loaded on demand).
  assert.match(dataGridSource, /await action\.execute\(/);
  // A failed module load surfaces an understandable error instead of nothing.
  assert.match(dataGridSource, /toast\(t\("grid\.previewLoadFailed", \{ message: e\?\.message \|\| String\(e\) \}\), 5000\)/);
});

test("the handler loads the dialog (and Leaflet) only inside execute", () => {
  assert.doesNotMatch(handlerSource, /^import LayerPreviewDialog/m);
  assert.match(handlerSource, /await import\("@\/components\/grid\/LayerPreviewDialog\.vue"\)/);
});

test("execute loads the dialog on demand and returns it with the built FeatureCollection", async () => {
  const action = getApplicablePreviewActions(resultWithColumnTypes(["geometry", "text"]))[0]!;
  const rows = [
    ["POINT (1 2)", "a"],
    ["POINT (1 2)", "b"], // duplicate WKT — deduplicated into one feature
    [null, "c"],
  ];
  const config = (await action.execute({
    result: { columns: ["geom", "name"], column_types: ["geometry", "text"], rows },
    selectedRowIds: [],
    displayRowRefs: rows.map((_, i) => ({ id: i, sourceIndex: i, isNew: false })),
  })) as any;
  // The component arrives from the awaited dynamic import (stubbed above).
  assert.deepEqual(config.component, { name: "LayerPreviewDialogStub" });
  const fc = JSON.parse(config.props.geojson);
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry, { type: "Point", coordinates: [1, 2] });
  assert.equal(fc.features[0].properties._column, "geom");
  assert.equal(fc.features[0].properties._row, 0);
  assert.equal(fc.features[0].properties.name, "a"); // properties from the first row
});

test("LayerPreviewDialog keeps Leaflet JS and CSS in async chunks", () => {
  // Leaflet is loaded at map-init time, together with its stylesheet.
  assert.match(dialogSource, /import\("leaflet"\)/);
  assert.match(dialogSource, /import\("leaflet\/dist\/leaflet\.css"\)/);
  // The only static leaflet reference is the type-only import, which is erased
  // at build time; any runtime `from "leaflet"` would pull it back in.
  assert.match(dialogSource, /^import type L from "leaflet";$/m);
  assert.equal(dialogSource.split('from "leaflet"').length - 1, 1);
});
