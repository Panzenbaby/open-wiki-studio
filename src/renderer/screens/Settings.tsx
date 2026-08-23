import { useEffect, useState, type ChangeEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { useAppearance } from "../appearance.ts";
import { isLocalePreference, isThemePreference } from "../../shared/appearance.ts";
import { currentVersionAtom, viewAtom } from "../store.ts";
import type { LlmConfigView, LocalePreference, ThemePreference } from "../../shared/ipc-types.ts";
import { LlmConfigForm } from "../components/LlmConfigForm.tsx";

const THEME_OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];
const LOCALE_OPTIONS: readonly LocalePreference[] = ["system", "en", "de"];

export function Settings(): JSX.Element {
  const t = useT();
  const setView = useSetAtom(viewAtom);
  const currentVersion = useAtomValue(currentVersionAtom);
  const { settings, save } = useAppearance();
  const [initial, setInitial] = useState<LlmConfigView | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const result = await api.getLlmConfig();
      setInitial(result.success ? result.data : null);
    })();
  }, []);

  function onThemeChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    if (isThemePreference(value)) save({ ...settings, theme: value });
  }

  function onLocaleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    if (isLocalePreference(value)) save({ ...settings, locale: value });
  }

  return (
    <main className="setup" style={{ overflow: "auto" }}>
      <div className="setup-card">
        <h1>{t("settings.title")}</h1>

        <section className="settings-section">
          <h2>{t("settings.appearance")}</h2>
          <p className="muted settings-section-desc">{t("settings.appearanceDesc")}</p>
          <div className="llm-form">
            <div className="field">
              <label htmlFor="settings-theme">{t("settings.theme")}</label>
              <select
                id="settings-theme"
                className="input"
                value={settings.theme}
                onChange={onThemeChange}
              >
                {THEME_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`settings.theme.${option}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="settings-language">{t("settings.language")}</label>
              <select
                id="settings-language"
                className="input"
                value={settings.locale}
                onChange={onLocaleChange}
              >
                {LOCALE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`settings.language.${option}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2>{t("settings.llm")}</h2>
          <p className="muted settings-section-desc">{t("settings.desc")}</p>
          {initial === undefined ? (
            <div className="muted">{t("settings.loading")}</div>
          ) : (
            <LlmConfigForm
              initial={initial}
              submitLabel={t("settings.save")}
              onSaved={() => setView("dashboard")}
            />
          )}
        </section>

        <button className="btn btn-ghost btn-block" onClick={() => setView("dashboard")}>
          {t("settings.cancel")}
        </button>
        <p className="muted settings-version">
          {t("settings.version", { version: currentVersion })}
        </p>
      </div>
    </main>
  );
}
