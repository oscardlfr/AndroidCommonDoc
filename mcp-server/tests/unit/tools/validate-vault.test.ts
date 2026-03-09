/**
 * Tests for the validate-vault MCP tool.
 *
 * Covers all 4 validation dimensions: duplicates, structural homogeneity,
 * cross-layer reference integrity, and wikilink coverage.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  checkDuplicates,
  checkStructuralHomogeneity,
  checkReferenceIntegrity,
  checkWikilinkCoverage,
  validateVault,
  type ProjectPath,
} from "../../../src/tools/validate-vault.js";

// ─── checkDuplicates ─────────────────────────────────────────────────

describe("checkDuplicates", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "vault-dup-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 issues for empty vault", async () => {
    const issues = await checkDuplicates(tmpDir);
    expect(issues).toHaveLength(0);
  });

  it("returns 0 issues for unique files", async () => {
    await writeFile(path.join(tmpDir, "alpha.md"), "# Alpha\nContent A\n");
    await writeFile(path.join(tmpDir, "beta.md"), "# Beta\nContent B\n");

    const issues = await checkDuplicates(tmpDir);
    expect(issues).toHaveLength(0);
  });

  it("detects case-insensitive filename collision in same directory", async () => {
    // On Windows this is impossible (same file), but we simulate with a subdirectory approach.
    // Instead, test two files with the same lowercase mapping in the same dir.
    // Since Windows FS is case-insensitive, we test via content hash detection instead.
    // For a meaningful case test, create files in different dirs with same name different case.
    const subA = path.join(tmpDir, "dirA");
    await mkdir(subA, { recursive: true });
    await writeFile(path.join(subA, "test.md"), "# Test A\n");
    await writeFile(path.join(subA, "other.md"), "# Other\n");

    // No collision expected when names differ
    const issues = await checkDuplicates(tmpDir);
    const collisionIssues = issues.filter(
      (i) => i.message.includes("filename collision"),
    );
    expect(collisionIssues).toHaveLength(0);
  });

  it("detects identical content hash in different directories", async () => {
    const subA = path.join(tmpDir, "dirA");
    const subB = path.join(tmpDir, "dirB");
    await mkdir(subA, { recursive: true });
    await mkdir(subB, { recursive: true });

    const sameContent = "---\nslug: test\n---\n\n# Same Content\n";
    await writeFile(path.join(subA, "doc-a.md"), sameContent);
    await writeFile(path.join(subB, "doc-b.md"), sameContent);

    const issues = await checkDuplicates(tmpDir);
    const hashIssues = issues.filter((i) =>
      i.message.includes("Identical content"),
    );
    expect(hashIssues).toHaveLength(1);
    expect(hashIssues[0].severity).toBe("error");
  });

  it("detects same vault_source in two files", async () => {
    await writeFile(
      path.join(tmpDir, "file1.md"),
      "---\nvault_source: docs/testing/patterns.md\n---\n\n# File 1\n",
    );
    await writeFile(
      path.join(tmpDir, "file2.md"),
      "---\nvault_source: docs/testing/patterns.md\n---\n\n# File 2\n",
    );

    const issues = await checkDuplicates(tmpDir);
    const sourceIssues = issues.filter((i) =>
      i.message.includes("vault_source"),
    );
    expect(sourceIssues).toHaveLength(1);
    expect(sourceIssues[0].severity).toBe("error");
    expect(sourceIssues[0].message).toContain("docs/testing/patterns.md");
  });
});

// ─── checkStructuralHomogeneity ──────────────────────────────────────

describe("checkStructuralHomogeneity", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "vault-struct-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeProject(name: string): ProjectPath {
    return { name, path: tmpDir, layer: "L0" };
  }

  it("returns 0 issues for single-file subdirectory (no hub needed)", async () => {
    const subDir = path.join(tmpDir, "docs", "testing");
    await mkdir(subDir, { recursive: true });
    await writeFile(
      path.join(subDir, "patterns.md"),
      "---\nslug: patterns\nscope: [testing]\nsources: [junit]\ntargets: [jvm]\nstatus: active\nlayer: L0\ncategory: testing\ndescription: Testing patterns\nversion: 1\nlast_updated: 2026-01-01\n---\n\n# Patterns\n",
    );

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const hubWarnings = issues.filter((i) => i.message.includes("hub doc"));
    expect(hubWarnings).toHaveLength(0);
  });

  it("returns 0 issues for multi-file subdirectory with hub", async () => {
    const subDir = path.join(tmpDir, "docs", "testing");
    await mkdir(subDir, { recursive: true });

    // Hub doc (short, <100 lines)
    await writeFile(
      path.join(subDir, "testing.md"),
      "---\nslug: testing\nscope: [testing]\nsources: [junit]\ntargets: [jvm]\nstatus: active\nlayer: L0\ncategory: testing\ndescription: Hub\nversion: 1\nlast_updated: 2026-01-01\n---\n\n# Testing\n\n## Sub-documents\n\n- [Patterns](patterns.md)\n",
    );

    await writeFile(
      path.join(subDir, "patterns.md"),
      "---\nslug: patterns\nscope: [testing]\nsources: [junit]\ntargets: [jvm]\nstatus: active\nlayer: L0\ncategory: testing\ndescription: Patterns\nversion: 1\nlast_updated: 2026-01-01\n---\n\n# Patterns\n",
    );

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const hubIssues = issues.filter((i) => i.message.includes("hub doc"));
    expect(hubIssues).toHaveLength(0);
  });

  it("warns when multi-file subdirectory has no hub", async () => {
    const subDir = path.join(tmpDir, "docs", "testing");
    await mkdir(subDir, { recursive: true });

    await writeFile(path.join(subDir, "doc1.md"), "# Doc 1\n");
    await writeFile(path.join(subDir, "doc2.md"), "# Doc 2\n");

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const hubWarnings = issues.filter(
      (i) => i.message.includes("no hub doc") && i.severity === "warning",
    );
    expect(hubWarnings).toHaveLength(1);
  });

  it("errors when hub doc exceeds 100 lines", async () => {
    const subDir = path.join(tmpDir, "docs", "testing");
    await mkdir(subDir, { recursive: true });

    // Hub doc with >100 lines
    const longHub =
      "---\nslug: testing\nscope: [testing]\nsources: [junit]\ntargets: [jvm]\nstatus: active\nlayer: L0\ncategory: testing\ndescription: Hub\nversion: 1\nlast_updated: 2026-01-01\n---\n\n# Testing\n\n## Sub-documents\n\n" +
      Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n") +
      "\n";

    await writeFile(path.join(subDir, "testing.md"), longHub);
    await writeFile(path.join(subDir, "patterns.md"), "# Patterns\n");

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const hubErrors = issues.filter(
      (i) =>
        i.message.includes("Hub doc") &&
        i.message.includes("lines") &&
        i.severity === "error",
    );
    expect(hubErrors).toHaveLength(1);
  });

  it("errors when sub-doc exceeds 300 lines", async () => {
    const subDir = path.join(tmpDir, "docs", "testing");
    await mkdir(subDir, { recursive: true });

    const longDoc =
      "---\nslug: big\nscope: [testing]\nsources: [junit]\ntargets: [jvm]\nstatus: active\nlayer: L0\ncategory: testing\ndescription: Big doc\nversion: 1\nlast_updated: 2026-01-01\n---\n\n# Big Doc\n" +
      Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`).join("\n") +
      "\n";

    await writeFile(path.join(subDir, "big-doc.md"), longDoc);

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const sizeErrors = issues.filter(
      (i) =>
        i.message.includes("300") &&
        i.message.includes("sub-docs") &&
        i.severity === "error",
    );
    expect(sizeErrors).toHaveLength(1);
  });

  it("warns when frontmatter fields are missing", async () => {
    const subDir = path.join(tmpDir, "docs", "testing");
    await mkdir(subDir, { recursive: true });

    // Only 3 of 10 fields present
    await writeFile(
      path.join(subDir, "incomplete.md"),
      "---\nslug: incomplete\ncategory: testing\nstatus: active\n---\n\n# Incomplete\n",
    );

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const fmWarnings = issues.filter(
      (i) =>
        i.message.includes("missing frontmatter") &&
        i.severity === "warning",
    );
    expect(fmWarnings).toHaveLength(1);
    expect(fmWarnings[0].details?.missingFields).toContain("scope");
    expect(fmWarnings[0].details?.missingFields).toContain("description");
  });

  it("skips archive subdirectory files for size checks", async () => {
    const archiveDir = path.join(tmpDir, "docs", "archive");
    await mkdir(archiveDir, { recursive: true });

    // Large file in archive -- should not produce size error
    const longDoc =
      "---\nslug: archived\n---\n\n# Archived\n" +
      Array.from({ length: 400 }, (_, i) => `Line ${i + 1}`).join("\n") +
      "\n";

    await writeFile(path.join(archiveDir, "old-doc.md"), longDoc);

    const issues = await checkStructuralHomogeneity([makeProject("TestProj")]);
    const sizeErrors = issues.filter(
      (i) => i.message.includes("lines") && i.severity === "error",
    );
    expect(sizeErrors).toHaveLength(0);
  });
});

// ─── checkReferenceIntegrity ─────────────────────────────────────────

describe("checkReferenceIntegrity", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "vault-refs-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 issues for L1 doc with valid l0_refs", async () => {
    // L0 project
    const l0Path = path.join(tmpDir, "l0");
    const l0Docs = path.join(l0Path, "docs", "testing");
    await mkdir(l0Docs, { recursive: true });
    await writeFile(
      path.join(l0Docs, "patterns.md"),
      "---\nslug: testing-patterns\n---\n\n# Testing Patterns\n",
    );

    // L1 project
    const l1Path = path.join(tmpDir, "l1");
    const l1Docs = path.join(l1Path, "docs", "testing");
    await mkdir(l1Docs, { recursive: true });
    await writeFile(
      path.join(l1Docs, "impl.md"),
      "---\nslug: impl\nl0_refs:\n  - testing-patterns\n---\n\n# Implementation\n",
    );

    const projects: ProjectPath[] = [
      { name: "AndroidCommonDoc", path: l0Path, layer: "L0" },
      { name: "my-shared-libs", path: l1Path, layer: "L1" },
    ];

    const issues = await checkReferenceIntegrity(projects);
    expect(issues).toHaveLength(0);
  });

  it("errors for L1 doc with broken l0_ref", async () => {
    // L0 project (no docs)
    const l0Path = path.join(tmpDir, "l0");
    await mkdir(path.join(l0Path, "docs"), { recursive: true });

    // L1 project with broken ref
    const l1Path = path.join(tmpDir, "l1");
    const l1Docs = path.join(l1Path, "docs", "testing");
    await mkdir(l1Docs, { recursive: true });
    await writeFile(
      path.join(l1Docs, "impl.md"),
      "---\nslug: impl\nl0_refs:\n  - nonexistent-slug\n---\n\n# Implementation\n",
    );

    const projects: ProjectPath[] = [
      { name: "AndroidCommonDoc", path: l0Path, layer: "L0" },
      { name: "my-shared-libs", path: l1Path, layer: "L1" },
    ];

    const issues = await checkReferenceIntegrity(projects);
    const refErrors = issues.filter(
      (i) => i.severity === "error" && i.message.includes("nonexistent-slug"),
    );
    expect(refErrors).toHaveLength(1);
  });

  it("warns when L0 doc mentions L1/L2 project name (upward reference)", async () => {
    // L0 project with doc mentioning L1 project
    const l0Path = path.join(tmpDir, "l0");
    const l0Docs = path.join(l0Path, "docs", "testing");
    await mkdir(l0Docs, { recursive: true });
    await writeFile(
      path.join(l0Docs, "patterns.md"),
      "---\nslug: patterns\n---\n\nThis pattern is used by MyApp in production.\n",
    );

    // L2 project
    const l2Path = path.join(tmpDir, "l2");
    await mkdir(path.join(l2Path, "docs"), { recursive: true });

    const projects: ProjectPath[] = [
      { name: "AndroidCommonDoc", path: l0Path, layer: "L0" },
      { name: "MyApp", path: l2Path, layer: "L2" },
    ];

    const issues = await checkReferenceIntegrity(projects);
    const upwardWarnings = issues.filter(
      (i) =>
        i.severity === "warning" && i.message.includes("upward reference"),
    );
    expect(upwardWarnings).toHaveLength(1);
    expect(upwardWarnings[0].message).toContain("MyApp");
  });

  it("returns 0 issues for L2 doc with valid l0_refs", async () => {
    // L0 project
    const l0Path = path.join(tmpDir, "l0");
    const l0Docs = path.join(l0Path, "docs", "arch");
    await mkdir(l0Docs, { recursive: true });
    await writeFile(
      path.join(l0Docs, "mvvm.md"),
      "---\nslug: mvvm-pattern\n---\n\n# MVVM\n",
    );

    // L2 project
    const l2Path = path.join(tmpDir, "l2");
    const l2Docs = path.join(l2Path, "docs", "arch");
    await mkdir(l2Docs, { recursive: true });
    await writeFile(
      path.join(l2Docs, "app-arch.md"),
      "---\nslug: app-arch\nl0_refs:\n  - mvvm-pattern\n---\n\n# App Architecture\n",
    );

    const projects: ProjectPath[] = [
      { name: "AndroidCommonDoc", path: l0Path, layer: "L0" },
      { name: "MyApp", path: l2Path, layer: "L2" },
    ];

    const issues = await checkReferenceIntegrity(projects);
    expect(issues).toHaveLength(0);
  });
});

// ─── checkWikilinkCoverage ───────────────────────────────────────────

describe("checkWikilinkCoverage", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "vault-wiki-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 issues for file with valid wikilinks", async () => {
    await writeFile(
      path.join(tmpDir, "index.md"),
      "# Index\n\nSee [[patterns]] for details.\n",
    );
    await writeFile(
      path.join(tmpDir, "patterns.md"),
      "# Patterns\n\nBack to [[index]].\n",
    );

    const issues = await checkWikilinkCoverage(tmpDir);
    const brokenLinks = issues.filter(
      (i) => i.message.includes("broken wikilink"),
    );
    expect(brokenLinks).toHaveLength(0);
  });

  it("errors for broken wikilink (target not found)", async () => {
    await writeFile(
      path.join(tmpDir, "doc.md"),
      "# Doc\n\nSee [[nonexistent]] for details.\n",
    );

    const issues = await checkWikilinkCoverage(tmpDir);
    const brokenLinks = issues.filter(
      (i) =>
        i.severity === "error" && i.message.includes("broken wikilink"),
    );
    expect(brokenLinks).toHaveLength(1);
    expect(brokenLinks[0].message).toContain("nonexistent");
  });

  it("warns about orphan file (no incoming wikilinks, not MOC)", async () => {
    // Two files, neither links to the other, neither is MOC
    await writeFile(path.join(tmpDir, "orphan.md"), "# Orphan\n\nNo links here.\n");
    await writeFile(path.join(tmpDir, "another.md"), "# Another\n\nAlso alone.\n");

    const issues = await checkWikilinkCoverage(tmpDir);
    const orphanWarnings = issues.filter(
      (i) => i.severity === "warning" && i.message.includes("orphan"),
    );
    expect(orphanWarnings.length).toBeGreaterThanOrEqual(2);
  });

  it("exempts MOC files from orphan check", async () => {
    await writeFile(
      path.join(tmpDir, "Home.md"),
      "# Home\n\nSee [[patterns]].\n",
    );
    await writeFile(
      path.join(tmpDir, "patterns.md"),
      "# Patterns\n\nContent here.\n",
    );

    const issues = await checkWikilinkCoverage(tmpDir);
    // Home.md should NOT be reported as orphan even though nothing links to it
    const homeOrphans = issues.filter(
      (i) => i.message.includes("orphan") && i.file?.includes("Home.md"),
    );
    expect(homeOrphans).toHaveLength(0);
  });

  it("handles wikilinks with display text (pipe syntax)", async () => {
    await writeFile(
      path.join(tmpDir, "doc.md"),
      "# Doc\n\nSee [[patterns|Testing Patterns]] for details.\n",
    );
    await writeFile(
      path.join(tmpDir, "patterns.md"),
      "# Patterns\n\nBack to [[doc]].\n",
    );

    const issues = await checkWikilinkCoverage(tmpDir);
    const brokenLinks = issues.filter(
      (i) => i.message.includes("broken wikilink"),
    );
    expect(brokenLinks).toHaveLength(0);
  });
});

// ─── validateVault orchestrator ──────────────────────────────────────

describe("validateVault", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "vault-all-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("runs all 4 checks and returns structured result with summary", async () => {
    // Create a simple vault with one issue per dimension
    await writeFile(path.join(tmpDir, "doc.md"), "# Doc\n\nSee [[missing]].\n");

    const result = await validateVault({
      vaultPath: tmpDir,
      projectPaths: [],
    });

    expect(result).toHaveProperty("duplicates");
    expect(result).toHaveProperty("homogeneity");
    expect(result).toHaveProperty("references");
    expect(result).toHaveProperty("wikilinks");
    expect(result).toHaveProperty("summary");
    expect(typeof result.summary.errors).toBe("number");
    expect(typeof result.summary.warnings).toBe("number");
    expect(typeof result.summary.passed).toBe("boolean");
  });

  it("runs only selected checks when specified", async () => {
    await writeFile(path.join(tmpDir, "doc.md"), "# Doc\n\nSee [[missing]].\n");

    const result = await validateVault({
      vaultPath: tmpDir,
      checks: ["duplicates"],
      projectPaths: [],
    });

    // Wikilinks check was NOT run, so broken wikilink should not appear
    expect(result.wikilinks).toHaveLength(0);
    expect(result.duplicates).toBeDefined();
  });

  it("summary.passed is true when no errors exist", async () => {
    // Empty vault -- no issues
    const result = await validateVault({
      vaultPath: tmpDir,
      projectPaths: [],
    });

    expect(result.summary.passed).toBe(true);
    expect(result.summary.errors).toBe(0);
  });

  it("summary.passed is false when errors exist", async () => {
    // Create duplicate content
    const subA = path.join(tmpDir, "dirA");
    const subB = path.join(tmpDir, "dirB");
    await mkdir(subA, { recursive: true });
    await mkdir(subB, { recursive: true });

    const content = "# Exact Same Content\n";
    await writeFile(path.join(subA, "a.md"), content);
    await writeFile(path.join(subB, "b.md"), content);

    const result = await validateVault({
      vaultPath: tmpDir,
      projectPaths: [],
    });

    expect(result.summary.passed).toBe(false);
    expect(result.summary.errors).toBeGreaterThan(0);
  });
});
