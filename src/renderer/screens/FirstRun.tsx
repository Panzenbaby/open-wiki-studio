import { useAtom, useSetAtom } from "jotai";
import { llmConfiguredAtom, screenAtom } from "../store.ts";
import { useT } from "../i18n.ts";
import { LlmConfigForm } from "../components/LlmConfigForm.tsx";

export function FirstRun(): JSX.Element {
  const t = useT();
  const setLlmConfigured = useSetAtom(llmConfiguredAtom);
  const [, setScreen] = useAtom(screenAtom);

  return (
    <main className="setup" style={{ overflow: "auto" }}>
      <div className="setup-card">
        <div className="setup-steps">
          <span className="step done" />
          <span className="step active" />
        </div>
        <h1>{t("firstrun.title")}</h1>
        <p className="fg2" style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-6)" }}>
          {t("firstrun.desc")}
        </p>
        <LlmConfigForm
          initial={null}
          submitLabel={t("firstrun.submit")}
          onSaved={() => {
            setLlmConfigured(true);
            setScreen("app");
          }}
        />
      </div>
    </main>
  );
}