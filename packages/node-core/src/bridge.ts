import { readFile } from "node:fs/promises";
import { appDataDir, bridgePortFilePath, bridgeTokenFilePath } from "./paths.js";

export { bridgeTokenFilePath };

export async function getBridgeUrl(): Promise<string> {
  const port = (await readFile(bridgePortFilePath(), "utf-8")).trim();
  return `http://127.0.0.1:${port}`;
}

/**
 * Shared token the desktop app writes next to the port file at bridge startup
 * (seeded from its local device secret). `DBX_BRIDGE_TOKEN` wins so a manual
 * MCP client config can pin the token without touching the data dir.
 */
export async function readBridgeToken(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const fromEnv = env.DBX_BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const token = (await readFile(bridgeTokenFilePath(), "utf-8")).trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export function bridgeHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function postBridge(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  try {
    const [bridgeUrl, token] = await Promise.all([getBridgeUrl(), readBridgeToken()]);
    const res = await fetch(`${bridgeUrl}${path}`, {
      method: "POST",
      headers: bridgeHeaders(token),
      body: JSON.stringify(body),
    });
    return { ok: res.ok, text: res.ok ? "" : await res.text() };
  } catch {
    return { ok: false, text: "DBX is not running. Please start DBX first." };
  }
}

export async function notifyReload(): Promise<void> {
  await postBridge("/reload-connections", {});
}
