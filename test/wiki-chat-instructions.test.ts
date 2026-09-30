import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILT_IN_WIKI_CHAT_INSTRUCTIONS,
  WIKI_CHAT_INSTRUCTIONS_FILENAME,
  readCustomWikiChatInstructions,
  replaceWikiChatInstructions,
  resetWikiChatInstructions,
  saveWikiChatInstructions,
} from "../src/main/wiki-chat-instructions.ts";

const workspaces: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "wiki-instructions-"));
  workspaces.push(workspace);
  return workspace;
}

afterAll(async () => {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
});

describe("wiki chat instruction prompt replacement", () => {
  const dynamicContext = [
    "## Wiki tree",
    "topic/example.md",
    "",
    "## index.md",
    "Current wiki index",
    "",
    "## Retrieved concepts (most relevant)",
    "--- Concept: topic/example ---",
    "Retrieved concept content",
  ].join("\n");
  const basePrompt = "Application base prompt\n\n";
  const defaultPrompt = `${basePrompt}${BUILT_IN_WIKI_CHAT_INSTRUCTIONS}\n${dynamicContext}`;

  it("keeps the extension's built-in rules and dynamic wiki context unchanged without an override", () => {
    expect(replaceWikiChatInstructions(defaultPrompt, "  ")).toBe(defaultPrompt);
    expect(BUILT_IN_WIKI_CHAT_INSTRUCTIONS).toContain("Cite every claim with a source");
    expect(BUILT_IN_WIKI_CHAT_INSTRUCTIONS).toContain("Removed knowledge (IMPORTANT)");
  });

  it("substitutes fixed rules while preserving dynamic wiki context verbatim", () => {
    const custom = "Answer in short paragraphs.\nAvoid jargon.";
    const composed = replaceWikiChatInstructions(defaultPrompt, custom);
    expect(composed).toBe(`${basePrompt}${custom}\n${dynamicContext}`);
    expect(composed).toContain("Current wiki index");
    expect(composed).toContain("Retrieved concept content");
  });

  it("leaves an unknown extension prompt layout untouched", () => {
    expect(replaceWikiChatInstructions("Other system prompt", "Custom rule")).toBe("Other system prompt");
  });
});

describe("workspace instruction persistence", () => {
  it("does not create a file on read and persists only in the selected workspace", async () => {
    const workspace = await createWorkspace();
    const otherWorkspace = await createWorkspace();
    const absent = await readCustomWikiChatInstructions(workspace);
    expect(absent).toEqual({ success: true, data: null });
    await expect(stat(join(workspace, WIKI_CHAT_INSTRUCTIONS_FILENAME))).rejects.toMatchObject({ code: "ENOENT" });

    const saved = await saveWikiChatInstructions(workspace, "Use concise answers.\n");
    expect(saved.success).toBe(true);
    expect(await readFile(join(workspace, WIKI_CHAT_INSTRUCTIONS_FILENAME), "utf8")).toBe("Use concise answers.\n");
    expect(await readCustomWikiChatInstructions(otherWorkspace)).toEqual({ success: true, data: null });
  });

  it("removes the file when saving empty content or resetting", async () => {
    const workspace = await createWorkspace();
    const path = join(workspace, WIKI_CHAT_INSTRUCTIONS_FILENAME);
    await writeFile(path, "custom", "utf8");
    expect((await saveWikiChatInstructions(workspace, "  \n")).success).toBe(true);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(path, "custom", "utf8");
    expect((await resetWikiChatInstructions(workspace)).success).toBe(true);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await resetWikiChatInstructions(workspace)).success).toBe(true);
  });
});
