import { useT } from "../i18n.ts";
import type { ModelOption } from "../../shared/ipc-types.ts";

function filterModels(models: readonly ModelOption[], query: string): readonly ModelOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return models;
  return models.filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(normalizedQuery),
  );
}

interface ModelPickerProps {
  readonly models: readonly ModelOption[];
  readonly modelId: string;
  readonly onModelChange: (id: string) => void;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  /** Accessible name of the option list, e.g. "Chat model" — tells several
   *  pickers on one form apart. */
  readonly label: string;
}

/** Searchable single-choice list of provider models. */
export function ModelPicker(props: ModelPickerProps): JSX.Element {
  const t = useT();
  const matchingModels = filterModels(props.models, props.searchQuery);
  const selectedModel = props.models.find((model) => model.id === props.modelId);
  const selectedModelMatches = matchingModels.some((model) => model.id === props.modelId);

  return (
    <div className="model-picker">
      <input
        className="input model-picker-search"
        type="search"
        value={props.searchQuery}
        onChange={(event) => props.onSearchQueryChange(event.target.value)}
        placeholder={t("llf.searchModels")}
        aria-label={t("llf.searchModels")}
      />
      {matchingModels.length > 0 ? (
        <div className="model-picker-options" role="group" aria-label={props.label}>
          {matchingModels.map((model) => (
            <button
              key={model.id}
              type="button"
              className={`model-picker-option${model.id === props.modelId ? " selected" : ""}`}
              aria-pressed={model.id === props.modelId}
              onClick={() => props.onModelChange(model.id)}
            >
              <span className="model-picker-option-name">{model.name || model.id}</span>
              {model.name && model.name !== model.id && (
                <span className="model-picker-option-id">{model.id}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="hint model-picker-empty" role="status">
          {t("llf.modelSearchNoResults")}
        </div>
      )}
      {!selectedModelMatches && selectedModel && (
        <div className="model-picker-current">
          <span>{t("llf.selectedModel")}</span>
          <strong>{selectedModel.name || selectedModel.id}</strong>
        </div>
      )}
    </div>
  );
}
