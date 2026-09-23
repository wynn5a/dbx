// The awaited part of app startup: the saved-SQL library, then the saved
// connections. The two loads are independent — a saved-SQL failure is
// reported but must not keep the connections from loading, or
// `connectionsLoading` (cleared only by initFromDisk) stays true forever and
// the Welcome screen / sidebar show "Loading connections…" permanently.
export interface StartupLoadSteps {
  loadSavedSql: () => Promise<void>;
  loadConnections: () => Promise<void>;
  onSavedSqlLoaded?: () => void;
  onConnectionsLoaded?: () => void;
  onError: (error: unknown) => void;
}

export async function runStartupLoadChain(steps: StartupLoadSteps): Promise<void> {
  try {
    await steps.loadSavedSql();
    steps.onSavedSqlLoaded?.();
  } catch (error) {
    steps.onError(error);
  }
  try {
    await steps.loadConnections();
    steps.onConnectionsLoaded?.();
  } catch (error) {
    steps.onError(error);
  }
}
