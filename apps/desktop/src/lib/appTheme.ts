import type { Theme } from "@tauri-apps/api/window";

export const APP_THEME_STORAGE_KEY = "dbx-theme";

export type AppThemeMode = "light" | "dark" | "system";
export type AppThemeAppearance = "light" | "dark";

export function normalizeAppThemeMode(value: string | null): AppThemeMode {
  if (value === "dark" || value === "light" || value === "system") return value;
  return "system";
}

export function resolveAppThemeAppearance(mode: AppThemeMode, systemPrefersDark: boolean): AppThemeAppearance {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

/**
 * Appearance the pre-paint boot script in `apps/desktop/index.html` must resolve to.
 *
 * That inline script cannot import this module (it runs before any bundle code), so its
 * five lines duplicate this logic on purpose: read `APP_THEME_STORAGE_KEY` from
 * localStorage, treat anything but "light"/"dark"/"system" (including a missing key) as
 * "system", and resolve "system" against `matchMedia("(prefers-color-scheme: dark)")`.
 * `packages/app-tests/appTheme.test.ts` executes the extracted inline script and locks
 * it to this function; change both together.
 */
export function resolveBootThemeAppearance(
  storageValue: string | null,
  systemPrefersDark: boolean,
): AppThemeAppearance {
  return resolveAppThemeAppearance(normalizeAppThemeMode(storageValue), systemPrefersDark);
}

export function getTauriThemeForMode(mode: AppThemeMode): Theme | null {
  return mode === "system" ? null : mode;
}
