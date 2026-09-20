import assert from "node:assert/strict";
import { afterAll, beforeEach, test } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridgeHeaders, postBridge, readBridgeToken } from "../src/bridge.js";
import { executeQuery } from "../src/database.js";
import type { ConnectionConfig } from "../src/connections.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "dbx-bridge-auth-"));
  process.env.DBX_APP_DATA_DIR = dataDir;
  delete process.env.DBX_BRIDGE_TOKEN;
  delete process.env.DBX_MCP_ALLOW_WRITES;
  delete process.env.DBX_MCP_ALLOW_DANGEROUS_SQL;
});

afterAll(() => {
  delete process.env.DBX_APP_DATA_DIR;
  delete process.env.DBX_BRIDGE_TOKEN;
  delete process.env.DBX_MCP_ALLOW_WRITES;
  delete process.env.DBX_MCP_ALLOW_DANGEROUS_SQL;
});

test("readBridgeToken prefers the DBX_BRIDGE_TOKEN env override", async () => {
  writeFileSync(join(dataDir, "mcp-bridge-token"), "file-token\n");
  process.env.DBX_BRIDGE_TOKEN = " env-token ";
  assert.equal(await readBridgeToken(), "env-token");
});

test("readBridgeToken falls back to the token file", async () => {
  writeFileSync(join(dataDir, "mcp-bridge-token"), "file-token\n");
  assert.equal(await readBridgeToken(), "file-token");
});

test("readBridgeToken returns undefined without env or file", async () => {
  assert.equal(await readBridgeToken(), undefined);
});

test("bridgeHeaders carry the bearer token only when present", () => {
  assert.deepEqual(bridgeHeaders("tok"), { "Content-Type": "application/json", Authorization: "Bearer tok" });
  assert.deepEqual(bridgeHeaders(), { "Content-Type": "application/json" });
});

function startBridge(handler: (req: IncomingMessage, body: string) => [number, string]): Promise<{
  server: Server;
  port: number;
  requests: { auth: string | undefined; body: Record<string, unknown> }[];
}> {
  const requests: { auth: string | undefined; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requests.push({ auth: req.headers.authorization, body: JSON.parse(raw || "{}") });
      const [status, text] = handler(req, raw);
      res.statusCode = status;
      res.end(text);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

test("postBridge authenticates with the token from the data dir", async () => {
  process.env.DBX_BRIDGE_TOKEN = "shared-token";
  const { server, port, requests } = await startBridge(() => [200, "ok"]);
  writeFileSync(join(dataDir, "mcp-bridge-port"), String(port));
  try {
    const result = await postBridge("/reload-connections", {});
    assert.deepEqual(result, { ok: true, text: "" });
    assert.equal(requests[0]?.auth, "Bearer shared-token");
  } finally {
    server.close();
  }
});

test("postBridge surfaces a 401 rejection from the bridge", async () => {
  const { server, port } = await startBridge(() => [401, JSON.stringify({ error: "Missing or invalid bridge token" })]);
  writeFileSync(join(dataDir, "mcp-bridge-port"), String(port));
  try {
    const result = await postBridge("/reload-connections", {});
    assert.equal(result.ok, false);
    assert.match(result.text, /Missing or invalid bridge token/);
  } finally {
    server.close();
  }
});

const oracleConfig: ConnectionConfig = {
  id: "oracle-1",
  name: "oracle-local",
  db_type: "oracle",
  host: "127.0.0.1",
  port: 1521,
  username: "system",
  password: "secret",
  ssl: false,
};

test("executeQuery sends the token and policy flags through the bridge", async () => {
  process.env.DBX_BRIDGE_TOKEN = "shared-token";
  process.env.DBX_MCP_ALLOW_WRITES = "1";
  const { server, port, requests } = await startBridge(() => [
    200,
    JSON.stringify({ columns: ["id"], rows: [[7]], affected_rows: 0, execution_time_ms: 1, truncated: false }),
  ]);
  writeFileSync(join(dataDir, "mcp-bridge-port"), String(port));
  try {
    const result = await executeQuery(oracleConfig, "UPDATE t SET x = 1 WHERE id = 2");
    assert.equal(result.row_count, 1);
    assert.equal(result.columns[0], "id");
    const request = requests[0];
    assert.equal(request?.auth, "Bearer shared-token");
    assert.equal(request?.body.allow_writes, true);
    assert.equal(request?.body.allow_dangerous, false);
    assert.equal(request?.body.connection_name, "oracle-local");
  } finally {
    server.close();
  }
});
