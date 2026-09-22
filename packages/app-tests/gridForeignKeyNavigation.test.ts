import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  buildForeignKeyNavigationTarget,
  buildForeignKeyWhereInput,
  foreignKeyByColumnName,
  foreignKeyForColumn,
  formatForeignKeyCellLiteral,
  formatForeignKeyTargetLabel,
  isForeignKeyCellValueNavigable,
} from "../../apps/desktop/src/lib/gridForeignKeyNavigation.ts";
import type { ForeignKeyInfo } from "../../apps/desktop/src/types/database.ts";

const LOCALES = ["en", "es", "it", "pt-BR", "zh-CN", "zh-TW"] as const;

function fk(overrides: Partial<ForeignKeyInfo> = {}): ForeignKeyInfo {
  return {
    name: "fk_orders_customer",
    column: "customer_id",
    ref_table: "customers",
    ref_column: "id",
    ...overrides,
  };
}

test("foreignKeyByColumnName indexes FKs by lowercased column and keeps the first per column", () => {
  const byColumn = foreignKeyByColumnName([
    fk(),
    fk({ name: "fk_other", column: "CUSTOMER_ID", ref_table: "other" }),
    fk({ column: "region", ref_table: "regions", ref_column: "code" }),
  ]);
  assert.equal(byColumn.size, 2);
  assert.equal(byColumn.get("customer_id")?.ref_table, "customers");
  assert.equal(byColumn.get("region")?.ref_table, "regions");
});

test("foreignKeyByColumnName skips FKs without a column name", () => {
  const byColumn = foreignKeyByColumnName([fk({ column: "" })]);
  assert.equal(byColumn.size, 0);
});

test("foreignKeyForColumn resolves case-insensitively and tolerates missing names", () => {
  const byColumn = foreignKeyByColumnName([fk()]);
  assert.equal(foreignKeyForColumn(byColumn, "Customer_Id")?.ref_table, "customers");
  assert.equal(foreignKeyForColumn(byColumn, "unknown"), undefined);
  assert.equal(foreignKeyForColumn(byColumn, undefined), undefined);
});

test("only non-null scalar cells are FK-navigable", () => {
  assert.equal(isForeignKeyCellValueNavigable(42), true);
  assert.equal(isForeignKeyCellValueNavigable(3.14), true);
  assert.equal(isForeignKeyCellValueNavigable(-7), true);
  assert.equal(isForeignKeyCellValueNavigable(0), true);
  assert.equal(isForeignKeyCellValueNavigable("abc"), true);
  assert.equal(isForeignKeyCellValueNavigable(""), true);
  assert.equal(isForeignKeyCellValueNavigable(true), true);
  assert.equal(isForeignKeyCellValueNavigable(false), true);
  assert.equal(isForeignKeyCellValueNavigable(null), false);
  assert.equal(isForeignKeyCellValueNavigable(undefined), false);
  assert.equal(isForeignKeyCellValueNavigable(Number.NaN), false);
  assert.equal(isForeignKeyCellValueNavigable(Number.POSITIVE_INFINITY), false);
  assert.equal(isForeignKeyCellValueNavigable([1, 2]), false);
  assert.equal(isForeignKeyCellValueNavigable({ a: 1 }), false);
});

test("numeric and boolean literals are emitted unquoted", () => {
  assert.equal(formatForeignKeyCellLiteral(42, "postgres"), "42");
  assert.equal(formatForeignKeyCellLiteral(3.14, "sqlite"), "3.14");
  assert.equal(formatForeignKeyCellLiteral(-7, undefined), "-7");
  assert.equal(formatForeignKeyCellLiteral(true, "postgres"), "TRUE");
  assert.equal(formatForeignKeyCellLiteral(false, "mysql"), "FALSE");
});

test("string literals escape quotes on every dialect", () => {
  assert.equal(formatForeignKeyCellLiteral("abc", "postgres"), "'abc'");
  assert.equal(formatForeignKeyCellLiteral("O'Reilly", "postgres"), "'O''Reilly'");
  assert.equal(formatForeignKeyCellLiteral("O'Reilly", "sqlite"), "'O''Reilly'");
  assert.equal(formatForeignKeyCellLiteral("O'Reilly", undefined), "'O''Reilly'");
});

