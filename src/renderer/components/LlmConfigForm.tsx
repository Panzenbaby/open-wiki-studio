import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { api } from "../ipc.ts";
import { useT } from "../i18n.ts";
import { llmConfiguredAtom, toastAtom } from "../store.ts";
import { IngestModelField } from "./IngestModelField.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { RemoveApiKeyModal } from "./RemoveApiKeyModal.tsx";
import type { CopilotLoginEvent, LlmConfig, LlmConfigView, ModelOption, ProviderId } from "../../shared/ipc-types.ts";

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
  readonly initial: LlmConfigView | null;
  readonly submitLabel: string;
  readonly onSaved: () => void;
  /** Offer a separate ingest model (Settings). The first-run setup picks one
   *  model for chat and ingest (ADR 0007). */
  readonly allowSeparateIngestModel: boolean;
}

export function LlmConfigForm(props: LlmConfigFormProps): JSX.Element {
  const t = useT();
  const [provider, setProvider] = useState<ProviderId>(props.initial?.provider ?? "anthropic");
  const [modelId, setModelId] = useState(props.initial?.modelId ?? "");
  // Ingest model: follows the chat model unless a separate one is chosen.
  // The chosen ID is kept while the checkbox toggles so it is not lost.
  const [ingestUsesChatModel, setIngestUsesChatModel] = useState(props.initial?.ingestModelId === undefined);
  const [ingestModelId, setIngestModelId] = useState(props.initial?.ingestModelId ?? "");
  // Always starts empty: the stored key never reaches the renderer. An empty
  // field means "keep whatever is stored".
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const setToast = useSetAtom(toastAtom);
  const setLlmConfigured = useSetAtom(llmConfiguredAtom);

  // Live provider for async callbacks: a login completing while the user is
  // on another provider must not clobber that provider's modelId.
  const providerRef = useRef<ProviderId>(provider);
  providerRef.current = provider;

  // ── Copilot OAuth state ───────────────────────────────────────────
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>("idle");
  const [copilotModels, setCopilotModels] = useState<readonly ModelOption[]>([]);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);

  // ── Non-Copilot model-selection state (two-phase: credentials → dropdown) ─
  // `modelsLoaded` gates the dropdown until a Load succeeds. Editing key/baseUrl
  // resets it so the user re-loads with the new credentials.
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set once the stored key has actually been revoked in the main process, so
  // the form stops claiming a key is stored.
  const [storedKeyRemoved, setStoredKeyRemoved] = useState(false);
  const [confirmingKeyRemoval, setConfirmingKeyRemoval] = useState(false);

  useEffect(() => {
    if (!props.initial) return;
    setProvider(props.initial.provider);
    setModelId(props.initial.modelId);
    setIngestUsesChatModel(props.initial.ingestModelId === undefined);
    setIngestModelId(props.initial.ingestModelId ?? "");
    setApiKey("");
    setBaseUrl(props.initial.baseUrl ?? "");
    setStoredKeyRemoved(false);
  }, [props.initial]);

  const selected = PROVIDERS.find((p) => p.id === provider)!;
  const showKeyField = selected.keyMode !== "none";
  const isCopilot = selected.oauth === true;
  // A key is already stored for the selected provider, so an empty field is
  // still a valid save and models can be loaded without re-entering it.
  const hasStoredKey =
    props.initial?.hasApiKey === true && props.initial.provider === provider && !storedKeyRemoved;

  // Probe auth status when Copilot is selected: a non-empty model list =
  // already logged in (dropdown + logout); empty = show login button. State is
  // NOT reset when switching away (a login may still be in flight).
  useEffect(() => {
    if (!isCopilot) return;
    if (copilotStatus === "logging-in") return;
    // Skip the redundant re-probe right after a successful login.
    if (copilotStatus === "logged-in" && copilotModels.length > 0) return;
    let cancelled = false;
    setModelSearchQuery("");
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

  // Auto-load models for the persisted provider on mount/switch when its
  // saved credentials are present, so reopening Settings shows the dropdown
  // without an extra click.
  useEffect(() => {
    if (isCopilot) return;
    const saved = props.initial && props.initial.provider === provider ? props.initial : null;
    if (!saved) {
      setModels([]);
      setModelsLoaded(false);
      setLoadError(null);
      return;
    }
    const hasCreds = saved.hasApiKey || !!saved.baseUrl || provider === "ollama";
    if (!hasCreds) return;
    let cancelled = false;
    setModelSearchQuery("");
    void (async () => {
      setLoadingModels(true);
      setLoadError(null);
      // No key passed: main falls back to the stored one for this provider.
      const result = await api.loadModels(provider, undefined, saved.baseUrl);
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
    // `modelId` and `props.initial` excluded on purpose: this is the
    // provider-switch auto-load. Re-running it when the user picks a model
    // would re-fetch the list and fight their selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, isCopilot]);

  // Save gate: required-key providers need an apiKey; OAuth (Copilot) needs a
  // completed login + selected model; other providers need a loaded model
  // list + a selected model. A separate ingest model must be chosen too.
  const missingRequiredKey = selected.keyMode === "required" && !apiKey.trim() && !hasStoredKey;
  const copilotMissingModel = isCopilot && (copilotStatus !== "logged-in" || !modelId.trim());
  const nonCopilotMissingModel = !isCopilot && (!modelsLoaded || !modelId.trim());
  const availableModels = isCopilot ? copilotModels : models;
  const separateIngestModel = props.allowSeparateIngestModel && !ingestUsesChatModel;
  // A chosen ingest model the loaded list does not offer counts as missing:
  // the user picks again instead of being switched to another model silently.
  const ingestMissingModel =
    separateIngestModel && !availableModels.some((model) => model.id === ingestModelId);
  const canSave =
    !busy &&
    !missingRequiredKey &&
    !ingestMissingModel &&
    (isCopilot ? !copilotMissingModel : !nonCopilotMissingModel);

  // Load-models gate: required-key providers need an apiKey; base-URL
  // providers need a base URL (Ollama has a default, so it's always ready).
  const canLoadModels =
    !loadingModels &&
    (selected.keyMode !== "required" || !!apiKey.trim() || hasStoredKey) &&
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
    setModelSearchQuery("");
    setBusy(true);
    setCopilotStatus("logging-in");
    setCopilotDeviceCode(null);
  // Forward device-code events; library progress text is English-only, so the
  // UI shows a localized label instead.
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
    // loginCopilot() resolves with cause "cancelled" and resets state/busy in
    // its finally block. Don't touch busy here — Cancel stays responsive while
    // the abort propagates.
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
   * (Ollama gets its default base URL; the ingest follows the chat model).
   * Always clears the loaded model list so a stale dropdown from another
   * provider never leaks.
   */
  function selectProvider(next: ProviderId): void {
    setProvider(next);
    setModelSearchQuery("");
    setApiKey("");
    if (props.initial && props.initial.provider === next) {
      setBaseUrl(props.initial.baseUrl ?? "");
      setModelId(props.initial.modelId);
      setIngestUsesChatModel(props.initial.ingestModelId === undefined);
      setIngestModelId(props.initial.ingestModelId ?? "");
    } else {
      setBaseUrl(next === "ollama" ? "http://localhost:11434/v1" : "");
      setModelId("");
      setIngestUsesChatModel(true);
      setIngestModelId("");
    }
    setModels([]);
    setModelsLoaded(false);
    setLoadError(null);
  }

  /** Manually load models with the currently-entered credentials/base URL. */
  async function loadModelsAction(): Promise<void> {
    setModelSearchQuery("");
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

  /**
   * Revoke the stored key. Applied immediately rather than on save: the field
   * shows "a key is stored", and deferring would leave that label wrong until
   * the user saves — or permanently, if they navigate away. It also cannot be
   * deferred for required-key providers, where the save button is disabled
   * until a key exists, so a pending removal could never be applied.
   */
  async function removeStoredKey(): Promise<void> {
    setBusy(true);
    const result = await api.removeLlmApiKey();
    setBusy(false);
    if (!result.success) {
      setToast({ message: `${t("llf.removeApiKeyFailed")}: ${result.error.message}`, kind: "error" });
      return;
    }
    setStoredKeyRemoved(true);
    setApiKey("");
    setModels([]);
    setModelsLoaded(false);
    setLoadError(null);
    setLlmConfigured(false);
    setToast({ message: t("llf.apiKeyRemoved"), kind: "info" });
  }

  /** Editing credentials invalidates a previously-loaded model list. */
  function onApiKeyChange(value: string): void {
    setApiKey(value);
    if (!isCopilot) {
      setModels([]);
      setModelsLoaded(false);
      setLoadError(null);
      setModelSearchQuery("");
    }
  }
  function onBaseUrlChange(value: string): void {
    setBaseUrl(value);
    if (!isCopilot) {
      setModels([]);
      setModelsLoaded(false);
      setLoadError(null);
      setModelSearchQuery("");
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
    if (ingestMissingModel) {
      setToast({ message: t("llf.ingestModelRequired"), kind: "error" });
      return;
    }
    setBusy(true);
    const config: LlmConfig = {
      provider,
      modelId,
      // Absent = the ingest follows the chat model, now and after later
      // changes to it.
      ingestModelId: separateIngestModel ? ingestModelId : undefined,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    };
    const result = await api.configureLlm(config);
    setBusy(false);
    if (!result.success) {
      setToast({ message: `${t("llf.saveFailed")}: ${result.error.message}`, kind: "error" });
      return;
    }
    // Keep the renderer's notion of "an LLM is configured" in sync after any
    // successful save (FirstRun and Settings share this form).
    setLlmConfigured(true);
    props.onSaved();
  }

  const chatModelLabel = t(props.allowSeparateIngestModel ? "llf.chatModel" : "llf.selectModel");

  /** The chat model picker plus — where offered — the ingest model choice,
   *  both fed by the same provider model list. */
  function renderModelSelection(): JSX.Element {
    return (
      <>
        <div className="field">
          <label>{chatModelLabel}</label>
          <ModelPicker
            models={availableModels}
            modelId={modelId}
            onModelChange={setModelId}
            searchQuery={modelSearchQuery}
            onSearchQueryChange={setModelSearchQuery}
            label={chatModelLabel}
          />
          {!props.allowSeparateIngestModel && (
            <span className="hint">{t("llf.modelUsedForChatAndIngest")}</span>
          )}
        </div>
        {props.allowSeparateIngestModel && (
          <IngestModelField
            key={provider}
            models={availableModels}
            usesChatModel={ingestUsesChatModel}
            modelId={ingestModelId}
            missingModel={ingestMissingModel}
            onUsesChatModelChange={setIngestUsesChatModel}
            onModelChange={setIngestModelId}
          />
        )}
      </>
    );
  }

  return (
    <div className="llm-form">
      <div className="field">
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
          modelSelection={copilotModels.length > 0 ? renderModelSelection() : null}
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
            <div className="field">
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
            <div className="field">
              <label>
                {t("llf.apiKey")}
                {selected.keyMode === "optional" && (
                  <span className="hint">{t("llf.apiKeyOptional")}</span>
                )}
              </label>
              <input
                className="input"
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={hasStoredKey ? t("llf.apiKeyStored") : "sk-…"}
              />
              {hasStoredKey && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmingKeyRemoval(true)}
                  disabled={busy}
                >
                  {t("llf.removeApiKey")}
                </button>
              )}
            </div>
          )}

          {!modelsLoaded && (
            <div className="field">
              <button
                className="btn btn-block"
                onClick={() => void loadModelsAction()}
                disabled={!canLoadModels}
              >
                {loadingModels ? `${t("llf.loadModelsBusy")}${t("app.ellipsis")}` : t("llf.loadModels")}
              </button>
              {loadError && <span className="hint err">{loadError}</span>}
            </div>
          )}

          {modelsLoaded && (models.length > 0 ? renderModelSelection() : (
            <div className="field">
              <div className="hint">{t("llf.noModels")}</div>
            </div>
          ))}
        </>
      )}

      <button
        className="btn btn-primary btn-block"
        disabled={!canSave}
        onClick={() => void save()}
      >
        {busy ? `${t("settings.save")}${t("app.ellipsis")}` : props.submitLabel}
      </button>
      {missingRequiredKey && <div className="hint err">{t("llf.apiKeyRequired")}</div>}
      {isCopilot && copilotMissingModel && <div className="hint err">{t("copilot.noModels")}</div>}

      {confirmingKeyRemoval && (
        <RemoveApiKeyModal
          busy={busy}
          onCancel={() => setConfirmingKeyRemoval(false)}
          onConfirm={() => {
            setConfirmingKeyRemoval(false);
            void removeStoredKey();
          }}
        />
      )}
    </div>
  );
}

// ── Copilot OAuth section (inline in the form) ──────────────────────
interface CopilotSectionProps {
  readonly status: CopilotStatus;
  /** Model pickers shown once signed in; `null` when the account offers no
   *  models. Composed by the form, which owns the model selection state. */
  readonly modelSelection: JSX.Element | null;
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
  const { status, deviceCode, busy } = props;

  if (status === "logged-in") {
    return (
      <>
        {props.modelSelection ?? (
          <div className="field">
            <div className="hint">{t("copilot.noModels")}</div>
          </div>
        )}
        <div className="row between">
          <span className="hint">{t("copilot.loggedIn")}</span>
          <button className="btn btn-ghost" onClick={props.onLogout}>
            {t("copilot.logout")}
          </button>
        </div>
      </>
    );
  }

  if (status === "logging-in") {
    return (
      <div className="field">
        {deviceCode ? (
          <>
            <label>{t("copilot.deviceCode")}</label>
            <div className="copilot-code-row">
              <div className="copilot-device-code mono">{deviceCode.userCode}</div>
              <button
                className="btn btn-ghost copilot-copy-btn"
                onClick={() => void props.onCopyCode(deviceCode.userCode)}
                title={t("copilot.copyCode")}
                aria-label={t("copilot.copyCode")}
              >
                {t("copilot.copyCode")}
              </button>
            </div>
            <span className="hint">{t("copilot.deviceCodeHint")}</span>
            <button
              className="btn btn-block"
              onClick={() => void props.onOpenUrl(deviceCode.verificationUri)}
            >
              {t("copilot.openUrl")}
            </button>
          </>
        ) : (
          <div className="hint">{t("copilot.loggingIn")}</div>
        )}
        <div className="hint">{t("copilot.progress")}</div>
        <button
          className="btn btn-ghost btn-block"
          onClick={props.onCancel}
          disabled={!busy}
        >
          {t("copilot.cancel")}
        </button>
      </div>
    );
  }

  // idle
  return (
    <div className="field">
      <button
        className="btn btn-primary btn-block"
        onClick={props.onLogin}
        disabled={busy}
      >
        {busy ? `${t("copilot.loggingIn")}${t("app.ellipsis")}` : t("copilot.login")}
      </button>
    </div>
  );
}