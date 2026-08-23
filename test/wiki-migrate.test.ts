// Tests for the migration repository — it delegates the rewrite rules to
// pi-okf-wiki, so these pin the boundary: the plan names exactly the legacy
// concepts (and nothing else), and running the migration rewrites them.
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateWiki, planMigration } from "../src/main/wiki-migrate.ts";

const WORKSPACES: string[] = [];

async function workspace(
  ...files: readonly { path: string; content: string }[]
): Promise<string> {
  const dir = join(tmpdir(), `wiki-migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, "wiki"), { recursive: true });
  WORKSPACES.push(dir);
  for (const file of files) {
    const absolute = join(dir, "wiki", file.path);
    await mkdir(join(absolute, ".."), { recursive: true });
    await writeFile(absolute, file.content, "utf8");
  }
  return dir;
}

const LEGACY = [
  "---",
  "type: table",
  "title: Orders",
  "timestamp: 2024-01-05T10:00:00Z",
  "status: superseded",
  "---",
  "",
  "The orders table.",
  "",
  "# Citations",
  "",
  "* [1] [Spec v2](/archive/spec-v2.pdf)",
  "",
].join("\n");

const CURRENT = [
  "---",
  "type: table",
  "title: Customers",
  "generated:",
  "  by: pi-okf-wiki/claude-sonnet-4",
  "  at: 2026-08-23T10:00:00Z",
  "---",
  "",
  "The customers table.",
  "",
].join("\n");

afterAll(async () => {
  await Promise.all(WORKSPACES.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("planMigration", () => {
  it("names the legacy concepts and counts the current ones", async () => {
    const dir = await workspace(
      { path: "orders.md", content: LEGACY },
      { path: "customers.md", content: CURRENT },
      { path: "index.md", content: '---\nokf_version: "0.1"\n---\n\n# Wiki Index\n' },
    );

    const result = await planMigration(dir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.conceptIds).toEqual(["orders"]);
    expect(result.data.upToDate).toBe(1);
    expect(result.data.declaredVersion).toBe("0.1");
    expect(result.data.targetVersion).toBe("0.2");
  });

  it("plans nothing for an already-current wiki", async () => {
    const dir = await workspace({ path: "customers.md", content: CURRENT });

    const result = await planMigration(dir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.conceptIds).toEqual([]);
    expect(result.data.declaredVersion).toBeUndefined();
  });
});

describe("migrateWiki", () => {
  it("rewrites the legacy fields and leaves current concepts alone", async () => {
    const dir = await workspace(
      { path: "orders.md", content: LEGACY },
      { path: "customers.md", content: CURRENT },
    );

    const result = await migrateWiki(dir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.migrated).toEqual(["orders"]);
    expect(result.data.alreadyCurrent).toBe(1);

    const orders = await readFile(join(dir, "wiki", "orders.md"), "utf8");
    expect(orders).toContain("generated:");
    expect(orders).not.toContain("timestamp:");
    expect(orders).toContain("deprecated");
    expect(orders).toContain("sources:");
    expect(orders).not.toContain("# Citations");

    expect(await readFile(join(dir, "wiki", "customers.md"), "utf8")).toBe(CURRENT);
    // The migration regenerates the index, which is what declares the version.
    expect(await readFile(join(dir, "wiki", "index.md"), "utf8")).toContain('okf_version: "0.2"');
  });
});
