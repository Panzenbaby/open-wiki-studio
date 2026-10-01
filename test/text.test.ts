import { describe, expect, it } from "vitest";
import {
  SESSION_PREVIEW_MAX_LENGTH,
  abbreviateHomePath,
  buildSessionPreview,
  markdownToPlainText,
} from "../src/shared/text.ts";

describe("markdownToPlainText", () => {
  it("keeps link labels and drops markdown markers", () => {
    expect(
      markdownToPlainText("## Pain points\n\n- **Onboarding** is slow, see [Interviews](wiki/interviews.md).\n> `quoted`"),
    ).toBe("Pain points Onboarding is slow, see Interviews. quoted");
  });
});

describe("buildSessionPreview", () => {
  it("drops the first question and returns the start of the answer", () => {
    expect(
      buildSessionPreview("/wiki-query What can you do? I answer questions **based on** your wiki.", "/wiki-query What can you do?"),
    ).toBe("I answer questions based on your wiki.");
  });

  it("returns an empty preview for a session without an answer", () => {
    expect(buildSessionPreview("/wiki-query Hello", "/wiki-query Hello")).toBe("");
  });

  it("caps the preview length", () => {
    const preview = buildSessionPreview(`Q ${"word ".repeat(200)}`, "Q");
    expect(preview.length).toBeLessThanOrEqual(SESSION_PREVIEW_MAX_LENGTH);
  });
});

describe("abbreviateHomePath", () => {
  it("replaces the home directory with ~", () => {
    expect(abbreviateHomePath("/Users/ada/Research/Wiki", "/Users/ada")).toBe("~/Research/Wiki");
    expect(abbreviateHomePath("/Users/ada", "/Users/ada/")).toBe("~");
  });

  it("leaves other paths and Windows homes unchanged", () => {
    expect(abbreviateHomePath("/Users/adam/Wiki", "/Users/ada")).toBe("/Users/adam/Wiki");
    expect(abbreviateHomePath("C:\\Users\\ada\\Wiki", "C:\\Users\\ada")).toBe("C:\\Users\\ada\\Wiki");
    expect(abbreviateHomePath("/data/Wiki", "")).toBe("/data/Wiki");
  });
});
