// React-specific i18n hook — uses Jotai for locale state and reacts to
// navigator.language. The dictionary and pure t() live in shared/i18n.ts
// so both renderer and main process share the same translations.
import { atom, useAtomValue } from "jotai";
import { t, type Locale, type I18nParams } from "../shared/i18n.ts";

export type { Locale, I18nParams };
export { messages } from "../shared/i18n.ts";

export const localeAtom = atom<Locale>(detectLocale());

function detectLocale(): Locale {
  const lang = (
    typeof navigator !== "undefined" ? navigator.language : "en"
  ).toLowerCase();
  return lang.startsWith("de") ? "de" : "en";
}

/** React hook: returns a t() function for the current locale. */
export function useT(): (key: string, params?: I18nParams) => string {
  const locale = useAtomValue(localeAtom);
  return (key: string, params?: I18nParams): string =>
    t(locale, key, params);
}
