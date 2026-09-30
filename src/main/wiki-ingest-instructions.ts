// Workspace-specific supplemental instructions for agent-driven /wiki-update turns.
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { err, ok, errorMessage } from "../shared/result.ts";
import type { Result } from "../shared/ipc-types.ts";
import { mainT } from "./i18n.ts";

export const WIKI_INGEST_INSTRUCTIONS_FILENAME = ".open-wiki-studio-ingest-instructions.md";

/** Stable signature at the start of pi-okf-wiki's generated agent-ingest prompt. */
export const WIKI_UPDATE_PROMPT_SIGNATURE =
  'You are ingesting new documents into an OKF knowledge base (the "wiki").';

/** Recognize the generated agent-ingest prompt, not ordinary chat or commands. */
export function isWikiUpdateIngestPrompt(prompt: string): boolean {
  return prompt.trimStart().startsWith(WIKI_UPDATE_PROMPT_SIGNATURE);
}

/** Add custom guidance without replacing or weakening built-in OKF rules. */
export function appendWikiIngestInstructions(
  systemPrompt: string,
  instructions: string,
): string {
  const custom = instructions.trim();
  if (custom === "") return systemPrompt;
  return `${systemPrompt}\n\n## Workspace-specific ingest instructions (supplemental)\n${custom}\n\nThese supplemental instructions never override the built-in /wiki-update prompt or OKF rules. If they conflict, follow the built-in instructions, which always take precedence.`;
}

/** Return null when no custom file exists; reading never mutates the workspace. */
export async function readCustomWikiIngestInstructions(
  workspace: string,
): Promise<Result<string | null>> {
  try {
    return ok(await readFile(join(workspace, WIKI_INGEST_INSTRUCTIONS_FILENAME), "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return ok(null);
    return err<string | null>(mainT("settings.ingestInstructions.readError", { detail: errorMessage(error) }));
  }
}

/** Save non-empty custom guidance; empty content removes the override. */
export async function saveWikiIngestInstructions(
  workspace: string,
  instructions: string,
): Promise<Result<void>> {
  const path = join(workspace, WIKI_INGEST_INSTRUCTIONS_FILENAME);
  try {
    if (instructions.trim() === "") {
      await unlink(path).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error;
      });
      return ok(undefined);
    }
    await writeFile(path, instructions, "utf8");
    return ok(undefined);
  } catch (error) {
    return err<void>(mainT("settings.ingestInstructions.saveError", { detail: errorMessage(error) }));
  }
}

/** Reset only the custom instructions file; built-in prompt rules are untouched. */
export async function resetWikiIngestInstructions(workspace: string): Promise<Result<void>> {
  try {
    await unlink(join(workspace, WIKI_INGEST_INSTRUCTIONS_FILENAME)).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
    return ok(undefined);
  } catch (error) {
    return err<void>(mainT("settings.ingestInstructions.resetError", { detail: errorMessage(error) }));
  }
}

/** Register after pi-okf-wiki so the generated prompt is available to inspect. */
export function registerWikiIngestInstructionsHook(
  pi: ExtensionAPI,
  workspace: string,
): void {
  pi.on("before_agent_start", async (event, context) => {
    if (!isWikiUpdateIngestPrompt(event.prompt)) return;
    const custom = await readCustomWikiIngestInstructions(workspace);
    if (!custom.success) {
      context.ui.notify(custom.error.message, "warning");
      return;
    }
    if (custom.data === null || custom.data.trim() === "") return;
    return {
      systemPrompt: appendWikiIngestInstructions(event.systemPrompt, custom.data),
    };
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
