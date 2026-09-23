import type { DatabaseType, SqlSnippet } from "@/types/database";
import type { SqlDialect } from "@/lib/sqlDialect";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "ASC",
  "DESC",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "DISTINCT",
  "UNION",
  "ALL",
  "EXISTS",
  "BETWEEN",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "IF",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "IIF",
  "CHOOSE",
  "COALESCE",
  "CAST",
  "ALTER",
  "DROP",
  "ADD",
  "COLUMN",
  "INDEX",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "DEFAULT",
  "CHECK",
  "UNIQUE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRUNCATE",
  "EXPLAIN",
  "ANALYZE",
  "WITH",
  "RECURSIVE",
  "OVER",
  "PARTITION BY",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
  "FIRST_VALUE",
  "LAST_VALUE",
  "NTILE",
  "CROSS",
  "APPLY",
  "CROSS APPLY",
  "OUTER APPLY",
  "ISJSON",
  "JSON_ARRAY",
  "JSON_ARRAYAGG",
  "JSON_ARRAY_APPEND",
  "JSON_ARRAY_INSERT",
  "JSON_CONTAINS",
  "JSON_CONTAINS_PATH",
  "JSON_DEPTH",
  "JSON_EXTRACT",
  "JSON_INSERT",
  "JSON_KEYS",
  "JSON_LENGTH",
  "JSON_MERGE_PATCH",
  "JSON_MERGE_PRESERVE",
  "JSON_MODIFY",
  "JSON_OBJECT",
  "JSON_OBJECTAGG",
  "JSON_OVERLAPS",
  "JSON_PATH_EXISTS",
  "JSON_PRETTY",
  "JSON_QUERY",
  "JSON_QUOTE",
  "JSON_REMOVE",
  "JSON_REPLACE",
  "JSON_SCHEMA_VALID",
  "JSON_SEARCH",
  "JSON_SET",
  "JSON_STORAGE_FREE",
  "JSON_STORAGE_SIZE",
  "JSON_TABLE",
  "JSON_TYPE",
  "JSON_UNQUOTE",
  "JSON_VALID",
  "JSON_VALUE",
  "OPENJSON",
  "OPENXML",
  "OPENROWSET",
  "FULL",
  "NATURAL",
  "USING",
  "LATERAL",
  "UNNEST",
  "FILTER",
  "EXCLUDE",
  "REPLACE",
  "QUALIFY",
  "PIVOT",
  "UNPIVOT",
  "ASOF",
  "POSITIONAL",
  "ANTI",
  "SEMI",
  "SAMPLE",
  "TABLESAMPLE",
  "STRUCT",
  "MAP",
  "LIST",
  "ARRAY",
  "LAMBDA",
  "LIST_TRANSFORM",
  "READ_CSV",
  "READ_PARQUET",
  "READ_JSON",
  "COPY",
  "EXPORT",
  "IMPORT",
  "DESCRIBE",
  "SHOW",
  "SUMMARIZE",
  "PRAGMA",
  "BIGINT",
  "BINARY",
  "BIT",
  "CHAR",
  "DATE",
  "DATETIME",
  "DATETIME2",
  "DATETIMEOFFSET",
  "DECIMAL",
  "FLOAT",
  "IMAGE",
  "INT",
  "MONEY",
  "NCHAR",
  "NTEXT",
  "NUMERIC",
  "NVARCHAR",
  "REAL",
  "SMALLDATETIME",
  "SMALLINT",
  "SMALLMONEY",
  "TEXT",
  "TIME",
  "TIMESTAMP",
  "TINYINT",
  "UNIQUEIDENTIFIER",
  "VARBINARY",
  "VARCHAR",
  "XML",
  // Common built-in functions
  "ABS",
  "CEIL",
  "CEILING",
  "FLOOR",
  "ROUND",
  "MOD",
  "POWER",
  "SQRT",
  "SIGN",
  "TRUNCATE",
  "CONCAT",
  "CONCAT_WS",
  "LENGTH",
  "CHAR_LENGTH",
  "UPPER",
  "LOWER",
  "TRIM",
  "LTRIM",
  "RTRIM",
  "SUBSTRING",
  "SUBSTR",
  "INSTR",
  "LOCATE",
  "LPAD",
  "RPAD",
  "REVERSE",
  "REPEAT",
  "SPACE",
  "FORMAT",
  "HEX",
  "UNHEX",
  "NOW",
  "CURDATE",
  "CURTIME",
  "DATE_ADD",
  "DATE_SUB",
  "DATE_FORMAT",
  "DATEDIFF",
  "TIMESTAMPDIFF",
  "EXTRACT",
  "YEAR",
  "MONTH",
  "DAY",
  "HOUR",
  "MINUTE",
  "SECOND",
  "DAYOFWEEK",
  "DAYOFYEAR",
  "LAST_DAY",
  "STR_TO_DATE",
  "CONVERT",
  "IFNULL",
  "NULLIF",
  "GREATEST",
  "LEAST",
  "GROUP_CONCAT",
  "FIND_IN_SET",
  "FIELD",
  "ELT",
  "REGEXP",
  "REGEXP_LIKE",
  "REGEXP_REPLACE",
  "REGEXP_SUBSTR",
  "UUID",
  "MD5",
  "SHA1",
  "SHA2",
  "CRC32",
];

const COMMON_SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "ASC",
  "DESC",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "DISTINCT",
  "UNION",
  "ALL",
  "EXISTS",
  "BETWEEN",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "CAST",
  "ALTER",
  "DROP",
  "ADD",
  "COLUMN",
  "INDEX",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "DEFAULT",
  "CHECK",
  "UNIQUE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRUNCATE",
  "EXPLAIN",
  "ANALYZE",
  "WITH",
  "RECURSIVE",
  "OVER",
  "PARTITION BY",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
  "FIRST_VALUE",
  "LAST_VALUE",
  "NTILE",
  "BIGINT",
  "BINARY",
  "BIT",
  "CHAR",
  "DATE",
  "DECIMAL",
  "FLOAT",
  "INT",
  "NUMERIC",
  "REAL",
  "SMALLINT",
  "TEXT",
  "TIME",
  "TIMESTAMP",
  "VARCHAR",
];

const POSTGRES_SQL_KEYWORDS = [
  "BIGSERIAL",
  "JSON",
  "JSONB",
  "SMALLSERIAL",
  "SERIAL",
  "UUID",
  "INET",
  "CIDR",
  "MACADDR",
  "MACADDR8",
  "TSVECTOR",
  "TSQUERY",
  "BYTEA",
  "BOOLEAN",
  "RETURNING",
  "ILIKE",
  "SIMILAR TO",
  "ON CONFLICT",
  "DO NOTHING",
  "DO UPDATE",
  "GENERATED",
  "IDENTITY",
  "MATERIALIZED",
  "VACUUM",
  "ARRAY_AGG",
  "JSONB_BUILD_OBJECT",
  "JSONB_AGG",
  "TO_JSONB",
  "CURRENT_TIMESTAMP",
];

const MYSQL_SQL_KEYWORDS = [
  "AUTO_INCREMENT",
  "UNSIGNED",
  "ZEROFILL",
  "ENGINE",
  "CHARSET",
  "COLLATE",
  "ENUM",
  "JSON",
  "BOOL",
  "BOOLEAN",
  "TINYTEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "TINYBLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
  "SHOW",
  "DESCRIBE",
  "REPLACE",
  "DUPLICATE KEY",
  "JSON_EXTRACT",
  "JSON_UNQUOTE",
  "DATE_FORMAT",
];

const SQLITE_SQL_KEYWORDS = [
  "AUTOINCREMENT",
  "INTEGER",
  "BLOB",
  "BOOLEAN",
  "WITHOUT ROWID",
  "VACUUM",
  "PRAGMA",
  "JSON_EXTRACT",
  "JSON_SET",
  "STRFTIME",
];

const SQLSERVER_SQL_KEYWORDS = [
  "TOP",
  "IDENTITY",
  "UNIQUEIDENTIFIER",
  "NVARCHAR",
  "DATETIME2",
  "DATETIMEOFFSET",
  "BIT",
  "GO",
  "MERGE",
  "OUTPUT",
  "TRY_CAST",
  "TRY_CONVERT",
  "OPENJSON",
  "JSON_VALUE",
  "JSON_QUERY",
];

const DATABASE_SQL_KEYWORDS: Partial<Record<DatabaseType, string[]>> = {
  mysql: MYSQL_SQL_KEYWORDS,
  postgres: POSTGRES_SQL_KEYWORDS,
  sqlite: SQLITE_SQL_KEYWORDS,
  rqlite: SQLITE_SQL_KEYWORDS,
  sqlserver: SQLSERVER_SQL_KEYWORDS,
};

// Keywords that appear in nearly every SQL query — boosted so frequency beats length tie-breaking.
// E.g. typing "WH" should rank WHERE (high frequency) above WHEN (CASE-only).
const HIGH_FREQUENCY_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "JOIN",
  "ON",
  "IN",
  "AS",
  "GROUP BY",
  "ORDER BY",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "NOT",
  "NULL",
  "IS",
  "LIKE",
  "DISTINCT",
  "HAVING",
  "LIMIT",
  "COUNT",
  "SUM",
  "AVG",
  "MAX",
  "MIN",
  "CASE",
  "UNION",
  "ALL",
  "ASC",
  "DESC",
  "BETWEEN",
  "EXISTS",
]);

const TABLE_TRIGGER_KEYWORDS = new Set(["from", "join", "update", "into", "table", "describe", "explain", "apply"]);
const EXCLUSIVE_TABLE_TRIGGER_KEYWORDS = new Set(["from", "join", "update", "into", "apply"]);
const JOIN_MODIFIERS = new Set(["left", "right", "inner", "outer", "cross", "full", "natural"]);
const MAX_TABLE_COMPLETION_ITEMS = 200;

// Keywords that only make sense in DDL / statement-start contexts (not inside SELECT/INSERT/UPDATE/DELETE)
const DDL_ONLY_KEYWORDS = new Set([
  "CREATE",
  "ALTER",
  "DROP",
  "TABLE",
  "VIEW",
  "INDEX",
  "COLUMN",
  "ADD",
  "CONSTRAINT",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "DEFAULT",
  "CHECK",
  "UNIQUE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRUNCATE",
  "EXPLAIN",
  "DESCRIBE",
  "SHOW",
  "SUMMARIZE",
  "PRAGMA",
  "COPY",
  "EXPORT",
  "IMPORT",
  "IF",
]);

// Data type keywords — only relevant in DDL (CREATE/ALTER TABLE)
const DATA_TYPE_KEYWORDS = new Set([
  "BIGINT",
  "BINARY",
  "BIT",
  "CHAR",
  "DATE",
  "DATETIME",
  "DATETIME2",
  "DATETIMEOFFSET",
  "DECIMAL",
  "FLOAT",
  "IMAGE",
  "INT",
  "MONEY",
  "NCHAR",
  "NTEXT",
  "NUMERIC",
  "NVARCHAR",
  "REAL",
  "SMALLDATETIME",
  "SMALLINT",
  "SMALLMONEY",
  "TEXT",
  "TIME",
  "TIMESTAMP",
  "TINYINT",
  "UNIQUEIDENTIFIER",
  "VARBINARY",
  "VARCHAR",
  "XML",
  "JSON",
  "JSONB",
  "UUID",
  "SERIAL",
  "BIGSERIAL",
  "SMALLSERIAL",
  "BYTEA",
  "BOOLEAN",
  "BOOL",
  "INET",
  "CIDR",
  "MACADDR",
  "MACADDR8",
  "TSVECTOR",
  "TSQUERY",
  "ENUM",
  "TINYTEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "TINYBLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
]);

// Window functions that should use OVER() completion
const WINDOW_FUNCTIONS = new Set([
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
  "FIRST_VALUE",
  "LAST_VALUE",
  "NTILE",
]);

function getFunctionDescriptions(t?: SqlCompletionTranslations): Map<string, string> {
  const d = t?.functionDescriptions ?? {};
  return new Map<string, string>([
    ["COUNT", d.COUNT || "Returns the number of rows"],
    ["SUM", d.SUM || "Returns the sum of a numeric column"],
    ["AVG", d.AVG || "Returns the average of a numeric column"],
    ["MIN", d.MIN || "Returns the minimum value"],
    ["MAX", d.MAX || "Returns the maximum value"],
    ["GROUP_CONCAT", d.GROUP_CONCAT || "Concatenates group values into a string"],
    ["STRING_AGG", d.STRING_AGG || "Concatenates strings in a group"],
    ["CONCAT", d.CONCAT || "Concatenates multiple strings"],
    ["CONCAT_WS", d.CONCAT_WS || "Concatenates strings with a separator"],
    ["SUBSTRING", d.SUBSTRING || "Extracts a substring"],
    ["REPLACE", d.REPLACE || "Replaces content in a string"],
    ["TRIM", d.TRIM || "Removes leading and trailing spaces"],
    ["UPPER", d.UPPER || "Converts to uppercase"],
    ["LOWER", d.LOWER || "Converts to lowercase"],
    ["LENGTH", d.LENGTH || "Returns string length"],
    ["REGEXP_REPLACE", d.REGEXP_REPLACE || "Replaces using a regular expression"],
    ["DATE_FORMAT", d.DATE_FORMAT || "Formats a date with a pattern"],
    ["DATEDIFF", d.DATEDIFF || "Calculates the difference between two dates"],
    ["DATE_ADD", d.DATE_ADD || "Adds to a date"],
    ["DATE_SUB", d.DATE_SUB || "Subtracts from a date"],
    ["EXTRACT", d.EXTRACT || "Extracts a part from a date"],
    ["NOW", d.NOW || "Returns the current date and time"],
    ["ROUND", d.ROUND || "Rounds to the specified precision"],
    ["FLOOR", d.FLOOR || "Rounds down"],
    ["CEIL", d.CEIL || "Rounds up"],
    ["ABS", d.ABS || "Returns the absolute value"],
    ["MOD", d.MOD || "Returns the remainder"],
    ["COALESCE", d.COALESCE || "Returns the first non-NULL argument"],
    ["IFNULL", d.IFNULL || "Returns an alternate value when NULL"],
    ["NULLIF", d.NULLIF || "Returns NULL when values are equal"],
    ["CAST", d.CAST || "Converts an expression to a specified type"],
    ["JSON_EXTRACT", d.JSON_EXTRACT || "Extracts a value from JSON"],
    ["JSON_VALUE", d.JSON_VALUE || "Extracts a scalar value from JSON"],
    ["JSON_OBJECT", d.JSON_OBJECT || "Creates a JSON object"],
    ["JSON_ARRAY", d.JSON_ARRAY || "Creates a JSON array"],
  ]);
}

export const DEFAULT_SQL_SNIPPETS: SqlSnippet[] = [
  {
    id: "builtin-sel",
    label: "select *",
    prefix: "sel",
    body: "SELECT *\nFROM {table}\nLIMIT 100;",
  },
  {
    id: "builtin-ins",
    label: "insert into",
    prefix: "ins",
    body: "INSERT INTO {table} ({columns})\nVALUES ({values});",
  },
  {
    id: "builtin-upd",
    label: "update set",
    prefix: "upd",
    body: "UPDATE {table}\nSET {column} = {value}\nWHERE {condition};",
  },
  {
    id: "builtin-cte",
    label: "common table expression",
    prefix: "cte",
    body: "WITH {name} AS (\n  SELECT {columns}\n  FROM {table}\n)\nSELECT *\nFROM {name};",
  },
  {
    id: "builtin-join",
    label: "join",
    prefix: "join",
    body: "JOIN {table} ON {left_column} = {right_column}",
  },
  {
    id: "builtin-case",
    label: "case when",
    prefix: "case",
    body: "CASE\n  WHEN {condition} THEN {value}\n  ELSE {default}\nEND",
  },
  {
    id: "builtin-ct",
    label: "create table",
    prefix: "ct",
    body: "CREATE TABLE {table} (\n  {column} {type}\n);",
  },
  {
    id: "builtin-ex",
    label: "exists",
    prefix: "ex",
    body: "EXISTS (\n  SELECT 1\n  FROM {table}\n  WHERE {condition}\n)",
  },
  {
    id: "builtin-nex",
    label: "not exists",
    prefix: "nex",
    body: "NOT EXISTS (\n  SELECT 1\n  FROM {table}\n  WHERE {condition}\n)",
  },
  {
    id: "builtin-at",
    label: "alter table add column",
    prefix: "at",
    body: "ALTER TABLE {table}\nADD COLUMN {column} {type};",
  },
  {
    id: "builtin-ci",
    label: "create index",
    prefix: "ci",
    body: "CREATE INDEX {idx_name}\nON {table} ({column});",
  },
];

const SQL_FUNCTION_SIGNATURES = new Map<string, string[]>([
  // Aggregate
  ["COUNT", ["expression"]],
  ["SUM", ["expression"]],
  ["AVG", ["expression"]],
  ["MIN", ["expression"]],
  ["MAX", ["expression"]],
  ["GROUP_CONCAT", ["expression", "separator"]],
  ["STRING_AGG", ["expression", "separator"]],
  ["ARRAY_AGG", ["expression"]],
  // String
  ["CONCAT", ["value", "...values"]],
  ["CONCAT_WS", ["separator", "...values"]],
  ["SUBSTRING", ["string", "start", "length"]],
  ["SUBSTR", ["string", "start", "length"]],
  ["REPLACE", ["string", "old", "new"]],
  ["TRIM", ["string"]],
  ["LTRIM", ["string"]],
  ["RTRIM", ["string"]],
  ["UPPER", ["string"]],
  ["LOWER", ["string"]],
  ["LENGTH", ["string"]],
  ["LPAD", ["string", "length", "pad"]],
  ["RPAD", ["string", "length", "pad"]],
  ["INSTR", ["string", "substring"]],
  ["LOCATE", ["substring", "string"]],
  ["REVERSE", ["string"]],
  ["REPEAT", ["string", "count"]],
  ["SPACE", ["count"]],
  ["FORMAT", ["number", "decimals"]],
  ["REGEXP_REPLACE", ["string", "pattern", "replacement"]],
  ["REGEXP_SUBSTR", ["string", "pattern"]],
  ["SPLIT_PART", ["string", "delimiter", "part"]],
  // Date / Time
  ["DATE_FORMAT", ["date", "format"]],
  ["DATEDIFF", ["date1", "date2"]],
  ["TIMESTAMPDIFF", ["unit", "datetime_expr1", "datetime_expr2"]],
  ["DATE_ADD", ["date", "interval"]],
  ["DATE_SUB", ["date", "interval"]],
  ["EXTRACT", ["unit", "date"]],
  ["YEAR", ["date"]],
  ["MONTH", ["date"]],
  ["DAY", ["date"]],
  ["HOUR", ["datetime"]],
  ["MINUTE", ["datetime"]],
  ["SECOND", ["datetime"]],
  ["DAYOFWEEK", ["date"]],
  ["DAYOFYEAR", ["date"]],
  ["LAST_DAY", ["date"]],
  ["STR_TO_DATE", ["string", "format"]],
  ["NOW", []],
  ["CURDATE", []],
  ["CURTIME", []],
  // Numeric
  ["ROUND", ["number", "decimals"]],
  ["FLOOR", ["number"]],
  ["CEIL", ["number"]],
  ["CEILING", ["number"]],
  ["ABS", ["number"]],
  ["MOD", ["dividend", "divisor"]],
  ["POWER", ["base", "exponent"]],
  ["SQRT", ["number"]],
  ["SIGN", ["number"]],
  ["TRUNCATE", ["number", "decimals"]],
  ["RAND", []],
  // Conditional
  ["COALESCE", ["value", "...values"]],
  ["IFNULL", ["expression", "fallback"]],
  ["NULLIF", ["expression1", "expression2"]],
  ["CAST", ["expression", "type"]],
  ["CONVERT", ["expression", "type"]],
  ["GREATEST", ["...values"]],
  ["LEAST", ["...values"]],
  ["IIF", ["condition", "true_value", "false_value"]],
  // Hash / Crypto
  ["MD5", ["string"]],
  ["SHA1", ["string"]],
  ["SHA2", ["string", "bit_length"]],
  ["UUID", []],
  // JSON
  ["JSON_EXTRACT", ["json", "path"]],
  ["JSON_VALUE", ["json", "path"]],
  ["JSON_QUERY", ["json", "path"]],
  ["JSON_OBJECT", ["key", "value", "...pairs"]],
  ["JSON_ARRAY", ["...values"]],
  ["JSON_SET", ["json", "path", "value"]],
  ["JSON_REMOVE", ["json", "path"]],
  ["JSON_CONTAINS", ["json", "value"]],
  ["JSON_LENGTH", ["json"]],
  ["JSON_KEYS", ["json"]],
  ["JSON_TYPE", ["json"]],
  ["JSON_PRETTY", ["json"]],
  ["JSON_VALID", ["json"]],
  ["JSON_ARRAYAGG", ["expression"]],
  ["JSON_OBJECTAGG", ["key", "value"]],
]);

