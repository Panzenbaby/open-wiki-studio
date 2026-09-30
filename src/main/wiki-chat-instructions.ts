// Workspace-specific overrides for the fixed pi-okf-wiki /wiki-query rules.
// pi-okf-wiki 0.4.0 currently puts its fixed instructions before the dynamic
// "## Wiki tree" context in the system prompt. This isolated replacement
// boundary must be revalidated if that extension prompt layout changes.
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildQuerySystemContext } from "pi-okf-wiki/src/prompts.ts";
import { err, ok, errorMessage } from "../shared/result.ts";
import type { Result } from "../shared/ipc-types.ts";
import { mainT } from "./i18n.ts";

export const WIKI_CHAT_INSTRUCTIONS_FILENAME = ".open-wiki-studio-chat-instructions.md";

const FIXED_INSTRUCTIONS_START = "Answer the user's question using ONLY the OKF knowledge base in wiki/.";
const DYNAMIC_CONTEXT_START = "\n## Wiki tree\n";

/** The extension's built-in query rules, derived from its prompt builder so
 *  the editor and runtime default cannot drift apart. Dynamic values are empty
 *  because only the fixed section is used. */
export const BUILT_IN_WIKI_CHAT_INSTRUCTIONS: string = extractFixedInstructions(
  buildQuerySystemContext({ retrieved: [], wikiTree: "", indexMd: null }),
);

/** Replace only the fixed /wiki-query rules, retaining base prompt material
 *  and all dynamically retrieved wiki context verbatim. Returns the original
 *  prompt when the expected extension layout is absent. */
export function replaceWikiChatInstructions(
  systemPrompt: string,
  instructions: string,
): string {
  if (instructions.trim() === "") return systemPrompt;
  const fixedStart = systemPrompt.indexOf(FIXED_INSTRUCTIONS_START);
  if (fixedStart < 0) return systemPrompt;
  const dynamicStart = systemPrompt.indexOf(DYNAMIC_CONTEXT_START, fixedStart);
  if (dynamicStart < 0) return systemPrompt;
  return `${systemPrompt.slice(0, fixedStart)}${instructions.trimEnd()}${systemPrompt.slice(dynamicStart)}`;
}

function extractFixedInstructions(systemPrompt: string): string {
  const start = systemPrompt.indexOf(FIXED_INSTRUCTIONS_START);
  const dynamicStart = systemPrompt.indexOf(DYNAMIC_CONTEXT_START, start);
  if (start < 0 || dynamicStart < 0) {
    throw new Error("pi-okf-wiki query prompt layout changed");
  }
  return systemPrompt.slice(start, dynamicStart).trimEnd();
}

/** Return null when no custom file exists. Reading does not create workspace
 *  content, which keeps workspace activation side-effect free. */
export async function readCustomWikiChatInstructions(
  workspace: string,
): Promise<Result<string | null>> {
  try {
    return ok(await readFile(join(workspace, WIKI_CHAT_INSTRUCTIONS_FILENAME), "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return ok(null);
    return err<string | null>(mainT("settings.chatInstructions.readError", { detail: errorMessage(error) }));
  }
}

/** Save non-empty custom rules, or remove the custom file for empty content. */
export async function saveWikiChatInstructions(
  workspace: string,
  instructions: string,
): Promise<Result<void>> {
  const path = join(workspace, WIKI_CHAT_INSTRUCTIONS_FILENAME);
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
    return err<void>(mainT("settings.chatInstructions.saveError", { detail: errorMessage(error) }));
  }
}

/** Reset to the extension defaults by removing the workspace override. */
export async function resetWikiChatInstructions(workspace: string): Promise<Result<void>> {
  try {
    await unlink(join(workspace, WIKI_CHAT_INSTRUCTIONS_FILENAME)).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error;
    });
    return ok(undefined);
  } catch (error) {
    return err<void>(mainT("settings.chatInstructions.resetError", { detail: errorMessage(error) }));
  }
}

/** Register after the wiki extension: Pi processes extension factories after
 *  file-based extensions, so this hook sees the wiki context already appended
 *  by pi-okf-wiki and can replace only its fixed instruction section. */
export function registerWikiChatInstructionsHook(
  pi: ExtensionAPI,
  workspace: string,
): void {
  pi.on("before_agent_start", async (event, context) => {
    if (!event.systemPrompt.includes(DYNAMIC_CONTEXT_START)) return;
    const custom = await readCustomWikiChatInstructions(workspace);
    if (!custom.success) {
      context.ui.notify(custom.error.message, "warning");
      return;
    }
    if (custom.data === null || custom.data.trim() === "") return;
    return {
      systemPrompt: replaceWikiChatInstructions(event.systemPrompt, custom.data),
    };
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
