import type { App, ComponentPublicInstance } from "vue";
import { appendErrorDebugLog, uncapturedConsoleError } from "@/lib/debugLog";

// A render loop or a broken watcher can throw many errors per second: every
// error is still logged, but the user-facing toast is throttled to one per
// window so it never spams the screen.
const ERROR_TOAST_THROTTLE_MS = 10_000;

export interface UnhandledVueError {
  error: unknown;
  instance: ComponentPublicInstance | null;
  info: string;
}

export interface GlobalErrorHandlerDeps {
  /** Appends one structured entry to the debug-log buffer (always kept). */
  logError: (message: string) => void;
  /** Keeps the default error chain visible in the console / devtools. */
  consoleError: (...args: unknown[]) => void;
  /** Shows the localized "export debug logs" toast. */
  showErrorToast: () => void;
  /** Clock for the toast throttle; injectable for tests. */
  now: () => number;
}

export function vueComponentLabel(instance: ComponentPublicInstance | null): string | null {
  if (!instance) return null;
  const options = instance.$options;
  if (options.name) return options.name;
  if (options.__name) return options.__name;
  return null;
}

export function formatUnhandledVueError({ error, instance, info }: UnhandledVueError): string {
  const parts = ["[vue:error]"];
  const label = vueComponentLabel(instance);
  if (label) parts.push(`component=${label}`);
  if (info) parts.push(`hook=${info}`);
  if (error instanceof Error) {
    parts.push([error.name, error.message, error.stack].filter(Boolean).join("\n"));
  } else {
    parts.push(String(error));
  }
  return parts.join(" ");
}

export function createUnhandledVueErrorHandler(deps: GlobalErrorHandlerDeps) {
  let lastToastAt = Number.NEGATIVE_INFINITY;
  return (error: unknown, instance: ComponentPublicInstance | null, info: string) => {
    const message = formatUnhandledVueError({ error, instance, info });
    deps.logError(message);
    deps.consoleError(message, error);
    const at = deps.now();
    if (at - lastToastAt >= ERROR_TOAST_THROTTLE_MS) {
      lastToastAt = at;
      deps.showErrorToast();
    }
  };
}

export function installGlobalErrorHandler(app: App, showErrorToast: () => void) {
  app.config.errorHandler = createUnhandledVueErrorHandler({
    logError: appendErrorDebugLog,
    // The entry is already in the buffer via logError; the capture-wrapped
    // console.error would append it again when debug logging is on.
    consoleError: uncapturedConsoleError,
    showErrorToast,
    now: () => Date.now(),
  });
}