const POSTGRES_FUNCTION_SIGNATURES = new Map<string, string[]>([
  ["JSONB_BUILD_OBJECT", ["key", "value", "...pairs"]],
  ["JSONB_AGG", ["expression"]],
  ["TO_JSONB", ["value"]],
  ["JSONB_SET", ["target", "path", "new_value"]],
  ["ARRAY_AGG", ["expression"]],
  ["STRING_AGG", ["expression", "delimiter"]],
  ["GEN_RANDOM_UUID", []],
]);

const MYSQL_FUNCTION_SIGNATURES = new Map<string, string[]>([
  ["DATE_FORMAT", ["date", "format"]],
  ["JSON_EXTRACT", ["json", "path"]],
  ["JSON_UNQUOTE", ["json"]],
  ["GROUP_CONCAT", ["expression"]],
  ["UUID", []],
]);

const SQLITE_FUNCTION_SIGNATURES = new Map<string, string[]>([
  ["JSON_EXTRACT", ["json", "path"]],
  ["JSON_SET", ["json", "path", "value"]],
  ["STRFTIME", ["format", "time"]],
  ["IFNULL", ["expression", "fallback"]],
]);

const SQLSERVER_FUNCTION_SIGNATURES = new Map<string, string[]>([
  ["TRY_CAST", ["expression AS type"]],
  ["TRY_CONVERT", ["type", "expression"]],
  ["JSON_VALUE", ["expression", "path"]],
  ["JSON_QUERY", ["expression", "path"]],
  ["NEWID", []],
]);

// ClickHouse keeps the engine's canonical camelCase spellings — function names
// are case-sensitive there, so e.g. `TODATETIME` would not resolve.
const CLICKHOUSE_FUNCTION_SIGNATURES = new Map<string, string[]>([
  // Aggregate
  ["countIf", ["condition"]],
  ["any", ["value"]],
  ["uniq", ["value"]],
  ["uniqExact", ["value"]],
  ["groupArray", ["value"]],
  ["groupUniqArray", ["value"]],
  ["median", ["value"]],
  ["argMin", ["arg", "val"]],
  ["argMax", ["arg", "val"]],
  // String
  ["startsWith", ["string", "prefix"]],
  ["endsWith", ["string", "suffix"]],
  ["lengthUTF8", ["string"]],
  ["upperUTF8", ["string"]],
  ["lowerUTF8", ["string"]],
  ["replaceOne", ["string", "search", "replacement"]],
  ["replaceAll", ["string", "search", "replacement"]],
  ["replaceRegexpAll", ["string", "pattern", "replacement"]],
  ["splitByChar", ["separator", "string"]],
  ["splitByString", ["separator", "string"]],
  ["extractAll", ["string", "pattern"]],
  ["empty", ["value"]],
  // Date / Time
  ["now", []],
  ["today", []],
  ["yesterday", []],
  ["toYear", ["date"]],
  ["toMonth", ["date"]],
  ["toDayOfMonth", ["date"]],
  ["toDayOfWeek", ["date"]],
  ["toHour", ["datetime"]],
  ["toYYYYMM", ["date"]],
  ["toYYYYMMDD", ["date"]],
  ["toStartOfDay", ["datetime"]],
  ["toStartOfHour", ["datetime"]],
  ["toStartOfMinute", ["datetime"]],
  ["toStartOfMonth", ["datetime"]],
  ["toStartOfWeek", ["datetime"]],
  ["dateDiff", ["unit", "start_date", "end_date"]],
  ["dateTrunc", ["unit", "datetime"]],
  ["formatDateTime", ["datetime", "format"]],
  ["parseDateTimeBestEffort", ["string"]],
  ["addDays", ["datetime", "count"]],
  ["subtractDays", ["datetime", "count"]],
  // Arrays
  ["array", ["...values"]],
  ["arrayElement", ["array", "index"]],
  ["arrayJoin", ["array"]],
  ["has", ["array", "element"]],
  ["hasAll", ["array", "elements"]],
  ["hasAny", ["array", "elements"]],
  ["arrayMap", ["lambda", "array"]],
  ["arrayFilter", ["lambda", "array"]],
  ["arraySort", ["array"]],
  ["arrayDistinct", ["array"]],
  ["arrayStringConcat", ["array", "delimiter"]],
  ["arraySlice", ["array", "offset", "length"]],
  // Math
  ["exp", ["number"]],
  ["log", ["number"]],
  ["log2", ["number"]],
  ["rand", []],
  // Type conversion
  ["toString", ["value"]],
  ["toInt64", ["value"]],
  ["toUInt64", ["value"]],
  ["toFloat64", ["value"]],
  ["toDate", ["value"]],
  ["toDateTime", ["value"]],
  ["toDateTime64", ["value", "scale"]],
  ["toUnixTimestamp", ["datetime"]],
  ["toTypeName", ["value"]],
  // Conditional / null
  ["if", ["condition", "then_value", "else_value"]],
  ["multiIf", ["...condition_then_pairs", "else_value"]],
  ["ifNull", ["expression", "fallback"]],
  ["isNull", ["value"]],
  ["assumeNotNull", ["value"]],
  // Hash / UUID
  ["generateUUIDv4", []],
  ["cityHash64", ["...values"]],
]);

// DuckDB function names are case-insensitive; entries follow the docs spelling.
const DUCKDB_FUNCTION_SIGNATURES = new Map<string, string[]>([
  // Aggregate
  ["list", ["value"]],
  ["any_value", ["value"]],
  ["first", ["value"]],
  ["last", ["value"]],
  ["arg_min", ["value", "order"]],
  ["arg_max", ["value", "order"]],
  ["mode", ["value"]],
  ["median", ["value"]],
  ["quantile_cont", ["value", "position"]],
  ["quantile_disc", ["value", "position"]],
  ["approx_count_distinct", ["value"]],
  ["bool_and", ["value"]],
  ["bool_or", ["value"]],
  ["histogram", ["value"]],
  // String
  ["len", ["value"]],
  ["left", ["string", "count"]],
  ["right", ["string", "count"]],
  ["contains", ["string", "search"]],
  ["prefix", ["string", "prefix"]],
  ["suffix", ["string", "suffix"]],
  ["format", ["format", "...values"]],
  ["printf", ["format", "...values"]],
  ["split", ["string", "separator"]],
  ["regexp_matches", ["string", "pattern"]],
  ["regexp_extract", ["string", "pattern", "group"]],
  ["ascii", ["string"]],
  ["chr", ["code"]],
  ["md5", ["value"]],
  ["sha256", ["value"]],
  ["hash", ["value"]],
  ["levenshtein", ["string1", "string2"]],
  // Date / Time
  ["now", []],
  ["today", []],
  ["date_trunc", ["unit", "timestamp"]],
  ["date_part", ["unit", "timestamp"]],
  ["date_diff", ["unit", "start_date", "end_date"]],
  ["date_add", ["timestamp", "interval"]],
  ["strftime", ["timestamp", "format"]],
  ["strptime", ["text", "format"]],
  ["make_date", ["year", "month", "day"]],
  ["to_timestamp", ["seconds"]],
  ["epoch", ["timestamp"]],
  ["epoch_ms", ["milliseconds"]],
  ["last_day", ["date"]],
  ["monthname", ["date"]],
  ["dayname", ["date"]],
  // Math
  ["random", []],
  ["exp", ["number"]],
  ["ln", ["number"]],
  ["log10", ["number"]],
  // Lists
  ["unnest", ["list"]],
  ["list_value", ["...values"]],
  ["list_extract", ["list", "index"]],
  ["list_concat", ["...lists"]],
  ["list_transform", ["list", "lambda"]],
  ["list_filter", ["list", "lambda"]],
  ["list_contains", ["list", "value"]],
  ["list_position", ["list", "value"]],
  ["list_reverse", ["list"]],
  ["list_sort", ["list"]],
  ["list_distinct", ["list"]],
  ["list_slice", ["list", "begin", "end"]],
  ["list_sum", ["list"]],
  // Structs / maps
  ["struct_pack", ["...named_values"]],
  ["struct_extract", ["struct", "key"]],
  ["map", ["keys", "values"]],
  ["map_extract", ["map", "key"]],
  // JSON
  ["to_json", ["value"]],
  ["json_extract", ["json", "path"]],
  ["json_extract_string", ["json", "path"]],
  ["json_array", ["...values"]],
  ["json_object", ["...key_value_pairs"]],
  ["json_array_length", ["json"]],
  ["json_type", ["json"]],
  ["json_valid", ["json"]],
  // Conditional / null
  ["ifnull", ["expression", "fallback"]],
]);

const ORACLE_FUNCTION_SIGNATURES = new Map<string, string[]>([
  // Aggregate
  ["LISTAGG", ["expression", "delimiter"]],
  ["MEDIAN", ["value"]],
  ["STDDEV", ["expression"]],
  ["STDDEV_POP", ["expression"]],
  ["STDDEV_SAMP", ["expression"]],
  ["VARIANCE", ["expression"]],
  ["VAR_POP", ["expression"]],
  ["VAR_SAMP", ["expression"]],
  ["GROUPING", ["expression"]],
  // String
  ["INITCAP", ["string"]],
  ["TRANSLATE", ["expression", "search", "replacement"]],
  ["REGEXP_LIKE", ["expression", "pattern"]],
  ["REGEXP_INSTR", ["string", "pattern"]],
  ["REGEXP_COUNT", ["string", "pattern"]],
  ["CHR", ["code"]],
  ["ASCII", ["string"]],
  ["SOUNDEX", ["string"]],
  ["ASCIISTR", ["string"]],
  // Date / Time
  ["SYSDATE", []],
  ["SYSTIMESTAMP", []],
  ["CURRENT_DATE", []],
  ["CURRENT_TIMESTAMP", []],
  ["LOCALTIMESTAMP", []],
  ["SESSIONTIMEZONE", []],
  ["DBTIMEZONE", []],
  ["ADD_MONTHS", ["date", "months"]],
  ["MONTHS_BETWEEN", ["date1", "date2"]],
  ["NEXT_DAY", ["date", "day"]],
  ["FROM_TZ", ["timestamp", "time_zone"]],
  // Conversion
  ["TO_CHAR", ["value", "format"]],
  ["TO_DATE", ["value", "format"]],
  ["TO_NUMBER", ["value", "format"]],
  ["TO_TIMESTAMP", ["value", "format"]],
  ["TO_DSINTERVAL", ["value"]],
  ["TO_YMINTERVAL", ["value"]],
  ["NUMTODSINTERVAL", ["value", "unit"]],
  ["NUMTOYMINTERVAL", ["value", "unit"]],
  ["TRUNC", ["value", "format_or_digits"]],
  // Conditional / null
  ["NVL", ["expression", "fallback"]],
  ["NVL2", ["expression", "not_null_value", "null_value"]],
  ["DECODE", ["expression", "...search_result_pairs", "default"]],
  ["LNNVL", ["condition"]],
  // Analytic / hierarchical
  ["RATIO_TO_REPORT", ["expression"]],
  ["SYS_CONNECT_BY_PATH", ["column", "delimiter"]],
  // JSON
  ["JSON_EXISTS", ["json", "path"]],
  // Misc
  ["SYS_GUID", []],
  ["SYS_CONTEXT", ["namespace", "parameter"]],
  ["BITAND", ["expression1", "expression2"]],
  ["EMPTY_BLOB", []],
  ["EMPTY_CLOB", []],
]);

// One-line English detail per dialect-specific function, shown as the completion
// item detail. Every key must exist in the matching signature catalog (locked by
// sqlCompletion.dialectFunctions.test.ts). Both catalogs are exported so the test
// suite can lock their structure and content.
const ORACLE_FUNCTION_DESCRIPTIONS = new Map<string, string>([
  ["LISTAGG", "Concatenates group values, ordered WITHIN GROUP"],
  ["MEDIAN", "Median of the values"],
  ["STDDEV", "Sample standard deviation"],
  ["STDDEV_POP", "Population standard deviation"],
  ["STDDEV_SAMP", "Sample standard deviation"],
  ["VARIANCE", "Sample variance"],
  ["VAR_POP", "Population variance"],
  ["VAR_SAMP", "Sample variance"],
  ["GROUPING", "Whether a ROLLUP/CUBE row is aggregated"],
  ["INITCAP", "Capitalizes the first letter of each word"],
  ["TRANSLATE", "Maps characters from search to replacement"],
  ["REGEXP_LIKE", "TRUE when the expression matches the pattern"],
  ["REGEXP_INSTR", "Position of the first pattern match"],
  ["REGEXP_COUNT", "Number of pattern matches"],
  ["CHR", "Character for the given code"],
  ["ASCII", "ASCII code of the first character"],
  ["SOUNDEX", "Phonetic representation of the string"],
  ["ASCIISTR", "ASCII approximation with \\xxxx escapes"],
  ["SYSDATE", "Server date and time"],
  ["SYSTIMESTAMP", "Server timestamp with time zone"],
  ["CURRENT_DATE", "Session date in the session time zone"],
  ["CURRENT_TIMESTAMP", "Session timestamp with time zone"],
  ["LOCALTIMESTAMP", "Session timestamp without time zone"],
  ["SESSIONTIMEZONE", "Session time zone offset"],
  ["DBTIMEZONE", "Database time zone offset"],
  ["ADD_MONTHS", "Adds months to a date"],
  ["MONTHS_BETWEEN", "Months between two dates"],
  ["NEXT_DAY", "First given weekday after the date"],
  ["FROM_TZ", "Attaches a time zone to a timestamp"],
  ["TO_CHAR", "Formats a value as a string"],
  ["TO_DATE", "Parses a string to a date"],
  ["TO_NUMBER", "Parses a string to a number"],
  ["TO_TIMESTAMP", "Parses a string to a timestamp"],
  ["TO_DSINTERVAL", "Parses an INTERVAL DAY TO SECOND literal"],
  ["TO_YMINTERVAL", "Parses an INTERVAL YEAR TO MONTH literal"],
  ["NUMTODSINTERVAL", "Converts a number to a DAY TO SECOND interval"],
  ["NUMTOYMINTERVAL", "Converts a number to a YEAR TO MONTH interval"],
  ["TRUNC", "Truncates a date or number"],
  ["NVL", "Returns fallback when the expression is NULL"],
  ["NVL2", "not_null_value when the expression is not NULL, else null_value"],
  ["DECODE", "Chained search/result comparison with a default"],
  ["LNNVL", "TRUE when the condition is FALSE or unknown"],
  ["RATIO_TO_REPORT", "Value's ratio to the group total (analytic)"],
  ["SYS_CONNECT_BY_PATH", "Path from the hierarchy root to the row"],
  ["JSON_EXISTS", "Whether the JSON contains the path"],
  ["SYS_GUID", "Globally unique identifier (RAW)"],
  ["SYS_CONTEXT", "Value of a namespace attribute"],
  ["BITAND", "Bitwise AND of two numbers"],
  ["EMPTY_BLOB", "Empty BLOB locator"],
  ["EMPTY_CLOB", "Empty CLOB locator"],
]);

