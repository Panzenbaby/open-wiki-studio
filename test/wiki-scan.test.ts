import { afterAll, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffSnapshots, markChangedConceptsUnverified, snapshotWiki } from "../src/main/wiki-scan.ts";

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdir(
    join(tmpdir(), `wiki-scan-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  );
  workspaces.push(path);
  await mkdir(join(path, "wiki"), { recursive: true });
  return path;
}

afterAll(async () => {
  await Promise.all(workspaces.map((path) => rm(path, { recursive: true, force: true })));
});

describe("wiki snapshots", () => {
  it("diffs body and descriptive metadata changes, but ignores status and formatting", async () => {
    const path = await workspace();
    const conceptPath = join(path, "wiki", "note.md");
    await writeFile(conceptPath, "---\ntype: Note\ntitle: Note\ndescription: Details\ntags: [a, b]\nverified: true\n---\n\nBody.\n", "utf8");
    const before = await snapshotWiki(path);

    await writeFile(conceptPath, "---\r\ntype: Note\r\ntitle: Note\r\ndescription: Details\r\ntags: [a, b]\r\nverified: false\r\n---\r\n\r\nBody.\r\n\r\n", "utf8");
    const formattingOnly = await snapshotWiki(path);
    expect(diffSnapshots(before, formattingOnly).updated).toEqual([]);

    await writeFile(conceptPath, "---\ntype: Note\ntitle: Note\ndescription: Changed\ntags: [a, b]\nverified: false\n---\n\nBody.\n", "utf8");
    const descriptionChanged = await snapshotWiki(path);
    expect(diffSnapshots(before, descriptionChanged).updated).toEqual(["note"]);
  });

  it("marks app-observed new and updated concepts unverified", async () => {
    const path = await workspace();
    const before = await snapshotWiki(path);
    await writeFile(join(path, "wiki", "note.md"), "---\ntype: Note\nverified: true\n---\nBody.\n", "utf8");
    const after = await snapshotWiki(path);

    await markChangedConceptsUnverified(path, before, after);

    const content = await readFile(join(path, "wiki", "note.md"), "utf8");
    expect(content).toContain("verified: false");
    expect(content).toContain("Body.\n");
    const afterVerification = await snapshotWiki(path);
    expect(diffSnapshots(before, afterVerification).created).toEqual(["note"]);

    await writeFile(join(path, "wiki", "note.md"), content.replace("verified: false", "verified: true"), "utf8");
    const verifiedSnapshot = await snapshotWiki(path);
    expect(diffSnapshots(afterVerification, verifiedSnapshot).updated).toEqual([]);
    await writeFile(join(path, "wiki", "note.md"), content.replace("Body.", "Updated body."), "utf8");
    const updatedSnapshot = await snapshotWiki(path);
    expect(diffSnapshots(verifiedSnapshot, updatedSnapshot).updated).toEqual(["note"]);
    await markChangedConceptsUnverified(path, verifiedSnapshot, updatedSnapshot);
    expect(await readFile(join(path, "wiki", "note.md"), "utf8")).toContain("verified: false");
  });
});
