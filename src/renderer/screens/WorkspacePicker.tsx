import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import {
  recentWorkspacesAtom,
  screenAtom,
  workspaceAtom,
  llmConfiguredAtom,
  toastAtom,
} from "../store.ts";

export function WorkspacePicker(): JSX.Element {
  const t = useT();
  const recent = useAtomValue(recentWorkspacesAtom);
  const setWorkspace = useSetAtom(workspaceAtom);
  const setLlmConfigured = useSetAtom(llmConfiguredAtom);
  const [, setScreen] = useAtom(screenAtom);
  const setToast = useSetAtom(toastAtom);

  async function activate(path: string): Promise<void> {
    const result = await api.openWorkspace(path);
    if (!result.success) {
      setToast({ message: `${t("picker.openFailed")}: ${result.error.message}`, kind: "error" });
      return;
    }
    setWorkspace(result.data);
    const self = await api.getAppSelf();
    if (self.success) setLlmConfigured(self.data.hasLlmConfig);
    setScreen(self.success && self.data.hasLlmConfig ? "app" : "first-run");
  }

  async function pick(): Promise<void> {
    const result = await api.pickWorkspace();
    if (!result.success) {
      setToast({ message: `${t("picker.pickFailed")}: ${result.error.message}`, kind: "error" });
      return;
    }
    if (!result.data) return;
    setWorkspace(result.data);
    const self = await api.getAppSelf();
    if (self.success) setLlmConfigured(self.data.hasLlmConfig);
    setScreen(self.success && self.data.hasLlmConfig ? "app" : "first-run");
  }

  return (
    <main className="setup" style={{ overflow: "auto" }}>
      <div className="setup-card">
        <div className="row" style={{ gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
          <span className="brand" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontWeight: 700 }}>
            <span className="mark" style={{ width: 22, height: 22, borderRadius: 6, background: "var(--accent)", color: "var(--accent-on)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)" }}>{t("app.avatar")}</span>
            {t("app.name")}
          </span>
        </div>
        <h1>{t("picker.title")}</h1>
        <p className="fg2" style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-6)" }}>{t("picker.desc")}</p>

        <button className="btn btn-primary" onClick={() => void pick()} style={{ width: "100%", justifyContent: "center", marginBottom: "var(--space-6)" }}>
          {t("picker.chooseFolder")}
        </button>

        {recent.length > 0 && (
          <>
            <div className="side-title" style={{ marginBottom: "var(--space-3)" }}>{t("picker.recent")}</div>
            <div className="recent-sessions">
              {recent.map((w) => (
                <button key={w.path} className="rs-item" style={{ border: "none", width: "100%", textAlign: "left", background: "transparent" }} onClick={() => void activate(w.path)}>
                  <div>
                    <div className="rs-title">{w.name}</div>
                    <div className="rs-prev mono">{w.path}</div>
                  </div>
                  <span className="rs-time">{new Date(w.lastOpened).toLocaleDateString()}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}