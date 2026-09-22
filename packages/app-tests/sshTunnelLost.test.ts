import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  createTunnelLostNotifier,
  presentTunnelLost,
  SSH_TUNNEL_LOST_EVENT,
  type SshTunnelLostPayload,
} from "../../apps/desktop/src/lib/sshTunnelLost.ts";
import en from "../../apps/desktop/src/i18n/locales/en.ts";
import es from "../../apps/desktop/src/i18n/locales/es.ts";
import it from "../../apps/desktop/src/i18n/locales/it.ts";
import ptBR from "../../apps/desktop/src/i18n/locales/pt-BR.ts";
import zhCN from "../../apps/desktop/src/i18n/locales/zh-CN.ts";
import zhTW from "../../apps/desktop/src/i18n/locales/zh-TW.ts";

const payload: SshTunnelLostPayload = { connection_id: "conn-1", ssh_host: "bastion.example.com", ssh_port: 22 };
const t = (key: string, params?: Record<string, unknown>) =>
  `T:${key}` + (params ? `(${JSON.stringify(params)})` : "");

test("event name matches the backend emit literal", () => {
  assert.equal(SSH_TUNNEL_LOST_EVENT, "ssh-tunnel-lost");
  const libRs = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(libRs, /"ssh-tunnel-lost"/, "the Tauri shell must emit the same event name");
});

test("presents the toast with the connection name and the endpoint hint", () => {
  const present = presentTunnelLost(t, payload, "  My DB  ");
  assert.equal(present.title, `T:connection.tunnelLost({"name":"My DB"})`);
  assert.equal(
    present.description,
    `T:connection.tunnelLostHint({"host":"bastion.example.com","port":22})`,
  );
  assert.equal(present.variant, "error");
});

test("falls back to the SSH endpoint when the connection is unknown", () => {
  const present = presentTunnelLost(t, payload, undefined);
  assert.equal(present.title, `T:connection.tunnelLost({"name":"bastion.example.com:22"})`);
  const blank = presentTunnelLost(t, payload, "   ");
  assert.equal(blank.title, `T:connection.tunnelLost({"name":"bastion.example.com:22"})`);
});

test("dedupe allows the first notice per connection and suppresses repeats inside the window", () => {
  const notifier = createTunnelLostNotifier();
  assert.equal(notifier.shouldNotify("conn-1", 1_000), true, "first notice for a connection shows");
  assert.equal(notifier.shouldNotify("conn-1", 5_000), false, "repeat within the window is suppressed");
  assert.equal(notifier.shouldNotify("conn-1", 11_001), true, "after the window a new notice may show");
  assert.equal(notifier.shouldNotify("conn-2", 11_002), true, "another connection is independent");
});

test("tunnel-lost copy exists in all six locales", () => {
  const locales: Record<string, Record<string, unknown>> = {
    en: en as unknown as Record<string, unknown>,
    es: es as unknown as Record<string, unknown>,
    it: it as unknown as Record<string, unknown>,
    "pt-BR": ptBR as unknown as Record<string, unknown>,
    "zh-CN": zhCN as unknown as Record<string, unknown>,
    "zh-TW": zhTW as unknown as Record<string, unknown>,
  };
  for (const [locale, messages] of Object.entries(locales)) {
    const connection = messages.connection as Record<string, unknown> | undefined;
    for (const key of ["tunnelLost", "tunnelLostHint"]) {
      assert.equal(typeof connection?.[key], "string", `${locale} is missing connection.${key}`);
      assert.ok((connection?.[key] as string).length > 0, `${locale} has empty copy for connection.${key}`);
    }
    assert.match(connection?.tunnelLostHint as string, /\{host\}/, `${locale} hint must name the endpoint`);
    assert.match(connection?.tunnelLostHint as string, /\{port\}/, `${locale} hint must name the port`);
  }
});

// ---------------------------------------------------------------------------
// Source contracts: the listener surface is a composable + a plain .vue
// template (no mount test facility), so the wiring is asserted against the
// sources — same approach as the T18 connectionStoreCancel contract tests.
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("useTauriEvents subscribes to the tunnel-lost push and forwards the payload", () => {
  const source = readSource("../../apps/desktop/src/composables/useTauriEvents.ts");
  assert.match(source, /listen<SshTunnelLostPayload>\(SSH_TUNNEL_LOST_EVENT/, "must listen on the typed event");
  assert.match(source, /deps\.onSshTunnelLost\(event\.payload\)/, "payload must reach the handler");
  assert.match(source, /onSshTunnelLost: \(payload: SshTunnelLostPayload\) => void;/, "handler is a required dep");
});

test("App.vue shows a deduped toast from the tunnel-lost handler", () => {
  const app = readSource("../../apps/desktop/src/App.vue");
  assert.match(app, /createTunnelLostNotifier\(\)/);
  assert.match(app, /tunnelLostNotifier\.shouldNotify\(payload\.connection_id/, "toast must pass the dedupe gate");
  assert.match(app, /presentTunnelLost\(t, payload/, "copy must come from the i18n presentation helper");
  assert.match(app, /toast\(present\.title, \{ \.\.\.present, duration: 5000 \}\)/, "error toast like T17");
  assert.match(app, /onSshTunnelLost,/);
});
