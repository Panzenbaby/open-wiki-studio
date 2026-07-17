import { useAtom, useSetAtom } from "jotai";
import { AlertTriangle, Trash2 } from "lucide-react";
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
  const [recent, setRecent] = useAtom(recentWorkspacesAtom);
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
    // The opened workspace bubbles to the top of the recent list (rememberWorkspace
    // updates lastOpened); refresh so the list reflects the new order on the
    // next picker visit.
    void refreshRecent();
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
    // A freshly picked workspace is added to the recent list by rememberWorkspace;
    // refresh so it appears immediately instead of only after an app restart.
    void refreshRecent();
    const self = await api.getAppSelf();
    if (self.success) setLlmConfigured(self.data.hasLlmConfig);
    setScreen(self.success && self.data.hasLlmConfig ? "app" : "first-run");
  }

  async function refreshRecent(): Promise<void> {
    const refreshed = await api.listRecentWorkspaces();
    if (refreshed.success) setRecent(refreshed.data);
  }

  // Remove a workspace from the recent list. Only the stored reference is
  // dropped — the folder on disk stays untouched.
  async function forget(path: string): Promise<void> {
    if (!window.confirm(t("picker.confirmForget"))) return;
    const result = await api.forgetWorkspace(path);
    if (!result.success) {
      setToast({ message: `${t("picker.forgetFailed")}: ${result.error.message}`, kind: "error" });
      return;
    }
    await refreshRecent();
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
              {recent.map((w) => {
                const missing = w.missing === true;
                return (
                  <div key={w.path} className={`rs-item${missing ? " rs-item-missing" : ""}`}>
                    <button
                      type="button"
                      className="rs-open"
                      disabled={missing}
                      onClick={() => void activate(w.path)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-4)",
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        padding: 0,
                        cursor: missing ? "default" : "pointer",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="rs-title">{w.name}</div>
                        <div className="rs-prev mono">{w.path}</div>
                        {missing && (
                          <div className="rs-missing" style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", marginTop: "var(--space-1)", color: "var(--warn)", fontSize: "var(--text-xs)" }}>
                            <AlertTriangle size={12} />
                            <span>{t("picker.missing")}</span>
                          </div>
                        )}
                      </div>
                      <span className="rs-time">{new Date(w.lastOpened).toLocaleDateString()}</span>
                    </button>
                    <button
                      type="button"
                      className="session-delete-dash"
                      title={t("picker.forget")}
                      aria-label={t("picker.forget")}
                      onClick={() => void forget(w.path)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}