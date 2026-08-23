// The localStorage mirror is what makes the first frame correct: the atoms are
// seeded from it synchronously, so the "system" placeholder default never
// reaches `data-theme` or overwrites the mirror while IPC is still in flight.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";

const storage = new Map<string, string>();

const fakeLocalStorage = {
  getItem: (key: string): string | null => storage.get(key) ?? null,
  setItem: (key: string, value: string): void => void storage.set(key, value),
  removeItem: (key: string): void => void storage.delete(key),
  clear: (): void => storage.clear(),
  key: (): string | null => null,
  length: 0,
};

const globals = globalThis as unknown as {
  localStorage: typeof fakeLocalStorage;
  window: { api: unknown; matchMedia: () => { matches: boolean } };
};

globals.localStorage = fakeLocalStorage;
// A dark OS: matchMedia reports prefers-color-scheme: dark. Node's own
// `navigator.language` is en-US, which stands in for an English OS.
globals.window = { api: {}, matchMedia: () => ({ matches: true }) };

function storeAppearance(value: unknown): void {
  storage.set("okf:appearance", JSON.stringify(value));
}

describe("readCachedAppearance", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it("returns the mirrored preferences", async () => {
    storeAppearance({ theme: "light", locale: "de" });
    const { readCachedAppearance } = await import("../src/renderer/appearance-cache.ts");
    expect(readCachedAppearance()).toEqual({ theme: "light", locale: "de" });
  });

  it("falls back to system for an empty or corrupt mirror", async () => {
    const { readCachedAppearance } = await import("../src/renderer/appearance-cache.ts");
    expect(readCachedAppearance()).toEqual({ theme: "system", locale: "system" });
    storage.set("okf:appearance", "{not json");
    expect(readCachedAppearance()).toEqual({ theme: "system", locale: "system" });
    storeAppearance({ theme: "neon", locale: "de" });
    expect(readCachedAppearance()).toEqual({ theme: "system", locale: "de" });
  });

  it("round-trips through writeCachedAppearance", async () => {
    const { readCachedAppearance, writeCachedAppearance } = await import(
      "../src/renderer/appearance-cache.ts"
    );
    writeCachedAppearance({ theme: "dark", locale: "en" });
    expect(readCachedAppearance()).toEqual({ theme: "dark", locale: "en" });
  });
});

describe("atom seeding", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it("seeds both preferences from the mirror, not from the system default", async () => {
    // Without the seed, the first frame would render dark/en (the system
    // values) instead of the stored choice.
    storeAppearance({ theme: "light", locale: "de" });
    const { themePreferenceAtom, effectiveThemeAtom } = await import(
      "../src/renderer/appearance.ts"
    );
    const { localePreferenceAtom, localeAtom } = await import("../src/renderer/i18n.ts");
    const store = createStore();

    expect(store.get(themePreferenceAtom)).toBe("light");
    expect(store.get(effectiveThemeAtom)).toBe("light");
    expect(store.get(localePreferenceAtom)).toBe("de");
    expect(store.get(localeAtom)).toBe("de");
  });

  it("falls back to the system values when nothing is mirrored", async () => {
    const { effectiveThemeAtom } = await import("../src/renderer/appearance.ts");
    const { localeAtom } = await import("../src/renderer/i18n.ts");
    const store = createStore();

    expect(store.get(effectiveThemeAtom)).toBe("dark");
    expect(store.get(localeAtom)).toBe("en");
  });
});
