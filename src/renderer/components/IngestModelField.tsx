import { useId, useState } from "react";
import { useT } from "../i18n.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import type { ModelOption } from "../../shared/ipc-types.ts";

interface IngestModelFieldProps {
  /** The provider's models — the same list the chat model is picked from. */
  readonly models: readonly ModelOption[];
  /** True while the ingest follows the chat model. */
  readonly usesChatModel: boolean;
  /** The separately chosen ingest model; empty while none is chosen. */
  readonly modelId: string;
  /** True while a separate ingest model is wanted but none of the offered
   *  models is chosen — saving is blocked until the user picks one. */
  readonly missingModel: boolean;
  readonly onUsesChatModelChange: (usesChatModel: boolean) => void;
  readonly onModelChange: (modelId: string) => void;
}

/**
 * Ingest model choice (ADR 0007): follow the chat model — the default — or
 * pick a separate model of the same provider, e.g. a stronger one.
 */
export function IngestModelField(props: IngestModelFieldProps): JSX.Element {
  const t = useT();
  const titleId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const title = t("llf.ingestModel");

  return (
    <div className="field" role="group" aria-labelledby={titleId}>
      <span id={titleId} className="field-title">{title}</span>
      <label className="check-row">
        <input
          type="checkbox"
          checked={props.usesChatModel}
          onChange={(event) => props.onUsesChatModelChange(event.target.checked)}
        />
        <span>{t("llf.ingestUsesChatModel")}</span>
      </label>
      <span className="hint">{t("llf.ingestModelHint")}</span>
      {!props.usesChatModel && (
        <>
          <ModelPicker
            models={props.models}
            modelId={props.modelId}
            onModelChange={props.onModelChange}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            label={title}
          />
          {props.missingModel && (
            <span className="hint err">{t("llf.ingestModelRequired")}</span>
          )}
        </>
      )}
    </div>
  );
}