export const DATABASE_FUNCTION_DESCRIPTIONS: Partial<Record<DatabaseType, Map<string, string>>> = {
  clickhouse: new Map<string, string>([
    ["countIf", "Counts rows matching the condition"],
    ["any", "Returns an arbitrary non-null value in the group"],
    ["uniq", "Approximates the number of distinct values"],
    ["uniqExact", "Counts distinct values exactly"],
    ["groupArray", "Aggregates values into an array"],
    ["groupUniqArray", "Aggregates distinct values into an array"],
    ["median", "Computes the median of numeric values"],
    ["argMin", "Value of arg for the minimum val"],
    ["argMax", "Value of arg for the maximum val"],
    ["startsWith", "Whether the string starts with the prefix"],
    ["endsWith", "Whether the string ends with the suffix"],
    ["lengthUTF8", "String length measured in code points"],
    ["upperUTF8", "Uppercase, Unicode-aware"],
    ["lowerUTF8", "Lowercase, Unicode-aware"],
    ["replaceOne", "Replaces the first occurrence of search"],
    ["replaceAll", "Replaces all occurrences of search"],
    ["replaceRegexpAll", "Replaces every regexp pattern match"],
    ["splitByChar", "Splits by a single-character separator"],
    ["splitByString", "Splits by a string separator"],
    ["extractAll", "All matches of the regexp pattern"],
    ["empty", "Whether the string or array is empty"],
    ["now", "Current date and time"],
    ["today", "Current date"],
    ["yesterday", "Yesterday's date"],
    ["toYear", "Year component of a date"],
    ["toMonth", "Month component of a date"],
    ["toDayOfMonth", "Day-of-month component of a date"],
    ["toDayOfWeek", "Weekday number of a date (Monday = 1)"],
    ["toHour", "Hour component of a datetime"],
    ["toYYYYMM", "Date formatted as a YYYYMM number"],
    ["toYYYYMMDD", "Date formatted as a YYYYMMDD number"],
    ["toStartOfDay", "Truncates to the start of the day"],
    ["toStartOfHour", "Truncates to the start of the hour"],
    ["toStartOfMinute", "Truncates to the start of the minute"],
    ["toStartOfMonth", "Truncates to the first day of the month"],
    ["toStartOfWeek", "Truncates to the first day of the week"],
    ["dateDiff", "Difference between two dates in the given unit"],
    ["dateTrunc", "Truncates a datetime to the given unit"],
    ["formatDateTime", "Formats a datetime by format specifiers"],
    ["parseDateTimeBestEffort", "Parses a datetime from loose text"],
    ["addDays", "Adds days to a datetime"],
    ["subtractDays", "Subtracts days from a datetime"],
    ["array", "Creates an array from values"],
    ["arrayElement", "Element at the given 1-based index"],
    ["arrayJoin", "Explodes array elements into rows"],
    ["has", "Whether the array contains the element"],
    ["hasAll", "Whether the array contains all elements"],
    ["hasAny", "Whether the array shares any element"],
    ["arrayMap", "Applies a lambda to every element"],
    ["arrayFilter", "Keeps elements where the lambda is true"],
    ["arraySort", "Sorts the array ascending"],
    ["arrayDistinct", "Removes duplicate elements"],
    ["arrayStringConcat", "Joins array elements with a delimiter"],
    ["arraySlice", "Sub-array from offset"],
    ["exp", "e raised to the given power"],
    ["log", "Natural logarithm"],
    ["log2", "Base-2 logarithm"],
    ["rand", "Random unsigned integer"],
    ["toString", "Converts a value to String"],
    ["toInt64", "Converts a value to Int64"],
    ["toUInt64", "Converts a value to UInt64"],
    ["toFloat64", "Converts a value to Float64"],
    ["toDate", "Converts a value to Date"],
    ["toDateTime", "Converts a value to DateTime"],
    ["toDateTime64", "Converts to DateTime with sub-second scale"],
    ["toUnixTimestamp", "Converts a datetime to a Unix timestamp"],
    ["toTypeName", "Returns the type name of a value"],
    ["if", "Conditional: then_value or else_value"],
    ["multiIf", "Chained conditionals with a final else"],
    ["ifNull", "Returns fallback when the expression is NULL"],
    ["isNull", "Whether the value is NULL"],
    ["assumeNotNull", "Returns the value, asserting it is not NULL"],
    ["generateUUIDv4", "Generates a UUID version 4"],
    ["cityHash64", "CityHash-64 of the values"],
  ]),
  duckdb: new Map<string, string>([
    ["list", "Aggregates values into a LIST"],
    ["any_value", "Returns an arbitrary value in the group"],
    ["first", "First value in the group"],
    ["last", "Last value in the group"],
    ["arg_min", "Value associated with the minimum order"],
    ["arg_max", "Value associated with the maximum order"],
    ["mode", "Most frequent value in the group"],
    ["median", "Median of numeric values"],
    ["quantile_cont", "Continuous quantile at position"],
    ["quantile_disc", "Discrete quantile at position"],
    ["approx_count_distinct", "Approximates the distinct count"],
    ["bool_and", "True if all values are true"],
    ["bool_or", "True if any value is true"],
    ["histogram", "MAP of values to their counts"],
    ["len", "Length of a string or list"],
    ["left", "Leftmost count characters"],
    ["right", "Rightmost count characters"],
    ["contains", "Whether the string contains search"],
    ["prefix", "Whether the string starts with prefix"],
    ["suffix", "Whether the string ends with suffix"],
    ["format", "Formats values using a format string"],
    ["printf", "printf-style formatting"],
    ["split", "Splits the string by a separator"],
    ["regexp_matches", "Whether the string matches the pattern"],
    ["regexp_extract", "First match of the pattern"],
    ["ascii", "ASCII code of the first character"],
    ["chr", "Character for the given code point"],
    ["md5", "MD5 hash as a hex string"],
    ["sha256", "SHA-256 hash as a hex string"],
    ["hash", "Hash of the value"],
    ["levenshtein", "Edit distance between two strings"],
    ["now", "Current transaction timestamp"],
    ["today", "Current date"],
    ["date_trunc", "Truncates to the given unit"],
    ["date_part", "Extracts the given unit as a number"],
    ["date_diff", "Difference between dates in the given unit"],
    ["date_add", "Adds an interval to the timestamp"],
    ["strftime", "Formats a timestamp by format specifiers"],
    ["strptime", "Parses text using a format string"],
    ["make_date", "Builds a date from year, month, day"],
    ["to_timestamp", "Converts Unix seconds to a timestamp"],
    ["epoch", "Seconds since the Unix epoch"],
    ["epoch_ms", "Converts Unix milliseconds to a timestamp"],
    ["last_day", "Last day of the month"],
    ["monthname", "English month name"],
    ["dayname", "English weekday name"],
    ["random", "Random double in [0, 1)"],
    ["exp", "e raised to the given power"],
    ["ln", "Natural logarithm"],
    ["log10", "Base-10 logarithm"],
    ["unnest", "Explodes a list into rows"],
    ["list_value", "Creates a LIST from values"],
    ["list_extract", "Element at the given 1-based index"],
    ["list_concat", "Concatenates lists"],
    ["list_transform", "Applies a lambda to every element"],
    ["list_filter", "Keeps elements where the lambda is true"],
    ["list_contains", "Whether the list contains the value"],
    ["list_position", "1-based position of the value, or NULL"],
    ["list_reverse", "Reverses the list"],
    ["list_sort", "Sorts the list ascending"],
    ["list_distinct", "Removes duplicate elements"],
    ["list_slice", "Sub-list from begin to end"],
    ["list_sum", "Sum of the list elements"],
    ["struct_pack", "Builds a STRUCT from named values"],
    ["struct_extract", "Member of a struct by key"],
    ["map", "Builds a MAP from key and value lists"],
    ["map_extract", "Value for the key, or NULL"],
    ["to_json", "Serializes a value to JSON"],
    ["json_extract", "JSON at the given path"],
    ["json_extract_string", "String at the given path as VARCHAR"],
    ["json_array", "Builds a JSON array"],
    ["json_object", "Builds a JSON object from key/value pairs"],
    ["json_array_length", "Number of elements in a JSON array"],
    ["json_type", "JSON type of the value"],
    ["json_valid", "Whether the value is valid JSON"],
    ["ifnull", "Returns fallback when the expression is NULL"],
  ]),
  oracle: ORACLE_FUNCTION_DESCRIPTIONS,
  // Oracle-compatible engines share the Oracle catalog (same dialect family).
  dameng: ORACLE_FUNCTION_DESCRIPTIONS,
  yashandb: ORACLE_FUNCTION_DESCRIPTIONS,
  "oceanbase-oracle": ORACLE_FUNCTION_DESCRIPTIONS,
};

// Exported so the test suite can lock catalog structure and content.
export const DATABASE_FUNCTION_SIGNATURES: Partial<Record<DatabaseType, Map<string, string[]>>> = {
  mysql: MYSQL_FUNCTION_SIGNATURES,
  postgres: POSTGRES_FUNCTION_SIGNATURES,
  sqlite: SQLITE_FUNCTION_SIGNATURES,
  rqlite: SQLITE_FUNCTION_SIGNATURES,
  sqlserver: SQLSERVER_FUNCTION_SIGNATURES,
  clickhouse: CLICKHOUSE_FUNCTION_SIGNATURES,
  duckdb: DUCKDB_FUNCTION_SIGNATURES,
  oracle: ORACLE_FUNCTION_SIGNATURES,
  // Oracle-compatible engines (T07 maps them to the oracle dialect) share the
  // Oracle catalog; the catalog is keyed by DatabaseType, not by dialect.
  dameng: ORACLE_FUNCTION_SIGNATURES,
  yashandb: ORACLE_FUNCTION_SIGNATURES,
  "oceanbase-oracle": ORACLE_FUNCTION_SIGNATURES,
};

// Oracle pseudo-functions that take no argument list: `SYSDATE()` is ORA-00923,
// so completion inserts the bare name and the signature card skips them.
const ORACLE_NILADIC_FUNCTIONS = new Set([
  "SYSDATE",
  "SYSTIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIMESTAMP",
  "LOCALTIMESTAMP",
  "SESSIONTIMEZONE",
  "DBTIMEZONE",
]);

export const DATABASE_NILADIC_FUNCTIONS: Partial<Record<DatabaseType, Set<string>>> = {
  oracle: ORACLE_NILADIC_FUNCTIONS,
  dameng: ORACLE_NILADIC_FUNCTIONS,
  yashandb: ORACLE_NILADIC_FUNCTIONS,
  "oceanbase-oracle": ORACLE_NILADIC_FUNCTIONS,
};

function isNiladicFunction(databaseType: DatabaseType | undefined, upperName: string): boolean {
  return !!databaseType && !!DATABASE_NILADIC_FUNCTIONS[databaseType]?.has(upperName);
}

const COMMON_SQL_FUNCTION_NAMES = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "CONCAT",
  "SUBSTRING",
  "SUBSTR",
  "REPLACE",
  "TRIM",
  "LTRIM",
  "RTRIM",
  "UPPER",
  "LOWER",
  "LENGTH",
  "EXTRACT",
  "NOW",
  "ROUND",
  "FLOOR",
  "CEIL",
  "CEILING",
  "ABS",
  "MOD",
  "POWER",
  "SQRT",
  "SIGN",
  "COALESCE",
  "NULLIF",
  "CAST",
  "GREATEST",
  "LEAST",
]);

export interface SqlCompletionTable {
  name: string;
  schema?: string;
  type?: "table" | "view";
}

export interface SqlCompletionObject {
  name: string;
  schema?: string;
  type: "procedure" | "function" | "trigger";
  parentSchema?: string;
  parentName?: string;
}

export interface SqlCompletionColumn {
  name: string;
  table: string;
  schema?: string;
  dataType?: string;
  isNullable?: boolean;
  comment?: string | null;
}

export interface SqlCompletionForeignKey {
  name: string;
  column: string;
  ref_schema?: string | null;
  ref_table: string;
  ref_column: string;
}

export interface SqlCompletionItem {
  label: string;
  type: "keyword" | "table" | "column" | "snippet" | "function" | "schema";
  detail?: string;
  info?: string;
  apply?: string;
  boost: number;
}

export interface SqlCompletionReferencedTable {
  name: string;
  schema?: string;
  alias?: string;
  columns?: string[];
}

/**
 * AST-derived references for one statement (the text `getSqlCompletionContext`
 * would extract at the cursor). Produced by the backend's `analyze_sql_references`
 * via the per-statement cache in `sqlReferences.ts`; the completion pipeline
 * consumes it synchronously on a cache hit and refreshes asynchronously on a
 * statement change (stale-while-revalidate).
 */
export interface SqlStatementReferences {
  referencedTables: SqlCompletionReferencedTable[];
}

/**
 * Resolves references for a statement text. Production wires this to the
 * statement cache (which kicks the async backend parse on a miss); omitting
 * it (tests, flag-only consumers) yields an empty reference set.
 */
export type SqlReferencesResolver = (statement: string) => SqlStatementReferences | undefined;

export type SqlStatementKind = "select" | "insert" | "update" | "delete" | "create" | "alter" | "drop" | "unknown";

export interface SqlCompletionContext {
  prefix: string;
  qualifier?: string;
  suggestTables: boolean;
  suggestColumns: boolean;
  suggestKeywords: boolean;
  suggestRoutines: boolean;
  suggestJoinConditions: boolean;
  exclusiveTableSuggestions: boolean;
  exclusiveColumnSuggestions: boolean;
  exclusiveRoutineSuggestions: boolean;
  prioritizeSelectAliases: boolean;
  selectAliases: string[];
  referencedTables: SqlCompletionReferencedTable[];
  insertTable?: string;
  insertSchema?: string;
  statementKind: SqlStatementKind;
  tableTriggerWord?: string;
  isGroupBy: boolean;
  nonAggregatedSelectColumns: string[];
  comparisonLeftColumn?: string;
  onStar: boolean;
}

export interface SqlFunctionSignatureHelp {
  name: string;
  signature: string;
  activeParameter: number;
  parameters: string[];
}

export interface SqlCompletionTranslations {
  nullValue: string;
  isNull: string;
  isNotNull: string;
  stringLiteral: string;
  numericLiteral: string;
  booleanValue: string;
  starExpansionColumns: string;
  functionDescriptions: Record<string, string>;
}

export function buildSqlCompletionItems(
  sql: string,
  cursor: number,
  input: {
    tables: SqlCompletionTable[];
    objects?: SqlCompletionObject[];
    columnsByTable: Map<string, SqlCompletionColumn[]>;
    foreignKeysByTable?: Map<string, SqlCompletionForeignKey[]>;
    schemas?: string[];
    translations?: SqlCompletionTranslations;
    dialect?: SqlDialect;
    databaseType?: DatabaseType;
    references?: SqlStatementReferences | SqlReferencesResolver;
  },
): SqlCompletionItem[] {
  const context = getSqlCompletionContext(sql, cursor, input.references, { dialect: input.dialect });
  return buildSqlCompletionItemsFromContext(context, input);
}

export function buildSqlCompletionItemsFromContext(
  context: SqlCompletionContext,
  input: {
    tables: SqlCompletionTable[];
    objects?: SqlCompletionObject[];
    columnsByTable: Map<string, SqlCompletionColumn[]>;
    foreignKeysByTable?: Map<string, SqlCompletionForeignKey[]>;
    schemas?: string[];
    translations?: SqlCompletionTranslations;
    snippets?: SqlSnippet[];
    dialect?: SqlDialect;
    databaseType?: DatabaseType;
  },
): SqlCompletionItem[] {
  const items: SqlCompletionItem[] = [];
  const t = input.translations;
  const dialect = input.dialect;
  const databaseType = input.databaseType;

  if (databaseType === "mongodb") {
    return dedupeAndSort(buildMongoCompletionItems(context.prefix));
  }

  if (
    !context.exclusiveTableSuggestions &&
    !context.exclusiveColumnSuggestions &&
    !context.exclusiveRoutineSuggestions
  ) {
    // Inside a DML statement at a pure column/expression position, snippets are secondary
    // to the columns being referenced — drop statement-starting ones and damp the rest.
    const snippetsAreSecondary =
      isDmlStatementKind(context.statementKind) && context.suggestColumns && !context.suggestTables;
    items.push(
      ...buildSnippetItems(context.prefix, input.snippets ?? DEFAULT_SQL_SNIPPETS, { secondary: snippetsAreSecondary }),
    );
    items.push(...buildFunctionSnippetItems(context.prefix, getFunctionDescriptions(t), databaseType));
  }

  if (
    !context.exclusiveTableSuggestions &&
    !context.exclusiveColumnSuggestions &&
    !context.exclusiveRoutineSuggestions &&
    context.prioritizeSelectAliases
  ) {
    items.push(...buildSelectAliasItems(context));
  }

  if (
    !context.exclusiveTableSuggestions &&
    !context.exclusiveColumnSuggestions &&
    !context.exclusiveRoutineSuggestions &&
    context.isGroupBy &&
    context.nonAggregatedSelectColumns.length > 0
  ) {
    items.push(...buildNonAggregatedColumnItems(context, input.columnsByTable, dialect));
  }

  if (
    !context.exclusiveTableSuggestions &&
    !context.exclusiveColumnSuggestions &&
    !context.exclusiveRoutineSuggestions &&
    context.suggestJoinConditions
  ) {
    items.push(...buildJoinConditionItems(context, input.columnsByTable, input.foreignKeysByTable, dialect));
  }

  if (context.suggestKeywords && !context.exclusiveRoutineSuggestions) {
    items.push(...buildKeywordItems(context.prefix, context, databaseType));
  }

  if (!context.exclusiveTableSuggestions && context.suggestColumns) {
    items.push(...buildColumnItems(context, input.columnsByTable, dialect));
  }

  // Suggest aliases for referenced tables (independent of table-suggestion mode)
  if (context.referencedTables.length > 0 && !context.suggestColumns && !context.insertTable) {
    items.push(...buildAliasItems(context));
  }

  if (!context.exclusiveColumnSuggestions && context.suggestTables) {
    items.push(...buildTableItems(context.prefix, input.tables, dialect));
    if (input.schemas && input.schemas.length > 0) {
      items.push(...buildSchemaItems(context.prefix, input.schemas, dialect));
    }
  }

  if (context.suggestRoutines || context.exclusiveRoutineSuggestions) {
    items.push(...buildObjectItems(context, input.objects ?? [], dialect));
  }

  // Type-aware value hints after comparison operator
  if (context.comparisonLeftColumn && context.suggestKeywords) {
    items.push(...buildComparisonValueItems(context, input.columnsByTable, t));
  }

  // SELECT * expansion
  if (context.onStar) {
    const starItem = buildStarExpansionItem(input.columnsByTable, t, dialect);
    if (starItem) items.push(starItem);
  }

  return dedupeAndSort(items);
}

export function shouldAutoOpenSqlCompletion(sql: string, cursor: number, dialect?: SqlDialect): boolean {
  const previousChar = sql[cursor - 1];
  if (!previousChar) return false;
  if (/\bon\s+$/i.test(sql.slice(0, cursor))) return true;
  if (/\bcall\s+(?:[A-Za-z_][\w$]*\.)?$/i.test(sql.slice(0, cursor))) return true;
  if (/[,;()[\]]/.test(previousChar)) return false;
  const context = getSqlCompletionContext(sql, cursor, undefined, { dialect });
  if (
    context.exclusiveTableSuggestions ||
    context.exclusiveColumnSuggestions ||
    context.exclusiveRoutineSuggestions ||
    context.suggestTables
  ) {
    return true;
  }
  // A completed numeric literal (e.g. `where t.id = 1000|`) is a value, not a
  // prefix worth completing — don't pop the function/keyword menu after it.
  // Closing quotes already fail the [\w$.@] check below; digits are the only
  // value terminator that would otherwise read as an identifier prefix.
  if (cursorAfterNumericLiteral(sql, cursor)) return false;
  return /[\w$.@]/.test(previousChar);
}

// True when the run of characters immediately before the cursor is a standalone
// numeric literal (the `1000` in `id = 1000|`) rather than the digit tail of an
// identifier (the `2` in `addr2|`). The preceding char must not be an identifier
// character, otherwise the digits belong to a name worth completing.
function cursorAfterNumericLiteral(sql: string, cursor: number): boolean {
  let index = cursor;
  let sawDigit = false;
  while (index > 0) {
    const ch = sql[index - 1];
    if (ch >= "0" && ch <= "9") {
      sawDigit = true;
      index -= 1;
    } else if (ch === ".") {
      index -= 1;
    } else {
      break;
    }
  }
  if (!sawDigit) return false;
  const before = sql[index - 1];
  return before === undefined || !/[A-Za-z_$]/.test(before);
}

export function isSqlLikeCompletionStatement(sql: string, cursor: number): boolean {
  const statement = extractStatementAt(sql, cursor).trimStart();
  if (/^(select|with)\b/i.test(statement)) return true;
  return currentLineBlockStartsSql(sql, cursor);
}

function currentLineBlockStartsSql(sql: string, cursor: number): boolean {
  return currentSqlLikeLineBlockSpan(sql, cursor) != null;
}

