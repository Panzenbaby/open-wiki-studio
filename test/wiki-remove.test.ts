// The app's removal boundary. These go through `src/main/wiki-remove.ts`,
// which delegates to pi-okf-wiki — so they also pin the assumption that the
// bundled extension source is importable from the main process at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({ app: { getLocale: () => "en" } }));

const { planRemoval, removeFromWiki } = await import("../src/main/wiki-remove.ts");
const { ConceptStore } = await import("../src/main/concept-store.ts");
const { getPreview, listFolder } = await import("../src/main/files.ts");

let workspace: string;

beforeEach(async () => {
  workspace = join(
    tmpdir(),
    `wiki-remove-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await writeConcept("project/foo.md", "type: note\ntitle: Foo", "# Foo");
  await writeConcept("project/bar.md", "type: note\ntitle: Bar", "See [Foo](/project/foo.md).");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeConcept(
  relativePath: string,
  frontmatter: string,
  body: string,
): Promise<void> {
  const absolute = join(workspace, "wiki", relativePath);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
}

describe("planRemoval", () => {
  it("reports the concepts and the concepts linking to them", async () => {
    const result = await planRemoval(workspace, "project/foo.md");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.conceptIds).toEqual(["project/foo"]);
    expect(result.data.incomingLinks).toEqual([
      { fromConceptId: "project/bar", toConceptId: "project/foo" },
    ]);
  });

  it("fails for a generated file instead of removing it", async () => {
    const result = await planRemoval(workspace, "index.md");
    expect(result.success).toBe(false);
  });
});

describe("removeFromWiki", () => {
  it("moves the concept to the trash and redirects the link that pointed at it", async () => {
    const result = await removeFromWiki(workspace, "project/foo.md");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.removed).toEqual([
      { conceptId: "project/foo", trashPath: "/trash/project/foo.md.orig" },
    ]);
    expect(result.data.rewrittenConcepts).toEqual(["project/bar"]);
    const bar = await readFile(join(workspace, "wiki", "project", "bar.md"), "utf8");
    expect(bar).toContain("[Foo](/trash/project/foo.md.orig)");
  });

  it("keeps trashed concepts out of the concept store", async () => {
    await removeFromWiki(workspace, "project/foo.md");
    const concepts = await new ConceptStore(workspace).listAll();

    expect(concepts.map((c) => c.conceptId)).not.toContain("project/foo");
    expect(concepts.every((c) => !c.conceptId.startsWith("trash/"))).toBe(true);
  });

  it("shows the trash in the browser tree so the file stays reachable", async () => {
    await removeFromWiki(workspace, "project/foo.md");
    const listed = await listFolder(workspace, "wiki");

    expect(listed.success).toBe(true);
    if (!listed.success) return;
    expect(listed.data.map((n) => n.relativePath)).toContain("trash/project/foo.md.orig");
  });

  it("previews a trashed concept as plain markdown, without concept metadata", async () => {
    await removeFromWiki(workspace, "project/foo.md");
    const preview = await getPreview(workspace, "wiki/trash/project/foo.md.orig");

    expect(preview.success).toBe(true);
    if (!preview.success) return;
    expect(preview.data.frontmatter).toBeUndefined();
    expect(preview.data.content).toContain("# Foo");
  });

  it("surfaces a failure as a Result instead of throwing", async () => {
    const result = await removeFromWiki(workspace, "../escape.md");

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toContain("escape.md");
  });
});
