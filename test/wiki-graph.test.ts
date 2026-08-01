// Tests for buildWikiGraph — focused on the archive-source nodes: concepts
// cite archived originals as `[label](/archive/<rel>)`, and those originals
// become their own graph nodes so a source is reachable from the graph.
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWikiGraph } from "../src/main/wiki-graph.ts";
import type { WikiGraph } from "../src/shared/ipc-types.ts";

const workspaces: string[] = [];

async function newWorkspace(): Promise<string> {
  const workspace = join(
    tmpdir(),
    `wiki-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(workspace, { recursive: true });
  workspaces.push(workspace);
  return workspace;
}

async function writeWikiFile(workspace: string, rel: string, content: string): Promise<void> {
  const absolute = join(workspace, "wiki", rel);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

async function build(workspace: string): Promise<WikiGraph> {
  const result = await buildWikiGraph(workspace);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

afterAll(async () => {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
});

describe("buildWikiGraph archive sources", () => {
  it("turns a cited archived original into a source node with an edge", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "notes/spec.md", "Source: [spec v2](/archive/notes/spec-v2.pdf)");
    await writeWikiFile(workspace, "archive/notes/spec-v2.pdf", "%PDF-1.4");

    const graph = await build(workspace);

    const source = graph.nodes.find((node) => node.kind === "source");
    expect(source?.id).toBe("archive/notes/spec-v2.pdf");
    expect(source?.title).toBe("spec-v2.pdf");
    expect(source?.degree).toBe(1);
    expect(graph.edges).toContainEqual({ source: "notes/spec", target: "archive/notes/spec-v2.pdf" });
  });

  it("decodes percent-encoded citations so names with spaces match the file", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "manual.md", "[manual](/archive/Owners%20Manual.pdf)");
    await writeWikiFile(workspace, "archive/Owners Manual.pdf", "%PDF-1.4");

    const graph = await build(workspace);

    expect(graph.nodes.map((node) => node.id)).toContain("archive/Owners Manual.pdf");
  });

  it("resolves angle-bracket destinations, the form used for paths with spaces", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "manual.md", "1. [ODT](</archive/Miro Export/notes.odt>)");
    await writeWikiFile(workspace, "archive/Miro Export/notes.odt", "odt");

    const graph = await build(workspace);

    expect(graph.edges).toContainEqual({
      source: "manual",
      target: "archive/Miro Export/notes.odt",
    });
  });

  it("ignores citations whose original is no longer in the archive", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "manual.md", "[gone](/archive/gone.pdf)");

    const graph = await build(workspace);

    expect(graph.nodes.every((node) => node.kind === "concept")).toBe(true);
    expect(graph.edges).toHaveLength(0);
  });

  it("does not create source nodes for uncited archive files", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "manual.md", "no citations here");
    await writeWikiFile(workspace, "archive/orphan.pdf", "%PDF-1.4");

    const graph = await build(workspace);

    expect(graph.nodes.every((node) => node.kind === "concept")).toBe(true);
  });

  it("does not turn a bare archive path in prose into an edge", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "manual.md", "The original lives at archive/notes/spec-v2.pdf.");
    await writeWikiFile(workspace, "archive/notes/spec-v2.pdf", "%PDF-1.4");

    const graph = await build(workspace);

    expect(graph.edges).toHaveLength(0);
  });

  it("keeps archived markdown originals out of the concept nodes", async () => {
    const workspace = await newWorkspace();
    await writeWikiFile(workspace, "manual.md", "[original](/archive/manual.md.orig)");
    await writeWikiFile(workspace, "archive/manual.md.orig", "# Manual");

    const graph = await build(workspace);

    expect(graph.nodes.filter((node) => node.kind === "concept").map((node) => node.id)).toEqual([
      "manual",
    ]);
    expect(graph.nodes.filter((node) => node.kind === "source").map((node) => node.id)).toEqual([
      "archive/manual.md.orig",
    ]);
  });
});
