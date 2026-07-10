// First tests for ConceptStore — the deepened module whose interface is the
// test surface for everything concept-shaped. These exercise the interface
// directly against a temp wiki/ tree: listConcepts excludes reserved,
// listAll includes index/log, readConcept parses frontmatter + derives the
// conceptId, normalizeRef strips wiki/ + .md and rejects external refs.
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConceptStore } from "../src/main/concept-store.ts";

async function freshWorkspace(): Promise<string> {
  return mkdir(
    join(tmpdir(), `concept-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  );
}

async function writeWiki(
  workspace: string,
  ...files: readonly { path: string; content: string }[]
): Promise<void> {
  await mkdir(join(workspace, "wiki"), { recursive: true });
  for (const file of files) {
    const absolute = join(workspace, "wiki", file.path);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, file.content, "utf8");
  }
}

const WORKSPACES: string[] = [];
async function workspace(): Promise<string> {
  const dir = await freshWorkspace();
  WORKSPACES.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(WORKSPACES.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ConceptStore.listConcepts / listAll", () => {
  it("listConcepts excludes reserved files; listAll includes them with kind", async () => {
    const dir = await workspace();
    await writeWiki(
      dir,
      { path: "foo/bar.md", content: "---\ntype: Table\ntitle: My Table\n---\nbody text" },
      { path: "baz.md", content: "# no frontmatter" },
      { path: "index.md", content: "# Wiki Index" },
      { path: "log.md", content: "# Wiki Update Log" },
      { path: "sub/index.md", content: "# nested index" },
    );

    const store = new ConceptStore(dir);
    const concepts = await store.listConcepts();
    const all = await store.listAll();

    expect(concepts.map((c) => c.conceptId).sort()).toEqual(["baz", "foo/bar"]);
    expect(concepts.every((c) => c.kind === "concept")).toBe(true);

    const byId = new Map(all.map((c) => [c.conceptId, c]));
    expect(byId.get("index")?.kind).toBe("index");
    expect(byId.get("log")?.kind).toBe("log");
    // basename-based reserved: nested index.md is kind "index" too, so
    // listConcepts excludes it (matches wiki-scan's RESERVED semantics).
    expect(byId.get("sub/index")?.kind).toBe("index");
    expect(concepts.find((c) => c.conceptId === "sub/index")).toBeUndefined();
  });

  it("returns empty when wiki/ does not exist", async () => {
    const store = new ConceptStore(await workspace());
    expect(await store.listConcepts()).toEqual([]);
    expect(await store.listAll()).toEqual([]);
  });

  it("parses frontmatter into title/type/description/tags and strips body", async () => {
    const dir = await workspace();
    await writeWiki(dir, {
      path: "foo/bar.md",
      content: "---\ntype: Table\ntitle: My Table\ndescription: A table\ntags: [a, b]\n---\nthe body\n",
    });
    const store = new ConceptStore(dir);
    const [concept] = await store.listConcepts();
    expect(concept).toMatchObject({
      conceptId: "foo/bar",
      kind: "concept",
      title: "My Table",
      type: "Table",
      description: "A table",
      tags: ["a", "b"],
      frontmatterType: "Table",
    });
    expect(concept.body).toBe("the body\n");
  });

  it("falls back title -> type -> conceptId and type -> untyped label", async () => {
    const dir = await workspace();
    await writeWiki(dir, { path: "no_meta.md", content: "just body" });
    const store = new ConceptStore(dir);
    const [concept] = await store.listConcepts();
    expect(concept.title).toBe("no_meta"); // conceptId fallback
    expect(concept.type).toBe("(untyped)"); // mainT("concept.untyped") under en
    expect(concept.frontmatterType).toBeUndefined();
  });
});

describe("ConceptStore.readConcept", () => {
  it("reads a wiki concept by workspace-relative path with wiki/ prefix", async () => {
    const dir = await workspace();
    await writeWiki(dir, { path: "foo/bar.md", content: "---\ntype: Table\n---\nbody" });
    const store = new ConceptStore(dir);
    const concept = await store.readConcept("wiki/foo/bar.md");
    expect(concept?.conceptId).toBe("foo/bar");
    expect(concept?.type).toBe("Table");
    expect(concept?.body).toBe("body");
  });

  it("returns null for a non-wiki path", async () => {
    const dir = await workspace();
    await writeWiki(dir, { path: "foo.md", content: "x" });
    const store = new ConceptStore(dir);
    expect(await store.readConcept("input/foo.md")).toBeNull();
  });

  it("returns null for a non-markdown file", async () => {
    const dir = await workspace();
    await writeWiki(dir, { path: "foo.md", content: "x" });
    const store = new ConceptStore(dir);
    expect(await store.readConcept("wiki/foo.txt")).toBeNull();
  });

  it("returns null for a traversal attempt", async () => {
    const store = new ConceptStore(await workspace());
    expect(await store.readConcept("wiki/../../etc/passwd.md")).toBeNull();
  });
});

describe("ConceptStore.normalizeRef", () => {
  const store = new ConceptStore("/unused");

  it("strips wiki/ prefix and .md suffix", () => {
    expect(store.normalizeRef("wiki/foo/bar.md")).toBe("foo/bar");
    expect(store.normalizeRef("foo/bar.md")).toBe("foo/bar");
    expect(store.normalizeRef("/foo/bar.md")).toBe("foo/bar");
  });

  it("rejects external and non-markdown refs", () => {
    expect(store.normalizeRef("https://example.com/foo.md")).toBeNull();
    expect(store.normalizeRef("mailto:a@b.com")).toBeNull();
    expect(store.normalizeRef("foo/bar.txt")).toBeNull();
    expect(store.normalizeRef("foo/bar")).toBeNull();
  });

  it("drops anchors and query strings", () => {
    expect(store.normalizeRef("foo/bar.md#section")).toBe("foo/bar");
    expect(store.normalizeRef("foo/bar.md?v=1")).toBe("foo/bar");
  });
});