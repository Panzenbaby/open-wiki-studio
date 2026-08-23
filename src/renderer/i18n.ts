// React-specific i18n hook — uses Jotai for locale state. The locale is
// derived from the user's preference, falling back to navigator.language when
// it is "system". The dictionary and pure t() live in shared/i18n.ts so both
// renderer and main process share the same translations.
import { useCallback } from "react";
import { atom, useAtomValue } from "jotai";
import { resolveLocale } from "../shared/appearance.ts";
import { readCachedAppearance } from "./appearance-cache.ts";
import { t, type Locale, type I18nParams } from "../shared/i18n.ts";
import type { LocalePreference } from "../shared/ipc-types.ts";

export const localePreferenceAtom = atom<LocalePreference>(readCachedAppearance().locale);

export const localeAtom = atom<Locale>((get) =>
  resolveLocale(get(localePreferenceAtom), systemLanguage()),
);

function systemLanguage(): string {
  return typeof navigator !== "undefined" ? navigator.language : "en";
}

/** React hook: returns a t() function for the current locale. Memoized on the
 *  locale so callers can list it as an effect dependency without re-running on
 *  every render. */
export function useT(): (key: string, params?: I18nParams) => string {
  const locale = useAtomValue(localeAtom);
  return useCallback(
    (key: string, params?: I18nParams): string => t(locale, key, params),
    [locale],
  );
}
