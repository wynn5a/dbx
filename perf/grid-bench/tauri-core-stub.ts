// grid-bench stub for @tauri-apps/api/core: every Tauri call (lib/api, plugins,
// window/event helpers) funnels through invoke, so blocking invoke alone makes
// the whole app graph Tauri-free while keeping every real named export intact.
export const invoke = async (cmd: string, ..._rest: unknown[]): Promise<never> => {
  throw new Error(`[grid-bench] invoke('${cmd}') is blocked in the benchmark harness`);
};

export const convertFileSrc = (filePath: string): string => filePath;

// Imported by @tauri-apps/plugin-fs (and similar plugins) at module scope.
export class Channel<_T = unknown> {
  id = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(onmessage?: (message: _T) => void) {}
  onmessage: ((message: unknown) => void) | null = null;
}

export class Resource {
  #rid = 0;
}
