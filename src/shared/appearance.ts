// Appearance preferences: pure resolution of a stored preference into the
// value the UI actually uses. Shared by main (window background, mainT) and
// renderer (data-theme attribute, locale atom).
import type {
  AppearanceSettings,
  EffectiveTheme,
  LocalePreference,
  ThemePreference,
} from "./ipc-types.ts";
import type { Locale } from "./i18n.ts";

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system",
  locale: "system",
};

/** Window background per effective theme, mirroring `--bg` in brand.css. The
 *  main process cannot read the stylesheet, so both must change together. */
export const THEME_BACKGROUND: Record<EffectiveTheme, string> = {
  dark: "#0e1214",
  light: "#faf7f3",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || value === "en" || value === "de";
}

export function isAppearanceSettings(value: unknown): value is AppearanceSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isThemePreference(candidate["theme"]) && isLocalePreference(candidate["locale"]);
}

/** Coerce anything read from disk or IPC into a usable settings object,
 *  falling back per field so one corrupt value does not discard the other. */
export function normalizeAppearance(value: unknown): AppearanceSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_APPEARANCE;
  const candidate = value as Record<string, unknown>;
  const theme = candidate["theme"];
  const locale = candidate["locale"];
  return {
    theme: isThemePreference(theme) ? theme : DEFAULT_APPEARANCE.theme,
    locale: isLocalePreference(locale) ? locale : DEFAULT_APPEARANCE.locale,
  };
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): EffectiveTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function resolveLocale(
  preference: LocalePreference,
  systemLanguage: string,
): Locale {
  if (preference !== "system") return preference;
  return systemLanguage.toLowerCase().startsWith("de") ? "de" : "en";
}
