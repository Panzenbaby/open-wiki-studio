import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { toastAtom } from "../store.ts";
import type { CopilotLoginEvent, LlmConfig, ModelOption, ProviderId } from "../../shared/ipc-types.ts";

type ProviderDef = {
  id: ProviderId;
  name: string;
  subKey: string;
  // 'required' = key mandatory, 'optional' = key field shown but may be empty,
  // 'none' = no key field at all.
  keyMode: "required" | "optional" | "none";
  needsBaseUrl: boolean;
/** OAuth provider (GitHub Copilot) — renders the login section instead of a key field. */
  oauth?: boolean;
};

const PROVIDERS: ReadonlyArray<ProviderDef> = [
  { id: "anthropic", name: "Anthropic", subKey: "llf.anthropic.sub", keyMode: "required", needsBaseUrl: false },
  { id: "openai", name: "OpenAI", subKey: "llf.openai.sub", keyMode: "required", needsBaseUrl: false },
  { id: "google", name: "Google", subKey: "llf.google.sub", keyMode: "required", needsBaseUrl: false },
  { id: "ollama", name: "Ollama", subKey: "llf.ollama.sub", keyMode: "none", needsBaseUrl: true },
  { id: "openai-compatible", name: "OpenAI-compatible", subKey: "llf.openai-compatible.sub", keyMode: "optional", needsBaseUrl: true },
  { id: "github-copilot", name: "GitHub Copilot", subKey: "llf.github-copilot.sub", keyMode: "none", needsBaseUrl: false, oauth: true },
];

type CopilotStatus = "idle" | "logging-in" | "logged-in";

interface LlmConfigFormProps {
  readonly initial: LlmConfig | null;
  readonly submitLabel: string;
  readonly onSaved: () => void;
}

