// Tests for the appearance persistence in src/main/config.ts: defaults,
// round-trip through config.json, repair of corrupt values, and that saving
// appearance leaves the rest of the config intact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const electronState = vi.hoisted(() => ({ userDataDir: "/tmp" }));

vi.mock("electron", () => {
  const electron = {
    app: {
      getLocale: () => "en",
      getPath: () => electronState.userDataDir,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (plain: string) => Buffer.from(plain, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8"),
    },
  };
  return { default: electron, ...electron };
});

type ConfigModule = typeof import("../src/main/config.ts");

async function loadConfigModule(): Promise<ConfigModule> {
  vi.resetModules();
  return import("../src/main/config.ts");
}

function configPath(): string {
  return join(electronState.userDataDir, "config.json");
}

interface RawConfigFile {
  readonly appearance?: { readonly theme?: string; readonly locale?: string };
  readonly lastWorkspace?: string;
  readonly llm?: { readonly provider?: string };
}

async function readRawConfig(): Promise<RawConfigFile> {
  return JSON.parse(await readFile(configPath(), "utf8")) as RawConfigFile;
}

describe("appearance config", () => {
  beforeEach(async () => {
    electronState.userDataDir = await mkdtemp(join(tmpdir(), "okf-appearance-"));
  });

  afterEach(async () => {
    await rm(electronState.userDataDir, { recursive: true, force: true });
  });

  it("defaults to system/system when nothing is stored", async () => {
    const config = await loadConfigModule();
    expect(await config.getAppearance()).toEqual({ theme: "system", locale: "system" });
  });

  it("round-trips an explicit choice through config.json", async () => {
    const config = await loadConfigModule();
    const saved = await config.setAppearance({ theme: "light", locale: "de" });
    expect(saved.success).toBe(true);
    expect((await readRawConfig()).appearance).toEqual({ theme: "light", locale: "de" });
    expect(await config.getAppearance()).toEqual({ theme: "light", locale: "de" });
  });

  it("repairs corrupt stored values instead of failing", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({ recentWorkspaces: [], appearance: { theme: "neon", locale: "de" } }),
      "utf8",
    );
    const config = await loadConfigModule();
    expect(await config.getAppearance()).toEqual({ theme: "system", locale: "de" });
  });

  it("keeps the rest of the config when saving appearance", async () => {
    await writeFile(
      configPath(),
      JSON.stringify({
        recentWorkspaces: [],
        lastWorkspace: "/tmp/workspace",
        llm: { provider: "anthropic", modelId: "m" },
      }),
      "utf8",
    );
    const config = await loadConfigModule();
    await config.setAppearance({ theme: "dark", locale: "en" });
    const raw = await readRawConfig();
    expect(raw.lastWorkspace).toBe("/tmp/workspace");
    expect(raw.llm?.provider).toBe("anthropic");
  });

  it("keeps appearance when the recent-workspace list changes", async () => {
    const config = await loadConfigModule();
    await config.setAppearance({ theme: "dark", locale: "de" });
    await config.rememberWorkspace(join(electronState.userDataDir, "workspace"));
    await config.forgetWorkspace(join(electronState.userDataDir, "workspace"));
    expect(await config.getAppearance()).toEqual({ theme: "dark", locale: "de" });
  });
});
