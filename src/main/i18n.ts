// Main-process i18n — uses the persisted locale preference when the user made
// an explicit choice, and Electron's app.getLocale() when it is "system".
// Uses the same shared dictionary as the renderer so translations stay in sync.
import { app } from "electron";
import { resolveLocale } from "../shared/appearance.ts";
import { t, type I18nParams, type Locale } from "../shared/i18n.ts";
import type { LocalePreference } from "../shared/ipc-types.ts";

let cachedSystemLocale: Locale | null = null;
let preference: LocalePreference = "system";

function systemLocale(): Locale {
  if (cachedSystemLocale) return cachedSystemLocale;
  cachedSystemLocale = resolveLocale("system", app.getLocale());
  return cachedSystemLocale;
}

/** Apply the user's locale preference so native dialogs match the renderer. */
export function setMainLocalePreference(next: LocalePreference): void {
  preference = next;
}

/** Translation function for main process — no React/Jotai dependency. */
export function mainT(key: string, params?: I18nParams): string {
  return t(preference === "system" ? systemLocale() : preference, key, params);
}
