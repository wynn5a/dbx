import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  DATABASE_FUNCTION_DESCRIPTIONS,
  DATABASE_FUNCTION_SIGNATURES,
  buildSqlCompletionItems,
  getSqlFunctionSignatureHelp,
} from "../../apps/desktop/src/lib/sqlCompletion.ts";
import type { DatabaseType } from "../../apps/desktop/src/types/database.ts";

// Representative samples per new dialect — kept broad on purpose so both the
// catalog contents and the completion wiring stay locked.
const CLICKHOUSE_FUNCTIONS = [
  "countIf",
  "uniq",
  "uniqExact",
  "groupArray",
  "median",
  "argMax",
  "replaceAll",
  "splitByString",
  "toYYYYMM",
  "toStartOfDay",
  "dateDiff",
  "formatDateTime",
  "arrayJoin",
  "arrayMap",
  "hasAll",
  "toDateTime",
  "toTypeName",
  "multiIf",
  "ifNull",
  "cityHash64",
  "generateUUIDv4",
];

const DUCKDB_FUNCTIONS = [
  "list",
  "arg_max",
  "quantile_cont",
  "histogram",
  "list_transform",
  "list_filter",
  "struct_pack",
  "struct_extract",
  "map_extract",
  "date_trunc",
  "strftime",
  "strptime",
  "epoch_ms",
  "json_extract_string",
  "regexp_extract",
  "levenshtein",
  "ifnull",
  "approx_count_distinct",
];

const ORACLE_FUNCTIONS = [
  "LISTAGG",
  "NVL",
  "NVL2",
  "DECODE",
  "ADD_MONTHS",
  "MONTHS_BETWEEN",
  "TO_CHAR",
  "TO_DATE",
  "TRANSLATE",
  "REGEXP_LIKE",
  "RATIO_TO_REPORT",
  "SYS_CONNECT_BY_PATH",
  "JSON_EXISTS",
  "SYS_GUID",
  "TRUNC",
];

const DIALECT_CATALOGS: Array<{
  databaseType: DatabaseType;
  signatures: Map<string, string[]>;
  descriptions: Map<string, string>;
  expectedCount: number;
  samples: string[];
}> = [
  {
    databaseType: "clickhouse",
    signatures: DATABASE_FUNCTION_SIGNATURES.clickhouse,
    descriptions: DATABASE_FUNCTION_DESCRIPTIONS.clickhouse,
    expectedCount: 74,
    samples: CLICKHOUSE_FUNCTIONS,
  },
  {
    databaseType: "duckdb",
    signatures: DATABASE_FUNCTION_SIGNATURES.duckdb,
    descriptions: DATABASE_FUNCTION_DESCRIPTIONS.duckdb,
    expectedCount: 76,
    samples: DUCKDB_FUNCTIONS,
  },
  {
    databaseType: "oracle",
    signatures: DATABASE_FUNCTION_SIGNATURES.oracle,
    descriptions: DATABASE_FUNCTION_DESCRIPTIONS.oracle,
    expectedCount: 50,
    samples: ORACLE_FUNCTIONS,
  },
];

function functionItems(sql: string, databaseType: DatabaseType) {
  const items = buildSqlCompletionItems(sql, sql.length, {
    tables: [],
    columnsByTable: new Map(),
    databaseType,
  });
  return items.filter((item) => item.type === "function");
}

test("registers catalogs for ClickHouse, DuckDB and Oracle", () => {
  assert.deepEqual(Object.keys(DATABASE_FUNCTION_SIGNATURES).sort(), [
    "clickhouse",
    "dameng",
    "duckdb",
    "mysql",
    "oceanbase-oracle",
    "oracle",
    "postgres",
    "rqlite",
    "sqlite",
    "sqlserver",
    "yashandb",
  ]);
  for (const { databaseType, signatures } of DIALECT_CATALOGS) {
    assert.ok(signatures && signatures.size > 0, `${databaseType} catalog is registered`);
  }
});

