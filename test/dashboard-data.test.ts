import { describe, expect, it } from "vitest";
import {
  fileTypeLabel,
  formatFileSize,
  formatSessionTime,
  ingestCardMode,
  summarizeWikiListing,
} from "../src/renderer/dashboard-data.ts";
import { t as translate, type I18nParams } from "../src/shared/i18n.ts";
import type { IngestSummary } from "../src/shared/ipc-types.ts";

const t = (key: string, params?: I18nParams): string => translate("en", key, params);

const SUMMARY: IngestSummary = {
  files: [],
  leftover: [],
  createdConcepts: [],
  updatedConcepts: [],
  wikiConceptCountBefore: 0,
  wikiConceptCountAfter: 0,
};

describe("summarizeWikiListing", () => {
  it("counts concepts, verified concepts, and archived originals", () => {
    expect(
      summarizeWikiListing([
        { relativePath: "a.md", name: "a.md", isDirectory: false, verified: true },
        { relativePath: "b.md", name: "b.md", isDirectory: false, verified: false },
        { relativePath: "index.md", name: "index.md", isDirectory: false },
        { relativePath: "archive/report.pdf", name: "report.pdf", isDirectory: false },
        { relativePath: "archive/report-extracted.txt", name: "report-extracted.txt", isDirectory: false },
        { relativePath: "archive/deck-extracted.part02.2026-10-01-0915.txt", name: "deck-extracted.part02.2026-10-01-0915.txt", isDirectory: false },
        { relativePath: "archive/notes.md.orig", name: "notes.md.orig", isDirectory: false },
        { relativePath: "trash/old.md.orig", name: "old.md.orig", isDirectory: false },
      ]),
    ).toEqual({ concepts: 2, verified: 1, sourceFiles: 2 });
  });
});

describe("formatFileSize", () => {
  it("uses whole kilobytes and one decimal from megabytes on", () => {
    expect(formatFileSize(512, "en", t)).toBe("512 B");
    expect(formatFileSize(86016, "en", t)).toBe("84 KB");
    expect(formatFileSize(2202009, "de", t)).toBe("2,1 MB");
    expect(formatFileSize(3 * 1024 ** 3, "en", t)).toBe("3 GB");
  });
});

describe("fileTypeLabel", () => {
  it("returns the upper-case extension, capped at four characters", () => {
    expect(fileTypeLabel("report.pdf")).toBe("PDF");
    expect(fileTypeLabel("notes.markdown")).toBe("MARK");
    expect(fileTypeLabel("README")).toBeNull();
    expect(fileTypeLabel(".env")).toBeNull();
  });
});

describe("formatSessionTime", () => {
  const now = new Date(2026, 9, 1, 14, 30);

  it("shows the time today, 'Yesterday', and day + month before that", () => {
    expect(formatSessionTime(new Date(2026, 9, 1, 9, 5).toISOString(), now, "de", t)).toBe("09:05");
    expect(formatSessionTime(new Date(2026, 8, 30, 23, 0).toISOString(), now, "de", t)).toBe("Yesterday");
    expect(formatSessionTime(new Date(2026, 8, 28, 10, 0).toISOString(), now, "de", t)).toBe("28.09.");
    expect(formatSessionTime("not a date", now, "de", t)).toBe("");
  });
});

describe("ingestCardMode", () => {
  it("prefers a running run, then its result, then an error, then pending files", () => {
    expect(ingestCardMode("running", null, null, 3)).toBe("running");
    expect(ingestCardMode("done", SUMMARY, null, 1)).toBe("done");
    expect(ingestCardMode("idle", SUMMARY, "boom", 1)).toBe("error");
    expect(ingestCardMode("idle", SUMMARY, null, 2)).toBe("pending");
    expect(ingestCardMode("idle", null, null, 0)).toBe("hidden");
  });

  it("keeps showing a run as running until its summary or error arrives", () => {
    expect(ingestCardMode("done", null, null, 3)).toBe("running");
    expect(ingestCardMode("done", null, "no progress", 3)).toBe("error");
  });
});
