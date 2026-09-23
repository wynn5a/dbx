import type { ComposerTranslation } from "vue-i18n";
import { classifyConnectionError } from "@/lib/connectionErrorHints";

const patterns: [RegExp, string][] = [
  [/^(.+?) driver is not installed\. Please install it from the Driver Manager\.$/, "connection.driverNotInstalled"],
  [/^JRE (.+?) runtime is not installed\. Please install it from the Driver Manager\.$/, "connection.jreNotInstalled"],
  [
    /^System Java runtime was not found on PATH\. Please install Java or choose a custom Java executable\.$/,
    "connection.systemJavaNotFound",
  ],
  [/^Custom Java runtime path is empty\. Please choose a Java executable\.$/, "connection.customJavaPathEmpty"],
  [
    /^JDBC plugin is not installed\. Install the optional JDBC plugin to use this connection\.$/,
    "connection.jdbcPluginNotInstalled",
  ],
];

const paramNames: Record<string, string> = {
  "connection.driverNotInstalled": "driver",
  "connection.jreNotInstalled": "jre",
};

export function translateBackendError(t: ComposerTranslation, message: string): string {
  for (const [regex, key] of patterns) {
    const match = message.match(regex);
    if (match) {
      const name = paramNames[key];
      if (name && match[1]) {
        return t(key, { [name]: match[1] });
      }
      return t(key);
    }
  }
  return message;
}

export interface PresentedConnectionError {
  title: string;
  description?: string;
  variant: "error";
}

// Presents a connection failure for display: the installer-translated (or raw)
// message framed as "Connection failed: …" as title, plus — when the
// cross-driver classifier recognizes the error — an actionable hint as
// description. The raw message is never replaced: without a classification the
// framed original text is shown on its own.
export function presentConnectionError(
  t: ComposerTranslation,
  message: string,
  driver?: string | null,
): PresentedConnectionError {
  const hint = classifyConnectionError(message, driver);
  return {
    title: t("connection.connectFailed", { message: translateBackendError(t, message) }),
    description: hint ? t(hint.i18nKey) : undefined,
    variant: "error",
  };
}

// String-context variant (fields that render a single string under their own
// failure label, e.g. the connection dialog test result): the unframed message
// with the hint appended below it.
export function formatConnectionError(t: ComposerTranslation, message: string, driver?: string | null): string {
  const text = translateBackendError(t, message);
  const hint = classifyConnectionError(message, driver);
  return hint ? `${text}\n${t(hint.i18nKey)}` : text;
}
