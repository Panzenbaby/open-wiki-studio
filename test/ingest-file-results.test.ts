import { describe, expect, it } from "vitest";
import { buildIngestFileResults, isArchivedOriginalOf } from "../src/main/ingest-file-results.ts";

describe("isArchivedOriginalOf", () => {
  it("matches the plain archive name", () => {
    expect(isArchivedOriginalOf("report.pdf", "report.pdf")).toBe(true);
    expect(isArchivedOriginalOf("team/report.pdf", "team/report.pdf")).toBe(true);
  });

  it("matches the timestamped and counted collision names", () => {
    expect(isArchivedOriginalOf("report.pdf", "report.2026-10-01-0915.pdf")).toBe(true);
    expect(isArchivedOriginalOf("report.pdf", "report.2026-10-01-0915.2.pdf")).toBe(true);
  });

  it("expects the .orig suffix for markdown originals", () => {
    expect(isArchivedOriginalOf("notes.md", "notes.md.orig")).toBe(true);
    expect(isArchivedOriginalOf("notes.md", "notes.2026-10-01-0915.md.orig")).toBe(true);
    expect(isArchivedOriginalOf("notes.md", "notes.md")).toBe(false);
  });

  it("rejects other files, other folders, and extracted text", () => {
    expect(isArchivedOriginalOf("report.pdf", "report-extracted.txt")).toBe(false);
    expect(isArchivedOriginalOf("report.pdf", "other/report.pdf")).toBe(false);
    expect(isArchivedOriginalOf("report.pdf", "report.docx")).toBe(false);
    expect(isArchivedOriginalOf("a+b (1).pdf", "a+b (1).pdf")).toBe(true);
    expect(isArchivedOriginalOf("a+b (1).pdf", "aab (1).pdf")).toBe(false);
  });

  it("handles files without an extension", () => {
    expect(isArchivedOriginalOf("README", "README")).toBe(true);
    expect(isArchivedOriginalOf("README", "README.2026-10-01-0915")).toBe(true);
  });
});

describe("buildIngestFileResults", () => {
  it("maps processed files to the concepts citing their archived original", () => {
    const results = buildIngestFileResults({
      inputBefore: ["survey.pdf", "interview.docx", "scan.pdf"],
      leftover: ["scan.pdf"],
      newArchiveFiles: ["interview.docx", "survey.2026-10-01-0915.pdf", "survey-extracted.txt"],
      createdSources: new Map([
        ["pain-points", ["interview.docx"]],
        ["personas", ["interview.docx", "survey.2026-10-01-0915.pdf"]],
        ["pricing", ["survey.2026-10-01-0915.pdf"]],
      ]),
      updatedSources: new Map([["overview", ["survey.2026-10-01-0915.pdf"]]]),
    });

    expect(results).toEqual([
      { relativePath: "interview.docx", status: "processed", createdConcepts: 2, updatedConcepts: 0 },
      { relativePath: "scan.pdf", status: "leftover", createdConcepts: 0, updatedConcepts: 0 },
      { relativePath: "survey.pdf", status: "processed", createdConcepts: 2, updatedConcepts: 1 },
    ]);
  });

  it("does not attribute an older archive entry with the same name", () => {
    const results = buildIngestFileResults({
      inputBefore: ["report.pdf"],
      leftover: [],
      newArchiveFiles: ["report.2026-10-01-0915.pdf"],
      createdSources: new Map([["old-concept", ["report.pdf"]]]),
      updatedSources: new Map(),
    });

    expect(results).toEqual([
      { relativePath: "report.pdf", status: "processed", createdConcepts: 0, updatedConcepts: 0 },
    ]);
  });
});
