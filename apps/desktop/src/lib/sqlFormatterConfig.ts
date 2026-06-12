const CASE_VALUES = ["preserve", "upper", "lower"] as const;
const LOGICAL_OPERATOR_NEWLINE_VALUES = ["before", "after"] as const;
const TAB_WIDTH_VALUES = [2, 4] as const;
const EXPRESSION_WIDTH_VALUES = [50, 80, 120] as const;
const LINES_BETWEEN_QUERIES_VALUES = [0, 1, 2] as const;

export type SqlFormatterCase = (typeof CASE_VALUES)[number];
export type SqlFormatterLogicalOperatorNewline = (typeof LOGICAL_OPERATOR_NEWLINE_VALUES)[number];
export type SqlFormatterTabWidth = (typeof TAB_WIDTH_VALUES)[number];
export type SqlFormatterExpressionWidth = (typeof EXPRESSION_WIDTH_VALUES)[number];
export type SqlFormatterLinesBetweenQueries = (typeof LINES_BETWEEN_QUERIES_VALUES)[number];

export interface SqlFormatterSettings {
  keywordCase: SqlFormatterCase;
  dataTypeCase: SqlFormatterCase;
  functionCase: SqlFormatterCase;
  useTabs: boolean;
  tabWidth: SqlFormatterTabWidth;
  logicalOperatorNewline: SqlFormatterLogicalOperatorNewline;
  expressionWidth: SqlFormatterExpressionWidth;
  linesBetweenQueries: SqlFormatterLinesBetweenQueries;
  denseOperators: boolean;
  newlineBeforeSemicolon: boolean;
}

export const DEFAULT_SQL_FORMATTER_SETTINGS: SqlFormatterSettings = {
  keywordCase: "upper",
  dataTypeCase: "preserve",
  functionCase: "preserve",
  useTabs: false,
  tabWidth: 2,
  logicalOperatorNewline: "before",
  expressionWidth: 50,
  linesBetweenQueries: 1,
  denseOperators: false,
  newlineBeforeSemicolon: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeChoice<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}

function normalizeNumberChoice<T extends readonly number[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === "number" && values.includes(value) ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSqlFormatterSettings(value: unknown): SqlFormatterSettings {
  const input = isObject(value) ? value : {};
  return {
    keywordCase: normalizeChoice(input.keywordCase, CASE_VALUES, DEFAULT_SQL_FORMATTER_SETTINGS.keywordCase),
    dataTypeCase: normalizeChoice(input.dataTypeCase, CASE_VALUES, DEFAULT_SQL_FORMATTER_SETTINGS.dataTypeCase),
    functionCase: normalizeChoice(input.functionCase, CASE_VALUES, DEFAULT_SQL_FORMATTER_SETTINGS.functionCase),
    useTabs: normalizeBoolean(input.useTabs, DEFAULT_SQL_FORMATTER_SETTINGS.useTabs),
    tabWidth: normalizeNumberChoice(input.tabWidth, TAB_WIDTH_VALUES, DEFAULT_SQL_FORMATTER_SETTINGS.tabWidth),
    logicalOperatorNewline: normalizeChoice(
      input.logicalOperatorNewline,
      LOGICAL_OPERATOR_NEWLINE_VALUES,
      DEFAULT_SQL_FORMATTER_SETTINGS.logicalOperatorNewline,
    ),
    expressionWidth: normalizeNumberChoice(
      input.expressionWidth,
      EXPRESSION_WIDTH_VALUES,
      DEFAULT_SQL_FORMATTER_SETTINGS.expressionWidth,
    ),
    linesBetweenQueries: normalizeNumberChoice(
      input.linesBetweenQueries,
      LINES_BETWEEN_QUERIES_VALUES,
      DEFAULT_SQL_FORMATTER_SETTINGS.linesBetweenQueries,
    ),
    denseOperators: normalizeBoolean(input.denseOperators, DEFAULT_SQL_FORMATTER_SETTINGS.denseOperators),
    newlineBeforeSemicolon: normalizeBoolean(
      input.newlineBeforeSemicolon,
      DEFAULT_SQL_FORMATTER_SETTINGS.newlineBeforeSemicolon,
    ),
  };
}

export function sqlFormatterOptions(settings: unknown) {
  const normalized = normalizeSqlFormatterSettings(settings);
  return {
    keywordCase: normalized.keywordCase,
    dataTypeCase: normalized.dataTypeCase,
    functionCase: normalized.functionCase,
    useTabs: normalized.useTabs,
    tabWidth: normalized.tabWidth,
    logicalOperatorNewline: normalized.logicalOperatorNewline,
    expressionWidth: normalized.expressionWidth,
    linesBetweenQueries: normalized.linesBetweenQueries,
    denseOperators: normalized.denseOperators,
    newlineBeforeSemicolon: normalized.newlineBeforeSemicolon,
  };
}
