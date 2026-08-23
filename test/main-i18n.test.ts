// The main process must speak the same language as the renderer: an explicit
// locale preference wins over app.getLocale(), "system" falls back to it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ locale: "en-US" }));

vi.mock("electron", () => {
  const electron = { app: { getLocale: () => electronState.locale, getPath: () => "/tmp" } };
  return { default: electron, ...electron };
});

type MainI18nModule = typeof import("../src/main/i18n.ts");

async function loadMainI18n(): Promise<MainI18nModule> {
  vi.resetModules();
  return import("../src/main/i18n.ts");
}

describe("mainT", () => {
  beforeEach(() => {
    electronState.locale = "en-US";
  });

  it("follows the system locale while the preference is system", async () => {
    electronState.locale = "de-DE";
    const { mainT } = await loadMainI18n();
    expect(mainT("action.cancel")).toBe("Abbrechen");
  });

  it("honours an explicit preference over the system locale", async () => {
    electronState.locale = "en-US";
    const { mainT, setMainLocalePreference } = await loadMainI18n();
    setMainLocalePreference("de");
    expect(mainT("action.cancel")).toBe("Abbrechen");
    setMainLocalePreference("en");
    expect(mainT("action.cancel")).toBe("Cancel");
  });

  it("returns to the system locale when the preference goes back to system", async () => {
    electronState.locale = "de-DE";
    const { mainT, setMainLocalePreference } = await loadMainI18n();
    setMainLocalePreference("en");
    expect(mainT("action.cancel")).toBe("Cancel");
    setMainLocalePreference("system");
    expect(mainT("action.cancel")).toBe("Abbrechen");
  });
});
