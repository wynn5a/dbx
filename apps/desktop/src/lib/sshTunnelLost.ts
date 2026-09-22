// Frontend handling of the backend `ssh-tunnel-lost` push (perf plan §2 A5):
// when a connection's SSH tunnel exhausts its reconnect attempts, the backend
// evicts the pools built on it and emits exactly one event per tunnel lifetime.
// This module turns that push into a toast presentation (T17 connection-error
// style) and provides the per-connection dedupe window — a multi-hop
// connection can lose several tunnel layers in quick succession, and one
// notice is enough.

export const SSH_TUNNEL_LOST_EVENT = "ssh-tunnel-lost";

/** Payload of the backend event; field names match the Rust struct. */
export interface SshTunnelLostPayload {
  connection_id: string;
  ssh_host: string;
  ssh_port: number;
}

export interface TunnelLostPresentation {
  title: string;
  description: string;
  variant: "error";
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

// Toast copy for a lost tunnel. The connection name is preferred; an unknown
// connection (saved elsewhere / removed) falls back to the SSH endpoint.
export function presentTunnelLost(
  t: Translate,
  payload: SshTunnelLostPayload,
  connectionName?: string,
): TunnelLostPresentation {
  const name = connectionName?.trim() || `${payload.ssh_host}:${payload.ssh_port}`;
  return {
    title: t("connection.tunnelLost", { name }),
    description: t("connection.tunnelLostHint", { host: payload.ssh_host, port: payload.ssh_port }),
    variant: "error",
  };
}

// The backend fires one event per tunnel give-up, but several layers of the
// same connection (or the same tunnel recreated and lost again in quick
// succession) can arrive within seconds — suppress repeats per connection.
const TUNNEL_LOST_DEDUPE_WINDOW_MS = 10_000;

export interface TunnelLostNotifier {
  shouldNotify: (connectionId: string, now: number) => boolean;
}

export function createTunnelLostNotifier(): TunnelLostNotifier {
  const lastShownAt = new Map<string, number>();
  return {
    shouldNotify(connectionId: string, now: number): boolean {
      const last = lastShownAt.get(connectionId);
      if (last !== undefined && now - last < TUNNEL_LOST_DEDUPE_WINDOW_MS) {
        return false;
      }
      lastShownAt.set(connectionId, now);
      return true;
    },
  };
}
