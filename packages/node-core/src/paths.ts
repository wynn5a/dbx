import { homedir, platform } from "node:os";
import { join } from "node:path";

export function appDataDir(): string {
  // Relocation hook (tests, portable installs): moves the port, token and
  // connection files together instead of only the ones paths.ts owns.
  const override = process.env.DBX_APP_DATA_DIR?.trim();
  if (override) return override;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "com.dbx.app");
    case "win32":
      return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "com.dbx.app");
    default:
      return join(home, ".config", "com.dbx.app");
  }
}

export function dbPath(): string {
  return join(appDataDir(), "dbx.db");
}

export function bridgePortFilePath(): string {
  return join(appDataDir(), "mcp-bridge-port");
}

export function bridgeTokenFilePath(): string {
  return join(appDataDir(), "mcp-bridge-token");
}
