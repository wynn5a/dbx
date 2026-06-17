import type { ConnectionConfig } from "@/types/database";

export const CONNECTION_ATTEMPT_TIMEOUT_BUFFER_MS = 2_000;
export const MONGO_LEGACY_FALLBACK_TIMEOUT_BUFFER_MS = 30_000;
export const METADATA_LOAD_TIMEOUT_BUFFER_MS = 3_000;
const DEFAULT_CONNECT_TIMEOUT_SECS = 5;
const DEFAULT_QUERY_TIMEOUT_SECS = 30;

function positiveSeconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function connectionAttemptTimeoutMs(
  config: Pick<ConnectionConfig, "connect_timeout_secs" | "transport_layers"> &
    Partial<Pick<ConnectionConfig, "db_type">>,
): number {
  const timeouts = [positiveSeconds(config.connect_timeout_secs, DEFAULT_CONNECT_TIMEOUT_SECS)];
  for (const layer of config.transport_layers ?? []) {
    if (layer.type === "ssh") {
      timeouts.push(positiveSeconds(layer.connect_timeout_secs, DEFAULT_CONNECT_TIMEOUT_SECS));
    }
  }
  const fallbackBuffer = config.db_type === "mongodb" ? MONGO_LEGACY_FALLBACK_TIMEOUT_BUFFER_MS : 0;
  return Math.ceil(Math.max(...timeouts) * 1000 + CONNECTION_ATTEMPT_TIMEOUT_BUFFER_MS + fallbackBuffer);
}

export function connectionAttemptTimeoutMessage(timeoutMs: number): string {
  return `Connection attempt timed out after ${Math.ceil(timeoutMs / 1000)}s. Please check the network or VPN and try again.`;
}

// The connect call itself is bounded by connectionAttemptTimeoutMs, but the
// catalog/metadata queries issued right after connecting (listDatabases,
// listSchemas, …) are not — a pooler can accept the socket yet stall the first
// query, leaving the sidebar spinner stuck forever. Bound those by the
// connection's query timeout plus a buffer.
export function metadataLoadTimeoutMs(config?: Pick<ConnectionConfig, "query_timeout_secs"> | null): number {
  const secs = positiveSeconds(config?.query_timeout_secs, DEFAULT_QUERY_TIMEOUT_SECS);
  return Math.ceil(secs * 1000 + METADATA_LOAD_TIMEOUT_BUFFER_MS);
}

export function metadataLoadTimeoutMessage(timeoutMs: number): string {
  return `Loading database objects timed out after ${Math.ceil(timeoutMs / 1000)}s. The server accepted the connection but did not answer a metadata query (this can happen with connection poolers). Try again or check the server.`;
}
