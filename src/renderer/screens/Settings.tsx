import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { currentVersionAtom, viewAtom } from "../store.ts";
import type { LlmConfig } from "../../shared/ipc-types.ts";
import { LlmConfigForm } from "../components/LlmConfigForm.tsx";

export function Settings(): JSX.Element {
  const t = useT();
  const setView = useSetAtom(viewAtom);
  const currentVersion = useAtomValue(currentVersionAtom);
  const [initial, setInitial] = useState<LlmConfig | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const result = await api.getLlmConfig();
      setInitial(result.success ? result.data : null);
    })();
  }, []);

  return (
    <main className="setup" style={{ overflow: "auto" }}>
      <div className="setup-card">
        <h1>{t("settings.title")}</h1>
        <p className="fg2" style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-6)" }}>
          {t("settings.desc")}
        </p>
        {initial === undefined ? (
          <div className="muted">{t("settings.loading")}</div>
        ) : (
          <LlmConfigForm
            initial={initial}
            submitLabel={t("settings.save")}
            onSaved={() => setView("dashboard")}
          />
        )}
        <button className="btn btn-ghost" style={{ marginTop: "var(--space-4)", width: "100%", justifyContent: "center" }} onClick={() => setView("dashboard")}>
          {t("settings.cancel")}
        </button>
        <p className="muted settings-version">
          {t("settings.version", { version: currentVersion })}
        </p>
      </div>
    </main>
  );
}