function currentSqlLikeLineBlockSpan(sql: string, cursor: number): { start: number; end: number } | null {
  const safeCursor = Math.max(0, Math.min(cursor, sql.length));
  const beforeCursor = sql.slice(0, safeCursor);
  const lines = beforeCursor.split(/\r?\n/);
  let start: number | null = null;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed) {
      const indentation = line.length - trimmed.length;
      if (/^(select|with)\b/i.test(trimmed)) start = offset + indentation;
      if (/^(get|post|put|delete|patch|head)\s+\//i.test(trimmed)) start = null;
    }
    offset += line.length + 1;
  }

  if (start == null) return null;

  let end = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = start; index < sql.length; index += 1) {
    const ch = sql[index];
    if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (ch === ";" && !inSingleQuote && !inDoubleQuote && index >= safeCursor) {
      end = index;
      break;
    }
  }

  const blockEnd = currentLineBlockEnd(sql, safeCursor, start);
  if (blockEnd != null) end = Math.min(end, blockEnd);

  return { start, end };
}

// A line that starts a brand-new top-level SQL statement. Used to bound the
// current statement when the previous one was not terminated with a semicolon
// (e.g. two `select` statements on consecutive lines) so completion does not
// bleed referenced tables/columns across statements.
const STATEMENT_START_KEYWORD = /^(?:select|with|insert|update|delete|create|alter|drop|truncate|merge|replace)\b/i;
// Set operators (UNION/INTERSECT/EXCEPT) chain selects into ONE statement, so a
// `select` following one of these is a continuation, not a new statement.
const SET_OPERATOR_TAIL = /(?:\bunion\b|\bintersect\b|\bexcept\b|\bminus\b)(?:\s+(?:all|distinct))?\s*$/i;

/** Paren nesting depth of `text`, ignoring parens inside string literals. */
function parenDepthOutsideQuotes(text: string): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (inSingleQuote || inDoubleQuote) continue;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}

function currentLineBlockEnd(sql: string, cursor: number, start: number): number | null {
  let lineStart = sql.lastIndexOf("\n", cursor - 1) + 1;
  while (lineStart < sql.length) {
    const lineEnd = sql.indexOf("\n", lineStart);
    const boundedLineEnd = lineEnd >= 0 ? lineEnd : sql.length;
    const line = sql.slice(lineStart, boundedLineEnd);
    const trimmed = line.trimStart();
    if (lineStart > start) {
      if (!trimmed || /^(get|post|put|delete|patch|head)\s+\//i.test(trimmed)) {
        return lineStart;
      }
      // A new top-level statement keyword at the start of a line ends the
      // current block — but only at paren depth 0 (not inside a subquery) and
      // not when it continues a UNION/INTERSECT/EXCEPT chain.
      if (STATEMENT_START_KEYWORD.test(trimmed)) {
        const preceding = sql.slice(start, lineStart);
        if (parenDepthOutsideQuotes(preceding) === 0 && !SET_OPERATOR_TAIL.test(preceding)) {
          return lineStart;
        }
      }
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }
  return null;
}

// Popup reuse while typing (CompletionResult.update) lives in sqlCompletionReuse.ts.

// Dialect catalogs keep the engine's canonical spelling (e.g. ClickHouse's
// `toYYYYMM`), so resolve by the uppercased name and surface that spelling back.
// Dialect entries win over the shared catalog, mirroring activeFunctionSignatures.
function findDialectFunction(
  databaseType: DatabaseType | undefined,
  upperName: string,
): { name: string; parameters: string[] } | undefined {
  const signatures = databaseType ? DATABASE_FUNCTION_SIGNATURES[databaseType] : undefined;
  if (!signatures) return undefined;
  for (const [name, parameters] of signatures) {
    if (name.toUpperCase() === upperName) return { name, parameters };
  }
  return undefined;
}

export function getSqlFunctionSignatureHelp(
  sql: string,
  cursor: number,
  databaseType?: DatabaseType,
): SqlFunctionSignatureHelp | null {
  const beforeCursor = sql.slice(0, cursor);
  const openParenIndex = findActiveFunctionOpenParen(beforeCursor);
  if (openParenIndex == null) return null;

  const beforeParen = beforeCursor.slice(0, openParenIndex).trimEnd();
  const upperName = /([A-Za-z_][\w$]*)$/.exec(beforeParen)?.[1]?.toUpperCase();
  if (!upperName) return null;
  if (isNiladicFunction(databaseType, upperName)) return null;

  const dialectFunction = findDialectFunction(databaseType, upperName);
  const parameters = dialectFunction?.parameters ?? SQL_FUNCTION_SIGNATURES.get(upperName);
  if (!parameters) return null;

  const name = dialectFunction?.name ?? upperName;
  const activeParameter = countTopLevelCommas(beforeCursor.slice(openParenIndex + 1));
  return {
    name,
    signature: `${name}(${parameters.join(", ")})`,
    activeParameter: Math.min(activeParameter, Math.max(0, parameters.length - 1)),
    parameters,
  };
}

/**
 * Find the start position of the SQL statement containing the cursor.
 * Respects semicolons and string literals.
 */
function extractStatementStart(sql: string, cursor: number): number {
  const lineBlock = currentSqlLikeLineBlockSpan(sql, cursor);
  if (lineBlock) return lineBlock.start;

  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (ch === ";" && !inSingleQuote && !inDoubleQuote) {
      if (i < cursor) {
        start = i + 1;
        while (start < sql.length && /\s/.test(sql[start])) start++;
      }
    }
  }
  return start;
}

/**
 * Extract the full SQL statement that contains the cursor position.
 * Respects semicolons and string literals.
 */
function extractStatementAt(sql: string, cursor: number): string {
  const lineBlock = currentSqlLikeLineBlockSpan(sql, cursor);
  if (lineBlock) return sql.slice(lineBlock.start, lineBlock.end).trim();

  const start = extractStatementStart(sql, cursor);
  let end = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
    else if (ch === ";" && !inSingleQuote && !inDoubleQuote && i >= cursor) {
      end = i;
      break;
    }
  }
  return sql.slice(start, end).trim();
}

/**
 * The statement text at `cursor` after comment stripping — the same text the
 * per-statement reference cache (sqlReferences.ts) keys its backend analyses on.
 * Callers outside `getSqlCompletionContext` (hover, ctrl+click, the explicit
 * completion await) use this to look references up without re-deriving them.
 */
export function extractSqlStatementAt(sql: string, cursor: number, dialect?: SqlDialect): string {
  const stripped = stripSqlComments(sql, cursor, dialect);
  if (stripped.cursorInComment) return "";
  return extractStatementAt(stripped.text, cursor);
}

function detectStatementKind(previousStatements: string): SqlStatementKind {
  const trimmed = previousStatements.trim();
  if (!trimmed) return "unknown";
  const firstWord = /^([A-Za-z_][\w$]*)/.exec(trimmed)?.[1]?.toLowerCase();
  if (!firstWord) return "unknown";
  const kindMap: Record<string, SqlStatementKind> = {
    select: "select",
    with: "select",
    insert: "insert",
    update: "update",
    delete: "delete",
    create: "create",
    alter: "alter",
    drop: "drop",
  };
  return kindMap[firstWord] ?? "unknown";
}

function isCallRoutineContext(beforeToken: string): boolean {
  return (
    /\bcall\s+(?:[A-Za-z_][\w$]*\.)?$/i.test(beforeToken) ||
    /\bcall\s+(?:[A-Za-z_][\w$]*\.)?[A-Za-z_][\w$]*$/i.test(beforeToken)
  );
}

interface StrippedSql {
  text: string;
  /** True when `cursor` sits inside a comment — the user is editing prose, not SQL. */
  cursorInComment: boolean;
}

// `$$…$$` or `$tag$…$tag$` (PostgreSQL dollar-quoted string). The tag starts with
// a letter or underscore (never a digit, so bind placeholders like `$1` are safe).
const DOLLAR_QUOTED_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;
const DOLLAR_TAG_LOOKAHEAD = 64;

/** Dialect-specific lexical rules for comment stripping. */
interface SqlLexicalRules {
  /** `\` escapes the next character inside '…' / "…" (MySQL family, ClickHouse). */
  backslashEscapes: boolean;
  /** `#` starts a line comment (MySQL family). */
  hashComments: boolean;
  /** Block comments nest (PostgreSQL, SQL Server). */
  nestedBlockComments: boolean;
  /** `[…]` is a quoted identifier (SQL Server). */
  bracketIdentifiers: boolean;
  /** `E'…'` strings use backslash escapes (PostgreSQL). */
  escapeStringPrefix: boolean;
}

function sqlLexicalRules(dialect?: SqlDialect): SqlLexicalRules {
  return {
    backslashEscapes: dialect === "mysql" || dialect === "clickhouse",
    hashComments: dialect === "mysql",
    nestedBlockComments: dialect === "postgres" || dialect === "sqlserver",
    bracketIdentifiers: dialect === "sqlserver",
    escapeStringPrefix: dialect === "postgres",
  };
}

/**
 * Blank out SQL comment bodies (`-- line`, `/* block *\/`, and MySQL `# line`)
 * so commented-out SQL never leaks into context detection (referenced tables,
 * statement kind, ...). Each body becomes same-length whitespace (newlines are
 * kept) so every cursor offset in the result stays valid; the comment
 * delimiters (`--`, `#`, `/*` and the block closer) stay visible so a fully
 * commented line does not read as a blank line and terminate the current
 * statement block. For the same reason every inner line of a multi-line block
 * comment keeps a `*` placeholder in its first column. Quoted spans are
 * skipped: a `--` or `/*` inside `'…'`, `"…"`, backticks, a dollar-quoted
 * string (or `[…]` on SQL Server) is data, not a comment. The dialect decides
 * the lexical details: backslash escapes (MySQL/ClickHouse, PG `E'…'`), `#`
 * comments (MySQL) and nested block comments (PostgreSQL/SQL Server).
 */
function stripSqlComments(sql: string, cursor: number, dialect?: SqlDialect): StrippedSql {
  const rules = sqlLexicalRules(dialect);
  const chars = sql.split("");
  let cursorInComment = false;
  const coversCursor = (from: number, to: number) => {
    if (cursor >= from && cursor <= to) cursorInComment = true;
  };
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const ch = chars[i];
      if (ch !== "\n" && ch !== "\r") chars[i] = " ";
    }
  };
  const blankBlock = (from: number, to: number) => {
    blank(from, to);
    for (let i = from; i < to; i++) {
      if (sql[i] !== "\n") continue;
      const lineStart = i + 1;
      if (lineStart < sql.length && sql[lineStart] !== "\n" && sql[lineStart] !== "\r") chars[lineStart] = "*";
    }
  };
  const skipLineComment = (bodyStart: number) => {
    // A line comment runs to the newline; the newline itself stays visible.
    const end = sql.indexOf("\n", bodyStart);
    const commentEnd = end < 0 ? sql.length : end;
    coversCursor(bodyStart, commentEnd);
    blank(bodyStart, commentEnd);
    return commentEnd;
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const escapeString =
        ch === "'" && rules.escapeStringPrefix && /[Ee]/.test(sql[i - 1] ?? "") && !isIdentifierPart(sql[i - 2]);
      const backslashes = ch !== "`" && (rules.backslashEscapes || escapeString);
      i = skipQuotedSpan(sql, i, ch, backslashes);
    } else if (ch === "[" && rules.bracketIdentifiers) {
      i = skipQuotedSpan(sql, i, "]", false);
    } else if (ch === "$") {
      i = skipDollarQuotedSpan(sql, i);
    } else if (ch === "-" && sql[i + 1] === "-") {
      i = skipLineComment(i + 2);
    } else if (ch === "#" && rules.hashComments) {
      i = skipLineComment(i + 1);
    } else if (ch === "/" && sql[i + 1] === "*") {
      const close = findBlockCommentClose(sql, i + 2, rules.nestedBlockComments);
      if (close < 0) {
        coversCursor(i + 2, sql.length);
        blankBlock(i + 2, sql.length);
        i = sql.length;
      } else {
        coversCursor(i + 2, close);
        blankBlock(i + 2, close);
        i = close + 2;
      }
    } else {
      i += 1;
    }
  }
  return { text: chars.join(""), cursorInComment };
}

/** Index of the `*\/` closing the block comment whose body starts at `from`, or -1. */
function findBlockCommentClose(sql: string, from: number, nested: boolean): number {
  if (!nested) return sql.indexOf("*/", from);
  let depth = 1;
  for (let i = from; i < sql.length - 1; i++) {
    if (sql[i] === "/" && sql[i + 1] === "*") {
      depth += 1;
      i += 1;
    } else if (sql[i] === "*" && sql[i + 1] === "/") {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
    }
  }
  return -1;
}

/**
 * Position right after the quoted span opening at `start` and closed by `quote`;
 * a doubled closing quote is an escape, and so is a backslash when the dialect
 * (or a PG `E'…'` string) uses backslash escapes.
 */
function skipQuotedSpan(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
  for (let i = start + 1; i < sql.length; i++) {
    if (backslashEscapes && sql[i] === "\\") {
      i += 1;
      continue;
    }
    if (sql[i] !== quote) continue;
    if (sql[i + 1] === quote) {
      i += 1;
      continue;
    }
    return i + 1;
  }
  return sql.length;
}

/** Position right after a dollar-quoted string opening at `start`, or `start + 1` when no tag matches. */
function skipDollarQuotedSpan(sql: string, start: number): number {
  const tag = DOLLAR_QUOTED_TAG.exec(sql.slice(start, start + DOLLAR_TAG_LOOKAHEAD))?.[0];
  if (!tag) return start + 1;
  const close = sql.indexOf(tag, start + tag.length);
  return close < 0 ? sql.length : close + tag.length;
}

export function getSqlCompletionContext(
  sql: string,
  cursor: number,
  references?: SqlStatementReferences | SqlReferencesResolver | null,
  options?: { dialect?: SqlDialect },
): SqlCompletionContext {
  // Commented-out SQL must not poison context detection (referenced tables,
  // statement kind, ...): blank `--` / `/* */` (and dialect-specific) comments
  // once, up front. Bodies become same-length whitespace so every offset stays
  // valid, and a cursor inside a comment gets the same neutral context as an
  // empty document. The dialect decides string escapes and comment syntax.
  const stripped = stripSqlComments(sql, cursor, options?.dialect);
  if (stripped.cursorInComment) return getSqlCompletionContext("", 0);

  // Extract the full statement at cursor position for referenced tables
  const fullStatement = extractStatementAt(stripped.text, cursor);

  // Content before cursor within the current statement
  const stmtStart = extractStatementStart(stripped.text, cursor);
  const beforeCursor = stripped.text.slice(stmtStart, cursor);

  const trailingIdentifier = parseTrailingIdentifierContext(beforeCursor);
  const prefix = trailingIdentifier?.prefix ?? "";
  const qualifier = trailingIdentifier?.qualifier;
  const bareStart = trailingIdentifier?.start ?? beforeCursor.length;
  const beforeToken = beforeCursor.slice(0, Math.max(0, bareStart)).trimEnd();
  const lastWord = /([A-Za-z_][\w$]*)$/.exec(beforeToken)?.[1]?.toLowerCase() ?? "";

  // Table/CTE/derived references come from the backend's AST analysis (see
  // sqlReferences.ts). Everything keyword-shaped below — which suggestion class
  // the cursor is in — stays local. The resolver form lets the caller drive the
  // per-statement cache without a second statement scan here.
  const resolvedReferences = typeof references === "function" ? references(fullStatement) : references;
  // Clone: the resolved snapshot is cached and shared across keystrokes, while
  // callers (context merge below, metadata refresh) may mutate entries.
  const referencedTables: SqlCompletionReferencedTable[] = (resolvedReferences?.referencedTables ?? []).map(
    (table) => ({
      ...table,
    }),
  );

  // Detect INSERT INTO table (column list) context
  const insertInfo = detectInsertColumnListContext(beforeCursor);

  const afterTableTrigger =
    TABLE_TRIGGER_KEYWORDS.has(lastWord) ||
    (JOIN_MODIFIERS.has(lastWord) && isFollowedByJoin(beforeToken)) ||
    isInTableListContext(beforeToken);
  const exclusiveTableSuggestions =
    EXCLUSIVE_TABLE_TRIGGER_KEYWORDS.has(lastWord) ||
    (JOIN_MODIFIERS.has(lastWord) && isFollowedByJoin(beforeToken)) ||
    isInTableListContext(beforeToken);
  const exclusiveColumnSuggestions = !!qualifier && !exclusiveTableSuggestions && !insertInfo;

  // Check if we're in a context where columns are expected
  const inColumnContext = isInColumnContext(beforeCursor) || !!insertInfo;
  const inJoinConditionContext = isInJoinConditionContext(beforeCursor);
  const prioritizeSelectAliases = isInOrderOrGroupByContext(beforeCursor);
  const inCallRoutineContext = isCallRoutineContext(beforeCursor);

  const statementKind = detectStatementKind(beforeCursor || fullStatement);

  return {
    prefix,
    qualifier: insertInfo ? undefined : qualifier,
    suggestTables: insertInfo ? false : afterTableTrigger,
    suggestColumns: !!qualifier || (inColumnContext && referencedTables.length > 0),
    suggestKeywords: !exclusiveTableSuggestions && !exclusiveColumnSuggestions && !insertInfo && !inCallRoutineContext,
    suggestRoutines:
      inCallRoutineContext ||
      (!exclusiveTableSuggestions && !exclusiveColumnSuggestions && !insertInfo && prefix.length >= 2),
    suggestJoinConditions: insertInfo ? false : inJoinConditionContext && referencedTables.length >= 2,
    exclusiveTableSuggestions: insertInfo ? false : exclusiveTableSuggestions,
    exclusiveColumnSuggestions: exclusiveColumnSuggestions || !!insertInfo,
    exclusiveRoutineSuggestions: inCallRoutineContext,
    prioritizeSelectAliases: insertInfo ? false : prioritizeSelectAliases,
    selectAliases: prioritizeSelectAliases ? extractSelectAliases(fullStatement) : [],
    referencedTables,
    insertTable: insertInfo?.table,
    insertSchema: insertInfo?.schema,
    statementKind,
    tableTriggerWord: lastWord || undefined,
    isGroupBy: isInGroupByContext(beforeCursor),
    nonAggregatedSelectColumns: extractNonAggregatedSelectColumns(fullStatement),
    comparisonLeftColumn: detectComparisonLeftColumn(beforeCursor),
    onStar: detectOnStar(beforeCursor),
  };
}

function parseTrailingIdentifierContext(input: string): { start: number; prefix: string; qualifier?: string } | null {
  if (/\s$/.test(input)) return null;
  let i = input.length - 1;
  while (i >= 0 && /\s/.test(input[i] ?? "")) i--;
  if (i < 0) return null;

  const endsWithDot = input[i] === ".";
  const tail = input.slice(0, endsWithDot ? i : i + 1);
  if (!tail) {
    return endsWithDot ? { start: i, prefix: "" } : null;
  }
  const parts: string[] = [];
  let index = tail.length;

  while (index > 0) {
    const parsed = parseTrailingIdentifierPart(tail, index);
    if (!parsed) break;
    parts.unshift(unquoteIdentifier(parsed.raw));
    index = parsed.start;
    if (index <= 0 || tail[index - 1] !== ".") break;
    index -= 1;
  }

  if (parts.length === 0) return null;
  const start = index;

  if (parts.length >= 2 || endsWithDot) {
    const qualifierParts = endsWithDot ? parts : parts.slice(0, -1);
    const prefixPart = endsWithDot ? "" : (parts[parts.length - 1] ?? "");
    const qualifierValue = qualifierParts.join(".");
    return {
      start,
      prefix: prefixPart,
      qualifier: qualifierValue || undefined,
    };
  }

  return {
    start,
    prefix: parts[0] ?? "",
  };
}

