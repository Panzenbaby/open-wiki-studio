import { useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { toastAtom } from "../store.ts";
import type { LlmConfig, ProviderId } from "../../shared/ipc-types.ts";

type ProviderDef = {
  id: ProviderId;
  name: string;
  subKey: string;
  // 'required' = key mandatory, 'optional' = key field shown but may be empty,
  // 'none' = no key field at all.
  keyMode: "required" | "optional" | "none";
  needsBaseUrl: boolean;
};

const PROVIDERS: ReadonlyArray<ProviderDef> = [
  { id: "anthropic", name: "Anthropic", subKey: "llf.anthropic.sub", keyMode: "required", needsBaseUrl: false },
  { id: "openai", name: "OpenAI", subKey: "llf.openai.sub", keyMode: "required", needsBaseUrl: false },
  { id: "google", name: "Google", subKey: "llf.google.sub", keyMode: "required", needsBaseUrl: false },
  { id: "ollama", name: "Ollama", subKey: "llf.ollama.sub", keyMode: "none", needsBaseUrl: true },
  { id: "openai-compatible", name: "OpenAI-compatible", subKey: "llf.openai-compatible.sub", keyMode: "optional", needsBaseUrl: true },
];

interface LlmConfigFormProps {
  readonly initial: LlmConfig | null;
  readonly submitLabel: string;
  readonly onSaved: () => void;
}

export function LlmConfigForm(props: LlmConfigFormProps): JSX.Element {
  const t = useT();
  const [provider, setProvider] = useState<ProviderId>(props.initial?.provider ?? "anthropic");
  const [modelId, setModelId] = useState(props.initial?.modelId ?? "claude-sonnet-4-5");
  const [apiKey, setApiKey] = useState(props.initial?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const setToast = useSetAtom(toastAtom);

  useEffect(() => {
    if (!props.initial) return;
    setProvider(props.initial.provider);
    setModelId(props.initial.modelId);
    setApiKey(props.initial.apiKey ?? "");
    setBaseUrl(props.initial.baseUrl ?? "");
  }, [props.initial]);

  const selected = PROVIDERS.find((p) => p.id === provider)!;
  const showKeyField = selected.keyMode !== "none";

  // A required-key provider needs a non-empty apiKey before we can save.
  // Ollama / openai-compatible have their own key handling in the main
  // process (placeholder key) so they are exempt.
  const missingRequiredKey = selected.keyMode === "required" && !apiKey.trim();
  const canSave = !busy && !missingRequiredKey;

  async function save(): Promise<void> {
    if (missingRequiredKey) {
      setToast({ message: t("llf.apiKeyRequired"), kind: "error" });
      return;
    }
    setBusy(true);
    const config: LlmConfig = {
      provider,
      modelId,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    };
    const result = await api.configureLlm(config);
    setBusy(false);
    if (!result.success) {
      setToast({ message: `${t("llf.saveFailed")}: ${result.error.message}`, kind: "error" });
      return;
    }
    props.onSaved();
  }

  return (
    <>
      <div className="field" style={{ marginBottom: "var(--space-5)" }}>
        <label>{t("llf.provider")}</label>
        <div className="provider-grid">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={`provider${p.id === provider ? " selected" : ""}`}
              style={{ border: "1px solid var(--border)", background: "transparent" }}
              onClick={() => setProvider(p.id)}
            >
              <div>
                <div className="p-name">{p.name}</div>
                <div className="p-sub">{t(p.subKey)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: "var(--space-4)" }}>
        <label>{t("llf.modelId")}</label>
        <input className="input" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="claude-sonnet-4-5" />
        <span className="hint">{t("llf.modelIdHint")}</span>
      </div>

      {selected.needsBaseUrl && (
        <div className="field" style={{ marginBottom: "var(--space-4)" }}>
          <label>{t("llf.baseUrl")}</label>
          <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
        </div>
      )}

      {showKeyField && (
        <div className="field" style={{ marginBottom: "var(--space-6)" }}>
          <label>
            {t("llf.apiKey")}
            {selected.keyMode === "optional" && (
              <span className="hint" style={{ marginLeft: "var(--space-2)", fontWeight: 400 }}>
                {t("llf.apiKeyOptional")}
              </span>
            )}
          </label>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={!canSave}
        onClick={() => void save()}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {busy ? `${t("settings.save")}…` : props.submitLabel}
      </button>
      {missingRequiredKey && (
        <div className="hint" style={{ marginTop: "var(--space-3)", color: "var(--danger, #e06c75)" }}>
          {t("llf.apiKeyRequired")}
        </div>
      )}
    </>
  );
}