import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildUpdatePrompt } from "pi-okf-wiki/src/prompts.ts";
import {
  appendWikiIngestInstructions,
  isWikiUpdateIngestPrompt,
  readCustomWikiIngestInstructions,
  registerWikiIngestInstructionsHook,
  resetWikiIngestInstructions,
  saveWikiIngestInstructions,
  WIKI_INGEST_INSTRUCTIONS_FILENAME,
  WIKI_UPDATE_PROMPT_SIGNATURE,
} from "../src/main/wiki-ingest-instructions.ts";

const workspaces: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "wiki-ingest-instructions-"));
  workspaces.push(workspace);
  return workspace;
}

afterAll(async () => {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
});

describe("workspace ingest instruction persistence", () => {
  it("starts empty and persists only in its workspace", async () => {
    const workspace = await createWorkspace();
    const otherWorkspace = await createWorkspace();
    expect(await readCustomWikiIngestInstructions(workspace)).toEqual({ success: true, data: null });
    await expect(stat(join(workspace, WIKI_INGEST_INSTRUCTIONS_FILENAME)))
      .rejects.toMatchObject({ code: "ENOENT" });

    expect(await saveWikiIngestInstructions(workspace, "Prefer concise concept descriptions."))
      .toEqual({ success: true, data: undefined });
    expect(await readFile(join(workspace, WIKI_INGEST_INSTRUCTIONS_FILENAME), "utf8"))
      .toBe("Prefer concise concept descriptions.");
    expect(await readCustomWikiIngestInstructions(otherWorkspace))
      .toEqual({ success: true, data: null });
  });

  it("reset removes only the custom file and leaves built-in instructions intact", async () => {
    const workspace = await createWorkspace();
    const path = join(workspace, WIKI_INGEST_INSTRUCTIONS_FILENAME);
    const input = {
      inputFiles: [],
      archiveDir: "/workspace/wiki/archive",
      wikiDir: "/workspace/wiki",
      structure: { directories: [], types: [], conceptIds: [] },
    };
    const builtInPromptBeforeReset = buildUpdatePrompt(input);
    await writeFile(path, "custom", "utf8");
    expect(await resetWikiIngestInstructions(workspace)).toEqual({ success: true, data: undefined });
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readCustomWikiIngestInstructions(workspace)).toEqual({ success: true, data: null });
    expect(buildUpdatePrompt(input)).toBe(builtInPromptBeforeReset);
    expect(builtInPromptBeforeReset).toContain("OKF (Open Knowledge Format, v0.2) rules");
    expect(await resetWikiIngestInstructions(workspace)).toEqual({ success: true, data: undefined });
  });
});

describe("wiki-update prompt recognition and hook", () => {
  it("recognizes the generated ingest prompt and rejects unrelated prompts", () => {
    const generatedPrompt = buildUpdatePrompt({
      inputFiles: [{ relativePath: "notes.txt", absolutePath: "/workspace/input/notes.txt", archiveTarget: "/workspace/wiki/archive/notes.txt" }],
      archiveDir: "/workspace/wiki/archive",
      wikiDir: "/workspace/wiki",
      structure: { directories: [], types: [], conceptIds: [] },
    });
    expect(isWikiUpdateIngestPrompt(generatedPrompt)).toBe(true);
    expect(isWikiUpdateIngestPrompt(`${WIKI_UPDATE_PROMPT_SIGNATURE}\nSteps...`)).toBe(true);
    expect(isWikiUpdateIngestPrompt(`  ${WIKI_UPDATE_PROMPT_SIGNATURE}\nSteps...`)).toBe(true);
    expect(isWikiUpdateIngestPrompt("/wiki-update")).toBe(false);
    expect(isWikiUpdateIngestPrompt("You are answering a question about the wiki.")).toBe(false);
  });

  it("appends supplemental rules only for ingest prompts and preserves built-in rules", async () => {
    const workspace = await createWorkspace();
    await saveWikiIngestInstructions(workspace, "Use short descriptions.");
    const handlers: Array<(
      event: BeforeAgentStartEvent,
      context: ExtensionContext,
    ) => Promise<{ systemPrompt: string } | undefined>> = [];
    const fakePi = {
      on: (_name: "before_agent_start", handler: (event: BeforeAgentStartEvent, context: ExtensionContext) => Promise<{ systemPrompt: string } | undefined>) => {
        handlers.push(handler);
      },
    } as unknown as ExtensionAPI;
    registerWikiIngestInstructionsHook(fakePi, workspace);

    const runHook = async (prompt: string): Promise<{ systemPrompt: string } | undefined> => {
      const event = {
        type: "before_agent_start",
        prompt,
        systemPrompt: "Built-in system prompt with OKF rules",
        systemPromptOptions: {},
      } as unknown as BeforeAgentStartEvent;
      const context = { ui: { notify: () => {} } } as unknown as ExtensionContext;
      const handler = handlers[0];
      if (!handler) throw new Error("Ingest prompt hook was not registered");
      return handler(event, context);
    };

    const ingest = await runHook(`${WIKI_UPDATE_PROMPT_SIGNATURE}\nBuilt-in ingest steps`);
    expect(ingest?.systemPrompt).toContain("Built-in system prompt with OKF rules");
    expect(ingest?.systemPrompt).toContain("Use short descriptions.");
    expect(ingest?.systemPrompt).toContain("always take precedence");
    expect(ingest?.systemPrompt).toContain("verified: false");
    await expect(runHook("A regular chat prompt")).resolves.toBeUndefined();
  });

  it("does not alter the prompt when the saved instructions are empty", () => {
    const systemPrompt = "The existing built-in prompt.";
    expect(appendWikiIngestInstructions(systemPrompt, "  ")).toBe(systemPrompt);
  });
});
