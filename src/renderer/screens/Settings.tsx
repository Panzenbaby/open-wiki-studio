import { useEffect, useState, type ChangeEvent } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { useAppearance } from "../appearance.ts";
import { isLocalePreference, isThemePreference } from "../../shared/appearance.ts";
import { currentVersionAtom, toastAtom, viewAtom, workspaceAtom } from "../store.ts";
import type { LlmConfigView, LocalePreference, ThemePreference } from "../../shared/ipc-types.ts";
import { LlmConfigForm } from "../components/LlmConfigForm.tsx";

const THEME_OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];
const LOCALE_OPTIONS: readonly LocalePreference[] = ["system", "en", "de"];

export function Settings(): JSX.Element {
  const t = useT();
  const setView = useSetAtom(viewAtom);
  const currentVersion = useAtomValue(currentVersionAtom);
  const workspace = useAtomValue(workspaceAtom);
  const setToast = useSetAtom(toastAtom);
  const { settings, save } = useAppearance();
  const [initial, setInitial] = useState<LlmConfigView | null | undefined>(undefined);
  const [defaultInstructions, setDefaultInstructions] = useState<string>("");
  const [savedInstructions, setSavedInstructions] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string>("");
  const [instructionsLoading, setInstructionsLoading] = useState<boolean>(true);
  const [instructionsSaving, setInstructionsSaving] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await api.getLlmConfig();
      if (active) setInitial(result.success ? result.data : null);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!workspace) return;
    let active = true;
    setInstructionsLoading(true);
    void api.getWikiChatInstructions().then((result) => {
      if (!active) return;
      if (!result.success) {
        setToast({ message: result.error.message, kind: "error" });
        setInstructionsLoading(false);
        return;
      }
      const custom = result.data.customInstructions;
      setDefaultInstructions(result.data.defaultInstructions);
      setSavedInstructions(custom);
      setInstructions(custom && custom.trim() !== "" ? custom : result.data.defaultInstructions);
      setInstructionsLoading(false);
    });
    return () => { active = false; };
  }, [workspace, setToast]);

  const instructionsDirty = instructions !== (savedInstructions && savedInstructions.trim() !== ""
    ? savedInstructions
    : defaultInstructions);

  async function saveInstructions(): Promise<void> {
    setInstructionsSaving(true);
    const result = await api.saveWikiChatInstructions(instructions);
    setInstructionsSaving(false);
    if (!result.success) {
      setToast({ message: result.error.message, kind: "error" });
      return;
    }
    const normalized = instructions.trim() === "" ? null : instructions;
    setSavedInstructions(normalized);
    setInstructions(normalized ?? defaultInstructions);
    setToast({ message: t("settings.chatInstructions.saved"), kind: "info" });
  }

  async function resetInstructions(): Promise<void> {
    setInstructionsSaving(true);
    const result = await api.resetWikiChatInstructions();
    if (!result.success) {
      setInstructionsSaving(false);
      setToast({ message: result.error.message, kind: "error" });
      return;
    }
    setSavedInstructions(null);
    setInstructions(defaultInstructions);
    setInstructionsSaving(false);
    setToast({ message: t("settings.chatInstructions.resetDone"), kind: "info" });
  }

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

        {workspace && (
          <section className="settings-section">
            <h2>{t("settings.chatInstructions.title")}</h2>
            <p className="muted settings-section-desc">{t("settings.chatInstructions.description")}</p>
            <p className="muted settings-section-desc">
              {t("settings.chatInstructions.workspace", { name: workspace.name })}
            </p>
            {instructionsLoading ? (
              <div className="muted">{t("settings.chatInstructions.loading")}</div>
            ) : (
              <div className="llm-form">
                <div className="field">
                  <label htmlFor="settings-chat-instructions">
                    {t("settings.chatInstructions.editorLabel")}
                  </label>
                  <textarea
                    id="settings-chat-instructions"
                    className="input"
                    rows={14}
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    disabled={instructionsSaving}
                  />
                  <span className="hint">{t("settings.chatInstructions.emptyHint")}</span>
                </div>
                <div className="row wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveInstructions()}
                    disabled={!instructionsDirty || instructionsSaving}
                  >
                    {t("settings.chatInstructions.save")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setInstructions(savedInstructions && savedInstructions.trim() !== ""
                      ? savedInstructions
                      : defaultInstructions)}
                    disabled={!instructionsDirty || instructionsSaving}
                  >
                    {t("settings.chatInstructions.discard")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void resetInstructions()}
                    disabled={instructionsSaving || (!instructionsDirty && savedInstructions === null)}
                  >
                    {t("settings.chatInstructions.reset")}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

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
