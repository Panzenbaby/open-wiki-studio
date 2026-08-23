// Renderer-side appearance state: theme preference → `data-theme` on the
// document root, locale preference → the shared locale atom. config.json (via
// the main process) is the source of truth; the localStorage mirror only
// carries the preferences across a restart so the first frame is right.
import { useCallback, useEffect } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { api } from "./ipc.ts";
import { localePreferenceAtom } from "./i18n.ts";
import { readCachedAppearance, writeCachedAppearance } from "./appearance-cache.ts";
import { resolveTheme } from "../shared/appearance.ts";
import { toastAtom } from "./store.ts";
import type {
  AppearanceSettings,
  EffectiveTheme,
  ThemePreference,
} from "../shared/ipc-types.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export const themePreferenceAtom = atom<ThemePreference>(readCachedAppearance().theme);
const systemPrefersDarkAtom = atom<boolean>(systemPrefersDark());

export const effectiveThemeAtom = atom<EffectiveTheme>((get) =>
  resolveTheme(get(themePreferenceAtom), get(systemPrefersDarkAtom)),
);

function applyTheme(theme: EffectiveTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Loads the persisted preferences, tracks `prefers-color-scheme`, and keeps
 *  `data-theme` in sync. Mount once, at the app root. */
export function useAppearanceSync(): void {
  const setThemePreference = useSetAtom(themePreferenceAtom);
  const setLocalePreference = useSetAtom(localePreferenceAtom);
  const setSystemPrefersDark = useSetAtom(systemPrefersDarkAtom);
  const effectiveTheme = useAtomValue(effectiveThemeAtom);
  const theme = useAtomValue(themePreferenceAtom);
  const locale = useAtomValue(localePreferenceAtom);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setSystemPrefersDark]);

  useEffect(() => {
    void (async () => {
      const result = await api.getAppearance();
      if (!result.success) return;
      setThemePreference(result.data.theme);
      setLocalePreference(result.data.locale);
    })();
  }, [setThemePreference, setLocalePreference]);

  useEffect(() => {
    applyTheme(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    writeCachedAppearance({ theme, locale });
  }, [theme, locale]);
}

export interface AppearanceControls {
  readonly settings: AppearanceSettings;
  readonly save: (next: AppearanceSettings) => void;
}

/** Current preferences plus a setter that applies them instantly and persists
 *  them in the background. */
export function useAppearance(): AppearanceControls {
  const theme = useAtomValue(themePreferenceAtom);
  const locale = useAtomValue(localePreferenceAtom);
  const setThemePreference = useSetAtom(themePreferenceAtom);
  const setLocalePreference = useSetAtom(localePreferenceAtom);
  const setToast = useSetAtom(toastAtom);

  const save = useCallback(
    (next: AppearanceSettings): void => {
      setThemePreference(next.theme);
      setLocalePreference(next.locale);
      void (async () => {
        const result = await api.setAppearance(next);
        if (!result.success) setToast({ message: result.error.message, kind: "error" });
      })();
    },
    [setThemePreference, setLocalePreference, setToast],
  );

  return { settings: { theme, locale }, save };
}
