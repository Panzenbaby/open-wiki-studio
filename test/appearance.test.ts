// Tests for the pure preference → effective-value resolution in
// src/shared/appearance.ts.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  isAppearanceSettings,
  normalizeAppearance,
  resolveLocale,
  resolveTheme,
} from "../src/shared/appearance.ts";

describe("resolveTheme", () => {
  it("follows the system preference when set to system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the system preference for an explicit choice", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("resolveLocale", () => {
  it("detects German from the system language when set to system", () => {
    expect(resolveLocale("system", "de-DE")).toBe("de");
    expect(resolveLocale("system", "DE")).toBe("de");
  });

  it("falls back to English for any other system language", () => {
    expect(resolveLocale("system", "en-US")).toBe("en");
    expect(resolveLocale("system", "fr-FR")).toBe("en");
    expect(resolveLocale("system", "")).toBe("en");
  });

  it("honours an explicit choice regardless of the system language", () => {
    expect(resolveLocale("de", "en-US")).toBe("de");
    expect(resolveLocale("en", "de-DE")).toBe("en");
  });
});

describe("normalizeAppearance", () => {
  it("defaults to system for both preferences", () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance("dark")).toEqual(DEFAULT_APPEARANCE);
  });

  it("keeps valid fields and repairs invalid ones independently", () => {
    expect(normalizeAppearance({ theme: "light", locale: "sv" })).toEqual({
      theme: "light",
      locale: "system",
    });
    expect(normalizeAppearance({ theme: 42, locale: "de" })).toEqual({
      theme: "system",
      locale: "de",
    });
  });

  it("passes through a fully valid object", () => {
    expect(normalizeAppearance({ theme: "dark", locale: "en" })).toEqual({
      theme: "dark",
      locale: "en",
    });
  });
});

describe("isAppearanceSettings", () => {
  it("accepts only fully valid settings", () => {
    expect(isAppearanceSettings({ theme: "dark", locale: "de" })).toBe(true);
    expect(isAppearanceSettings({ theme: "dark" })).toBe(false);
    expect(isAppearanceSettings({ theme: "neon", locale: "de" })).toBe(false);
    expect(isAppearanceSettings(null)).toBe(false);
  });
});