function parseTrailingIdentifierPart(input: string, endExclusive: number): { start: number; raw: string } | null {
  if (endExclusive <= 0) return null;
  const end = endExclusive - 1;
  const tailChar = input[end];
  if (!tailChar) return null;

  if (tailChar === '"') {
    let start = end - 1;
    while (start >= 0) {
      if (input[start] === '"') {
        if (start > 0 && input[start - 1] === '"') {
          start -= 2;
          continue;
        }
        return { start, raw: input.slice(start, endExclusive) };
      }
      start -= 1;
    }
    return null;
  }

  if (tailChar === "`") {
    const start = input.lastIndexOf("`", end - 1);
    if (start < 0) return null;
    return { start, raw: input.slice(start, endExclusive) };
  }

  // SQL Server bracket identifier (`[Order Details]`, as completion inserts
  // them for sqlserver). An escaped `]]` never contains `[`, so the nearest
  // opening bracket is the start.
  if (tailChar === "]") {
    const start = input.lastIndexOf("[", end - 1);
    if (start < 0) return null;
    return { start, raw: input.slice(start, endExclusive) };
  }

  let start = end;
  while (start >= 0 && /[A-Za-z0-9_$@]/.test(input[start] ?? "")) start -= 1;
  start += 1;
  if (start >= endExclusive) return null;
  const raw = input.slice(start, endExclusive);
  if (!/^[@A-Za-z_][\w$@]*$/.test(raw)) return null;
  return { start, raw };
}

/**
 * Check if the content before cursor is in a column-expected context.
 */
function isInColumnContext(beforeCursor: string): boolean {
  if (!beforeCursor) return false;

  // Strip string literals
  const cleaned = beforeCursor.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, "''");

  // Get all words/tokens
  const lastWords = cleaned.trimEnd().split(/\s+/);

  // Check the last 3 words for column-context keywords
  for (let i = lastWords.length - 1; i >= Math.max(0, lastWords.length - 3); i--) {
    const word = lastWords[i]?.toLowerCase().replace(/[^a-z0-9.]/g, "") ?? "";
    // Operators that indicate column context
    if (/^[=<>!+\-*/(,]$/.test(word)) return true;
    // Keywords that directly precede column expressions
    if (["where", "on", "having", "set", "and", "or", "not", "is", "like", "in", "between", "select"].includes(word)) {
      return true;
    }
    // "ORDER BY" / "GROUP BY" — when we see "by", check the word before it
    if (word === "by" && i > 0) {
      const prevWord = lastWords[i - 1]?.toLowerCase() ?? "";
      if (["order", "group"].includes(prevWord)) return true;
    }
  }

  return false;
}

function isInJoinConditionContext(beforeCursor: string): boolean {
  const cleaned = beforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, "''")
    .toLowerCase();
  const lastJoinIndex = cleaned.lastIndexOf(" join ");
  const currentJoinSegment = lastJoinIndex >= 0 ? cleaned.slice(lastJoinIndex) : cleaned;
  if (!/\bon\b/.test(currentJoinSegment)) return false;
  return /\b(?:on|and)\s+[a-z0-9_$]*$/i.test(currentJoinSegment);
}

function isInOrderOrGroupByContext(beforeCursor: string): boolean {
  const cleaned = beforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .toLowerCase();
  const lastOrderBy = cleaned.lastIndexOf("order by");
  const lastGroupBy = cleaned.lastIndexOf("group by");
  const lastContext = Math.max(lastOrderBy, lastGroupBy);
  if (lastContext < 0) return false;

  const segment = cleaned.slice(lastContext);
  return !/\b(?:where|having|limit|offset|union|intersect|except|join|from)\b/.test(segment);
}

function isInGroupByContext(beforeCursor: string): boolean {
  const cleaned = beforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .toLowerCase();
  const lastGroupBy = cleaned.lastIndexOf("group by");
  if (lastGroupBy < 0) return false;
  // Make sure GROUP BY is after ORDER BY (if both exist) — we want the closest
  const lastOrderBy = cleaned.lastIndexOf("order by");
  if (lastOrderBy > lastGroupBy) return false;
  const segment = cleaned.slice(lastGroupBy);
  return !/\b(?:where|having|limit|offset|union|intersect|except|join|from)\b/.test(segment);
}

