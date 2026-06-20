/**
 * Doc-validator regression tests (wave qg-doc-coverage).
 *
 * Tests the REAL exported functions from validate-doc-structure.ts using
 * os.tmpdir() fixtures — never the live docs/ tree.
 *
 * Three fixture classes (Option A — parent>300 rule dropped):
 *   1. wrong-category  — validateDocsDirectory: file in wrong subdir
 *   2. >500 lines       — checkSizeLimits: absolute line-count limit
 *   3. hub>100 lines    — checkSizeLimits: hub doc line-count limit
 *
 * Each fixture has a FAIL (pre-correction) and a PASS (post-correction) case.
 */
import { describe, it, expect } from "vitest";
import {
  validateDocsDirectory,
  checkSizeLimits,
} from "../../src/tools/validate-doc-structure.js";
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Helper: create a temporary docs directory
// ---------------------------------------------------------------------------
async function makeTmpDocs(suffix: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `dv-regression-${suffix}-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  return tmp;
}

// ---------------------------------------------------------------------------
// Helper: clean up a temporary directory
// ---------------------------------------------------------------------------
async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Helper: generate N newline-terminated lines of content
// ---------------------------------------------------------------------------
function makeLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 1. Wrong-category fixture
//    validateDocsDirectory(tmp) where docs/adr/x.md has category: agents
//    (not in SUBDIR_TO_CATEGORIES['adr'] which defaults to ['adr']).
// ---------------------------------------------------------------------------
describe("wrong-category: file in wrong subdirectory", () => {
  it("FAIL: docs/adr/x.md with category: agents (not allowed in adr/) returns an error", async () => {
    const tmp = await makeTmpDocs("wrong-cat-fail");
    try {
      const adrDir = path.join(tmp, "adr");
      await mkdir(adrDir, { recursive: true });
      // Valid frontmatter but wrong category for the adr/ subdirectory
      await writeFile(
        path.join(adrDir, "x.md"),
        [
          "---",
          "scope: [architecture]",
          "sources: [team]",
          "targets: [developers]",
          "slug: adr-001",
          "status: active",
          "layer: L0",
          "category: agents",
          "description: An ADR",
          "version: 1.0.0",
          "last_updated: 2026-06-20",
          "---",
          "",
          "# ADR-001",
          "",
          "Content here.",
        ].join("\n"),
      );

      const result = await validateDocsDirectory(tmp);
      expect(result.errors.length).toBeGreaterThan(0);
      // Error must mention the category or directory mismatch
      const categoryError = result.errors.find(
        (e) => e.includes("agents") || e.includes("adr"),
      );
      expect(categoryError).toBeDefined();
    } finally {
      await cleanup(tmp);
    }
  });

  it("PASS: docs/adr/x.md with corrected category: adr returns no category error", async () => {
    const tmp = await makeTmpDocs("wrong-cat-pass");
    try {
      const adrDir = path.join(tmp, "adr");
      await mkdir(adrDir, { recursive: true });
      // Correct category for the adr/ subdirectory
      await writeFile(
        path.join(adrDir, "x.md"),
        [
          "---",
          "scope: [architecture]",
          "sources: [team]",
          "targets: [developers]",
          "slug: adr-001",
          "status: active",
          "layer: L0",
          "category: adr",
          "description: An ADR",
          "version: 1.0.0",
          "last_updated: 2026-06-20",
          "---",
          "",
          "# ADR-001",
          "",
          "Content here.",
        ].join("\n"),
      );

      const result = await validateDocsDirectory(tmp);
      // No category-mismatch error for this file
      const categoryError = result.errors.find(
        (e) => e.includes("x.md") && (e.includes("category") || e.includes("adr")),
      );
      expect(categoryError).toBeUndefined();
    } finally {
      await cleanup(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. >500 lines fixture
//    checkSizeLimits: content.trimEnd().split("\n").length > 500 → error
// ---------------------------------------------------------------------------
describe(">500-line doc: absolute size limit", () => {
  it("FAIL: 501-line content returns a >500 error", () => {
    // 501 newline-terminated lines → trimEnd().split("\n").length === 501
    const content501 = makeLines(501);
    const result = checkSizeLimits("docs/agents/big-doc.md", content501, false);
    expect(result.errors.length).toBeGreaterThan(0);
    const sizeError = result.errors.find((e) => e.includes("500"));
    expect(sizeError).toBeDefined();
  });

  it("PASS: 499-line content returns no size error", () => {
    const content499 = makeLines(499);
    const result = checkSizeLimits("docs/agents/ok-doc.md", content499, false);
    const sizeError = result.errors.find((e) => e.includes("500"));
    expect(sizeError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. hub>100 lines fixture
//    checkSizeLimits: filepath contains "hub" + lineCount > 100 → error
// ---------------------------------------------------------------------------
describe("hub>100-line doc: hub size limit", () => {
  it("FAIL: hub doc with 101 lines returns a hub >100 error", () => {
    const content101 = makeLines(101);
    const result = checkSizeLimits("docs/x-hub.md", content101, false);
    expect(result.errors.length).toBeGreaterThan(0);
    const hubError = result.errors.find((e) => e.includes("hub"));
    expect(hubError).toBeDefined();
  });

  it("PASS: hub doc with 99 lines returns no hub error", () => {
    const content99 = makeLines(99);
    const result = checkSizeLimits("docs/x-hub.md", content99, false);
    const hubError = result.errors.find((e) => e.includes("hub"));
    expect(hubError).toBeUndefined();
  });
});
