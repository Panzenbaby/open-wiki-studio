// Tests for the runtime IPC payload guards in src/main/validate.ts. The module
// pulls in `mainT`, which reads the locale from Electron — mocked here so the
// guards can be exercised as plain functions.
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getLocale: () => "en" },
}));

const {
  expectPath,
  expectProvider,
  isFolder,
  isLlmConfig,
  isNonEmptyStringArray,
  isProviderId,
} = await import("../src/main/validate.ts");

describe("isLlmConfig", () => {
  it("accepts a minimal config", () => {
    expect(isLlmConfig({ provider: "anthropic", modelId: "claude-opus-4-7" })).toBe(true);
  });

  it("accepts optional apiKey and baseUrl", () => {
    const config = {
      provider: "openai-compatible",
      modelId: "gpt-4",
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
    };
    expect(isLlmConfig(config)).toBe(true);
  });

  it("rejects an unknown provider", () => {
    expect(isLlmConfig({ provider: "evil", modelId: "x" })).toBe(false);
  });

  it("rejects a missing or empty modelId", () => {
    expect(isLlmConfig({ provider: "openai" })).toBe(false);
    expect(isLlmConfig({ provider: "openai", modelId: "" })).toBe(false);
  });

  it("accepts a separate ingest model", () => {
    expect(isLlmConfig({ provider: "openai", modelId: "gpt-5-mini", ingestModelId: "gpt-5" })).toBe(true);
  });

  it("rejects an empty or non-string ingest model", () => {
    expect(isLlmConfig({ provider: "openai", modelId: "gpt-5-mini", ingestModelId: "" })).toBe(false);
    expect(isLlmConfig({ provider: "openai", modelId: "gpt-5-mini", ingestModelId: 5 })).toBe(false);
  });

  it("rejects a non-string apiKey", () => {
    expect(isLlmConfig({ provider: "openai", modelId: "x", apiKey: 42 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isLlmConfig(null)).toBe(false);
    expect(isLlmConfig("anthropic")).toBe(false);
    expect(isLlmConfig(undefined)).toBe(false);
  });
});

describe("isProviderId / isFolder", () => {
  it("accepts known values", () => {
    expect(isProviderId("github-copilot")).toBe(true);
    expect(isFolder("wiki")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isProviderId("anthropic ")).toBe(false);
    expect(isFolder("archive")).toBe(false);
    expect(isFolder(null)).toBe(false);
  });
});

describe("isNonEmptyStringArray", () => {
  it("accepts an empty array and an array of paths", () => {
    expect(isNonEmptyStringArray([])).toBe(true);
    expect(isNonEmptyStringArray(["/a/b.md", "/c.txt"])).toBe(true);
  });

  it("rejects arrays holding non-strings or empty strings", () => {
    expect(isNonEmptyStringArray(["/a", 1])).toBe(false);
    expect(isNonEmptyStringArray(["/a", ""])).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isNonEmptyStringArray("/a/b.md")).toBe(false);
  });
});

describe("argument validators", () => {
  it("expectPath passes a non-empty string and rejects everything else", () => {
    expect(expectPath(["wiki/foo.md"])).toBeNull();
    expect(expectPath([""])).not.toBeNull();
    expect(expectPath([])).not.toBeNull();
    expect(expectPath([{ toString: () => "wiki/foo.md" }])).not.toBeNull();
  });

  it("expectProvider names the offending provider in its message", () => {
    expect(expectProvider(["ollama"])).toBeNull();
    expect(expectProvider(["evil"])).toContain("evil");
  });
});
