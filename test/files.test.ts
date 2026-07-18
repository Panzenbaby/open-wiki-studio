// Tests for addInputFiles — the recursive folder-aware copy into input/.
// Covers: single files, folder structure preservation (1A), skip-existing
// (2B), partial-failure continuation (3B), dotfile + symlink skip (4A/6A),
// and empty subtrees not being materialized (7A).
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addInputFiles } from "../src/main/files.ts";

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