import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  appendColumnValueFilterCondition,
  buildColumnValueFilterCondition,
} from "../../apps/desktop/src/lib/dataGridColumnFilter.ts";

function installFilterInvokeMock() {
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd !== "build_data_grid_column_value_filter_condition") {
          throw new Error("unexpected command: " + cmd);
        }
        const options = (args ?? {}).options as {
          databaseType?: string;
          columnName: string;
          rawValue?: string;
        };
        const quote =
          options.databaseType === "mysql"
            ? (name: string) => `\`${name}\``
            : options.databaseType === "sqlserver"
              ? (name: string) => `[${name}]`
              : (name: string) => `"${name}"`;
        const text = String(options.rawValue ?? "").trim();
        const result = /^null$/i.test(text)
          ? `${quote(options.columnName)} IS NULL`
          : `${quote(options.columnName)} = ${/^\d+$/.test(text) ? text : `'${text}'`}`;
        return result;
      },
    },
  };
}

test("builds a numeric server-side column filter from typed text", async () => {
  installFilterInvokeMock();
  const condition = await buildColumnValueFilterCondition({
    databaseType: "mysql",
    columnName: "id",
    columnInfo: { name: "id", data_type: "int", is_nullable: false, is_primary_key: true },
    rawValue: "49436",
  });

  assert.equal(condition, "`id` = 49436");
});

test("quotes text server-side column filters and appends them to existing WHERE input", async () => {
  installFilterInvokeMock();
  const condition = await buildColumnValueFilterCondition({
    databaseType: "postgres",
    columnName: "status",
    columnInfo: { name: "status", data_type: "varchar", is_nullable: true, is_primary_key: false },
    rawValue: "active",
  });

  assert.equal(condition, `"status" = 'active'`);
  assert.equal(appendColumnValueFilterCondition("deleted_at IS NULL", condition), `(deleted_at IS NULL) AND ("status" = 'active')`);
});

test("builds IS NULL for typed NULL filters", async () => {
  installFilterInvokeMock();
  const condition = await buildColumnValueFilterCondition({
    databaseType: "sqlserver",
    columnName: "archived_at",
    rawValue: "NULL",
  });

  assert.equal(condition, "[archived_at] IS NULL");
});
