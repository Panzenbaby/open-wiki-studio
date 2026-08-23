// localStorage mirror of the persisted appearance preferences. Read by the
// pre-React splash in index.html and by the atom seeds below it, so the very
// first frame already uses the user's choice instead of the system default.
// config.json stays authoritative and refreshes the mirror once IPC answers.
import { DEFAULT_APPEARANCE, normalizeAppearance } from "../shared/appearance.ts";
import type { AppearanceSettings } from "../shared/ipc-types.ts";

export const APPEARANCE_CACHE_KEY = "okf:appearance";

export function readCachedAppearance(): AppearanceSettings {
  const raw = localStorage.getItem(APPEARANCE_CACHE_KEY);
  if (raw === null) return DEFAULT_APPEARANCE;
  try {
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeCachedAppearance(settings: AppearanceSettings): void {
  localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(settings));
}
