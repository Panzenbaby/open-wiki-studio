// Runtime validation for IPC payloads. TypeScript signatures do not exist at
// runtime, so every argument arriving from the renderer is re-checked here
// before it reaches a handler.
import { mainT } from "./i18n.ts";
import type { Folder, LlmConfig, ProviderId } from "../shared/ipc-types.ts";

/** Known `ProviderId` values. */
export const VALID_PROVIDERS: ReadonlyArray<ProviderId> = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
  "ollama",
  "github-copilot",
];

const VALID_FOLDERS: ReadonlyArray<Folder> = ["input", "wiki"];

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

export function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && VALID_PROVIDERS.includes(value as ProviderId);
}

export function isFolder(value: unknown): value is Folder {
  return typeof value === "string" && VALID_FOLDERS.includes(value as Folder);
}

export function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

export function isLlmConfig(value: unknown): value is LlmConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isProviderId(candidate.provider) &&
    isNonEmptyString(candidate.modelId) &&
    isOptionalNonEmptyString(candidate.ingestModelId) &&
    isOptionalString(candidate.apiKey) &&
    isOptionalString(candidate.baseUrl)
  );
}

/** Checks one channel's argument list. Returns a user-facing error message
 *  when the payload is malformed, or `null` when it may be forwarded. */
export type ArgumentValidator = (args: readonly unknown[]) => string | null;

/** Rejects anything but a single non-empty string — the shape of every
 *  path-like IPC argument. */
export const expectPath: ArgumentValidator = (args) =>
  isNonEmptyString(args[0]) ? null : mainT("error.invalidPath", { path: String(args[0]) });

export function expectProvider(args: readonly unknown[]): string | null {
  return isProviderId(args[0])
    ? null
    : mainT("error.unknownProvider", { provider: String(args[0]) });
}
