import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  coerceDataGridCellValue,
  dataGridCellDisplayText,
  dataGridCellEditorText,
} from "../../apps/desktop/src/lib/dataGridCellCoercion.ts";

test("formats Postgres array cells with native brace syntax", () => {
  const columnInfo = { data_type: "_text" };

  assert.equal(
    dataGridCellDisplayText({
      value: ["draft", "发布", "needs space"],
      databaseType: "postgres",
      columnInfo,
    }),
    '{draft,发布,"needs space"}',
  );
  assert.equal(
    dataGridCellEditorText({
      value: ["draft", "发布", "needs space"],
      databaseType: "postgres",
      columnInfo,
    }),
    '{draft,发布,"needs space"}',
  );
});

test("coerces JSON style input for Postgres array columns", () => {
  assert.deepEqual(
    coerceDataGridCellValue({
      value: `["draft","发布"]`,
      oldValue: "{legacy}",
      databaseType: "postgres",
      columnInfo: { data_type: "_text" },
    }),
    ["draft", "发布"],
  );
});

test("coerces PG brace-style input for Postgres array columns", () => {
  assert.deepEqual(
    coerceDataGridCellValue({
      value: "{1,2,3}",
      oldValue: [1, 2, 3],
      databaseType: "postgres",
      columnInfo: { data_type: "_int4" },
    }),
    [1, 2, 3],
  );
});

test("coerces PG brace-style string array", () => {
  assert.deepEqual(
    coerceDataGridCellValue({
      value: `{draft,"needs space",发布}`,
      oldValue: [],
      databaseType: "postgres",
      columnInfo: { data_type: "_text" },
    }),
    ["draft", "needs space", "发布"],
  );
});

test("coerces PG brace-style array with NULL", () => {
  assert.deepEqual(
    coerceDataGridCellValue({
      value: "{1,NULL,3}",
      oldValue: [],
      databaseType: "postgres",
      columnInfo: { data_type: "_int4" },
    }),
    [1, null, 3],
  );
});

test("coerces empty PG brace-style array", () => {
  assert.deepEqual(
    coerceDataGridCellValue({
      value: "{}",
      oldValue: [],
      databaseType: "postgres",
      columnInfo: { data_type: "_int4" },
    }),
    [],
  );
});

test("PG array round-trip: format -> coerce -> same values", () => {
  const original = ["draft", "发布", "needs space"];
  const columnInfo = { data_type: "_text" };

  const formatted = dataGridCellEditorText({
    value: original,
    databaseType: "postgres",
    columnInfo,
  });

  const coerced = coerceDataGridCellValue({
    value: formatted,
    oldValue: undefined,
    databaseType: "postgres",
    columnInfo,
  });

  assert.deepEqual(coerced as string[], original);
});

test("unchanged PG array value returns oldValue reference to avoid false dirty", () => {
  const oldValue = [1, 2, 3];

  const formatted = dataGridCellEditorText({
    value: oldValue,
    databaseType: "postgres",
    columnInfo: { data_type: "_int4" },
  });

  const result = coerceDataGridCellValue({
    value: formatted,
    oldValue,
    databaseType: "postgres",
    columnInfo: { data_type: "_int4" },
  });

  assert.strictEqual(result, oldValue);
});

test("changed PG array value returns new array reference", () => {
  const oldValue = [1, 2, 3];
  const newText = "{1,2,3,4}";

  const result = coerceDataGridCellValue({
    value: newText,
    oldValue,
    databaseType: "postgres",
    columnInfo: { data_type: "_int4" },
  });

  assert.notStrictEqual(result, oldValue);
  assert.deepEqual(result, [1, 2, 3, 4]);
});

const coerceJson = (value: string) =>
  coerceDataGridCellValue({
    value,
    oldValue: "{}",
    databaseType: "mysql",
    columnInfo: { data_type: "json" },
  });

test("normalizes curly smart quotes in hand-typed JSON", () => {
  // U+201C / U+201D, as inserted by macOS smart punctuation / Chinese IME.
  assert.equal(coerceJson("{“name”:“发布”}"), '{"name":"发布"}');
});

test("normalizes low-9 and high-reversed-9 smart quotes in JSON", () => {
  // U+201E / U+201F.
  assert.equal(coerceJson("{„key‟:„value‟}"), '{"key":"value"}');
});

test("normalizes fullwidth quotes in JSON", () => {
  // U+FF02.
  assert.equal(coerceJson("{＂a＂:＂1＂}"), '{"a":"1"}');
});

test("normalizes smart quotes in a JSON array", () => {
  assert.equal(coerceJson("[“a”,“b”]"), '["a","b"]');
});

test("leaves valid JSON containing smart quotes inside a string untouched", () => {
  const input = '{"note":"he said “hi”"}';
  assert.equal(coerceJson(input), input);
});

test("leaves non-JSON text with smart quotes untouched", () => {
  const input = "she said “hello”";
  assert.equal(coerceJson(input), input);
});

test("leaves plain ASCII JSON untouched", () => {
  assert.equal(coerceJson('{"a":1}'), '{"a":1}');
});
