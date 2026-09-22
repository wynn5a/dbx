// Cross-driver classifier for connection errors: maps raw driver/backend error
// text to an actionable hint category (i18n key) without replacing the original
// message. Unknown errors return null so callers keep showing the raw text.
export type ConnectionErrorHintCategory = "network" | "auth" | "tls";

export const CONNECTION_ERROR_HINT_I18N_KEYS: Record<ConnectionErrorHintCategory, string> = {
  network: "connection.errorHintNetwork",
  auth: "connection.errorHintAuth",
  tls: "connection.errorHintTls",
};

export interface ConnectionErrorHint {
  category: ConnectionErrorHintCategory;
  i18nKey: string;
}

// db_type values share rules across aliases ("postgresql" → postgres, "mssql" → sqlserver, …).
function normalizeDriver(driver?: string | null): string | null {
  if (!driver) return null;
  const d = driver.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!d) return null;
  if (d === "postgresql") return "postgres";
  if (d === "mssql") return "sqlserver";
  if (d === "mariadb") return "mysql";
  return d;
}

interface CategoryRule {
  category: ConnectionErrorHintCategory;
  // Matched against any driver's error text.
  patterns: RegExp[];
  // Matched only when the caller knows the driver; driver error codes are too
  // ambiguous to enable globally (e.g. SQL Server "Error: 18456").
  driverPatterns?: Partial<Record<string, RegExp[]>>;
}

// Order matters: auth keywords are the most specific, TLS next, and
// refused/timeout phrasing the broadest (it also shows up inside TLS failures).
const RULES: CategoryRule[] = [
  {
    category: "auth",
    patterns: [
      /password authentication failed/i, // PostgreSQL
      /authentication failed|authentication required/i,
      /\baccess denied\b/i, // MySQL
      /\blogin failed\b/i, // SQL Server
      /\bNOAUTH\b|\bWRONGPASS\b/i, // Redis
      /client sent AUTH/i, // Redis (password set but server has none)
      /invalid username-?password|invalid credentials|incorrect password|invalid password|wrong password/i,
      /\brole\b .*\bdoes not exist\b/i, // PostgreSQL FATAL: role "…" does not exist
      /\bnot authorized\b/i, // MongoDB
    ],
    driverPatterns: {
      postgres: [/\b28P01\b|\b28000\b/i], // SQLSTATE invalid_password / invalid_authorization
      mysql: [/\bERROR\s+1045\b/i], // Access denied
      sqlserver: [/\berror:\s*18456\b/i],
    },
  },
  {
    category: "tls",
    patterns: [
      /\bssl\b|\btls\b/i,
      /\bcertificate\b|self[- ]signed|\bunknown[\s-]?issuer\b/i,
      /\b(ssl|tls)[\s-]*handshake\b|handshake (failed|failure|timed? out)|fatal alert/i,
      /pg_hba\.conf/i, // PostgreSQL: server rejected host/auth/encryption combination
    ],
    driverPatterns: {
      mysql: [/\bERROR\s+2026\b/i], // SSL connection error
    },
  },
  {
    category: "network",
    patterns: [
      /connection refused/i,
      /can'?not connect|could not connect|can'?t connect/i,
      /\btimed?[- ]out\b|\btimeout\b/i,
      /\beconnrefused\b|\betimedout\b|\behostunreach\b|\benetunreach\b|\beconnaborted\b|\beconnreset\b|\benotfound\b/i,
      /no connection could be made/i, // Windows
      /forcibly closed|connection reset|connection aborted|broken pipe/i,
      /host unreachable|network unreachable|network is unreachable/i,
      /getaddrinfo|name or service not known|name resolution|temporary failure in name resolution/i,
    ],
    driverPatterns: {
      mysql: [/\bERROR\s+2003\b/i], // Can't connect to MySQL server
      sqlserver: [/\berror:\s*(?:-1|2|53|258|10060|10061)\b/i],
    },
  },
];

function hint(category: ConnectionErrorHintCategory): ConnectionErrorHint {
  return { category, i18nKey: CONNECTION_ERROR_HINT_I18N_KEYS[category] };
}

export function classifyConnectionError(message: string, driver?: string | null): ConnectionErrorHint | null {
  if (!message) return null;
  const normalized = normalizeDriver(driver);
  for (const rule of RULES) {
    if (normalized && rule.driverPatterns?.[normalized]?.some((pattern) => pattern.test(message))) {
      return hint(rule.category);
    }
    if (rule.patterns.some((pattern) => pattern.test(message))) {
      return hint(rule.category);
    }
  }
  return null;
}
