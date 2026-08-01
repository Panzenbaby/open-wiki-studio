// Tests for the pure core of the workspace merge: collision resolution,
// link rewriting, index regeneration, and log interleaving. One end-to-end
// case covers the filesystem wiring.
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveRenames,
  conceptRenames,
  generateIndexMd,
  mergeLogs,
  mergeWorkspaces,
  planPlacements,
  rewriteConceptContent,
  rewriteLinks,
  uniqueSourceNames,
  type FileEntry,
} from "../src/main/workspace-merge.ts";

function files(...entries: readonly [string, string][]): readonly FileEntry[] {
  return entries.map(([relativePath, hash]) => ({ relativePath, hash }));
}

describe("planPlacements", () => {
  it("keeps a path that only one source has", () => {
    const plans = planPlacements([
      { name: "a", files: files(["one.md", "h1"]) },
      { name: "b", files: files(["two.md", "h2"]) },
    ]);
    expect(plans[0]).toEqual([{ relativePath: "one.md", target: "one.md", copy: true }]);
    expect(plans[1]).toEqual([{ relativePath: "two.md", target: "two.md", copy: true }]);
  });

  it("deduplicates byte-identical collisions to a single copy", () => {
    const plans = planPlacements([
      { name: "a", files: files(["same.md", "h"]) },
      { name: "b", files: files(["same.md", "h"]) },
    ]);
    expect(plans[0]).toEqual([{ relativePath: "same.md", target: "same.md", copy: true }]);
    expect(plans[1]).toEqual([{ relativePath: "same.md", target: "same.md", copy: false }]);
  });

  it("prefixes every side of a differing collision, symmetrically", () => {
    const plans = planPlacements([
      { name: "a", files: files(["x.md", "h1"]) },
      { name: "b", files: files(["x.md", "h2"]) },
    ]);
    expect(plans[0]![0]!.target).toBe("a/x.md");
    expect(plans[1]![0]!.target).toBe("b/x.md");
  });

  it("prefixes all sources when only some of them are identical", () => {
    const plans = planPlacements([
      { name: "a", files: files(["x.md", "h1"]) },
      { name: "b", files: files(["x.md", "h1"]) },
      { name: "c", files: files(["x.md", "h2"]) },
    ]);
    expect(plans.map((p) => p[0]!.target)).toEqual(["a/x.md", "b/x.md", "c/x.md"]);
  });

  it("suffixes a prefixed target that a real path already claims", () => {
    const plans = planPlacements([
      { name: "a", files: files(["x.md", "h1"]) },
      { name: "b", files: files(["x.md", "h2"], ["a/x.md", "h3"]) },
    ]);
    // b really has a concept at `a/x.md`, so the prefixed collision target of
    // source `a` has to step aside.
    expect(plans[0]![0]!.target).toBe("a/x-2.md");
    expect(plans[1]!.map((p) => p.target).sort()).toEqual(["a/x.md", "b/x.md"]);
  });
});

describe("uniqueSourceNames", () => {
  it("disambiguates equal folder names", () => {
    expect(uniqueSourceNames(["wiki", "notes", "wiki", "wiki"])).toEqual([
      "wiki",
      "notes",
      "wiki-2",
      "wiki-3",
    ]);
  });
});

describe("renames", () => {
  it("maps moved concepts by conceptId and ignores untouched ones", () => {
    const renames = conceptRenames([
      { relativePath: "x.md", target: "a/x.md", copy: true },
      { relativePath: "y.md", target: "y.md", copy: true },
    ]);
    expect([...renames]).toEqual([["x", "a/x"]]);
  });

  it("maps moved archive originals by path", () => {
    const renames = archiveRenames([
      { relativePath: "notes/spec.pdf", target: "a/notes/spec.pdf", copy: true },
      { relativePath: "keep.pdf", target: "keep.pdf", copy: true },
    ]);
    expect([...renames]).toEqual([["notes/spec.pdf", "a/notes/spec.pdf"]]);
  });
});