test("new dialect catalogs are structurally complete", () => {
  for (const { databaseType, signatures, descriptions, expectedCount } of DIALECT_CATALOGS) {
    assert.ok(signatures && descriptions);
    assert.equal(signatures.size, expectedCount, `${databaseType}: no duplicate or missing function names`);
    assert.equal(descriptions.size, signatures.size, `${databaseType}: every function has a description`);
    assert.deepEqual(
      [...signatures.keys()].sort(),
      [...descriptions.keys()].sort(),
      `${databaseType}: description keys match signature keys`,
    );
    const upperNames = [...signatures.keys()].map((name) => name.toUpperCase());
    assert.equal(new Set(upperNames).size, upperNames.length, `${databaseType}: no case-insensitive duplicates`);
    for (const [name, parameters] of signatures) {
      assert.ok(Array.isArray(parameters), `${databaseType}.${name}: parameters are a list`);
      assert.ok(parameters.every((parameter) => typeof parameter === "string" && parameter.length > 0));
      assert.ok((descriptions.get(name) ?? "").length > 0, `${databaseType}.${name}: has a description`);
    }
  }
});

test("completes ClickHouse functions with signatures and descriptions", () => {
  const items = functionItems("select ", "clickhouse");
  const byLabel = new Map(items.map((item) => [item.label, item]));

  for (const name of CLICKHOUSE_FUNCTIONS) {
    const item = byLabel.get(name);
    assert.ok(item, `${name} is completed`);
    assert.equal(item.detail, DATABASE_FUNCTION_DESCRIPTIONS.clickhouse?.get(name));
    assert.ok(item.apply.startsWith(`${name}(`), `${name} applies a call template`);
  }

  const countIf = functionItems("select countI", "clickhouse").find((item) => item.label === "countIf");
  assert.ok(countIf);
  assert.equal(countIf.apply, "countIf(${condition})");

  const toYYYY = functionItems("select toYYYY", "clickhouse")
    .map((item) => item.label)
    .sort();
  assert.deepEqual(toYYYY, ["toYYYYMM", "toYYYYMMDD"]);

  const groupArray = functionItems("select groupAr", "clickhouse").find((item) => item.label === "groupArray");
  assert.ok(groupArray);
  assert.equal(groupArray.apply, "groupArray(${value})");

  const arrayJoin = functionItems("select arrayJ", "clickhouse").find((item) => item.label === "arrayJoin");
  assert.ok(arrayJoin);
  assert.equal(arrayJoin.apply, "arrayJoin(${array})");
});

test("completes DuckDB list, struct and JSON functions", () => {
  const items = functionItems("select ", "duckdb");
  const byLabel = new Map(items.map((item) => [item.label, item]));

  for (const name of DUCKDB_FUNCTIONS) {
    const item = byLabel.get(name);
    assert.ok(item, `${name} is completed`);
    assert.equal(item.detail, DATABASE_FUNCTION_DESCRIPTIONS.duckdb?.get(name));
    assert.ok(item.apply.startsWith(`${name}(`), `${name} applies a call template`);
  }

  const listTransform = functionItems("select list_trans", "duckdb").find((item) => item.label === "list_transform");
  assert.ok(listTransform);
  assert.equal(listTransform.apply, "list_transform(${list}, ${lambda})");

  const structExtract = functionItems("select struct_ex", "duckdb").find((item) => item.label === "struct_extract");
  assert.ok(structExtract);
  assert.equal(structExtract.apply, "struct_extract(${struct}, ${key})");

  const jsonExtract = functionItems("select json_extract", "duckdb")
    .map((item) => item.label)
    .sort();
  assert.deepEqual(jsonExtract, ["json_extract", "json_extract_string"]);
});

test("completes Oracle functions with signatures and descriptions", () => {
  const items = functionItems("select ", "oracle");
  const byLabel = new Map(items.map((item) => [item.label, item]));

  for (const name of ORACLE_FUNCTIONS) {
    const item = byLabel.get(name);
    assert.ok(item, `${name} is completed`);
    assert.equal(item.detail, DATABASE_FUNCTION_DESCRIPTIONS.oracle?.get(name));
    assert.ok(item.apply.startsWith(`${name}(`), `${name} applies a call template`);
  }

  const listagg = functionItems("select listagg", "oracle").find((item) => item.label === "LISTAGG");
  assert.ok(listagg);
  assert.equal(listagg.apply, "LISTAGG(${expression}, ${delimiter})");

  const nvl2 = functionItems("select nvl2", "oracle").find((item) => item.label === "NVL2");
  assert.ok(nvl2);
  assert.equal(nvl2.apply, "NVL2(${expression}, ${not_null_value}, ${null_value})");

  const addMonths = functionItems("select add_mon", "oracle").find((item) => item.label === "ADD_MONTHS");
  assert.ok(addMonths);
  assert.equal(addMonths.apply, "ADD_MONTHS(${date}, ${months})");
});