test("backslashes are doubled only for MySQL-family dialects", () => {
  assert.equal(formatForeignKeyCellLiteral("a\\b", "postgres"), "'a\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "sqlite"), "'a\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "sqlserver"), "N'a\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "mysql"), "'a\\\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "doris"), "'a\\\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "starrocks"), "'a\\\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "goldendb"), "'a\\\\b'");
  assert.equal(formatForeignKeyCellLiteral("a\\b", "sundb"), "'a\\\\b'");
});

test("sqlserver string literals use the N prefix", () => {
  assert.equal(formatForeignKeyCellLiteral("abc", "sqlserver"), "N'abc'");
  assert.equal(formatForeignKeyCellLiteral("O'Reilly", "sqlserver"), "N'O''Reilly'");
});

test("buildForeignKeyWhereInput quotes the ref column per dialect and types the value", () => {
  assert.equal(
    buildForeignKeyWhereInput({ foreignKey: fk(), value: 42, databaseType: "postgres" }),
    `"id" = 42`,
  );
  assert.equal(
    buildForeignKeyWhereInput({ foreignKey: fk(), value: "O'Reilly", databaseType: "mysql" }),
    "`id` = 'O''Reilly'",
  );
  assert.equal(
    buildForeignKeyWhereInput({ foreignKey: fk({ ref_column: "User Id" }), value: 7, databaseType: "sqlserver" }),
    "[User Id] = 7",
  );
  assert.equal(
    buildForeignKeyWhereInput({ foreignKey: fk({ ref_column: 'say "hi"' }), value: 7, databaseType: "sqlite" }),
    `"say ""hi""" = 7`,
  );
});

test("buildForeignKeyWhereInput refuses non-navigable cells and incomplete FKs", () => {
  assert.equal(buildForeignKeyWhereInput({ foreignKey: fk(), value: null, databaseType: "postgres" }), null);
  assert.equal(buildForeignKeyWhereInput({ foreignKey: fk(), value: undefined }), null);
  assert.equal(buildForeignKeyWhereInput({ foreignKey: fk(), value: [1] }), null);
  assert.equal(
    buildForeignKeyWhereInput({ foreignKey: fk({ ref_column: "" }), value: 1, databaseType: "postgres" }),
    null,
  );
  assert.equal(
    buildForeignKeyWhereInput({ foreignKey: fk({ ref_table: "" }), value: 1, databaseType: "postgres" }),
    null,
  );
});

test("formatForeignKeyTargetLabel prefixes the ref schema when present", () => {
  assert.equal(formatForeignKeyTargetLabel(fk()), "customers.id");
  assert.equal(formatForeignKeyTargetLabel(fk({ ref_schema: "public" })), "public.customers.id");
  assert.equal(formatForeignKeyTargetLabel(fk({ ref_schema: "  " })), "customers.id");
});

test("buildForeignKeyNavigationTarget prefers the FK ref schema and falls back to the current schema", () => {
  const target = buildForeignKeyNavigationTarget({
    connectionId: "c1",
    database: "app_dev",
    schema: "sales",
    databaseType: "postgres",
    foreignKey: fk({ ref_schema: "public" }),
    value: 42,
  });
  assert.deepEqual(target, {
    connectionId: "c1",
    database: "app_dev",
    schema: "public",
    tableName: "customers",
    whereInput: `"id" = 42`,
  });
});

test("buildForeignKeyNavigationTarget falls back to the current schema when the FK has no ref schema", () => {
  const target = buildForeignKeyNavigationTarget({
    connectionId: "c1",
    database: "app_dev",
    schema: "sales",
    databaseType: "postgres",
    foreignKey: fk(),
    value: "abc",
  });
  assert.ok(target);
  assert.equal(target.schema, "sales");
  assert.equal(target.whereInput, `"id" = 'abc'`);
});

test("buildForeignKeyNavigationTarget handles schema-less databases", () => {
  const target = buildForeignKeyNavigationTarget({
    connectionId: "c1",
    database: "main.db",
    schema: undefined,
    databaseType: "sqlite",
    foreignKey: fk(),
    value: 42,
  });
  assert.ok(target);
  assert.equal(target.schema, undefined);
  assert.equal(target.whereInput, `"id" = 42`);
});