export function LlmConfigForm(props: LlmConfigFormProps): JSX.Element {
  const t = useT();
  const [provider, setProvider] = useState<ProviderId>(props.initial?.provider ?? "anthropic");
  const [modelId, setModelId] = useState(props.initial?.modelId ?? "");
  const [apiKey, setApiKey] = useState(props.initial?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const setToast = useSetAtom(toastAtom);

  // Live provider for async callbacks: a login completing while the user is
  // on another provider must not clobber that provider's modelId.
  const providerRef = useRef<ProviderId>(provider);
  providerRef.current = provider;

  // ── Copilot OAuth state ───────────────────────────────────────────
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>("idle");
  const [copilotModels, setCopilotModels] = useState<readonly ModelOption[]>([]);
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);

  // ── Non-Copilot model-selection state (two-phase: credentials → dropdown) ─
  // `modelsLoaded` gates the dropdown: false until a Load succeeds (manual or
  // auto on reopen). Editing key/baseUrl resets it so the user re-loads with
  // the new credentials.
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.initial) return;
    setProvider(props.initial.provider);
    setModelId(props.initial.modelId);
    setApiKey(props.initial.apiKey ?? "");
    setBaseUrl(props.initial.baseUrl ?? "");
  }, [props.initial]);

  const selected = PROVIDERS.find((p) => p.id === provider)!;
  const showKeyField = selected.keyMode !== "none";
  const isCopilot = selected.oauth === true;

  // Probe auth status when Copilot is selected: non-empty model list =
  // already logged in (dropdown + logout); empty = show login button.
  // State is intentionally NOT reset when switching away: a login may still
  // be in flight, and tearing it down would leave the user stuck. The probe
  // also skips while logging in, so switching back mid-login restores the
  // live device-code UI.
  useEffect(() => {
    if (!isCopilot) return;
    if (copilotStatus === "logging-in") return;
    // Skip the redundant re-probe right after a successful login.
    if (copilotStatus === "logged-in" && copilotModels.length > 0) return;
    let cancelled = false;
    void (async () => {
      const result = await api.listAvailableModels("github-copilot");
      if (cancelled) return;
      if (result.success && result.data.length > 0) {
        setCopilotModels(result.data);
        setCopilotStatus("logged-in");
        if (!result.data.some((model) => model.id === modelId)) {
          setModelId(result.data[0].id);
        }
      } else {
        setCopilotModels([]);
        setCopilotStatus("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
    // modelId excluded on purpose: re-probe only on provider/status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, isCopilot, copilotStatus]);

  // Auto-load models for the *persisted* provider on mount/switch when its
  // saved credentials are present, so reopening Settings shows the dropdown
  // without an extra click. Other providers stay in phase 1 (Load button).
  useEffect(() => {
    if (isCopilot) return;
    const saved = props.initial && props.initial.provider === provider ? props.initial : null;
    if (!saved) {
      setModels([]);
      setModelsLoaded(false);
      setLoadError(null);
      return;
    }
    const hasCreds = !!saved.apiKey || !!saved.baseUrl || provider === "ollama";
    if (!hasCreds) return;
    let cancelled = false;
    void (async () => {
      setLoadingModels(true);
      setLoadError(null);
      const result = await api.loadModels(provider, saved.apiKey, saved.baseUrl);
      if (cancelled) return;
      setLoadingModels(false);
      if (result.success) {
        setModels(result.data);
        setModelsLoaded(true);
        if (!result.data.some((m) => m.id === modelId)) {
          setModelId(result.data[0]?.id ?? modelId);
        }
      } else {
        setModels([]);
        setModelsLoaded(false);
        setLoadError(result.error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, isCopilot]);

  // Save gate: required-key providers need an apiKey; OAuth (Copilot) needs
  // a completed login + selected model; other providers need a loaded model
  // list + a selected model.
  const missingRequiredKey = selected.keyMode === "required" && !apiKey.trim();
  const copilotMissingModel = isCopilot && (copilotStatus !== "logged-in" || !modelId.trim());
  const nonCopilotMissingModel = !isCopilot && (!modelsLoaded || !modelId.trim());
  const canSave =
    !busy &&
    !missingRequiredKey &&
    (isCopilot ? !copilotMissingModel : !nonCopilotMissingModel);

  // Load-models gate: required-key providers need an apiKey; base-URL
  // providers need a base URL (Ollama has a default, so it's always ready).
  const canLoadModels =
    !loadingModels &&
    (selected.keyMode !== "required" || !!apiKey.trim()) &&
    (!selected.needsBaseUrl || !!baseUrl.trim());

  async function openInBrowser(url: string): Promise<void> {
    const result = await api.openExternal(url);
    if (!result.success) setToast({ message: result.error.message, kind: "error" });
  }

  async function copyDeviceCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setToast({ message: t("copilot.copied"), kind: "info" });
    } catch {
      setToast({ message: t("copilot.copyFailed"), kind: "error" });
    }
  }

  async function loginCopilot(): Promise<void> {
    setBusy(true);
    setCopilotStatus("logging-in");
    setCopilotDeviceCode(null);
    // Forward device-code events; library progress text is English-only, so
    // the UI shows a localized label instead.
    const off = api.onCopilotLoginEvent((event: CopilotLoginEvent) => {
      if (event.type === "device_code") {
        setCopilotDeviceCode({ userCode: event.userCode, verificationUri: event.verificationUri });
      }
    });
    try {
      const result = await api.loginCopilot();
      if (!result.success) {
        setCopilotDeviceCode(null);
        if (result.error.cause === "cancelled") {
          setToast({ message: t("copilot.loginCancelled"), kind: "info" });
        } else {
          setToast({ message: `${t("copilot.loginFailed")}: ${result.error.message}`, kind: "error" });
        }
        setCopilotStatus("idle");
        setCopilotModels([]);
        return;
      }
      setCopilotModels(result.data);
      setCopilotStatus(result.data.length > 0 ? "logged-in" : "idle");
      setCopilotDeviceCode(null);
      // Only auto-pick a model when still on Copilot — see providerRef above.
      if (providerRef.current === "github-copilot") {
        setModelId(result.data[0]?.id ?? "");
      }
    } finally {
      off();
      setBusy(false);
    }
  }

  async function cancelCopilotLogin(): Promise<void> {
    // loginCopilot() resolves with cause "cancelled" and resets state/busy
    // in its finally block. Don't touch busy here — Cancel stays responsive
    // while the abort propagates.
    await api.cancelCopilotLogin();
  }

  async function logoutCopilot(): Promise<void> {
    const result = await api.logoutCopilot();
    if (!result.success) {
      setToast({ message: result.error.message, kind: "error" });
      return;
    }
    setCopilotStatus("idle");
    setCopilotModels([]);
    setModelId("");
  }

  /**
   * Switch provider and reset credentials/model selection for it: reuse the
   * saved config when re-selecting the persisted provider, else start clean
   * (Ollama gets its default base URL). Always clears the loaded model list
   * so a stale dropdown from another provider never leaks.
   */
  function selectProvider(next: ProviderId): void {
    setProvider(next);
    if (props.initial && props.initial.provider === next) {
      setApiKey(props.initial.apiKey ?? "");
      setBaseUrl(props.initial.baseUrl ?? "");
      setModelId(props.initial.modelId);
    } else {
      setApiKey("");
      setBaseUrl(next === "ollama" ? "http://localhost:11434/v1" : "");
      setModelId("");
    }
    setModels([]);
    setModelsLoaded(false);
    setLoadError(null);
  }

  /** Manually load models with the currently-entered credentials/base URL. */
  async function loadModelsAction(): Promise<void> {
    setLoadingModels(true);
    setLoadError(null);
    const result = await api.loadModels(provider, apiKey || undefined, baseUrl || undefined);
    setLoadingModels(false);
    if (!result.success) {
      setToast({ message: `${t("llf.loadModelsFailed")}: ${result.error.message}`, kind: "error" });
      setModels([]);
      setModelsLoaded(false);
      setLoadError(result.error.message);
      return;
    }
    setModels(result.data);
    setModelsLoaded(true);
    if (!result.data.some((m) => m.id === modelId)) {
      setModelId(result.data[0]?.id ?? "");
    }
  }

  /** Editing credentials invalidates a previously-loaded model list. */
  function onApiKeyChange(value: string): void {
    setApiKey(value);
    if (!isCopilot) {
      setModels([]);
      setModelsLoaded(false);
      setLoadError(null);
    }
  }
  function onBaseUrlChange(value: string): void {
    setBaseUrl(value);
    if (!isCopilot) {
      setModels([]);
      setModelsLoaded(false);
      setLoadError(null);
    }
  }

  async function save(): Promise<void> {
    if (missingRequiredKey) {
      setToast({ message: t("llf.apiKeyRequired"), kind: "error" });
      return;
    }
    if (isCopilot && copilotMissingModel) {
      setToast({ message: t("copilot.noModels"), kind: "error" });
      return;
    }
    if (!isCopilot && nonCopilotMissingModel) {
      setToast({ message: t("llf.noModels"), kind: "error" });
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
              onClick={() => selectProvider(p.id)}
            >
              <div>
                <div className="p-name">{p.name}</div>
                <div className="p-sub">{t(p.subKey)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {isCopilot ? (
        <CopilotSection
          status={copilotStatus}
          models={copilotModels}
          modelId={modelId}
          onModelChange={setModelId}
          deviceCode={copilotDeviceCode}
          busy={busy}
          onLogin={() => void loginCopilot()}
          onCancel={() => void cancelCopilotLogin()}
          onLogout={() => void logoutCopilot()}
          onOpenUrl={openInBrowser}
          onCopyCode={copyDeviceCode}
        />
      ) : (
        <>
          {selected.needsBaseUrl && (
            <div className="field" style={{ marginBottom: "var(--space-4)" }}>
              <label>{t("llf.baseUrl")}</label>
              <input
                className="input"
                value={baseUrl}
                onChange={(e) => onBaseUrlChange(e.target.value)}
                placeholder="http://localhost:11434/v1"
              />
            </div>
          )}

          {showKeyField && (
            <div className="field" style={{ marginBottom: "var(--space-4)" }}>
              <label>
                {t("llf.apiKey")}
                {selected.keyMode === "optional" && (
                  <span className="hint" style={{ marginLeft: "var(--space-2)", fontWeight: 400 }}>
                    {t("llf.apiKeyOptional")}
                  </span>
                )}
              </label>
              <input
                className="input"
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="sk-…"
              />
            </div>
          )}

          {!modelsLoaded && (
            <div className="field" style={{ marginBottom: "var(--space-4)" }}>
              <button
                className="btn"
                onClick={() => void loadModelsAction()}
                disabled={!canLoadModels}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {loadingModels ? `${t("llf.loadModelsBusy")}${t("app.ellipsis")}` : t("llf.loadModels")}
              </button>
              {loadError && <span className="hint" style={{ color: "var(--error)" }}>{loadError}</span>}
            </div>
          )}

          {modelsLoaded && (
            <div className="field" style={{ marginBottom: "var(--space-6)" }}>
              <label>{t("llf.selectModel")}</label>
              {models.length > 0 ? (
                <select className="input" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name || model.id}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="hint">{t("llf.noModels")}</div>
              )}
            </div>
          )}
        </>
      )}

      <button
        className="btn btn-primary"
        disabled={!canSave}
        onClick={() => void save()}
        style={{ width: "100%", justifyContent: "center", marginTop: "var(--space-4)" }}
      >
        {busy ? `${t("settings.save")}…` : props.submitLabel}
      </button>
      {missingRequiredKey && (
        <div className="hint" style={{ marginTop: "var(--space-3)", color: "var(--danger, #e06c75)" }}>
          {t("llf.apiKeyRequired")}
        </div>
      )}
      {isCopilot && copilotMissingModel && (
        <div className="hint" style={{ marginTop: "var(--space-3)", color: "var(--danger, #e06c75)" }}>
          {t("copilot.noModels")}
        </div>
      )}
    </>
  );
}

// ── Copilot OAuth section (inline in the form) ──────────────────────
interface CopilotSectionProps {
  readonly status: CopilotStatus;
  readonly models: readonly ModelOption[];
  readonly modelId: string;
  readonly onModelChange: (id: string) => void;
  readonly deviceCode: { userCode: string; verificationUri: string } | null;
  readonly busy: boolean;
  readonly onLogin: () => void;
  readonly onCancel: () => void;
  readonly onLogout: () => void;
  readonly onOpenUrl: (url: string) => void;
  readonly onCopyCode: (code: string) => void;
}

function CopilotSection(props: CopilotSectionProps): JSX.Element {
  const t = useT();
  const { status, models, modelId, deviceCode, busy } = props;

  if (status === "logged-in") {
    return (
      <>
        <div className="field" style={{ marginBottom: "var(--space-4)" }}>
          <label>{t("copilot.selectModel")}</label>
          {models.length > 0 ? (
            <select className="input" value={modelId} onChange={(e) => props.onModelChange(e.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </select>
          ) : (
            <div className="hint">{t("copilot.noModels")}</div>
          )}
        </div>
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
          <span className="hint">{t("copilot.loggedIn")}</span>
          <button className="btn btn-ghost" onClick={props.onLogout} style={{ justifyContent: "center" }}>
            {t("copilot.logout")}
          </button>
        </div>
      </>
    );
  }

  if (status === "logging-in") {
    return (
      <div className="field" style={{ marginBottom: "var(--space-6)" }}>
        {deviceCode ? (
          <>
            <label>{t("copilot.deviceCode")}</label>
            <div className="copilot-code-row">
              <div
                className="copilot-device-code mono"
                style={{ fontSize: "var(--space-5)", letterSpacing: "0.2em", userSelect: "text" }}
              >
                {deviceCode.userCode}
              </div>
              <button
                className="btn btn-ghost copilot-copy-btn"
                onClick={() => void props.onCopyCode(deviceCode.userCode)}
                title={t("copilot.copyCode")}
                aria-label={t("copilot.copyCode")}
              >
                {t("copilot.copyCode")}
              </button>
            </div>
            <span className="hint" style={{ display: "block", marginBottom: "var(--space-3)" }}>
              {t("copilot.deviceCodeHint")}
            </span>
            <button
              className="btn"
              onClick={() => void props.onOpenUrl(deviceCode.verificationUri)}
              style={{ marginBottom: "var(--space-3)", justifyContent: "center", width: "100%" }}
            >
              {t("copilot.openUrl")}
            </button>
          </>
        ) : (
          <div className="hint">{t("copilot.loggingIn")}</div>
        )}
        <div className="hint" style={{ marginTop: "var(--space-2)" }}>{t("copilot.progress")}</div>
        <button
          className="btn btn-ghost"
          onClick={props.onCancel}
          disabled={!busy}
          style={{ marginTop: "var(--space-3)", justifyContent: "center", width: "100%" }}
        >
          {t("copilot.cancel")}
        </button>
      </div>
    );
  }

  // idle
  return (
    <div className="field" style={{ marginBottom: "var(--space-6)" }}>
      <button
        className="btn btn-primary"
        onClick={props.onLogin}
        disabled={busy}
        style={{ width: "100%", justifyContent: "center" }}
      >
        {busy ? `${t("copilot.loggingIn")}${t("app.ellipsis")}` : t("copilot.login")}
      </button>
    </div>
  );
}