test("dialect catalogs do not leak into other dialects", () => {
  assert.equal(
    functionItems("select countI", "mysql").some((item) => item.label === "countIf"),
    false,
  );
  assert.equal(
    functionItems("select toYYYY", "postgres").some((item) => item.label === "toYYYYMM"),
    false,
  );
  assert.equal(
    functionItems("select list_trans", "clickhouse").some((item) => item.label === "list_transform"),
    false,
  );
  assert.equal(
    functionItems("select countI", "duckdb").some((item) => item.label === "countIf"),
    false,
  );
  assert.equal(
    functionItems("select listagg", "duckdb").some((item) => item.label === "LISTAGG"),
    false,
  );
  assert.equal(
    functionItems("select listagg", "postgres").some((item) => item.label === "LISTAGG"),
    false,
  );
  assert.equal(
    functionItems("select nvl2", "sqlite").some((item) => item.label === "NVL2"),
    false,
  );
  assert.equal(
    functionItems("select countI", "oracle").some((item) => item.label === "countIf"),
    false,
  );
});

test("signature help shows parameters for new dialect functions", () => {
  const toYYYYMM = getSqlFunctionSignatureHelp("select toYYYYMM(", "select toYYYYMM(".length, "clickhouse");
  assert.deepEqual(toYYYYMM, {
    name: "toYYYYMM",
    signature: "toYYYYMM(date)",
    activeParameter: 0,
    parameters: ["date"],
  });

  // Canonical spelling wins even when the query uppercases the name.
  const canonicalCase = getSqlFunctionSignatureHelp("SELECT TOYYYYMM(", "SELECT TOYYYYMM(".length, "clickhouse");
  assert.equal(canonicalCase?.name, "toYYYYMM");

  const dateDiff = getSqlFunctionSignatureHelp(
    "select dateDiff('day', start, ",
    "select dateDiff('day', start, ".length,
    "clickhouse",
  );
  assert.deepEqual(dateDiff, {
    name: "dateDiff",
    signature: "dateDiff(unit, start_date, end_date)",
    activeParameter: 2,
    parameters: ["unit", "start_date", "end_date"],
  });

  const listTransform = getSqlFunctionSignatureHelp(
    "select list_transform(tags, ",
    "select list_transform(tags, ".length,
    "duckdb",
  );
  assert.deepEqual(listTransform, {
    name: "list_transform",
    signature: "list_transform(list, lambda)",
    activeParameter: 1,
    parameters: ["list", "lambda"],
  });

  const nvl = getSqlFunctionSignatureHelp("select nvl(discount, ", "select nvl(discount, ".length, "oracle");
  assert.deepEqual(nvl, {
    name: "NVL",
    signature: "NVL(expression, fallback)",
    activeParameter: 1,
    parameters: ["expression", "fallback"],
  });

  const addMonths = getSqlFunctionSignatureHelp("select add_months(", "select add_months(".length, "oracle");
  assert.equal(addMonths?.activeParameter, 0);
  assert.equal(addMonths?.signature, "ADD_MONTHS(date, months)");
});

test("signature help keeps shared functions and generic behavior", () => {
  // Common functions resolve through the shared catalog even with a dialect.
  const coalesce = getSqlFunctionSignatureHelp("select coalesce(a, ", "select coalesce(a, ".length, "oracle");
  assert.deepEqual(coalesce, {
    name: "COALESCE",
    signature: "COALESCE(value, ...values)",
    activeParameter: 1,
    parameters: ["value", "...values"],
  });

  // Without a connection type, dialect-only functions stay unknown (unchanged).
  assert.equal(getSqlFunctionSignatureHelp("select toYYYYMM(", "select toYYYYMM(".length), null);
  assert.equal(getSqlFunctionSignatureHelp("select nvl(discount, ", "select nvl(discount, ".length), null);
});