test("buildForeignKeyNavigationTarget refuses NULL cells and unknown connections", () => {
  assert.equal(
    buildForeignKeyNavigationTarget({
      connectionId: "c1",
      database: "db",
      foreignKey: fk(),
      value: null,
    }),
    null,
  );
  assert.equal(
    buildForeignKeyNavigationTarget({
      connectionId: undefined,
      database: "db",
      foreignKey: fk(),
      value: 42,
    }),
    null,
  );
});

test("DataGrid wires FK navigation: eager fetch, click handlers, canvas affordance and emit", () => {
  const source = readFileSync(new URL("../../apps/desktop/src/components/grid/DataGrid.vue", import.meta.url), "utf8");
  // The pure helpers come from the lib module (no local re-derivation).
  assert.match(source, /from "@\/lib\/gridForeignKeyNavigation"/);
  // FK metadata is warmed for the current table even when the drawer is closed:
  // once in the table-change watch, once at setup.
  assert.equal(source.split("void fetchForeignKeys();").length - 1, 2);
  // The grid emits a navigation target for the parent to open.
  assert.match(source, /"open-fk-target": \[target: ForeignKeyNavigationTarget\]/);
  // DOM cells: click handler, pointer cursor and target tooltip only when the
  // cell has FK metadata and a navigable value.
  assert.match(source, /@click="onDataCellClick\(item, col\.actualColIdx, \$event\)"/);
  assert.match(source, /'cursor-pointer': !!foreignKeyCell\(item, col\.actualColIdx\)/);
  assert.match(source, /:title="foreignKeyCellTitle\(item, col\.actualColIdx\)"/);
  assert.match(source, /class="underline-offset-2 group-hover\/cell:underline"/);
  // Canvas cells: hover underline option plus a click handler guarded to the
  // mousedown cell so drags never navigate.
  assert.match(source, /isForeignKeyCell: \(row, actualColIdx\) => !!foreignKeyCell\(row, actualColIdx\)/);
  assert.match(source, /@click="onCanvasClick"/);
  assert.match(source, /canvasMouseDownCell\.value =\n\s+hit && !hit\.rowNumber/);
  // Both handlers navigate on the platform modifier only, after the cell passed
  // the navigable check (no metadata / NULL / composite value -> plain select).
  assert.equal(source.split("if (!(event.metaKey || event.ctrlKey)) return;").length - 1, 2);
  assert.match(source, /modifier: isMacOS\(\) \? "Cmd" : "Ctrl"/);
});

test("canvas renderer underlines the hovered FK cell text with the theme link color", () => {
  const source = readFileSync(
    new URL("../../apps/desktop/src/lib/canvasDataGridRenderer.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /isForeignKeyCell: \(row: CanvasDataGridRow, actualColIdx: number\) => boolean;/);
  assert.match(source, /const hoveredForeignKeyCell =/);
  assert.match(source, /ctx\.strokeStyle = theme\.primary;\n\s+ctx\.beginPath\(\);/);
});

test("ContentArea forwards the FK navigation emit from DataGrid", () => {
  const source = readFileSync(new URL("../../apps/desktop/src/components/layout/ContentArea.vue", import.meta.url), "utf8");
  assert.match(source, /openForeignKeyTarget: \[target: ForeignKeyNavigationTarget\]/);
  assert.match(source, /@open-fk-target="\(target\) => emit\('openForeignKeyTarget', target\)"/);
});

test("App.vue opens FK navigation targets through the existing navigation helper", () => {
  const source = readFileSync(new URL("../../apps/desktop/src/App.vue", import.meta.url), "utf8");
  assert.match(source, /@open-fk-target="openTableTarget"/);
});

test("the FK navigation tooltip is translated in all six locales with modifier and target slots", () => {
  for (const locale of LOCALES) {
    const source = readFileSync(
      new URL(`../../apps/desktop/src/i18n/locales/${locale}.ts`, import.meta.url),
      "utf8",
    );
    const match = source.match(/foreignKeyNavigateHint: "([^"]+)"/);
    assert.ok(match, `${locale} defines grid.foreignKeyNavigateHint`);
    assert.ok(match[1].includes("{modifier}"), `${locale} hint interpolates the modifier`);
    assert.ok(match[1].includes("{target}"), `${locale} hint interpolates the target`);
  }
});
