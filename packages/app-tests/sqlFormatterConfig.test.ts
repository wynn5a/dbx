import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DEFAULT_SQL_FORMATTER_SETTINGS,
  normalizeSqlFormatterSettings,
  sqlFormatterOptions,
} from "../../apps/desktop/src/lib/sqlFormatterConfig.ts";

test("normalizes empty formatter settings to defaults", () => {
  assert.deepEqual(normalizeSqlFormatterSettings({}), DEFAULT_SQL_FORMATTER_SETTINGS);
});

test("keeps valid formatter settings and clamps invalid values", () => {
  const settings = normalizeSqlFormatterSettings({
    keywordCase: "lower",
    dataTypeCase: "upper",
    functionCase: "lower",
    useTabs: true,
    tabWidth: 4,
    logicalOperatorNewline: "after",
    expressionWidth: 120,
    linesBetweenQueries: 2,
    denseOperators: true,
    newlineBeforeSemicolon: true,
  });

  assert.deepEqual(settings, {
    keywordCase: "lower",
    dataTypeCase: "upper",
    functionCase: "lower",
    useTabs: true,
    tabWidth: 4,
    logicalOperatorNewline: "after",
    expressionWidth: 120,
    linesBetweenQueries: 2,
    denseOperators: true,
    newlineBeforeSemicolon: true,
  });

  assert.deepEqual(
    normalizeSqlFormatterSettings({
      keywordCase: "camel",
      dataTypeCase: "invalid",
      functionCase: "invalid",
      useTabs: "yes",
      tabWidth: 99,
      logicalOperatorNewline: "middle",
      expressionWidth: -1,
      linesBetweenQueries: 9,
      denseOperators: "true",
      newlineBeforeSemicolon: "false",
    }),
    DEFAULT_SQL_FORMATTER_SETTINGS,
  );
});

test("maps DBX formatter settings to sql-formatter options", () => {
  assert.deepEqual(
    sqlFormatterOptions({
      ...DEFAULT_SQL_FORMATTER_SETTINGS,
      keywordCase: "lower",
      useTabs: true,
      newlineBeforeSemicolon: true,
    }),
    {
      keywordCase: "lower",
      dataTypeCase: "preserve",
      functionCase: "preserve",
      useTabs: true,
      tabWidth: 2,
      logicalOperatorNewline: "before",
      expressionWidth: 50,
      linesBetweenQueries: 1,
      denseOperators: false,
      newlineBeforeSemicolon: true,
    },
  );
});
