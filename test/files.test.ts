// Tests for addInputFiles — the recursive folder-aware copy into input/.
// Covers: single files, folder structure preservation (1A), skip-existing
// (2B), partial-failure continuation (3B), dotfile + symlink skip (4A/6A),
// and empty subtrees not being materialized (7A).
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addInputFiles, getPreview, listFolder } from "../src/main/files.ts";

async function freshWorkspace(): Promise<string> {
  return mkdir(
    join(tmpdir(), `files-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  );
}

async function writeFileRel(root: string, rel: string, content: string): Promise<void> {
  const absolute = join(root, rel);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

describe("addInputFiles", () => {
  const workspaces: string[] = [];

  async function newWorkspace(): Promise<string> {
    const workspace = await freshWorkspace();
    workspaces.push(workspace);
    return workspace;
  }

  afterAll(async () => {
    await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it("copies a single file flat into input/", async () => {
    const workspace = await newWorkspace();
    const source = join(workspace, "note.md");
    await writeFile(source, "hello", "utf8");

    const result = await addInputFiles(workspace, [source]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added).toEqual(["note.md"]);
    expect(result.data.skipped).toEqual([]);
    expect(result.data.failed).toEqual([]);
  });

  it("preserves folder structure under input/<top>/ (1A)", async () => {
    const workspace = await newWorkspace();
    const srcRoot = join(workspace, "src");
    await writeFileRel(srcRoot, "a.md", "a");
    await writeFileRel(srcRoot, "sub/b.md", "b");
    await writeFileRel(srcRoot, "sub/deep/c.md", "c");

    const result = await addInputFiles(workspace, [srcRoot]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added.sort()).toEqual([
      "src/a.md",
      "src/sub/b.md",
      "src/sub/deep/c.md",
    ]);
    expect(result.data.failed).toEqual([]);
  });

  it("skips existing destinations and continues (2B)", async () => {
    const workspace = await newWorkspace();
    const srcRoot = join(workspace, "src");
    await writeFileRel(srcRoot, "a.md", "a");
    await writeFileRel(srcRoot, "b.md", "b");
    // Pre-create a conflicting file in input/ so a.md collides.
    await writeFileRel(join(workspace, "input"), "src/a.md", "existing");

    const result = await addInputFiles(workspace, [srcRoot]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added).toEqual(["src/b.md"]);
    expect(result.data.skipped.map((entry) => entry.path)).toEqual(["src/a.md"]);
    expect(result.data.failed).toEqual([]);
  });

  it("continues past an unreadable file and reports it (3B)", async () => {
    const workspace = await newWorkspace();
    const srcRoot = join(workspace, "src");
    await writeFileRel(srcRoot, "ok.md", "ok");
    // A path that does not exist at all — stat fails, recorded as failed.
    const missing = join(workspace, "src", "ghost.md");

    const result = await addInputFiles(workspace, [srcRoot, missing]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added).toEqual(["src/ok.md"]);
    expect(result.data.failed.map((entry) => entry.path)).toEqual([missing]);
  });

  it("skips symlinks and dotfiles (4A/6A)", async () => {
    const workspace = await newWorkspace();
    const srcRoot = join(workspace, "src");
    await writeFileRel(srcRoot, "real.md", "real");
    await writeFileRel(srcRoot, ".hidden.md", "hidden");
    await symlink(join(srcRoot, "real.md"), join(srcRoot, "link.md"));

    const result = await addInputFiles(workspace, [srcRoot]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added).toEqual(["src/real.md"]);
    expect(result.data.skipped.map((entry) => entry.path)).toEqual(["src/link.md"]);
  });

  it("does not materialize empty directories (7A)", async () => {
    const workspace = await newWorkspace();
    const srcRoot = join(workspace, "src");
    // An entirely empty source folder.
    await mkdir(srcRoot, { recursive: true });

    const result = await addInputFiles(workspace, [srcRoot]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added).toEqual([]);
    expect(result.data.skipped).toEqual([]);
    expect(result.data.failed).toEqual([]);
  });

  it("skips a whole folder when a file occupies its destination dir", async () => {
    const workspace = await newWorkspace();
    const srcRoot = join(workspace, "src");
    await writeFileRel(srcRoot, "a.md", "a");
    await writeFileRel(srcRoot, "sub/b.md", "b");
    // Pre-create `input/src` as a FILE → the whole src subtree is blocked.
    await writeFileRel(join(workspace, "input"), "src", "blocker");

    const result = await addInputFiles(workspace, [srcRoot]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.added).toEqual([]);
    expect(result.data.skipped.map((entry) => entry.path)).toEqual(["src"]);
    expect(result.data.failed).toEqual([]);
  });

  it("returns a hard Result-error when input/ cannot be created", async () => {
    // Point the workspace at a path whose parent is a file so mkdir fails.
    const workspace = await freshWorkspace();
    workspaces.push(workspace);
    const blocker = join(workspace, "blocker");
    await writeFile(blocker, "x", "utf8");
    const bogus = join(blocker, "input"); // parent is a file → mkdir fails

    const result = await addInputFiles(bogus, [blocker]);

    expect(result.success).toBe(false);
    if (result.success) return;
    // Lock the i18n contract: the hard-failure message is the localized
    // "Failed to add input files: {detail}" template (en in the test env),
    // with the OS error as detail.
    expect(result.error.message).toMatch(/^Failed to add input files: /);
  });
});

// Tests for the pi-okf-wiki 0.2.0 archive layout: the OKF archive lives
// physically at `workspace/wiki/archive/` and is browsed as the `archive/`
// subdirectory of the wiki folder (the renderer's selection key is
// `wiki/archive/<rel>`). Covers listFolder (the wiki listing includes the
// archive/ subdirectory), getPreview translation (`wiki/archive/<rel>` →
// `wiki/archive/<rel>` with confinement to the archive base), `.md.orig`
// rendered as markdown (no concept metadata), and binary originals returning
// a `binary` placeholder instead of utf8 garbage.
describe("archive layout (pi-okf-wiki 0.2.0)", () => {
  const workspaces: string[] = [];

  async function newWorkspace(): Promise<string> {
    const workspace = await mkdir(
      join(tmpdir(), `files-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      { recursive: true },
    );
    workspaces.push(workspace);
    return workspace;
  }

  afterAll(async () => {
    await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  async function writeArchive(workspace: string, rel: string, content: string | Buffer): Promise<void> {
    const absolute = join(workspace, "wiki", "archive", rel);
    await mkdir(join(absolute, ".."), { recursive: true });
    if (typeof content === "string") await writeFile(absolute, content, "utf8");
    else await writeFile(absolute, content);
  }

  it("listFolder('wiki') includes the wiki/archive/ subtree", async () => {
    const workspace = await newWorkspace();
    await writeArchive(workspace, "sample/01-taxonomy.md.orig", "body");
    await writeArchive(workspace, "sample/report.pdf", Buffer.from([0x25, 0x50, 0x44, 0x46]));

    const result = await listFolder(workspace, "wiki");

    expect(result.success).toBe(true);
    if (!result.success) return;
    const paths = result.data.map((n) => n.relativePath).sort();
    // Archive files appear under the `archive/` prefix (relative to wiki/).
    expect(paths).toEqual(["archive/sample/01-taxonomy.md.orig", "archive/sample/report.pdf"]);
  });

  it("getPreview renders wiki/archive/<rel> .md.orig as markdown (no concept metadata)", async () => {
    const workspace = await newWorkspace();
    await writeArchive(workspace, "sample/01-taxonomy.md.orig", "# Title\n\narchived body");

    const result = await getPreview(workspace, "wiki/archive/sample/01-taxonomy.md.orig");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kind).toBe("markdown");
    expect(result.data.content).toBe("# Title\n\narchived body");
    // Archived originals are NOT concepts — no concept metadata chip.
    expect(result.data.frontmatter).toBeUndefined();
    // The renderer keeps the selection-key form for display.
    expect(result.data.relativePath).toBe("wiki/archive/sample/01-taxonomy.md.orig");
  });

  it("getPreview returns a binary placeholder for a non-text archive original", async () => {
    const workspace = await newWorkspace();
    // A PDF header followed by a NUL byte — trips the binary sniff.
    await writeArchive(workspace, "sample/report.pdf", Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]));

    const result = await getPreview(workspace, "wiki/archive/sample/report.pdf");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kind).toBe("binary");
    expect(result.data.content).toContain("wiki/archive/sample/report.pdf");
  });

  it("getPreview confines archive selections to wiki/archive/ (traversal blocked)", async () => {
    const workspace = await newWorkspace();
    // Place a real, readable file OUTSIDE the archive but inside the wiki
    // folder. The archive-base resolution must reject a selection that
    // escapes `wiki/archive/` via `..`.
    await mkdir(join(workspace, "wiki"), { recursive: true });
    await writeFile(join(workspace, "wiki", "secret.md"), "private", "utf8");

    // `wiki/archive/../secret.md` → stripped to `../secret.md` → resolved
    // against `wiki/archive/` → escapes the archive base → safeResolve
    // returns null.
    const result = await getPreview(workspace, "wiki/archive/../secret.md");
    expect(result.success).toBe(false);

    // Deeper traversal that would land outside the workspace is also rejected.
    const escape = await getPreview(workspace, "wiki/archive/../../etc/passwd");
    expect(escape.success).toBe(false);
  });
});