const AGGREGATE_FUNCTION_PATTERN =
  /^(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|STRING_AGG|ARRAY_AGG|JSON_ARRAYAGG|JSON_OBJECTAGG)\s*\(/i;

function extractNonAggregatedSelectColumns(sql: string): string[] {
  const selectList = extractSelectList(sql);
  if (!selectList) return [];

  const columns: string[] = [];
  for (const expression of splitTopLevel(selectList, ",")) {
    const trimmed = expression.trim();
    if (trimmed === "*") continue;
    if (AGGREGATE_FUNCTION_PATTERN.test(trimmed)) continue;

    const alias = /\bas\s+([A-Za-z_][\w$]*)$/i.exec(trimmed)?.[1];
    if (alias) {
      columns.push(alias);
      continue;
    }

    const lastId = /([A-Za-z_][\w$]*)$/.exec(trimmed)?.[1];
    if (lastId) columns.push(lastId);
  }

  return columns;
}

function detectOnStar(beforeCursor: string): boolean {
  // Cursor is right after * in SELECT clause
  return /\bselect\b[^;]*\*$/i.test(beforeCursor);
}

function detectComparisonLeftColumn(beforeCursor: string): string | undefined {
  // Match: column_name = | column.column = | alias.column =
  const match = /\b([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s*(?:=|!=|<>|>=|<=|>|<)\s*$/i.exec(beforeCursor);
  return match?.[1];
}

// `INSERT INTO <table> (` with an optional schema; each part may be bare,
// backtick-quoted or bracket-quoted (SQL Server) — double-quoted parts were
// already collapsed by the caller's string cleanup.
const INSERT_COLUMN_LIST_TARGET =
  /\binsert\s+into\s+((?:\[[^\]]+\]|`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:\[[^\]]+\]|`[^`]+`|[A-Za-z_][\w$]*))?)\s*\([^)]*$/i;

function detectInsertColumnListContext(beforeCursor: string): { table: string; schema?: string } | null {
  const cleaned = beforeCursor
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .toLowerCase();
  const match = INSERT_COLUMN_LIST_TARGET.exec(cleaned);
  if (!match) return null;
  const fullTable = match[1];
  if (!fullTable) return null;
  const [first, second] = splitQualifiedName(fullTable);
  if (second) return { table: second, schema: first! };
  return { table: first! };
}

/**
 * Regex reference extraction — the fallback for statements the backend AST
 * cannot parse. Mid-typing statements at exactly the positions where column
 * completion matters (`WHERE u.`, `JOIN o ON `, `SET `, `ORDER BY `, a trailing
 * `AND `) are syntax errors to sqlparser, so an AST-only path resolves them to
 * no tables. `sqlReferences.ts` uses this scanner only when the analysis fails
 * (and to fill a cold cache miss synchronously); every statement that parses
 * takes its references from the AST.
 *
 * The caller passes comment-stripped statement text; string-literal and
 * dollar-quoted bodies are masked here so `'… from x …'` cannot register `x`.
 */
export function extractSqlReferencesFallback(statement: string): SqlStatementReferences {
  const sql = maskSqlStringLiterals(statement);
  const referencedTables = extractReferencedTables(sql);
  for (const cte of extractCteDefinitions(sql)) {
    const existing = referencedTables.find((rt) => rt.name.toLowerCase() === cte.name.toLowerCase());
    if (!existing) {
      referencedTables.push({ name: cte.name, columns: cte.columns });
    } else if (!existing.columns) {
      existing.columns = cte.columns;
    }
  }
  for (const sq of extractSubqueryReferences(sql)) {
    if (!referencedTables.some((rt) => rt.name.toLowerCase() === sq.name.toLowerCase() && rt.alias === sq.alias)) {
      referencedTables.push(sq);
    }
  }
  return { referencedTables };
}

// Same-length masking of `'…'` (with `''` escapes) and `$tag$…$tag$` bodies, so
// offsets stay valid and literal text never reaches the reference regexes. An
// unterminated literal (the cursor is inside it) masks to the end.
function maskSqlStringLiterals(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      const closed = j < sql.length;
      const end = closed ? j + 1 : sql.length;
      out += `'${" ".repeat(end - i - (closed ? 2 : 1))}${closed ? "'" : ""}`;
      i = end;
      continue;
    }
    if (ch === "$" && !/[\w$]/.test(sql[i - 1] ?? "")) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        const end = close < 0 ? sql.length : close + tag.length;
        out += " ".repeat(end - i);
        i = end;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function extractReferencedTables(sql: string): SqlCompletionReferencedTable[] {
  // Keywords that should NOT be treated as table aliases
  const ALIAS_BLACKLIST = new Set([
    "where",
    "group",
    "order",
    "having",
    "limit",
    "offset",
    "union",
    "intersect",
    "except",
    "and",
    "or",
    "not",
    "is",
    "like",
    "in",
    "between",
    "exists",
    "select",
    "from",
    "join",
    "left",
    "right",
    "inner",
    "outer",
    "cross",
    "apply",
    "full",
    "natural",
    "on",
    "as",
    "set",
    "insert",
    "update",
    "delete",
    "create",
    "drop",
    "alter",
    "into",
    "values",
    "returning",
    "for",
    "window",
    "partition",
    "over",
    "with",
    "recursive",
    "lateral",
    "when",
    "then",
    "else",
    "end",
    "case",
    "cast",
    "coalesce",
    "null",
    "true",
    "false",
    "distinct",
    "all",
    "primary",
    "key",
    "foreign",
    "references",
    "constraint",
    "default",
    "check",
    "unique",
    "index",
    "table",
    "view",
    "database",
    "schema",
    "describe",
    "explain",
    "analyze",
    "pivot",
    "unpivot",
    "asof",
    "positional",
    "anti",
    "semi",
    "sample",
    "filter",
    "qualify",
    "offset",
    "fetch",
    "next",
    "rows",
    "only",
    "preceding",
    "following",
    "current",
    "unbounded",
    "asc",
    "desc",
    "nulls",
    "first",
    "last",
    "ignore",
    "respect",
  ]);

  const pattern =
    /\b(?:from|join|update|into|apply)\s+((?:"[^"]+"|`[^`]+`|[^\s,;()]+)(?:\.(?:"[^"]+"|`[^`]+`|[^\s,;()]+))?)(?:\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi;
  const referenced: SqlCompletionReferencedTable[] = [];
  for (const match of sql.matchAll(pattern)) {
    const rawName = match[1];
    const alias = match[2];
    // Filter out SQL keywords that accidentally matched as aliases
    const cleanAlias = alias && !ALIAS_BLACKLIST.has(alias.toLowerCase()) ? alias : undefined;
    if (isElasticsearchStyleIndexName(rawName)) {
      referenced.push({ name: unquoteIdentifier(rawName), alias: cleanAlias });
      continue;
    }
    const [first, second] = splitQualifiedName(rawName);
    if (!first) continue;
    const table = second ? { schema: first, name: second, alias: cleanAlias } : { name: first, alias: cleanAlias };
    referenced.push(table);
  }
  return referenced;
}

function isElasticsearchStyleIndexName(name: string | undefined): name is string {
  if (!name) return false;
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("`") && name.endsWith("`"))) return false;
  return /[-*]/.test(name);
}

function findMatchingParen(sql: string, openPos: number): number {
  if (sql[openPos] !== "(") return -1;
  let depth = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = openPos + 1; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractSelectColumnNames(sql: string): string[] {
  const selectList = extractSelectList(sql);
  if (!selectList) return [];
  const names: string[] = [];
  for (const expression of splitTopLevel(selectList, ",")) {
    const trimmed = expression.trim();
    if (trimmed === "*") continue;
    if (/^[A-Za-z_][\w$]*$/.test(trimmed)) {
      names.push(trimmed);
      continue;
    }
    const alias = /\bas\s+([A-Za-z_][\w$]*)$/i.exec(trimmed)?.[1];
    if (alias) {
      names.push(alias);
      continue;
    }
    const lastId = /([A-Za-z_][\w$]*)$/.exec(trimmed)?.[1];
    if (lastId) names.push(lastId);
  }
  return names;
}

function extractCteDefinitions(sql: string): Array<{ name: string; columns: string[] }> {
  const ctes: Array<{ name: string; columns: string[] }> = [];
  let lower = sql.toLowerCase();
  const withMatch = /\bwith\b/.exec(lower);
  if (!withMatch) return ctes;

  let pos = withMatch.index + "with".length;
  lower = lower.slice(pos);
  const recursiveMatch = /^\s+recursive\b/.exec(lower);
  if (recursiveMatch) {
    pos += recursiveMatch[0].length;
  }

  while (pos < sql.length) {
    while (pos < sql.length && /\s/.test(sql[pos])) pos++;
    if (pos >= sql.length) break;
    if (sql[pos] === "," || sql[pos] === ";") {
      pos++;
      continue;
    }

    const remaining = sql.slice(pos);
    const nameMatch = /^([A-Za-z_][\w$]*)/.exec(remaining);
    if (!nameMatch) break;
    const cteName = nameMatch[1];
    pos += nameMatch[0].length;

    while (pos < sql.length && /\s/.test(sql[pos])) pos++;

    let columns: string[] = [];
    if (pos < sql.length && sql[pos] === "(") {
      const colListEnd = findMatchingParen(sql, pos);
      if (colListEnd !== -1) {
        const colList = sql.slice(pos + 1, colListEnd).trim();
        if (!/\bselect\b/i.test(colList)) {
          columns = colList
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          pos = colListEnd + 1;
          while (pos < sql.length && /\s/.test(sql[pos])) pos++;
        }
      }
    }

    while (pos < sql.length && /\s/.test(sql[pos])) pos++;
    if (/\bas\b/i.test(sql.slice(pos, pos + 5))) {
      pos += 2;
      while (pos < sql.length && /\s/.test(sql[pos])) pos++;
    }

    if (pos >= sql.length || sql[pos] !== "(") break;
    const bodyEnd = findMatchingParen(sql, pos);
    if (bodyEnd === -1) break;

    if (columns.length === 0) {
      const body = sql.slice(pos + 1, bodyEnd);
      columns = extractSelectColumnNames(body);
    }

    ctes.push({ name: cteName, columns });
    pos = bodyEnd + 1;
  }

  return ctes;
}

function extractSubqueryReferences(sql: string): SqlCompletionReferencedTable[] {
  const refs: SqlCompletionReferencedTable[] = [];
  const pattern = /\b(?:from|join)\s*\(/gi;

  for (const match of sql.matchAll(pattern)) {
    const openParen = match.index! + match[0].length - 1;
    const closeParen = findMatchingParen(sql, openParen);
    if (closeParen === -1) continue;

    // Extract alias after closing paren
    let pos = closeParen + 1;
    while (pos < sql.length && /\s/.test(sql[pos])) pos++;
    if (/\bas\b/i.test(sql.slice(pos, pos + 4))) {
      pos += 2;
      while (pos < sql.length && /\s/.test(sql[pos])) pos++;
    }
    const aliasMatch = /^([A-Za-z_][\w$]*)/.exec(sql.slice(pos));
    if (!aliasMatch) continue;
    const alias = aliasMatch[1];
    if (ALIAS_BLACKLIST_FOR_REF.has(alias.toLowerCase())) continue;

    // Extract SELECT columns from subquery body
    const body = sql.slice(openParen + 1, closeParen);
    const columns = extractSelectColumnNames(body);

    refs.push({ name: alias, alias, columns });
  }

  return refs;
}

const ALIAS_BLACKLIST_FOR_REF = new Set([
  "where",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "union",
  "intersect",
  "except",
  "and",
  "or",
  "not",
  "is",
  "like",
  "in",
  "between",
  "exists",
  "select",
  "on",
  "set",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "full",
  "natural",
  "join",
]);

function extractSelectAliases(sql: string): string[] {
  const selectList = extractSelectList(sql);
  if (!selectList) return [];

  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const expression of splitTopLevel(selectList, ",")) {
    const alias = extractSelectAlias(expression);
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }

  return aliases;
}

function extractSelectList(sql: string): string | null {
  const lower = sql.toLowerCase();
  const selectIndex = lower.search(/\bselect\b/);
  if (selectIndex < 0) return null;

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = selectIndex + "select".length; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      lower.slice(i, i + "from".length) === "from" &&
      !isIdentifierPart(sql[i - 1]) &&
      !isIdentifierPart(sql[i + "from".length])
    ) {
      return sql.slice(selectIndex + "select".length, i).trim();
    }
  }

  return null;
}

function extractSelectAlias(expression: string): string | null {
  const trimmed = expression.trim();
  const explicitAlias = /\bas\s+([A-Za-z_][\w$]*)$/i.exec(trimmed)?.[1];
  if (explicitAlias) return explicitAlias;

  const implicitAlias = /(?:^|[\s)])([A-Za-z_][\w$]*)$/.exec(trimmed)?.[1];
  if (!implicitAlias) return null;
  const expressionWithoutAlias = trimmed.slice(0, trimmed.length - implicitAlias.length).trimEnd();
  if (!expressionWithoutAlias || /^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?$/.test(trimmed)) return null;
  return implicitAlias;
}

function isIdentifierPart(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function splitQualifiedName(input: string): [string | undefined, string | undefined] {
  const parts: string[] = [];
  let current = "";
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBracket = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && !inBacktick && !inBracket) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }
    if (ch === "`" && !inDoubleQuote && !inBracket) {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }
    if (ch === "[" && !inDoubleQuote && !inBacktick && !inBracket) {
      inBracket = true;
      current += ch;
      continue;
    }
    if (ch === "]" && inBracket) {
      // `]]` is an escaped bracket inside the identifier.
      if (input[i + 1] === "]") {
        current += "]]";
        i += 1;
        continue;
      }
      inBracket = false;
      current += ch;
      continue;
    }
    if (ch === "." && !inDoubleQuote && !inBacktick && !inBracket) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const unquoted = parts.map((p) => unquoteIdentifier(p)).filter(Boolean);
  if (unquoted.length >= 2) return [unquoted[0], unquoted[1]];
  return [unquoted[0], undefined];
}

function unquoteIdentifier(value: string): string {
  if (value.length < 2) return value;
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replaceAll('""', '"');
  if (value.startsWith("`") && value.endsWith("`")) return value.slice(1, -1).replaceAll("``", "`");
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).replaceAll("]]", "]");
  return value;
}

// Exported for the sidebar drag-to-editor insertion (queryEditorTableDrop.ts):
// dropped table/column identifiers must be quoted exactly like completion
// insertions (T06 rules — MySQL backticks, SQL Server brackets, PG double quotes).
export function quoteSqlIdentifier(identifier: string, dialect?: SqlDialect): string {
  switch (dialect) {
    case "postgres":
      if (!requiresPostgresIdentifierQuote(identifier)) return identifier;
      return `"${identifier.replaceAll('"', '""')}"`;
    case "mysql":
      if (!requiresMysqlIdentifierQuote(identifier)) return identifier;
      return `\`${identifier.replaceAll("`", "``")}\``;
    case "sqlserver":
      if (!requiresSqlServerIdentifierQuote(identifier)) return identifier;
      return `[${identifier.replaceAll("]", "]]")}]`;
    default:
      // Generic-family dialects (oracle, duckdb, clickhouse, sqlite, generic):
      // there is no per-dialect reserved-word set for them yet, so plain
      // identifiers stay bare. Anything that cannot be written bare (spaces,
      // hyphens, a leading digit, …) gets ANSI double quotes, which all five
      // accept — a bare `my table` is invalid SQL everywhere.
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return identifier;
      return `"${identifier.replaceAll('"', '""')}"`;
  }
}

function requiresPostgresIdentifierQuote(identifier: string): boolean {
  if (!/^[a-z_][a-z0-9_$]*$/.test(identifier)) return true;
  return POSTGRES_IDENTIFIER_KEYWORDS.has(identifier);
}

const POSTGRES_IDENTIFIER_KEYWORDS = new Set(
  SQL_KEYWORDS.map((keyword) => keyword.toLowerCase()).concat(["current_user", "session_user", "user"]),
);

function requiresMysqlIdentifierQuote(identifier: string): boolean {
  // Unquoted MySQL identifiers: start with a letter/underscore, then letters, digits, `_` or `$`.
  // Anything else (leading digit, hyphen, spaces, …) and every reserved word must be backtick-quoted.
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(identifier)) return true;
  return MYSQL_IDENTIFIER_KEYWORDS.has(identifier.toLowerCase());
}

function requiresSqlServerIdentifierQuote(identifier: string): boolean {
  // Regular T-SQL identifiers: start with a letter/underscore, then letters, digits, `_`, `@`, `$` or `#`.
  // Anything else and every reserved keyword must be bracket-quoted.
  if (!/^[a-zA-Z_][a-zA-Z0-9_@$#]*$/.test(identifier)) return true;
  return SQLSERVER_IDENTIFIER_KEYWORDS.has(identifier.toLowerCase());
}

// MySQL 8.0 reserved words (dev.mysql.com/doc/refman/8.0/en/keywords.html) — non-reserved
// keywords (e.g. `user`, `engine`) stay valid unquoted and are deliberately absent.
const MYSQL_IDENTIFIER_KEYWORDS = new Set([
  "accessible",
  "add",
  "all",
  "alter",
  "analyze",
  "and",
  "as",
  "asc",
  "asensitive",
  "before",
  "between",
  "bigint",
  "binary",
  "blob",
  "both",
  "by",
  "call",
  "cascade",
  "case",
  "change",
  "char",
  "character",
  "check",
  "collate",
  "column",
  "condition",
  "constraint",
  "continue",
  "convert",
  "create",
  "cross",
  "cube",
  "cume_dist",
  "current_date",
  "current_time",
  "current_timestamp",
  "current_user",
  "cursor",
  "database",
  "databases",
  "day_hour",
  "day_microsecond",
  "day_minute",
  "day_second",
  "dec",
  "decimal",
  "declare",
  "default",
  "delayed",
  "delete",
  "dense_rank",
  "desc",
  "describe",
  "distinct",
  "distinctrow",
  "div",
  "double",
  "drop",
  "dual",
  "else",
  "elseif",
  "empty",
  "enclosed",
  "escaped",
  "except",
  "exists",
  "exit",
  "explain",
  "false",
  "fetch",
  "first_value",
  "float",
  "float4",
  "float8",
  "for",
  "force",
  "foreign",
  "from",
  "fulltext",
  "function",
  "generated",
  "get",
  "grant",
  "group",
  "grouping",
  "groups",
  "having",
  "high_priority",
  "hour_microsecond",
  "hour_minute",
  "hour_second",
  "if",
  "ignore",
  "in",
  "index",
  "infile",
  "inner",
  "inout",
  "insensitive",
  "insert",
  "int",
  "int1",
  "int2",
  "int3",
  "int4",
  "int8",
  "integer",
  "interval",
  "into",
  "io_after_gtids",
  "io_before_gtids",
  "is",
  "iterate",
  "join",
  "json_table",
  "key",
  "keys",
  "kill",
  "lag",
  "last_value",
  "lateral",
  "lead",
  "leading",
  "leave",
  "left",
  "like",
  "limit",
  "linear",
  "lines",
  "load",
  "localtime",
  "localtimestamp",
  "lock",
  "long",
  "longblob",
  "longtext",
  "loop",
  "low_priority",
  "master_bind",
  "master_ssl_verify_server_cert",
  "match",
  "maxvalue",
  "mediumblob",
  "mediumint",
  "mediumtext",
  "middleint",
  "minute_microsecond",
  "minute_second",
  "mod",
  "modifies",
  "natural",
  "not",
  "no_write_to_binlog",
  "nth_value",
  "ntile",
  "null",
  "numeric",
  "of",
  "on",
  "optimize",
  "optimizer_costs",
  "option",
  "optionally",
  "or",
  "order",
  "out",
  "outer",
  "outfile",
  "over",
  "partition",
  "percent_rank",
  "precision",
  "primary",
  "procedure",
  "purge",
  "range",
  "rank",
  "read",
  "reads",
  "read_write",
  "real",
  "recursive",
  "references",
  "regexp",
  "release",
  "rename",
  "repeat",
  "replace",
  "require",
  "resignal",
  "restrict",
  "return",
  "revoke",
  "right",
  "rlike",
  "row",
  "rows",
  "row_number",
  "schema",
  "schemas",
  "second_microsecond",
  "select",
  "sensitive",
  "separator",
  "set",
  "show",
  "signal",
  "smallint",
  "spatial",
  "specific",
  "sql",
  "sqlexception",
  "sqlstate",
  "sqlwarning",
  "sql_big_result",
  "sql_calc_found_rows",
  "sql_small_result",
  "ssl",
  "starting",
  "stored",
  "straight_join",
  "system",
  "table",
  "terminated",
  "then",
  "tinyblob",
  "tinyint",
  "tinytext",
  "to",
  "trailing",
  "trigger",
  "true",
  "undo",
  "union",
  "unique",
  "unlock",
  "unsigned",
  "update",
  "usage",
  "use",
  "using",
  "utc_date",
  "utc_time",
  "utc_timestamp",
  "values",
  "varbinary",
  "varchar",
  "varcharacter",
  "varying",
  "virtual",
  "when",
  "where",
  "while",
  "window",
  "with",
  "write",
  "xor",
  "year_month",
  "zerofill",
]);

// Transact-SQL reserved keywords (learn.microsoft.com/sql/t-sql/language-elements/reserved-keywords).
const SQLSERVER_IDENTIFIER_KEYWORDS = new Set([
  "add",
  "all",
  "alter",
  "and",
  "any",
  "as",
  "asc",
  "authorization",
  "backup",
  "begin",
  "between",
  "break",
  "browse",
  "bulk",
  "by",
  "cascade",
  "case",
  "check",
  "checkpoint",
  "close",
  "clustered",
  "coalesce",
  "collate",
  "column",
  "commit",
  "compute",
  "constraint",
  "contains",
  "containstable",
  "continue",
  "convert",
  "create",
  "cross",
  "current",
  "current_date",
  "current_time",
  "current_timestamp",
  "current_user",
  "cursor",
  "database",
  "dbcc",
  "deallocate",
  "declare",
  "default",
  "delete",
  "deny",
  "desc",
  "disk",
  "distinct",
  "distributed",
  "double",
  "drop",
  "dump",
  "else",
  "end",
  "errlvl",
  "escape",
  "except",
  "exec",
  "execute",
  "exists",
  "exit",
  "external",
  "fetch",
  "file",
  "fillfactor",
  "for",
  "foreign",
  "freetext",
  "freetexttable",
  "from",
  "full",
  "function",
  "goto",
  "grant",
  "group",
  "having",
  "holdlock",
  "identity",
  "identity_insert",
  "identitycol",
  "if",
  "in",
  "index",
  "inner",
  "insert",
  "intersect",
  "into",
  "is",
  "join",
  "key",
  "kill",
  "left",
  "like",
  "lineno",
  "load",
  "merge",
  "national",
  "nocheck",
  "nonclustered",
  "not",
  "null",
  "nullif",
  "of",
  "off",
  "offsets",
  "on",
  "open",
  "opendatasource",
  "openquery",
  "openrowset",
  "openxml",
  "option",
  "or",
  "order",
  "outer",
  "over",
  "percent",
  "pivot",
  "plan",
  "precision",
  "primary",
  "print",
  "proc",
  "procedure",
  "public",
  "raiserror",
  "read",
  "readtext",
  "reconfigure",
  "references",
  "replication",
  "restore",
  "restrict",
  "return",
  "revert",
  "revoke",
  "right",
  "rollback",
  "rowcount",
  "rowguidcol",
  "rule",
  "save",
  "schema",
  "securityaudit",
  "select",
  "semantickeyphrasetable",
  "semanticsimilaritydetailstable",
  "semanticsimilaritytable",
  "session_user",
  "set",
  "setuser",
  "shutdown",
  "some",
  "statistics",
  "system_user",
  "table",
  "tablesample",
  "textsize",
  "then",
  "to",
  "top",
  "tran",
  "transaction",
  "trigger",
  "truncate",
  "try_convert",
  "tsequal",
  "union",
  "unique",
  "unpivot",
  "update",
  "updatetext",
  "use",
  "user",
  "values",
  "varying",
  "view",
  "waitfor",
  "when",
  "where",
  "while",
  "with",
  "writetext",
]);

function buildTableItems(prefix: string, tables: SqlCompletionTable[], dialect?: SqlDialect): SqlCompletionItem[] {
  return tables
    .filter((table) => matchesPrefix(table.name, prefix))
    .map((table) => ({
      label: table.name,
      type: "table" as const,
      detail: table.schema ? `${table.schema}.${table.name}` : table.type,
      apply: quoteSqlIdentifier(table.name, dialect),
      boost: computeBoost(table.name, prefix) + 1000,
    }))
    .sort(compareCompletionItems)
    .slice(0, MAX_TABLE_COMPLETION_ITEMS);
}

function buildSchemaItems(prefix: string, schemas: string[], dialect?: SqlDialect): SqlCompletionItem[] {
  return schemas
    .filter((schema) => matchesPrefix(schema, prefix))
    .slice(0, 50)
    .map((schema) => ({
      label: schema,
      type: "schema" as const,
      detail: "schema",
      apply: `${quoteSqlIdentifier(schema, dialect)}.`,
      boost: computeBoost(schema, prefix) + 1500,
    }));
}

function buildObjectItems(
  context: SqlCompletionContext,
  objects: SqlCompletionObject[],
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  const onlyProcedures = context.exclusiveRoutineSuggestions;
  return objects
    .filter((object) => (!onlyProcedures || object.type === "procedure") && matchesPrefix(object.name, context.prefix))
    .map((object) => {
      const applyName =
        context.qualifier && object.schema?.toLowerCase() === context.qualifier.toLowerCase()
          ? quoteSqlIdentifier(object.name, dialect)
          : object.schema
            ? `${quoteSqlIdentifier(object.schema, dialect)}.${quoteSqlIdentifier(object.name, dialect)}`
            : quoteSqlIdentifier(object.name, dialect);
      const detail =
        object.type === "trigger" && object.parentName
          ? `trigger on ${object.parentName}`
          : object.schema
            ? `${object.type} in ${object.schema}`
            : object.type;
      return {
        label: object.name,
        type: "function" as const,
        detail,
        apply: object.type === "trigger" ? applyName : `${applyName}()`,
        boost: computeBoost(object.name, context.prefix) + (object.type === "procedure" ? 1800 : 900),
      };
    })
    .sort(compareCompletionItems)
    .slice(0, MAX_TABLE_COMPLETION_ITEMS);
}

function buildStarExpansionItem(
  columnsByTable: Map<string, SqlCompletionColumn[]>,
  t?: SqlCompletionTranslations,
  dialect?: SqlDialect,
): SqlCompletionItem | null {
  const allColumns: string[] = [];
  const seen = new Set<string>();
  for (const [, cols] of columnsByTable) {
    for (const col of cols) {
      if (seen.has(col.name)) continue;
      seen.add(col.name);
      allColumns.push(quoteSqlIdentifier(col.name, dialect));
    }
  }
  if (allColumns.length === 0) return null;
  const expansion = allColumns.join(", ");
  return {
    label: "* → columns",
    type: "snippet" as const,
    detail: `${(t?.starExpansionColumns ?? "{count} columns").replace("{count}", String(allColumns.length))}: ${expansion.length > 60 ? expansion.slice(0, 57) + "..." : expansion}`,
    apply: expansion,
    boost: 1900,
  };
}

function buildComparisonValueItems(
  context: SqlCompletionContext,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
  t?: SqlCompletionTranslations,
): SqlCompletionItem[] {
  const colName = context.comparisonLeftColumn!;
  const parts = colName.split(".");
  const unqualified = parts.length > 1 ? parts[parts.length - 1]! : colName;
  const qualifier = parts.length > 1 ? parts[0] : undefined;

  // Resolve alias to actual table name
  let resolvedTable: string | undefined;
  if (qualifier) {
    const ref = context.referencedTables.find((r) => r.alias?.toLowerCase() === qualifier.toLowerCase());
    resolvedTable = ref?.name?.toLowerCase();
  }

  // Find the column's data type
  let dataType: string | undefined;
  for (const [, cols] of columnsByTable) {
    for (const col of cols) {
      if (col.name.toLowerCase() === unqualified.toLowerCase()) {
        if (qualifier) {
          const qualLower = qualifier.toLowerCase();
          if (
            col.table.toLowerCase() === qualLower ||
            col.schema?.toLowerCase() === qualLower ||
            col.table.toLowerCase() === resolvedTable
          ) {
            dataType = col.dataType;
            break;
          }
        } else {
          dataType = col.dataType;
          break;
        }
      }
    }
    if (dataType) break;
  }

  const items: SqlCompletionItem[] = [];

  // NULL check — always useful. Same typed-prefix casing as keyword completions:
  // the value hint would otherwise duplicate the catalog's NULL item under a
  // different case (both are `type: "keyword"` and dedupe by label).
  items.push({
    label: applyKeywordCasing("NULL", context.prefix),
    type: "keyword" as const,
    detail: t?.nullValue ?? "NULL value",
    boost: 1300,
  });
  items.push({
    label: applyKeywordCasing("IS NULL", context.prefix),
    type: "keyword" as const,
    detail: t?.isNull ?? "Checks whether the value is NULL",
    boost: 1250,
  });
  items.push({
    label: applyKeywordCasing("IS NOT NULL", context.prefix),
    type: "keyword" as const,
    detail: t?.isNotNull ?? "Checks whether the value is not NULL",
    boost: 1200,
  });

  if (!dataType) return items;

  const prefix = context.prefix;
  const dt = dataType.toLowerCase();

  // String-like types: suggest quoted string snippet
  if (dt.includes("char") || dt.includes("text") || dt === "varchar" || dt === "nvarchar" || dt === "ntext") {
    if (matchesPrefix("''", prefix) || !prefix) {
      items.push({
        label: "''",
        type: "snippet" as const,
        detail: t?.stringLiteral ?? "String literal",
        apply: "'${value}'",
        boost: 1800,
      });
    }
  }

  // Numeric types: suggest number placeholder
  if (
    dt.includes("int") ||
    dt.includes("decimal") ||
    dt.includes("numeric") ||
    dt.includes("float") ||
    dt.includes("real") ||
    dt.includes("money") ||
    dt === "bigint" ||
    dt === "smallint" ||
    dt === "tinyint"
  ) {
    if (matchesPrefix("0", prefix) || !prefix) {
      items.push({
        label: "0",
        type: "snippet" as const,
        detail: t?.numericLiteral ?? "Numeric literal",
        apply: "${1:value}",
        boost: 1750,
      });
    }
  }

  // Boolean-ish: tinyint or bit
  if (dt === "bit" || dt === "boolean" || dt === "bool") {
    items.push(
      {
        label: applyKeywordCasing("TRUE", prefix),
        type: "keyword" as const,
        detail: t?.booleanValue ?? "Boolean value",
        boost: 1700,
      },
      {
        label: applyKeywordCasing("FALSE", prefix),
        type: "keyword" as const,
        detail: t?.booleanValue ?? "Boolean value",
        boost: 1650,
      },
    );
  }

  return items;
}

function buildAliasItems(context: SqlCompletionContext): SqlCompletionItem[] {
  const items: SqlCompletionItem[] = [];
  const seen = new Set<string>();
  for (const ref of context.referencedTables) {
    if (ref.alias) continue;
    if (context.prefix && !matchesPrefix(ref.name, context.prefix)) continue;
    const candidate = generateAlias(ref.name);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    items.push({
      label: candidate,
      type: "snippet" as const,
      detail: `alias for ${ref.name}`,
      apply: `AS ${candidate} `,
      boost: 1600 - items.length,
    });
  }
  return items;
}

function generateAlias(tableName: string): string {
  // Simple name → first letter(s)
  const parts = tableName.split("_");
  if (parts.length >= 3) {
    return parts.map((p) => p[0] || "").join("");
  }
  if (parts.length === 2) {
    return parts.map((p) => p[0] || "").join("");
  }
  // Single word: first 1-3 chars
  const name = parts[0] || "";
  if (name.length <= 3) return name;
  return name.slice(0, 3);
}

function isFollowedByJoin(beforeToken: string): boolean {
  const words = beforeToken.trimEnd().split(/\s+/);
  const second = words[words.length - 2]?.toLowerCase();
  return second === "join" || JOIN_MODIFIERS.has(second ?? "");
}

function isInTableListContext(beforeToken: string): boolean {
  return /,\s*$/.test(beforeToken) && /\b(?:from|join|update|into)\b/i.test(beforeToken);
}

function buildColumnItems(
  context: SqlCompletionContext,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  // Collect all columns from the map (all tables have been fetched).
  // Parallel arrays avoid allocating a wrapper object per column per keystroke.
  const cols: SqlCompletionColumn[] = [];
  const keys: string[] = [];
  for (const [key, list] of columnsByTable.entries()) {
    for (const col of list) {
      cols.push(col);
      keys.push(key);
    }
  }

  // Resolve which column indexes are relevant (INSERT column list / qualifier)
  let indexes: number[];
  if (context.insertTable) {
    const tableLower = context.insertTable.toLowerCase();
    const schemaLower = context.insertSchema?.toLowerCase();
    const qualifiedKey = schemaLower ? `${schemaLower}.${tableLower}` : null;
    indexes = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.table.toLowerCase() !== tableLower) continue;
      if (schemaLower && !(c.schema?.toLowerCase() === schemaLower || keys[i].toLowerCase() === qualifiedKey)) continue;
      indexes.push(i);
    }
  } else if (context.qualifier) {
    const q = context.qualifier;
    const qLower = q.toLowerCase();
    const relatedTables = context.referencedTables.filter(
      (table) =>
        table.alias === q ||
        table.alias?.toLowerCase() === qLower ||
        table.name === q ||
        table.name.toLowerCase() === qLower,
    );
    const tableNameSet = new Set(relatedTables.map((t) => t.name.toLowerCase()));
    const tableKeys = new Set<string>();
    for (const table of relatedTables) {
      tableKeys.add(table.name);
      if (table.schema) {
        tableKeys.add(`${table.schema}.${table.name}`);
      }
    }
    indexes = [];
    for (let i = 0; i < cols.length; i++) {
      if (tableNameSet.has(cols[i].table.toLowerCase()) || tableKeys.has(keys[i])) indexes.push(i);
    }
  } else {
    indexes = cols.map((_, i) => i);
  }

  // Count name frequencies to detect duplicates across tables
  const nameCount = new Map<string, number>();
  for (const i of indexes) {
    const name = cols[i].name;
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }

  // When the query already references concrete tables (or we are after a
  // "table." qualifier / in an INSERT column list), the columns of those
  // tables are what the user is most likely picking — boost them above plain
  // keywords so they rank at the top instead of being interleaved.
  const relevanceBoost = context.referencedTables.length > 0 || !!context.qualifier || !!context.insertTable ? 2000 : 0;

  // Deduplicate, prefix-filter, and score in one pass; full items (detail,
  // info, apply strings) are only built for columns that match the prefix.
  const seen = new Set<string>();
  const items: SqlCompletionItem[] = [];
  for (const i of indexes) {
    const c = cols[i];
    const displayLabel = (nameCount.get(c.name) || 0) > 1 ? `${c.table}.${c.name}` : c.name;
    if (seen.has(displayLabel)) continue;
    seen.add(displayLabel);
    const score = computeMatchScore(displayLabel, context.prefix);
    if (score < 0) continue;
    const column = { ...c, displayLabel };
    items.push({
      label: displayLabel,
      type: "column" as const,
      detail: buildColumnDetail(column),
      info: buildColumnInfo(column),
      apply: buildColumnApply(column, context, dialect),
      boost: score + (isKeyColumn(c.name) ? 500 : 0) + relevanceBoost,
    });
  }
  return items.sort(compareCompletionItems);
}

function buildColumnApply(
  column: SqlCompletionColumn & { displayLabel: string },
  context: SqlCompletionContext,
  dialect?: SqlDialect,
): string {
  if (context.qualifier || column.displayLabel === column.name || !column.displayLabel.includes(".")) {
    return quoteSqlIdentifier(column.name, dialect);
  }
  return `${quoteSqlIdentifier(column.table, dialect)}.${quoteSqlIdentifier(column.name, dialect)}`;
}

function isKeyColumn(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "id" || lower.endsWith("_id");
}

function buildColumnDetail(column: SqlCompletionColumn): string {
  // Keep the inline detail short so the column name (the label) always stays
  // fully visible. The comment can be long and would push the name into
  // truncation, so it lives only in the hover `info` panel (buildColumnInfo).
  const tableInfo = column.schema ? `${column.schema}.${column.table}` : column.table;
  let detail = column.dataType ? `${tableInfo}  [${column.dataType}]` : tableInfo;
  if (column.isNullable === false) {
    detail += "  NOT NULL";
  }
  return detail;
}

function buildColumnInfo(column: SqlCompletionColumn): string | undefined {
  const parts = [
    column.schema ? `${column.schema}.${column.table}.${column.name}` : `${column.table}.${column.name}`,
    column.dataType ? `Type: ${column.dataType}` : undefined,
    column.isNullable === false ? "Nullable: no" : column.isNullable === true ? "Nullable: yes" : undefined,
    column.comment?.trim() ? `Comment: ${column.comment.trim()}` : undefined,
  ].filter((part): part is string => !!part);
  return parts.length > 1 ? parts.join("\n") : undefined;
}

function buildJoinConditionItems(
  context: SqlCompletionContext,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
  foreignKeysByTable?: Map<string, SqlCompletionForeignKey[]>,
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  const refs = context.referencedTables;
  if (refs.length < 2) return [];

  const latest = refs[refs.length - 1];
  const previousRefs = refs.slice(0, -1);
  const items: SqlCompletionItem[] = [];

  for (const previous of previousRefs) {
    const previousColumns = columnsForReferencedTable(previous, columnsByTable);
    const latestColumns = columnsForReferencedTable(latest, columnsByTable);
    items.push(
      ...buildForeignKeyJoinConditionItemsForPair(previous, latest, foreignKeysByTable, context.prefix, dialect),
      ...buildJoinConditionItemsForPair(previous, previousColumns, latest, latestColumns, context.prefix, dialect),
    );
  }

  return items;
}

function columnsForReferencedTable(
  table: SqlCompletionReferencedTable,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
): SqlCompletionColumn[] {
  const keys = table.schema ? [`${table.schema}.${table.name}`, table.name] : [table.name];
  for (const key of keys) {
    const columns = columnsByTable.get(key);
    if (columns) return columns;
  }
  return [];
}

function foreignKeysForReferencedTable(
  table: SqlCompletionReferencedTable,
  foreignKeysByTable?: Map<string, SqlCompletionForeignKey[]>,
): SqlCompletionForeignKey[] {
  if (!foreignKeysByTable) return [];
  const keys = table.schema ? [`${table.schema}.${table.name}`, table.name] : [table.name];
  for (const key of keys) {
    const foreignKeys = foreignKeysByTable.get(key);
    if (foreignKeys) return foreignKeys;
  }
  return [];
}

function buildForeignKeyJoinConditionItemsForPair(
  left: SqlCompletionReferencedTable,
  right: SqlCompletionReferencedTable,
  foreignKeysByTable?: Map<string, SqlCompletionForeignKey[]>,
  prefix = "",
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  if (!foreignKeysByTable) return [];
  return [
    ...buildDirectionalForeignKeyJoinConditionItems(
      left,
      right,
      foreignKeysForReferencedTable(left, foreignKeysByTable),
      prefix,
      dialect,
    ),
    ...buildDirectionalForeignKeyJoinConditionItems(
      right,
      left,
      foreignKeysForReferencedTable(right, foreignKeysByTable),
      prefix,
      dialect,
    ),
  ];
}

function buildDirectionalForeignKeyJoinConditionItems(
  owner: SqlCompletionReferencedTable,
  referenced: SqlCompletionReferencedTable,
  foreignKeys: SqlCompletionForeignKey[],
  prefix: string,
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  const matchingForeignKeys = foreignKeys.filter((foreignKey) =>
    referencedTableMatchesName(referenced, foreignKey.ref_table, foreignKey.ref_schema),
  );
  const groups = groupForeignKeysByConstraint(matchingForeignKeys);
  const items: SqlCompletionItem[] = [];

  for (const group of groups) {
    const parts = group.map((foreignKey) =>
      buildJoinConditionPart(owner, foreignKey.column, referenced, foreignKey.ref_column, dialect),
    );
    const label = parts.map((part) => part.label).join(" AND ");
    if (!label || (prefix && !matchesPrefix(label, prefix))) continue;
    const apply = parts.map((part) => part.apply).join(" AND ");
    items.push({
      label,
      type: "snippet",
      detail: group.length > 1 ? "JOIN condition from composite foreign key" : "JOIN condition from foreign key",
      apply,
      boost: 3200 + group.length,
    });
  }

  return items;
}

function buildJoinConditionPart(
  owner: SqlCompletionReferencedTable,
  ownerColumn: string,
  referenced: SqlCompletionReferencedTable,
  referencedColumn: string,
  dialect?: SqlDialect,
): { label: string; apply: string } {
  const ownerRef = owner.alias || owner.name;
  const referencedRef = referenced.alias || referenced.name;
  const ownerApplyRef = owner.alias ? owner.alias : quoteSqlIdentifier(owner.name, dialect);
  const referencedApplyRef = referenced.alias ? referenced.alias : quoteSqlIdentifier(referenced.name, dialect);
  return {
    label: `${ownerRef}.${ownerColumn} = ${referencedRef}.${referencedColumn}`,
    apply: `${ownerApplyRef}.${quoteSqlIdentifier(ownerColumn, dialect)} = ${referencedApplyRef}.${quoteSqlIdentifier(referencedColumn, dialect)}`,
  };
}

function groupForeignKeysByConstraint(foreignKeys: SqlCompletionForeignKey[]): SqlCompletionForeignKey[][] {
  const groups = new Map<string, SqlCompletionForeignKey[]>();
  for (const foreignKey of foreignKeys) {
    const key = `${foreignKey.name || `${foreignKey.column}->${foreignKey.ref_table}.${foreignKey.ref_column}`}:${foreignKey.ref_table}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(foreignKey);
  }
  return [...groups.values()];
}

function referencedTableMatchesName(
  table: SqlCompletionReferencedTable,
  candidate: string,
  candidateSchema?: string | null,
): boolean {
  const normalizedCandidate = normalizeTableName(candidate);
  if (normalizeTableName(table.name) !== normalizedCandidate) return false;
  if (!candidateSchema || !table.schema) return true;
  return normalizeIdentifierPart(table.schema) === normalizeIdentifierPart(candidateSchema);
}

function normalizeTableName(name: string): string {
  return name
    .split(".")
    .filter(Boolean)
    .pop()!
    .replace(/^["`[]|["`\]]$/g, "")
    .toLowerCase();
}

function normalizeIdentifierPart(name: string): string {
  return name.replace(/^["`[]|["`\]]$/g, "").toLowerCase();
}

function buildJoinConditionItemsForPair(
  left: SqlCompletionReferencedTable,
  leftColumns: SqlCompletionColumn[],
  right: SqlCompletionReferencedTable,
  rightColumns: SqlCompletionColumn[],
  prefix: string,
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  const items: SqlCompletionItem[] = [];
  const leftRef = left.alias || left.name;
  const rightRef = right.alias || right.name;
  const leftApplyRef = left.alias ? left.alias : quoteSqlIdentifier(left.name, dialect);
  const rightApplyRef = right.alias ? right.alias : quoteSqlIdentifier(right.name, dialect);
  const leftTableKey = singularTableName(left.name);
  const rightTableKey = singularTableName(right.name);

  const leftByName = indexColumnsByLowerName(leftColumns);
  const rightByName = indexColumnsByLowerName(rightColumns);
  const emittedPairs = new Set<string>();

  const addPair = (
    leftColumn: SqlCompletionColumn | undefined,
    rightColumn: SqlCompletionColumn | undefined,
    boost: number,
  ) => {
    if (!leftColumn || !rightColumn || !areJoinColumnTypesCompatible(leftColumn, rightColumn)) return;
    const key = `${leftColumn.name.toLowerCase()}:${rightColumn.name.toLowerCase()}`;
    if (emittedPairs.has(key)) return;
    emittedPairs.add(key);
    const label = `${leftRef}.${leftColumn.name} = ${rightRef}.${rightColumn.name}`;
    if (prefix && !matchesPrefix(label, prefix)) return;
    const apply = `${leftApplyRef}.${quoteSqlIdentifier(leftColumn.name, dialect)} = ${rightApplyRef}.${quoteSqlIdentifier(rightColumn.name, dialect)}`;
    items.push({
      label,
      type: "snippet",
      detail: "JOIN condition",
      apply,
      boost,
    });
  };

  const leftId = leftByName.get("id")?.[0];
  const rightId = rightByName.get("id")?.[0];

  // Pattern 1: a.id = b.{singular_a}_id  (e.g., users.id = orders.user_id)
  addPair(leftId, rightByName.get(`${leftTableKey}_id`)?.[0], 2300);
  // Pattern 2: a.{singular_b}_id = b.id  (e.g., orders.user_id = users.id)
  addPair(leftByName.get(`${rightTableKey}_id`)?.[0], rightId, 2300);

  // Pattern 3/4: same-name columns, with FK-looking names above generic shared columns.
  for (const [name, leftMatches] of leftByName.entries()) {
    if (name === "id") continue;
    const rightMatches = rightByName.get(name);
    if (!rightMatches?.length) continue;
    addPair(leftMatches[0], rightMatches[0], name.endsWith("_id") ? 2000 : 1700);
  }

  // Pattern 5: parent_id -> id (self-referencing / hierarchical)
  if (leftTableKey === rightTableKey) {
    addPair(leftByName.get("parent_id")?.[0], rightId, 2100);
    addPair(leftId, rightByName.get("parent_id")?.[0], 2100);
  }

  // Pattern 6: created_by / modified_by / owned_by -> users.id
  for (const auditColumnName of ["created_by", "modified_by", "owned_by"]) {
    addPair(leftId, rightByName.get(auditColumnName)?.[0], 1800);
    addPair(leftByName.get(auditColumnName)?.[0], rightId, 1800);
  }

  // Pattern 7: Generic FK column -> id when table names do not reveal the relationship.
  for (const leftColumn of leftColumns) {
    const leftName = leftColumn.name.toLowerCase();
    if (leftName !== "id" && leftName.endsWith("_id")) addPair(leftColumn, rightId, 1650);
  }
  for (const rightColumn of rightColumns) {
    const rightName = rightColumn.name.toLowerCase();
    if (rightName !== "id" && rightName.endsWith("_id")) addPair(leftId, rightColumn, 1650);
  }

  items.push(
    ...buildCompositeHeuristicJoinConditionItems(left, leftColumns, right, leftByName, rightByName, prefix, dialect),
  );

  return items;
}

function indexColumnsByLowerName(columns: SqlCompletionColumn[]): Map<string, SqlCompletionColumn[]> {
  const index = new Map<string, SqlCompletionColumn[]>();
  for (const column of columns) {
    const key = column.name.toLowerCase();
    const existing = index.get(key);
    if (existing) existing.push(column);
    else index.set(key, [column]);
  }
  return index;
}

function buildCompositeHeuristicJoinConditionItems(
  left: SqlCompletionReferencedTable,
  leftColumns: SqlCompletionColumn[],
  right: SqlCompletionReferencedTable,
  leftByName: Map<string, SqlCompletionColumn[]>,
  rightByName: Map<string, SqlCompletionColumn[]>,
  prefix: string,
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  const leftId = leftByName.get("id")?.[0];
  const rightId = rightByName.get("id")?.[0];
  const leftTableKey = singularTableName(left.name);
  const rightTableKey = singularTableName(right.name);
  const candidates: Array<{ parent: "left" | "right"; parentId: SqlCompletionColumn; childFk: SqlCompletionColumn }> =
    [];
  const rightNamedFk = rightByName.get(`${leftTableKey}_id`)?.[0];
  const leftNamedFk = leftByName.get(`${rightTableKey}_id`)?.[0];
  if (leftId && rightNamedFk && areJoinColumnTypesCompatible(leftId, rightNamedFk)) {
    candidates.push({ parent: "left", parentId: leftId, childFk: rightNamedFk });
  }
  if (rightId && leftNamedFk && areJoinColumnTypesCompatible(leftNamedFk, rightId)) {
    candidates.push({ parent: "right", parentId: rightId, childFk: leftNamedFk });
  }
  if (candidates.length === 0) return [];

  const sharedScopeColumns = leftColumns
    .map((leftColumn) => {
      const name = leftColumn.name.toLowerCase();
      const rightColumn = rightByName.get(name)?.[0];
      if (!rightColumn || !isLikelyScopeColumnName(name) || !areJoinColumnTypesCompatible(leftColumn, rightColumn)) {
        return null;
      }
      return { leftColumn, rightColumn };
    })
    .filter((value): value is { leftColumn: SqlCompletionColumn; rightColumn: SqlCompletionColumn } => !!value)
    .slice(0, 2);
  if (sharedScopeColumns.length === 0) return [];

  const leftRef = left.alias || left.name;
  const rightRef = right.alias || right.name;
  const leftApplyRef = left.alias ? left.alias : quoteSqlIdentifier(left.name, dialect);
  const rightApplyRef = right.alias ? right.alias : quoteSqlIdentifier(right.name, dialect);
  const items: SqlCompletionItem[] = [];

  for (const candidate of candidates.slice(0, 2)) {
    const parts = sharedScopeColumns.map(({ leftColumn, rightColumn }) =>
      buildHeuristicJoinConditionPart(leftRef, leftApplyRef, leftColumn, rightRef, rightApplyRef, rightColumn, dialect),
    );
    if (candidate.parent === "left") {
      parts.push(
        buildHeuristicJoinConditionPart(
          leftRef,
          leftApplyRef,
          candidate.parentId,
          rightRef,
          rightApplyRef,
          candidate.childFk,
          dialect,
        ),
      );
    } else {
      parts.push(
        buildHeuristicJoinConditionPart(
          leftRef,
          leftApplyRef,
          candidate.childFk,
          rightRef,
          rightApplyRef,
          candidate.parentId,
          dialect,
        ),
      );
    }
    const label = parts.map((part) => part.label).join(" AND ");
    if (prefix && !matchesPrefix(label, prefix)) continue;
    items.push({
      label,
      type: "snippet",
      detail: "Likely composite JOIN condition",
      apply: parts.map((part) => part.apply).join(" AND "),
      boost: 2400 + parts.length,
    });
  }

  return items;
}

function buildHeuristicJoinConditionPart(
  leftRef: string,
  leftApplyRef: string,
  leftColumn: SqlCompletionColumn,
  rightRef: string,
  rightApplyRef: string,
  rightColumn: SqlCompletionColumn,
  dialect?: SqlDialect,
): { label: string; apply: string } {
  return {
    label: `${leftRef}.${leftColumn.name} = ${rightRef}.${rightColumn.name}`,
    apply: `${leftApplyRef}.${quoteSqlIdentifier(leftColumn.name, dialect)} = ${rightApplyRef}.${quoteSqlIdentifier(rightColumn.name, dialect)}`,
  };
}

function isLikelyScopeColumnName(name: string): boolean {
  return (
    name !== "id" &&
    (name.endsWith("_id") ||
      name === "tenant" ||
      name === "tenant_id" ||
      name === "account_id" ||
      name === "workspace_id" ||
      name === "organization_id" ||
      name === "org_id")
  );
}

function areJoinColumnTypesCompatible(left: SqlCompletionColumn, right: SqlCompletionColumn): boolean {
  const leftType = normalizeJoinType(left.dataType);
  const rightType = normalizeJoinType(right.dataType);
  if (!leftType || !rightType) return true;
  return leftType === rightType;
}

function normalizeJoinType(dataType?: string): string | null {
  if (!dataType) return null;
  const type = dataType.toLowerCase();
  if (/\b(uuid|uniqueidentifier)\b/.test(type)) return "uuid";
  if (/\b(bigint|int8|integer|int|int4|smallint|int2|tinyint|serial|bigserial|number|numeric|decimal)\b/.test(type)) {
    return "number";
  }
  if (/\b(char|text|clob|string|varchar|nvarchar|nchar|uuid)\b/.test(type)) return "text";
  if (/\b(bool|boolean|bit)\b/.test(type)) return "boolean";
  if (/\b(date|time|timestamp|datetime)\b/.test(type)) return "temporal";
  return type.replace(/\(.+\)/, "").trim() || null;
}

function singularTableName(name: string): string {
  const lower = name.toLowerCase();
  // Irregular plurals
  if (lower.endsWith("ies") && lower.length > 3) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ives") && lower.length > 4) return `${lower.slice(0, -4)}f`; // lives → life
  if (lower.endsWith("ves") && lower.length > 3) {
    const stem = lower.slice(0, -3);
    if (stem.endsWith("el") || stem.endsWith("lf")) return `${stem}fe`; // shelves → shelf, halves → half
    return `${stem}f`; // calves → calf
  }
  if (lower.endsWith("ses") && lower.length > 3) {
    const stem = lower.slice(0, -2); // statuses → status, buses → bus
    if (stem.endsWith("s") || stem.endsWith("x") || stem.endsWith("z") || stem.endsWith("ch") || stem.endsWith("sh")) {
      return stem;
    }
  }
  if (lower.endsWith("xes") && lower.length > 3) return lower.slice(0, -2); // boxes → box
  if (lower.endsWith("ches") && lower.length > 4) return lower.slice(0, -2); // matches → match
  if (lower.endsWith("shes") && lower.length > 4) return lower.slice(0, -2); // dishes → dish
  if (lower.endsWith("ices") && lower.length > 4) {
    const stem = lower.slice(0, -4);
    if (stem === "ind") return "index";
    if (stem === "append") return "appendix";
    return `${stem}ex`; // matrices → matrix
  }
  if (lower.endsWith("men") && lower.length > 3) return `${lower}um`; // children → child... no, that's wrong
  if (lower === "children") return "child";
  if (lower === "people") return "person";
  if (lower === "data") return lower; // data is already singular-ish
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 1) return lower.slice(0, -1);
  return lower;
}

export function buildSnippetItemsForTest(prefix: string, snippets: SqlSnippet[]): SqlCompletionItem[] {
  return buildSnippetItems(prefix, snippets);
}

/**
 * Convert a snippet body's `{name}` placeholders into CodeMirror snippet fields
 * (`${name}`) so that applying the snippet selects the first placeholder with the
 * cursor at its end, letting the user immediately overtype it. Existing `${...}`
 * / `#{...}` fields are left untouched (the lookbehind skips them).
 */
export function snippetBodyToTemplate(body: string): string {
  return body.replace(/(?<![#$])\{(\w+)\}/g, "${$1}");
}

// --- Keyword casing: inserted completions follow the typed prefix ---

/**
 * Casing of a keyword completion's inserted text, derived from the word the user
 * typed. The keyword catalogs are canonically uppercase; the inserted (and popup)
 * text matches the in-progress typing style: the case of the first alphabetic
 * character of the prefix decides — `sel` inserts `select`, `SEL` and `Sel` insert
 * `SELECT`, and an empty (or letter-less) prefix — e.g. a completion invoked with no
 * word typed — keeps the canonical uppercase. Deciding on the first letter keeps the
 * choice stable while the prefix grows (`se` → `sel` never flips an already-offered
 * completion) and resolves mixed input like `sEL` deterministically.
 */
export function applyKeywordCasing(keyword: string, prefix: string): string {
  const firstLetter = /[A-Za-z]/.exec(prefix)?.[0];
  return firstLetter && firstLetter === firstLetter.toLowerCase() ? keyword.toLowerCase() : keyword.toUpperCase();
}

// Canonical (uppercase) keywords recognized inside snippet bodies for casing —
// the union of the generic catalog and every per-dialect list.
const SNIPPET_KEYWORD_CANONICAL = new Set<string>([
  ...SQL_KEYWORDS,
  ...COMMON_SQL_KEYWORDS,
  ...POSTGRES_SQL_KEYWORDS,
  ...MYSQL_SQL_KEYWORDS,
  ...SQLITE_SQL_KEYWORDS,
  ...SQLSERVER_SQL_KEYWORDS,
]);

// A snippet body token is a placeholder (`{name}` and pre-existing `${name}` /
// `#{name}` CodeMirror fields), a quoted span (string literal `'…'`, quoted
// identifier `"…"` / backticks / `[…]`), or a bare word. Placeholders and quoted
// spans come first in the alternation so the words inside them are never treated
// as casable keywords: `"Date"` is a different identifier than `"date"` on
// PostgreSQL, and `'TABLE'` is data.
const SNIPPET_BODY_TOKEN_PATTERN =
  /(\$\{[^{}]*\}|#\{[^{}]*\}|\{[^{}]*\}|'(?:[^']|'')*'?|"(?:[^"]|"")*"?|`(?:[^`]|``)*`?|\[[^\]]*\]?)|([A-Za-z_][A-Za-z0-9_$]*)/g;

/**
 * Casing for a snippet body's inserted text: SQL keyword words follow the typed
 * prefix (same rule as `applyKeywordCasing`); placeholders, quoted identifiers,
 * string literals, numbers, punctuation and non-keyword words (e.g. user-authored
 * identifiers) stay exactly as authored.
 */
export function applySnippetBodyCasing(body: string, prefix: string): string {
  return body.replace(
    SNIPPET_BODY_TOKEN_PATTERN,
    (match: string, verbatim: string | undefined, word: string | undefined) => {
      if (verbatim !== undefined) return verbatim;
      if (word !== undefined && SNIPPET_KEYWORD_CANONICAL.has(word.toUpperCase())) {
        return applyKeywordCasing(word, prefix);
      }
      return match;
    },
  );
}

// Snippets whose body starts a new statement (SELECT/INSERT/CREATE/WITH/…). These make
// no sense mid-expression (e.g. inside a WHERE clause), mirroring how DDL keywords are
// gated by `showDdl` in buildKeywordItems.
const STATEMENT_LEVEL_SNIPPET_BODY =
  /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i;

function isStatementLevelSnippet(snippet: SqlSnippet): boolean {
  return STATEMENT_LEVEL_SNIPPET_BODY.test(snippet.body);
}

function buildSnippetItems(
  prefix: string,
  snippets: SqlSnippet[],
  options?: { secondary?: boolean },
): SqlCompletionItem[] {
  if (!prefix) return [];
  // In column/expression positions the columns being referenced are the primary
  // suggestion; snippets are secondary. Drop statement-starting snippets entirely and
  // damp the rest so matching columns rank above them.
  const secondary = options?.secondary ?? false;
  return snippets
    .filter((snippet) => {
      if (secondary && isStatementLevelSnippet(snippet)) return false;
      const matchesSnippetPrefix = matchesPrefix(snippet.prefix, prefix);
      const matchesSnippetLabel = prefix.length > snippet.prefix.length && matchesPrefix(snippet.label, prefix);
      return matchesSnippetPrefix || matchesSnippetLabel;
    })
    .map((snippet) => {
      const boostByPrefix = computeBoost(snippet.prefix, prefix);
      const boostByLabel = computeBoost(snippet.label, prefix);
      const matchesByPrefix = matchesPrefix(snippet.prefix, prefix);
      // When the user types past the snippet prefix (e.g. "sele" vs prefix "sel"),
      // they are likely typing the actual keyword — reduce the base boost so
      // the real keyword can rank higher. In a secondary (expression) context the base
      // is smaller still, so contextually-relevant columns outrank these snippets.
      const baseBoost = matchesByPrefix ? (secondary ? 1500 : 4000) : 0;
      // Keyword words in the body follow the typed prefix casing so the inserted
      // template matches the user's style; everything else stays as authored.
      const casedBody = applySnippetBodyCasing(snippet.body, prefix);
      return {
        label: snippet.label,
        type: "snippet" as const,
        // `detail` previews the body (with `{name}` placeholders) in the same case
        // that will be inserted, while `apply` carries the CodeMirror field template.
        detail: casedBody,
        apply: snippetBodyToTemplate(casedBody),
        boost: Math.max(boostByPrefix, boostByLabel) + baseBoost,
      };
    });
}

function activeFunctionSignatures(databaseType?: DatabaseType): Map<string, string[]> {
  const signatures = databaseType
    ? new Map(Array.from(SQL_FUNCTION_SIGNATURES.entries()).filter(([name]) => COMMON_SQL_FUNCTION_NAMES.has(name)))
    : new Map(SQL_FUNCTION_SIGNATURES);
  const databaseSignatures = databaseType ? DATABASE_FUNCTION_SIGNATURES[databaseType] : undefined;
  if (databaseSignatures) {
    for (const [name, parameters] of databaseSignatures) signatures.set(name, parameters);
  }
  return signatures;
}

function buildFunctionSnippetItems(
  prefix: string,
  functionDescriptions: Map<string, string>,
  databaseType?: DatabaseType,
): SqlCompletionItem[] {
  const items: SqlCompletionItem[] = [];
  const dialectDescriptions = databaseType ? DATABASE_FUNCTION_DESCRIPTIONS[databaseType] : undefined;

  for (const [name, parameters] of activeFunctionSignatures(databaseType).entries()) {
    if (!matchesPrefix(name, prefix)) continue;
    const paramStr = parameters.length > 0 ? parameters.map((p) => `\${${p}}`).join(", ") : "";
    items.push({
      label: name,
      type: "function" as const,
      detail: functionDescriptions.get(name) ?? dialectDescriptions?.get(name) ?? "function",
      apply: isNiladicFunction(databaseType, name.toUpperCase()) ? name : `${name}(${paramStr})`,
      boost: computeBoost(name, prefix) + 300,
    });
  }

  // Window functions — complete with OVER() clause
  for (const name of WINDOW_FUNCTIONS) {
    if (!matchesPrefix(name, prefix)) continue;
    items.push({
      label: name,
      type: "function" as const,
      detail: "window function",
      apply: `${name}() OVER (PARTITION BY \${col} ORDER BY \${col})`,
      boost: computeBoost(name, prefix) + 250,
    });
  }

  return items;
}

const MONGO_COMPLETIONS: Array<Pick<SqlCompletionItem, "label" | "type" | "detail" | "apply">> = [
  { label: "find", type: "function", detail: "MongoDB query documents", apply: "find({})" },
  { label: "findOne", type: "function", detail: "MongoDB query one document", apply: "findOne({})" },
  { label: "aggregate", type: "function", detail: "MongoDB aggregation pipeline", apply: "aggregate([])" },
  {
    label: "countDocuments",
    type: "function",
    detail: "MongoDB count matching documents",
    apply: "countDocuments({})",
  },
  { label: "distinct", type: "function", detail: "MongoDB distinct field values", apply: 'distinct("field", {})' },
  { label: "insertOne", type: "function", detail: "MongoDB insert one document", apply: "insertOne({})" },
  { label: "updateOne", type: "function", detail: "MongoDB update one document", apply: "updateOne({}, { $set: {} })" },
  { label: "deleteOne", type: "function", detail: "MongoDB delete one document", apply: "deleteOne({})" },
  { label: "sort", type: "function", detail: "MongoDB sort cursor", apply: "sort({ field: 1 })" },
  { label: "limit", type: "function", detail: "MongoDB limit cursor", apply: "limit(100)" },
  { label: "skip", type: "function", detail: "MongoDB skip cursor", apply: "skip(0)" },
  { label: "db.collection.find", type: "snippet", detail: "MongoDB find command", apply: "db.collection.find({})" },
  {
    label: "db.collection.aggregate",
    type: "snippet",
    detail: "MongoDB aggregate command",
    apply: "db.collection.aggregate([])",
  },
];

function buildMongoCompletionItems(prefix: string): SqlCompletionItem[] {
  return MONGO_COMPLETIONS.filter((item) => matchesPrefix(item.label, prefix)).map((item) => ({
    ...item,
    boost: computeBoost(item.label, prefix) + (item.type === "snippet" ? 400 : 600),
  }));
}

function buildSelectAliasItems(context: SqlCompletionContext): SqlCompletionItem[] {
  return context.selectAliases
    .filter((alias) => matchesPrefix(alias, context.prefix))
    .map((alias, index) => ({
      label: alias,
      type: "column" as const,
      detail: "SELECT alias",
      boost: computeBoost(alias, context.prefix) + 3500 - index,
    }));
}

function buildNonAggregatedColumnItems(
  context: SqlCompletionContext,
  columnsByTable: Map<string, SqlCompletionColumn[]>,
  dialect?: SqlDialect,
): SqlCompletionItem[] {
  const nonAggSet = new Set(context.nonAggregatedSelectColumns.map((c) => c.toLowerCase()));
  const seen = new Set<string>();

  const items: SqlCompletionItem[] = [];
  for (const [, cols] of columnsByTable) {
    for (const col of cols) {
      const key = col.name.toLowerCase();
      if (!nonAggSet.has(key) || seen.has(key)) continue;
      if (context.prefix && !matchesPrefix(col.name, context.prefix)) continue;
      seen.add(key);
      items.push({
        label: col.name,
        type: "column" as const,
        detail: "non-aggregated column — required in GROUP BY",
        apply: quoteSqlIdentifier(col.name, dialect),
        boost: 2800 - items.length,
      });
    }
  }

  return items;
}

function isDmlStatementKind(kind: SqlStatementKind): boolean {
  return kind === "select" || kind === "insert" || kind === "update" || kind === "delete";
}

function activeSqlKeywords(databaseType?: DatabaseType): string[] {
  if (databaseType === "mongodb") return [];
  const databaseKeywords = databaseType ? DATABASE_SQL_KEYWORDS[databaseType] : undefined;
  return databaseType
    ? Array.from(new Set([...COMMON_SQL_KEYWORDS, ...(databaseKeywords ?? [])]))
    : Array.from(new Set(SQL_KEYWORDS));
}

function buildKeywordItems(
  prefix: string,
  context: SqlCompletionContext,
  databaseType?: DatabaseType,
): SqlCompletionItem[] {
  const isDml = isDmlStatementKind(context.statementKind);
  const showDdl = !isDml || context.suggestTables;

  return activeSqlKeywords(databaseType)
    .filter((keyword) => {
      if (SQL_FUNCTION_SIGNATURES.has(keyword)) return false;
      if (databaseType && DATABASE_FUNCTION_SIGNATURES[databaseType]?.has(keyword)) return false;
      if (WINDOW_FUNCTIONS.has(keyword)) return false;
      if (!matchesPrefix(keyword, prefix)) return false;
      if (!showDdl && isDml && (DDL_ONLY_KEYWORDS.has(keyword) || DATA_TYPE_KEYWORDS.has(keyword))) return false;
      return true;
    })
    .map((keyword) => {
      const base = computeBoost(keyword, prefix);
      const freqBoost = HIGH_FREQUENCY_KEYWORDS.has(keyword) ? 100 : 0;
      // Keyword items carry no `apply`: the editor inserts `apply ?? label`, so the
      // cased label is both what the popup shows and what lands in the document.
      return {
        label: applyKeywordCasing(keyword, prefix),
        type: "keyword" as const,
        boost: base + freqBoost,
      };
    });
}

function matchesPrefix(candidate: string, prefix: string): boolean {
  if (!prefix) return true;
  return computeMatchScore(candidate, prefix) >= 0;
}

/**
 * Score how well `prefix` matches `candidate`.
 * Returns -1 for no match, or a positive score where higher = better match.
 *
 * Scoring tiers:
 *   Exact match:    3000 - len
 *   Prefix match:   2000 - len
 *   Tight fuzzy:    1500 - gapPenalty + earlyMatchBonus - len  (gaps < prefix length)
 *   Loose fuzzy:     500 + partialEarlyBonus - gapPenalty - len (gaps >= prefix length)
 *   Substring:       300 - len
 */
// Candidates are filtered with matchesPrefix() and then scored again with
// computeBoost() — the same (candidate, prefix) pair twice per keystroke, over
// potentially thousands of candidates. Memoize per prefix; the cache resets
// whenever the prefix changes (i.e. on the next keystroke).
let scoreCachePrefix = "";
let scoreCachePrefixLower = "";
const scoreCache = new Map<string, number>();
const SCORE_CACHE_LIMIT = 20000;

function computeMatchScore(candidate: string, prefix: string): number {
  if (!prefix) return 1;
  if (prefix !== scoreCachePrefix) {
    scoreCachePrefix = prefix;
    scoreCachePrefixLower = prefix.toLowerCase();
    scoreCache.clear();
  }
  const cached = scoreCache.get(candidate);
  if (cached !== undefined) return cached;
  const score = computeMatchScoreUncached(candidate.toLowerCase(), scoreCachePrefixLower);
  if (scoreCache.size < SCORE_CACHE_LIMIT) scoreCache.set(candidate, score);
  return score;
}

function computeMatchScoreUncached(c: string, p: string): number {
  // Exact match
  if (c === p) return 3000 - c.length;

  // Prefix match
  if (c.startsWith(p)) return 2000 - c.length;

  // Fuzzy match: chars must appear in order (allows gaps for typos/abbrevs)
  let ci = 0;
  let totalGap = 0;
  let firstMatchPos = -1;
  for (let pi = 0; pi < p.length; pi++) {
    const ch = p[pi];
    const nextPos = c.indexOf(ch, ci);
    if (nextPos === -1) {
      // Fallback to substring match
      if (c.includes(p)) return 300 - c.length;
      return -1;
    }
    if (firstMatchPos === -1) firstMatchPos = nextPos;
    totalGap += nextPos - ci;
    ci = nextPos + 1;
  }

  const earlyMatchBonus = Math.max(0, 700 - firstMatchPos * 35);

  if (totalGap >= p.length) {
    // Too many gaps — low-confidence fuzzy match
    return 400 + earlyMatchBonus * 0.3 - totalGap * 20 - c.length;
  }

  const gapPenalty = totalGap * 10;
  return 1200 + earlyMatchBonus - gapPenalty - c.length;
}

function computeBoost(candidate: string, prefix: string): number {
  return computeMatchScore(candidate, prefix);
}

// --- History-based ranking ---
const completionStats = new Map<string, number>();

/** Record a user selection to boost future rankings. */
export function recordCompletionSelection(label: string, type: string): void {
  const key = `${type}:${label}`;
  completionStats.set(key, (completionStats.get(key) || 0) + 1);
}

function getHistoryBoost(label: string, type: string): number {
  const count = completionStats.get(`${type}:${label}`);
  if (!count) return 0;
  // Diminishing returns: first selection gives biggest boost
  return Math.min(count * 80, 500);
}

function dedupeAndSort(items: SqlCompletionItem[]): SqlCompletionItem[] {
  const seen = new Set<string>();
  return items.sort(compareCompletionItems).filter((item) => {
    const key = `${item.type}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareCompletionItems(left: SqlCompletionItem, right: SqlCompletionItem): number {
  const leftBonus = getHistoryBoost(left.label, left.type);
  const rightBonus = getHistoryBoost(right.label, right.type);
  return right.boost + rightBonus - (left.boost + leftBonus);
}

function findActiveFunctionOpenParen(sqlBeforeCursor: string): number | null {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = sqlBeforeCursor.length - 1; i >= 0; i--) {
    const ch = sqlBeforeCursor[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth === 0) return i;
      depth--;
    }
  }

  return null;
}

function countTopLevelCommas(text: string): number {
  let count = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) count++;
  }

  return count;
}
