import assert from "node:assert/strict";
import { test } from "vitest";
import {
  classifyConnectionError,
  CONNECTION_ERROR_HINT_I18N_KEYS,
  type ConnectionErrorHintCategory,
} from "../../apps/desktop/src/lib/connectionErrorHints.ts";
import { formatConnectionError, presentConnectionError } from "../../apps/desktop/src/i18n/backend-errors.ts";
import en from "../../apps/desktop/src/i18n/locales/en.ts";
import es from "../../apps/desktop/src/i18n/locales/es.ts";
import it from "../../apps/desktop/src/i18n/locales/it.ts";
import ptBR from "../../apps/desktop/src/i18n/locales/pt-BR.ts";
import zhCN from "../../apps/desktop/src/i18n/locales/zh-CN.ts";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.ts";
import type { ComposerTranslation } from "vue-i18n";

const t = ((key: string) => `T:${key}`) as unknown as ComposerTranslation;

function categoryOf(message: string, driver?: string | null): ConnectionErrorHintCategory | null {
  return classifyConnectionError(message, driver)?.category ?? null;
}

test("classifies connection refused / timeout errors as network across drivers", () => {
  // PostgreSQL
  assert.equal(
    categoryOf('error connecting to server at "db.example.com:5432": Connection refused (os error 111)'),
    "network",
  );
  assert.equal(categoryOf("timeout expired when connecting to PostgreSQL server"), "network");
  // MySQL
  assert.equal(
    categoryOf("ERROR 2003 (HY000): Can't connect to MySQL server on '127.0.0.1:3306' (111)"),
    "network",
  );
  // SQL Server (pre-login handshake failure is a network error, not TLS)
  assert.equal(
    categoryOf(
      "A connection was successfully established with the server, but then an error occurred during the pre-login handshake. (provider: TCP Provider, error: 0 - No connection could be made because the target machine actively refused it. (Microsoft SQL Server, Error: 10061))",
    ),
    "network",
  );
  assert.equal(categoryOf("Connection Timeout Expired. The timeout period elapsed while attempting to consume the pre-login handshake acknowledgement."), "network");
  // Redis
  assert.equal(categoryOf("Redis error: Connection refused (os error 111)"), "network");
  assert.equal(categoryOf("Error connecting to redis at 127.0.0.1:6379: IoError: Connection timed out"), "network");
});

test("classifies authentication failures as auth across drivers", () => {
  // PostgreSQL
  assert.equal(categoryOf('FATAL: password authentication failed for user "postgres"'), "auth");
  assert.equal(categoryOf('FATAL: role "reporting" does not exist'), "auth");
  // MySQL
  assert.equal(
    categoryOf("ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: YES)"),
    "auth",
  );
  // SQL Server
  assert.equal(categoryOf("Login failed for user 'sa'. (Microsoft SQL Server, Error: 18456)"), "auth");
  // Redis
  assert.equal(categoryOf("NOAUTH Authentication required."), "auth");
  assert.equal(categoryOf("WRONGPASS invalid username-password pair or user is disabled."), "auth");
});

test("classifies TLS/SSL errors as tls across drivers", () => {
  // PostgreSQL
  assert.equal(categoryOf("TLS handshake failed: invalid peer certificate: UnknownIssuer"), "tls");
  assert.equal(categoryOf('FATAL: no pg_hba.conf entry for host "10.0.0.5", user "app", database "sales", no encryption'), "tls");
  // MySQL
  assert.equal(
    categoryOf("ERROR 2026 (HY000): SSL connection error: SSL is required but the server does not support it"),
    "tls",
  );
  // SQL Server
  assert.equal(
    categoryOf("The certificate chain was issued by an authority that is not trusted. (Microsoft SQL Server, Error: -2146893019)"),
    "tls",
  );
  // Redis
  assert.equal(categoryOf("Redis over TLS failed: self-signed certificate in certificate chain"), "tls");
});