describe("ConceptStore archive exclusion (pi-okf-wiki 0.2.0)", () => {
  // Lives in files.test.ts alongside the other archive-layout tests; imports
  // ConceptStore lazily to keep the top of the file focused on addInputFiles.
  it("does not list archived .md.orig files as wiki concepts", async () => {
    const { ConceptStore } = await import("../src/main/concept-store.ts");
    const workspace = await mkdir(
      join(tmpdir(), `concept-archive-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      { recursive: true },
    );
    try {
      await mkdir(join(workspace, "wiki", "archive", "sample"), { recursive: true });
      await writeFile(join(workspace, "wiki", "real-concept.md"), "---\ntype: Note\n---\nbody", "utf8");
      await writeFile(join(workspace, "wiki", "archive", "sample", "01-taxonomy.md.orig"), "# archived", "utf8");
      // A stray .md under wiki/archive/ that does end in .md would normally be
      // picked up by endsWith(".md") — the defensive subtree skip prevents that.
      await writeFile(join(workspace, "wiki", "archive", "stray.md"), "# should be skipped", "utf8");

      const store = new ConceptStore(workspace);
      const concepts = await store.listConcepts();
      const ids = concepts.map((c) => c.conceptId).sort();
      expect(ids).toEqual(["real-concept"]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});