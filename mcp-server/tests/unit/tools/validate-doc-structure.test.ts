/**
 * Tests for the validate-doc-structure MCP tool.
 *
 * Verifies category-subdirectory alignment validation, missing category
 * warnings, README.md index generation, and structured JSON output.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  validateDocsDirectory,
  generateReadmeIndex,
  checkSizeLimits,
  validateL0Refs,
  frontmatterCompleteness,
  validateSubDocRefs,
  validateModuleReadme,
  checkMonitorUrls,
  type ValidationResult,
  type SizeLimitResult,
  type L0RefResult,
  type SubDocResult,
  type ModuleReadmeResult,
  type UrlCheckResult,
} from "../../../src/tools/validate-doc-structure.js";

describe("validate-doc-structure", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "validate-doc-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes when doc with category frontmatter is in correct subdir", async () => {
    // Create docs/testing/testing-patterns.md with category: testing
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "testing-patterns.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-patterns
category: testing
---

# Testing Patterns
`,
    );

    const result = await validateDocsDirectory(path.join(tmpDir, "docs"));

    expect(result.totalFiles).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("reports error when doc with category:testing is in docs/ui/ (wrong subdir)", async () => {
    // Create docs/ui/testing-patterns.md with category: testing (WRONG placement)
    const docsDir = path.join(tmpDir, "docs", "ui");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "testing-patterns.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-patterns
category: testing
---

# Testing Patterns
`,
    );

    const result = await validateDocsDirectory(path.join(tmpDir, "docs"));

    expect(result.totalFiles).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("testing-patterns.md");
    expect(result.errors[0]).toContain("testing");
    expect(result.errors[0]).toContain("ui");
  });

  it("reports warning when doc has no category field (not error -- opt-in)", async () => {
    // Create docs/testing/some-doc.md WITHOUT category field
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "some-doc.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: some-doc
---

# Some Doc
`,
    );

    const result = await validateDocsDirectory(path.join(tmpDir, "docs"));

    expect(result.totalFiles).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("some-doc.md");
    expect(result.warnings[0]).toContain("no category");
  });

  it("--generate-index produces a README.md with subdirectory table", async () => {
    // Create docs with multiple subdirectories
    const testingDir = path.join(tmpDir, "docs", "testing");
    const archDir = path.join(tmpDir, "docs", "architecture");
    await mkdir(testingDir, { recursive: true });
    await mkdir(archDir, { recursive: true });

    await writeFile(
      path.join(testingDir, "testing-patterns.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-patterns
category: testing
---
# Testing
`,
    );
    await writeFile(
      path.join(testingDir, "testing-coroutines.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-coroutines
category: testing
---
# Coroutines
`,
    );
    await writeFile(
      path.join(archDir, "kmp-architecture.md"),
      `---
scope: [architecture]
sources: [kotlin]
targets: [jvm]
slug: kmp-architecture
category: architecture
---
# Architecture
`,
    );

    const readme = await generateReadmeIndex(
      path.join(tmpDir, "docs"),
      "Test Project",
      "Test project description",
    );

    expect(readme).toContain("architecture");
    expect(readme).toContain("testing");
    // Should contain a table-like structure with file counts
    expect(readme).toMatch(/testing.*2/);
    expect(readme).toMatch(/architecture.*1/);
  });

  it("returns structured JSON with error count and warning count", async () => {
    // Create mix: 1 correct, 1 wrong subdir, 1 no category
    const correctDir = path.join(tmpDir, "docs", "testing");
    const wrongDir = path.join(tmpDir, "docs", "ui");
    await mkdir(correctDir, { recursive: true });
    await mkdir(wrongDir, { recursive: true });

    // Correct placement
    await writeFile(
      path.join(correctDir, "testing-patterns.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
category: testing
---
# OK
`,
    );
    // Wrong placement
    await writeFile(
      path.join(wrongDir, "wrong-doc.md"),
      `---
scope: [ui]
sources: [compose]
targets: [android]
category: testing
---
# Wrong
`,
    );
    // No category
    await writeFile(
      path.join(correctDir, "no-cat.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
---
# No cat
`,
    );

    const result = await validateDocsDirectory(path.join(tmpDir, "docs"));

    expect(result.totalFiles).toBe(3);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it("handles docs at root level (no subdirectory) with category as warning", async () => {
    // Create docs/root-doc.md at root with category -- should warn about not being in subdir
    const docsDir = path.join(tmpDir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "root-doc.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
category: testing
---
# Root doc
`,
    );

    const result = await validateDocsDirectory(docsDir);

    expect(result.totalFiles).toBe(1);
    // A doc with category at root (not in subdir) should be an error
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("root");
  });

  it("skips archive/ directories during validation", async () => {
    const archiveDir = path.join(tmpDir, "docs", "archive");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(
      path.join(archiveDir, "old-doc.md"),
      `---
scope: [old]
sources: [old]
targets: [jvm]
category: old
---
# Old
`,
    );

    const result = await validateDocsDirectory(path.join(tmpDir, "docs"));

    // archive/ should be skipped
    expect(result.totalFiles).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// --- Phase 14.2: Size limit checks ---

describe("checkSizeLimits", () => {
  it("reports error when active doc exceeds 500 lines", () => {
    const content = Array(501).fill("line").join("\n");
    const result = checkSizeLimits("testing/big-doc.md", content, false);

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("500"))).toBe(true);
  });

  it("does not report error when doc is exactly 500 lines", () => {
    const content = Array(500).fill("line").join("\n");
    const result = checkSizeLimits("testing/ok-doc.md", content, false);

    expect(result.errors.filter((e) => e.includes("500"))).toHaveLength(0);
  });

  it("reports error when hub doc exceeds 100 lines", () => {
    const lines = Array(80).fill("line");
    lines[10] = "## Sub-documents";
    // Total 101 lines
    const extra = Array(21).fill("more");
    const content = [...lines, ...extra].join("\n");
    const result = checkSizeLimits("testing/hub-doc.md", content, false);

    expect(result.errors.some((e) => e.includes("100") && e.includes("hub"))).toBe(true);
  });

  it("does not report hub error when hub doc is under 100 lines", () => {
    const lines = Array(50).fill("line");
    lines[5] = "## Sub-documents";
    const content = lines.join("\n");
    const result = checkSizeLimits("testing/small-hub.md", content, false);

    expect(result.errors.filter((e) => e.includes("hub"))).toHaveLength(0);
  });

  it("reports warning when any ## section exceeds 150 lines", () => {
    const lines: string[] = ["# Main Doc", ""];
    lines.push("## Short Section");
    lines.push(...Array(10).fill("short content"));
    lines.push("## Long Section");
    lines.push(...Array(151).fill("long content"));
    const content = lines.join("\n");
    const result = checkSizeLimits("testing/long-section.md", content, false);

    expect(result.warnings.some((w) => w.includes("150") && w.includes("Long Section"))).toBe(true);
  });

  it("does not warn for sections at exactly 150 lines", () => {
    const lines: string[] = ["# Main Doc", ""];
    lines.push("## Exact Section");
    lines.push(...Array(150).fill("exact content"));
    const content = lines.join("\n");
    const result = checkSizeLimits("testing/exact-section.md", content, false);

    expect(result.warnings.filter((w) => w.includes("150"))).toHaveLength(0);
  });

  it("skips size checks on archive docs", () => {
    const content = Array(600).fill("archived line").join("\n");
    const result = checkSizeLimits("archive/old-doc.md", content, true);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// --- Phase 14.2: l0_refs validation ---

describe("validateL0Refs", () => {
  it("reports error when l0_refs contains slug not found in L0 registry", () => {
    const entries = [
      {
        slug: "my-l1-doc",
        filepath: "/docs/my-l1-doc.md",
        metadata: {
          scope: ["test"],
          sources: ["src"],
          targets: ["all"],
          l0_refs: ["testing-patterns", "nonexistent-slug"],
        },
        layer: "L1" as const,
      },
    ];
    const l0Slugs = new Set(["testing-patterns", "coroutine-testing"]);

    const result = validateL0Refs(entries, l0Slugs);

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("nonexistent-slug"))).toBe(true);
  });

  it("reports no error when all l0_refs are valid L0 slugs", () => {
    const entries = [
      {
        slug: "my-l1-doc",
        filepath: "/docs/my-l1-doc.md",
        metadata: {
          scope: ["test"],
          sources: ["src"],
          targets: ["all"],
          l0_refs: ["testing-patterns", "coroutine-testing"],
        },
        layer: "L1" as const,
      },
    ];
    const l0Slugs = new Set(["testing-patterns", "coroutine-testing", "other-slug"]);

    const result = validateL0Refs(entries, l0Slugs);

    expect(result.errors).toHaveLength(0);
  });

  it("skips entries without l0_refs (no errors)", () => {
    const entries = [
      {
        slug: "my-doc",
        filepath: "/docs/my-doc.md",
        metadata: {
          scope: ["test"],
          sources: ["src"],
          targets: ["all"],
        },
        layer: "L0" as const,
      },
    ];
    const l0Slugs = new Set(["testing-patterns"]);

    const result = validateL0Refs(entries, l0Slugs);

    expect(result.errors).toHaveLength(0);
  });
});

// --- Phase 14.2: Frontmatter completeness ---

describe("frontmatterCompleteness", () => {
  it("returns 10/10 when all 10 required fields are present", () => {
    const metadata = {
      scope: ["testing"],
      sources: ["junit"],
      targets: ["jvm"],
      slug: "testing-patterns",
      status: "active",
      layer: "L0" as const,
      category: "testing",
      description: "A testing doc",
      version: 1,
      last_updated: "2026-03-15",
    };

    const score = frontmatterCompleteness(metadata);
    expect(score).toBe(10);
  });

  it("returns 3/10 when only scope, sources, targets present (minimum valid)", () => {
    const metadata = {
      scope: ["testing"],
      sources: ["junit"],
      targets: ["jvm"],
    };

    const score = frontmatterCompleteness(metadata);
    expect(score).toBe(3);
  });

  it("returns 0/10 when metadata is empty", () => {
    const metadata = {
      scope: [],
      sources: [],
      targets: [],
    };

    // Empty arrays count as not present for completeness scoring
    const score = frontmatterCompleteness(metadata);
    expect(score).toBe(0);
  });
});

// --- Phase 14.2.1: Sub-document cross-reference validation ---

describe("validateSubDocRefs", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "subdoc-validate-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports error when sub-doc has parent field pointing to file that doesn't exist", async () => {
    // Sub-doc references a parent that doesn't exist on disk
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });

    await writeFile(
      path.join(docsDir, "testing-orphan.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-orphan
parent: nonexistent-hub
category: testing
---

# Orphan Sub-doc
`,
    );

    const result = await validateSubDocRefs(path.join(tmpDir, "docs"));

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("nonexistent-hub") && e.includes("not found"))).toBe(true);
  });

  it("reports error when hub's Sub-documents section lists a file that doesn't exist", async () => {
    // Hub references a sub-doc that doesn't exist on disk
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });

    await writeFile(
      path.join(docsDir, "testing-patterns.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-patterns
category: testing
---

# Testing Patterns

## Sub-documents

- **[missing-sub](missing-sub.md)**: Does not exist on disk
`,
    );

    const result = await validateSubDocRefs(path.join(tmpDir, "docs"));

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("missing-sub.md") && e.includes("not found"))).toBe(true);
  });

  it("reports error when sub-doc's parent field doesn't match any hub that lists it in Sub-documents", async () => {
    // Sub-doc has parent pointing to hub-a, but hub-a doesn't list it; hub-b exists but also doesn't list it
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });

    // Hub that exists but does NOT list the sub-doc
    await writeFile(
      path.join(docsDir, "hub-a.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: hub-a
category: testing
---

# Hub A

## Sub-documents

- **[other-sub](other-sub.md)**: Another sub-doc
`,
    );

    // The other-sub that hub-a lists (so hub-a is valid)
    await writeFile(
      path.join(docsDir, "other-sub.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: other-sub
parent: hub-a
category: testing
---

# Other Sub
`,
    );

    // Sub-doc claiming hub-a as parent, but hub-a doesn't list it
    await writeFile(
      path.join(docsDir, "stray-sub.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: stray-sub
parent: hub-a
category: testing
---

# Stray Sub
`,
    );

    const result = await validateSubDocRefs(path.join(tmpDir, "docs"));

    expect(result.errors.some((e) => e.includes("stray-sub.md") && e.includes("hub-a") && e.includes("not listed"))).toBe(true);
  });

  it("reports no error for correctly linked hub + sub-doc pair", async () => {
    const docsDir = path.join(tmpDir, "docs", "architecture");
    await mkdir(docsDir, { recursive: true });

    // Hub doc
    await writeFile(
      path.join(docsDir, "kmp-architecture.md"),
      `---
scope: [architecture]
sources: [kotlin]
targets: [jvm]
slug: kmp-architecture
category: architecture
---

# KMP Architecture

## Sub-documents

- **[kmp-architecture-modules](kmp-architecture-modules.md)**: Module structure
`,
    );

    // Sub-doc with matching parent
    await writeFile(
      path.join(docsDir, "kmp-architecture-modules.md"),
      `---
scope: [architecture]
sources: [kotlin]
targets: [jvm]
slug: kmp-architecture-modules
parent: kmp-architecture
category: architecture
---

# KMP Architecture Modules
`,
    );

    const result = await validateSubDocRefs(path.join(tmpDir, "docs"));

    expect(result.errors).toHaveLength(0);
  });

  it("handles hub with no Sub-documents section (standalone doc -- not an error)", async () => {
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });

    // Standalone doc -- no Sub-documents section, no parent
    await writeFile(
      path.join(docsDir, "standalone.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: standalone
category: testing
---

# Standalone Doc

Just content, no sub-documents.
`,
    );

    const result = await validateSubDocRefs(path.join(tmpDir, "docs"));

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles sub-doc with empty parent field gracefully (warning)", async () => {
    const docsDir = path.join(tmpDir, "docs", "testing");
    await mkdir(docsDir, { recursive: true });

    // Sub-doc with parent field present but empty
    await writeFile(
      path.join(docsDir, "empty-parent.md"),
      `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: empty-parent
parent: ""
category: testing
---

# Empty Parent Sub-doc
`,
    );

    const result = await validateSubDocRefs(path.join(tmpDir, "docs"));

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("empty-parent.md") && w.includes("empty"))).toBe(true);
  });
});

// --- Phase 16: Module README validation ---

describe("validateModuleReadme", () => {
  it("passes when module README has all 10 frontmatter fields + l0_refs", () => {
    const content = `---
scope: [network, http]
sources: [ktor]
targets: [android, ios, jvm, desktop]
slug: core-network-ktor
status: active
layer: L1
category: data
description: Ktor HTTP client wrapper for KMP
version: 1
last_updated: "2026-03-15"
l0_refs: [io-network-modules]
---

# core-network-ktor

HTTP client module.
`;
    const result = validateModuleReadme("core-network-ktor/README.md", content, "L1");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when L1 module README is missing l0_refs field", () => {
    const content = `---
scope: [network, http]
sources: [ktor]
targets: [android, ios, jvm, desktop]
slug: core-network-ktor
status: active
layer: L1
category: data
description: Ktor HTTP client wrapper for KMP
version: 1
last_updated: "2026-03-15"
---

# core-network-ktor

HTTP client module.
`;
    const result = validateModuleReadme("core-network-ktor/README.md", content, "L1");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("l0_refs"))).toBe(true);
  });

  it("reports error when module README exceeds 300 lines", () => {
    const frontmatter = `---
scope: [network]
sources: [ktor]
targets: [android]
slug: core-foo
status: active
layer: L1
category: data
description: Foo module
version: 1
last_updated: "2026-03-15"
l0_refs: [io-network-modules]
---`;
    const bodyLines = Array(290).fill("Content line.");
    const content = frontmatter + "\n\n" + bodyLines.join("\n");
    const result = validateModuleReadme("core-foo/README.md", content, "L1");

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("300"))).toBe(true);
  });

  it("reports error when module README is missing category field", () => {
    const content = `---
scope: [network]
sources: [ktor]
targets: [android]
slug: core-foo
status: active
layer: L1
description: Foo module
version: 1
last_updated: "2026-03-15"
l0_refs: [io-network-modules]
---

# core-foo

Some content.
`;
    const result = validateModuleReadme("core-foo/README.md", content, "L1");

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("warns when module README is missing description field", () => {
    const content = `---
scope: [network]
sources: [ktor]
targets: [android]
slug: core-foo
status: active
layer: L1
category: data
version: 1
last_updated: "2026-03-15"
l0_refs: [io-network-modules]
---

# core-foo

Some content.
`;
    const result = validateModuleReadme("core-foo/README.md", content, "L1");

    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("description"))).toBe(true);
  });

  it("does not apply module README rules to regular docs/ files", () => {
    // Regular doc with missing fields should NOT get module-specific errors
    const content = `---
scope: [testing]
sources: [junit]
targets: [jvm]
slug: testing-patterns
category: testing
---

# Testing Patterns

Regular doc content.
`;
    // validateModuleReadme should still work when called, but the point is
    // that the MCP tool should NOT call it for non-module-readme files.
    // We test that the function itself only validates what it's given.
    const result = validateModuleReadme("docs/testing/testing-patterns.md", content, "L0");

    // L0 docs should NOT get l0_refs warnings (only L1 module READMEs)
    expect(result.warnings.filter((w) => w.includes("l0_refs"))).toHaveLength(0);
  });

  it("reports error when L1 module README layer field is not L1", () => {
    const content = `---
scope: [network]
sources: [ktor]
targets: [android]
slug: core-foo
status: active
layer: L0
category: data
description: Foo module
version: 1
last_updated: "2026-03-15"
l0_refs: [io-network-modules]
---

# core-foo

Some content.
`;
    const result = validateModuleReadme("core-foo/README.md", content, "L1");

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.includes("layer") && e.includes("L1"))).toBe(true);
  });
});

describe("checkMonitorUrls", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "url-check-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no docs have monitor_urls", async () => {
    await writeFile(
      path.join(tmpDir, "no-urls.md"),
      `---
slug: no-urls
status: active
layer: L0
category: guides
scope: [guides]
sources: [internal]
targets: [all]
description: Doc without monitor_urls
version: 1
last_updated: "2026-03"
---
# No URLs
Content.
`,
    );

    const results = await checkMonitorUrls(tmpDir, 5);
    expect(results).toHaveLength(0);
  });

  it("collects monitor_urls from docs and returns UrlCheckResult shape", async () => {
    await writeFile(
      path.join(tmpDir, "with-urls.md"),
      `---
slug: with-urls
status: active
layer: L0
category: guides
scope: [guides]
sources: [internal]
targets: [all]
description: Doc with monitor_urls
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://example.com"
    type: doc-page
    tier: 1
  - url: "https://example.org"
    type: doc-page
    tier: 2
---
# With URLs
Content.
`,
    );

    // Pass mock fetch as third argument — no global patching needed
    const mockFetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("example.com")) {
        return { status: 200 } as Response;
      }
      return { status: 404 } as Response;
    };

    const results = await checkMonitorUrls(tmpDir, 5, mockFetch);
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Check shape
    for (const r of results) {
      expect(r).toHaveProperty("url");
      expect(r).toHaveProperty("source_doc");
      expect(r).toHaveProperty("tier");
      expect(r).toHaveProperty("reachable");
      expect(typeof r.reachable).toBe("boolean");
    }

    const comResult = results.find(r => r.url.includes("example.com"));
    expect(comResult?.reachable).toBe(true);
    expect(comResult?.status_code).toBe(200);
  });

  it("marks unreachable URLs as reachable: false", async () => {
    await writeFile(
      path.join(tmpDir, "bad-url.md"),
      `---
slug: bad-url
status: active
layer: L0
category: guides
scope: [guides]
sources: [internal]
targets: [all]
description: Doc with bad URL
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://this-domain-does-not-exist-aaa.example"
    type: doc-page
    tier: 1
---
# Bad URL
`,
    );

    const mockFetch = async () => { throw new Error("ENOTFOUND"); };

    const results = await checkMonitorUrls(tmpDir, 5, mockFetch);
    expect(results.length).toBe(1);
    expect(results[0].reachable).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it("samples only maxSample URLs and deduplicates by domain", async () => {
    // Create doc with 4 URLs from 3 different domains
    await writeFile(
      path.join(tmpDir, "multi-urls.md"),
      `---
slug: multi-urls
status: active
layer: L0
category: guides
scope: [guides]
sources: [internal]
targets: [all]
description: Doc with multiple URLs
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://alpha.example.com/page1"
    type: doc-page
    tier: 1
  - url: "https://alpha.example.com/page2"
    type: doc-page
    tier: 1
  - url: "https://beta.example.com/page"
    type: doc-page
    tier: 2
  - url: "https://gamma.example.com/page"
    type: doc-page
    tier: 3
---
`,
    );

    const mockFetch = async () => ({ status: 200 }) as Response;

    // maxSample=2 — should get at most 2, one per domain (alpha + beta)
    const results = await checkMonitorUrls(tmpDir, 2, mockFetch);
    expect(results.length).toBeLessThanOrEqual(2);
    // No duplicate domains
    const domains = results.map(r => new URL(r.url).hostname);
    const uniqueDomains = new Set(domains);
    expect(uniqueDomains.size).toBe(domains.length);
  });
});