test("existing dialect function catalogs are unchanged", () => {
  // Reference sharing and entry counts for the five pre-existing catalogs.
  assert.equal(DATABASE_FUNCTION_SIGNATURES.mysql?.size, 5);
  assert.equal(DATABASE_FUNCTION_SIGNATURES.postgres?.size, 7);
  assert.equal(DATABASE_FUNCTION_SIGNATURES.sqlite?.size, 4);
  assert.equal(DATABASE_FUNCTION_SIGNATURES.sqlserver?.size, 5);
  assert.equal(DATABASE_FUNCTION_SIGNATURES.rqlite, DATABASE_FUNCTION_SIGNATURES.sqlite);

  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.mysql?.get("DATE_FORMAT"), ["date", "format"]);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.mysql?.get("GROUP_CONCAT"), ["expression"]);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.postgres?.get("JSONB_BUILD_OBJECT"), ["key", "value", "...pairs"]);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.postgres?.get("GEN_RANDOM_UUID"), []);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.sqlite?.get("STRFTIME"), ["format", "time"]);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.sqlite?.get("IFNULL"), ["expression", "fallback"]);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.sqlserver?.get("TRY_CAST"), ["expression AS type"]);
  assert.deepEqual(DATABASE_FUNCTION_SIGNATURES.sqlserver?.get("NEWID"), []);

  // The catalogs still surface through completion with their exact parameters.
  const dateFormat = functionItems("select date_f", "mysql").find((item) => item.label === "DATE_FORMAT");
  assert.equal(dateFormat?.apply, "DATE_FORMAT(${date}, ${format})");
  const jsonbBuildObject = functionItems("select jsonb_b", "postgres").find(
    (item) => item.label === "JSONB_BUILD_OBJECT",
  );
  assert.equal(jsonbBuildObject?.apply, "JSONB_BUILD_OBJECT(${key}, ${value}, ${...pairs})");
  const strftime = functionItems("select strft", "sqlite").find((item) => item.label === "STRFTIME");
  assert.equal(strftime?.apply, "STRFTIME(${format}, ${time})");
  const tryCast = functionItems("select try_c", "sqlserver").find((item) => item.label === "TRY_CAST");
  assert.equal(tryCast?.apply, "TRY_CAST(${expression AS type})");
  const ifnull = functionItems("select ifn", "rqlite").find((item) => item.label === "IFNULL");
  assert.equal(ifnull?.apply, "IFNULL(${expression}, ${fallback})");
});

test("Oracle niladic pseudo-functions insert without parentheses and get no signature card", () => {
  // T24 review: `SELECT sysd` used to insert `SYSDATE()` — ORA-00923.
  for (const name of ["SYSDATE", "SYSTIMESTAMP", "CURRENT_DATE", "CURRENT_TIMESTAMP", "LOCALTIMESTAMP"]) {
    const sql = `SELECT ${name.slice(0, 5).toLowerCase()}`;
    const item = functionItems(sql, "oracle").find((candidate) => candidate.label === name);
    assert.ok(item, `${name} is offered`);
    assert.equal(item.apply, name, `${name} inserts bare`);
  }
  for (const name of ["SESSIONTIMEZONE", "DBTIMEZONE"]) {
    const item = functionItems(`SELECT ${name.slice(0, 4).toLowerCase()}`, "oracle").find((c) => c.label === name);
    assert.equal(item?.apply, name);
  }
  // Real functions keep their argument list.
  assert.equal(
    functionItems("SELECT add_mo", "oracle").find((item) => item.label === "ADD_MONTHS")?.apply,
    "ADD_MONTHS(${date}, ${months})",
  );
  assert.equal(getSqlFunctionSignatureHelp("SELECT SYSDATE(", "SELECT SYSDATE(".length, "oracle"), null);
  assert.ok(getSqlFunctionSignatureHelp("SELECT ADD_MONTHS(", "SELECT ADD_MONTHS(".length, "oracle"));
  // Niladic handling is Oracle-only: other engines keep `NOW()`.
  assert.equal(functionItems("SELECT now", "mysql").find((item) => item.label === "NOW")?.apply, "NOW()");
});

test("Oracle-family engines get the Oracle function catalog", () => {
  for (const databaseType of ["dameng", "yashandb", "oceanbase-oracle"] as const) {
    assert.equal(DATABASE_FUNCTION_SIGNATURES[databaseType], DATABASE_FUNCTION_SIGNATURES.oracle, databaseType);
    const items = functionItems("SELECT nvl", databaseType);
    assert.ok(items.some((item) => item.label === "NVL2"), `${databaseType} offers NVL2`);
    assert.equal(functionItems("SELECT sysd", databaseType).find((item) => item.label === "SYSDATE")?.apply, "SYSDATE");
  }
});
