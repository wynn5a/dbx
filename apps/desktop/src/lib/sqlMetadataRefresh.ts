export type SqlMetadataRefreshScope = "none" | "connection" | "database";
export type SqlMetadataRefreshTarget =
  | { scope: "none" }
  | { scope: "connection" }
  | { scope: "database"; schema?: string };

const DATABASE_DDL_RE = /\b(CREATE|DROP)\s+DATABASE\b/i;
const SCHEMA_DDL_RE = /\b(CREATE|DROP)\s+SCHEMA\b/i;
// Clauses allowed between CREATE/ALTER/DROP/RENAME and the object keyword:
// OR REPLACE, temp/unlogged/virtual/foreign/external/materialized tables,
// UNIQUE / (NON)CLUSTERED indexes, and MySQL view/routine clauses
// (`ALGORITHM=…`, `DEFINER=user@host`, `SQL SECURITY …`).
const QUOTED_OR_WORD = "(?:'[^']*'|`[^`]*`|\"[^\"]*\"|[\\w.%$-]+)";
const DDL_MODIFIER =
  "(?:OR\\s+REPLACE|(?:(?:GLOBAL|LOCAL)\\s+)?TEMP(?:ORARY)?|UNLOGGED|VIRTUAL|FOREIGN|EXTERNAL|MATERIALIZED|UNIQUE|" +
  "CLUSTERED|NONCLUSTERED|ALGORITHM\\s*=\\s*\\w+|DEFINER\\s*=\\s*" +
  QUOTED_OR_WORD +
  "(?:\\s*@\\s*" +
  QUOTED_OR_WORD +
  ")?|SQL\\s+SECURITY\\s+(?:DEFINER|INVOKER))";
const DDL_VERB_AND_MODIFIERS = `\\b(?:CREATE|ALTER|DROP|RENAME)\\s+(?:${DDL_MODIFIER}\\s+)*`;
const QUALIFIED_NAME =
  '((?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)\\s*\\.\\s*(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*))';
const OBJECT_DDL_RE = new RegExp(
  `${DDL_VERB_AND_MODIFIERS}(?:TABLE|VIEW|INDEX|SEQUENCE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\\b`,
  "i",
);
const OBJECT_NAME_DDL_RE = new RegExp(
  `${DDL_VERB_AND_MODIFIERS}(?:TABLE|VIEW|SEQUENCE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?${QUALIFIED_NAME}`,
  "i",
);
const INDEX_TABLE_DDL_RE =
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+ON\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))/i;

// MySQL `#` comments: only at a line start or after whitespace, and never
// `#>` / `#>>` / `#-` / `##` — PostgreSQL JSON/geometric operators must not
// swallow the rest of the line (and any DDL on it). A spaced PG xor (`a # b`)
// still reads as a comment; that only loses DDL written after it on that line.
function stripSqlMetadataComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/(^|\s)#(?![>#-]).*$/gm, "$1 ");
}

export function sqlMetadataRefreshScope(sql: string): SqlMetadataRefreshScope {
  return sqlMetadataRefreshTarget(sql).scope;
}

function splitSqlMetadataStatements(sql: string): string[] {
  return stripSqlMetadataComments(sql)
    .split(";")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function schemaFromQualifiedName(qualifiedName: string): string | undefined {
  const schema = qualifiedName.split(".")[0]?.trim();
  return schema ? unquoteIdentifier(schema) : undefined;
}

function schemaFromObjectDdl(statement: string): string | undefined {
  const match = statement.match(INDEX_TABLE_DDL_RE) || statement.match(OBJECT_NAME_DDL_RE);
  return match?.[1] ? schemaFromQualifiedName(match[1]) : undefined;
}

export function sqlMetadataRefreshTarget(sql: string, activeSchema?: string): SqlMetadataRefreshTarget {
  const statements = splitSqlMetadataStatements(sql);
  if (statements.some((stmt) => DATABASE_DDL_RE.test(stmt))) return { scope: "connection" };

  const schemaTargets = new Set<string>();
  let hasDatabaseRefresh = false;

  for (const statement of statements) {
    if (SCHEMA_DDL_RE.test(statement)) {
      hasDatabaseRefresh = true;
      continue;
    }
    if (!OBJECT_DDL_RE.test(statement)) continue;
    hasDatabaseRefresh = true;
    const schema = schemaFromObjectDdl(statement) || activeSchema;
    if (schema) schemaTargets.add(schema);
  }

  if (!hasDatabaseRefresh) return { scope: "none" };
  if (schemaTargets.size === 1) return { scope: "database", schema: [...schemaTargets][0] };
  return { scope: "database" };
}