describe("rewriteLinks", () => {
  const concepts = new Map([["foo/bar", "a/foo/bar"]]);
  const archive = new Map([["notes/spec v2.pdf", "a/notes/spec v2.pdf"]]);

  it("rewrites all four concept reference forms", () => {
    const text = [
      "[x](foo/bar.md)",
      "[x](/foo/bar.md)",
      "[x](wiki/foo/bar.md)",
      "see foo/bar.md for details",
    ].join("\n");
    expect(rewriteLinks(text, concepts, archive)).toBe(
      [
        "[x](a/foo/bar.md)",
        "[x](/a/foo/bar.md)",
        "[x](wiki/a/foo/bar.md)",
        "see a/foo/bar.md for details",
      ].join("\n"),
    );
  });

  it("keeps anchors and angle brackets", () => {
    expect(rewriteLinks("[x](foo/bar.md#intro)", concepts, archive)).toBe(
      "[x](a/foo/bar.md#intro)",
    );
    expect(rewriteLinks("[x](</archive/notes/spec v2.pdf>)", concepts, archive)).toBe(
      "[x](</archive/a/notes/spec v2.pdf>)",
    );
  });

  it("leaves untouched refs, external URLs, and unknown archive paths alone", () => {
    const text = "[a](other.md) [b](https://example.org/foo/bar.md) [c](/archive/keep.pdf)";
    expect(rewriteLinks(text, concepts, archive)).toBe(text);
  });
});

describe("rewriteConceptContent", () => {
  it("rewrites the body but copies the frontmatter verbatim", () => {
    const content = [
      "---",
      "type: note",
      "resource: foo/bar.md",
      "---",
      "",
      "Links to [bar](foo/bar.md).",
      "",
    ].join("\n");
    const result = rewriteConceptContent(content, new Map([["foo/bar", "a/foo/bar"]]), new Map());
    expect(result).toContain("resource: foo/bar.md");
    expect(result).toContain("[bar](a/foo/bar.md)");
  });
});

describe("generateIndexMd", () => {
  it("groups by directory and falls back to the conceptId as title", () => {
    const index = generateIndexMd([
      { conceptId: "b", title: "B", description: "second" },
      { conceptId: "sub/a" },
    ]);
    expect(index).toBe(
      ["# Wiki Index", "", "## (root)", "", "* [B](b.md) - second", "", "## sub", "", "* [sub/a](sub/a.md)", ""].join(
        "\n",
      ),
    );
  });
});

describe("mergeLogs", () => {
  it("interleaves entries newest first and rewrites renamed links", () => {
    const merged = mergeLogs(
      [
        {
          content: "# Wiki Update Log\n\n## 2026-03-01\n\n* **Creation**: Added [x](/x.md).\n",
          concepts: new Map([["x", "a/x"]]),
          archive: new Map(),
        },
        {
          content: "# Wiki Update Log\n\n## 2026-05-01\n\n* **Creation**: Added [y](/y.md).\n",
          concepts: new Map(),
          archive: new Map(),
        },
      ],
      "## 2026-08-01\n\n* **Merge**: done.\n",
    );
    expect(merged.startsWith("# Wiki Update Log\n\n## 2026-08-01")).toBe(true);
    expect(merged.indexOf("2026-05-01")).toBeLessThan(merged.indexOf("2026-03-01"));
    expect(merged).toContain("Added [x](/a/x.md).");
  });
});

describe("mergeWorkspaces", () => {
  const roots: string[] = [];

  async function workspace(name: string, concepts: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `merge-${name}-`));
    roots.push(root);
    await mkdir(join(root, "wiki"), { recursive: true });
    await mkdir(join(root, "input"), { recursive: true });
    for (const [path, content] of Object.entries(concepts)) {
      const absolute = join(root, "wiki", path);
      await mkdir(join(absolute, ".."), { recursive: true });
      await writeFile(absolute, content, "utf8");
    }
    return root;
  }

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  it("copies both wikis, resolves the collision, and regenerates index.md", async () => {
    const a = await workspace("a", {
      "shared.md": "---\ntitle: A shared\n---\n\nA body\n",
      "only-a.md": "---\ntitle: Only A\n---\n\nSee [shared](shared.md).\n",
    });
    const b = await workspace("b", { "shared.md": "---\ntitle: B shared\n---\n\nB body\n" });
    const target = await mkdtemp(join(tmpdir(), "merge-target-"));
    roots.push(target);

    const result = await mergeWorkspaces([a, b], target);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.concepts).toBe(3);
    expect(result.data.renamed).toBe(2);

    const aName = a.split("/").pop()!;
    const link = await readFile(join(target, "wiki", "only-a.md"), "utf8");
    expect(link).toContain(`[shared](${aName}/shared.md)`);
    const index = await readFile(join(target, "wiki", "index.md"), "utf8");
    expect(index).toContain("A shared");
    expect(index).toContain("B shared");
  });

  it("refuses a non-empty destination", async () => {
    const a = await workspace("v1", { "x.md": "x" });
    const b = await workspace("v2", { "y.md": "y" });
    const result = await mergeWorkspaces([a, b], a);
    expect(result.success).toBe(false);
  });
});