test("matching is case-insensitive", () => {
  assert.equal(categoryOf("CONNECTION REFUSED (OS ERROR 111)"), "network");
  assert.equal(categoryOf("LOGIN FAILED FOR USER 'SA'"), "auth");
  assert.equal(categoryOf("wrongpass invalid username-password pair"), "auth");
  assert.equal(categoryOf("SSL Error: Certificate Verify Failed"), "tls");
});

test("driver error codes classify only when the driver is known", () => {
  // Without a driver these bare codes stay unclassified.
  assert.equal(categoryOf("Microsoft SQL Server, Error: 18456"), null);
  assert.equal(categoryOf("error 2003 while talking to the server"), null);
  // With the driver they resolve.
  assert.equal(categoryOf("Microsoft SQL Server, Error: 18456", "sqlserver"), "auth");
  assert.equal(categoryOf("Microsoft SQL Server, Error: 18456", "mssql"), "auth");
  assert.equal(categoryOf("error 2003 while talking to the server", "mysql"), "network");
  assert.equal(categoryOf("error 2003 while talking to the server", "mariadb"), "network");
  assert.equal(categoryOf("(SQLSTATE 28P01) password authentication", "postgresql"), "auth");
});

test("unknown errors return null so the raw text stays the fallback", () => {
  assert.equal(categoryOf('FATAL: database "analytics" does not exist'), null);
  assert.equal(categoryOf('syntax error at or near "SELEC"'), null);
  assert.equal(categoryOf("Unknown column 'name' in 'field list'"), null);
  assert.equal(categoryOf('relation "users" does not exist'), null);
  assert.equal(categoryOf(""), null);
});

test("hint categories map to i18n keys present in all six locales", () => {
  const locales: Record<string, Record<string, unknown>> = {
    en: en as unknown as Record<string, unknown>,
    es: es as unknown as Record<string, unknown>,
    it: it as unknown as Record<string, unknown>,
    "pt-BR": ptBR as unknown as Record<string, unknown>,
    "zh-CN": zhCN as unknown as Record<string, unknown>,
    "zh-TW": zhTW as unknown as Record<string, unknown>,
  };
  const keys = Object.values(CONNECTION_ERROR_HINT_I18N_KEYS);
  assert.equal(keys.length, 3);
  for (const [locale, messages] of Object.entries(locales)) {
    const connection = messages.connection as Record<string, unknown> | undefined;
    for (const key of keys) {
      assert.match(key, /^connection\.errorHint/);
      const shortKey = key.replace("connection.", "");
      assert.equal(typeof connection?.[shortKey], "string", `${locale} is missing ${key}`);
      assert.ok((connection?.[shortKey] as string).length > 0, `${locale} has empty copy for ${key}`);
    }
  }
});

test("presentConnectionError keeps the raw message and adds the hint as description", () => {
  const message = 'FATAL: password authentication failed for user "postgres"';
  const present = presentConnectionError(t, message, "postgres");
  assert.equal(present.title, message);
  assert.equal(present.description, "T:connection.errorHintAuth");
  assert.equal(present.variant, "error");
});

test("presentConnectionError shows only the raw message when unclassified", () => {
  const message = 'FATAL: database "analytics" does not exist';
  const present = presentConnectionError(t, message);
  assert.equal(present.title, message);
  assert.equal(present.description, undefined);
});

test("presentConnectionError still translates installer errors", () => {
  const present = presentConnectionError(
    t,
    "MySQL driver is not installed. Please install it from the Driver Manager.",
  );
  assert.equal(present.title, "T:connection.driverNotInstalled");
  assert.equal(present.description, undefined);
});

test("formatConnectionError appends the hint below the original message", () => {
  assert.equal(
    formatConnectionError(t, "Connection refused (os error 111)"),
    "Connection refused (os error 111)\nT:connection.errorHintNetwork",
  );
  assert.equal(formatConnectionError(t, 'relation "users" does not exist'), 'relation "users" does not exist');
});
