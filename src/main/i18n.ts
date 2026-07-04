// Main-process i18n — detects the system locale via Electron's app.getLocale()
// and exposes a simple t() function. Uses the same shared dictionary as the
// renderer so translations stay in sync.
import { app } from "electron";
import { t, type I18nParams, type Locale } from "../shared/i18n.ts";

let cachedLocale: Locale | null = null;

function getLocale(): Locale {
  if (cachedLocale) return cachedLocale;
  const lang = app.getLocale().toLowerCase();
  cachedLocale = lang.startsWith("de") ? "de" : "en";
  return cachedLocale;
}

/** Translation function for main process — no React/Jotai dependency. */
export function mainT(key: string, params?: I18nParams): string {
  return t(getLocale(), key, params);
}
