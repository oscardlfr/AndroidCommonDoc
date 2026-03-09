import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("vault collector", () => {
  let tmpDir: string;
  let toolkitDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "collector-test-"));
    toolkitDir = path.join(tmpDir, "toolkit");
    await fs.mkdir(toolkitDir, { recursive: true });

    // Stub ANDROID_COMMON_DOC to our temp toolkit directory
    vi.stubEnv("ANDROID_COMMON_DOC", toolkitDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: create a file (and its parent dirs) inside a directory.
   */
  async function createFile(
    baseDir: string,
    relativePath: string,
    content: string,
  ) {
    const fullPath = path.join(baseDir, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  /**
   * Valid frontmatter for a pattern doc (scanner requires scope/sources/targets).
   */
  const VALID_PATTERN = `---
scope:
  - testing
sources:
  - official-docs
targets:
  - android
  - ios
---
# Testing Patterns

Content here.
`;

  describe("collectL0Sources", () => {
    it("collects pattern docs with layer L0 and L0-generic/patterns/ path", async () => {
      await createFile(toolkitDir, "docs/testing-patterns.md", VALID_PATTERN);

      const { collectL0Sources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectL0Sources(toolkitDir);

      const patternSources = sources.filter(
        (s) => s.sourceType === "pattern",
      );
      expect(patternSources.length).toBeGreaterThan(0);

      const testingPattern = patternSources.find((s) =>
        s.relativePath.includes("testing-patterns"),
      );
      expect(testingPattern).toBeDefined();
      expect(testingPattern!.layer).toBe("L0");
      expect(testingPattern!.relativePath).toMatch(
        /^L0-generic\/patterns\//,
      );
    });

    it("collects skills with L0-generic/skills/ path", async () => {
      await createFile(
        toolkitDir,
        "skills/sync-vault/SKILL.md",
        "# Sync Vault Skill\n\nDescription.",
      );

      const { collectL0Sources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectL0Sources(toolkitDir);

      const skillSources = sources.filter(
        (s) => s.sourceType === "skill",
      );
      expect(skillSources.length).toBeGreaterThan(0);
      expect(skillSources[0].layer).toBe("L0");
      expect(skillSources[0].relativePath).toMatch(
        /^L0-generic\/skills\//,
      );
    });

    it("collects toolkit CLAUDE.md under L0-generic/{toolkitName}/ai/", async () => {
      await createFile(toolkitDir, "CLAUDE.md", "# CLAUDE\n\nInstructions.");

      const { collectL0Sources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectL0Sources(toolkitDir);

      const claudeSources = sources.filter(
        (s) => s.sourceType === "claude-md",
      );
      expect(claudeSources.length).toBeGreaterThan(0);
      expect(claudeSources[0].layer).toBe("L0");
      // toolkit name is the directory basename
      const toolkitName = path.basename(toolkitDir);
      expect(claudeSources[0].relativePath).toBe(
        `L0-generic/${toolkitName}/ai/CLAUDE.md`,
      );
    });

    it("collects .planning/codebase/ as architecture sourceType", async () => {
      await createFile(
        toolkitDir,
        ".planning/codebase/ARCHITECTURE.md",
        "# Architecture\n\nOverview.",
      );

      const { collectL0Sources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectL0Sources(toolkitDir);

      const archSources = sources.filter(
        (s) => s.sourceType === "architecture",
      );
      expect(archSources.length).toBeGreaterThan(0);
      expect(archSources[0].layer).toBe("L0");
    });
  });

  describe("collectProjectSources", () => {
    it("L1 project routes to L1-ecosystem/{name}/ paths", async () => {
      const projectDir = path.join(tmpDir, "my-shared-libs");
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE\n\nL1 project.");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "my-shared-libs",
        path: projectDir,
        layer: "L1",
      });

      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.relativePath).toMatch(/^L1-ecosystem\//);
        expect(source.layer).toBe("L1");
      }
    });

    it("L2 project routes to L2-apps/{name}/ paths", async () => {
      const projectDir = path.join(tmpDir, "MyApp");
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE\n\nL2 app.");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "MyApp",
        path: projectDir,
        layer: "L2",
      });

      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.relativePath).toMatch(/^L2-apps\//);
        expect(source.layer).toBe("L2");
      }
    });

    it("CLAUDE.md classified as sourceType claude-md in ai/ subdivision", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE\n\nInstructions.");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
      });

      const claude = sources.find((s) => s.sourceType === "claude-md");
      expect(claude).toBeDefined();
      expect(claude!.relativePath).toContain("/ai/CLAUDE.md");
    });

    it("docs/*.md classified as sourceType docs in docs/ subdivision", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(
        projectDir,
        "docs/conventions.md",
        "# Conventions\n\nRules.",
      );

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
      });

      const docSources = sources.filter((s) => s.sourceType === "docs");
      expect(docSources.length).toBeGreaterThan(0);
      expect(docSources[0].relativePath).toContain("/docs/");
    });

    it(".planning/codebase/ excluded from L2 project collection by default", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(
        projectDir,
        ".planning/codebase/ARCHITECTURE.md",
        "# Arch\n\nDesign.",
      );
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE\n\nInstructions.");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
      });

      // .planning/codebase/ is now excluded by default (handled by L0 only)
      const archSources = sources.filter(
        (s) => s.sourceType === "architecture",
      );
      expect(archSources.length).toBe(0);
    });

    it(".planning/codebase/ collected when explicitly included in collectGlobs", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(
        projectDir,
        ".planning/codebase/ARCHITECTURE.md",
        "# Arch\n\nDesign.",
      );

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
        collectGlobs: [".planning/codebase/**/*.md"],
        excludeGlobs: [],
      });

      const archSources = sources.filter(
        (s) => s.sourceType === "architecture",
      );
      expect(archSources.length).toBeGreaterThan(0);
      expect(archSources[0].relativePath).toContain("/planning/");
    });

    it("custom collectGlobs override default patterns", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE");
      await createFile(projectDir, "custom/notes.md", "# Notes");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      // Custom globs only look for custom/**/*.md
      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
        collectGlobs: ["custom/**/*.md"],
      });

      // Should find custom/notes.md but NOT CLAUDE.md
      const paths = sources.map((s) => s.relativePath);
      expect(paths.some((p) => p.includes("notes.md"))).toBe(true);
      expect(paths.some((p) => p.includes("CLAUDE.md"))).toBe(false);
    });

    it("L1 docs preserve source subdirectory structure in vault path", async () => {
      const projectDir = path.join(tmpDir, "my-shared-libs");
      await createFile(
        projectDir,
        "docs/security/crypto-api.md",
        "# Crypto API\n\nSecurity doc.",
      );

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "my-shared-libs",
        path: projectDir,
        layer: "L1",
      });

      const securityDoc = sources.find((s) =>
        s.relativePath.includes("crypto-api"),
      );
      expect(securityDoc).toBeDefined();
      // Path should preserve the security/ subdirectory
      expect(securityDoc!.relativePath).toContain("security/");
    });

    it("L2 docs preserve source subdirectory structure in vault path", async () => {
      const projectDir = path.join(tmpDir, "MyApp");
      await createFile(
        projectDir,
        "docs/features/offline-sync.md",
        "# Offline Sync\n\nFeature doc.",
      );

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "MyApp",
        path: projectDir,
        layer: "L2",
      });

      const featureDoc = sources.find((s) =>
        s.relativePath.includes("offline-sync"),
      );
      expect(featureDoc).toBeDefined();
      // Path should preserve the features/ subdirectory
      expect(featureDoc!.relativePath).toContain("features/");
    });

    it("archive/ docs excluded from collection by default globs", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(
        projectDir,
        "docs/archive/old-pattern.md",
        "# Old Pattern\n\nArchived.",
      );
      await createFile(
        projectDir,
        "docs/active-pattern.md",
        "# Active Pattern\n\nCurrent.",
      );

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
      });

      const paths = sources.map((s) => s.relativePath);
      // archive/ docs should be excluded
      expect(paths.some((p) => p.includes("old-pattern"))).toBe(false);
      // active docs should be included
      expect(paths.some((p) => p.includes("active-pattern"))).toBe(true);
    });
  });

  describe("source deduplication", () => {
    it(".planning/codebase/ file produces exactly 1 vault entry (no double-write)", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(
        projectDir,
        ".planning/codebase/ARCHITECTURE.md",
        "# Arch\n\nDesign.",
      );
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE\n\nInstructions.");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
      });

      // Count how many entries reference ARCHITECTURE.md
      const archEntries = sources.filter((s) =>
        s.filepath.replace(/\\/g, "/").includes("ARCHITECTURE.md"),
      );
      expect(archEntries.length).toBeLessThanOrEqual(1);
    });

    it(".planning/research/ files are excluded by default", async () => {
      const projectDir = path.join(tmpDir, "TestProject");
      await createFile(
        projectDir,
        ".planning/research/SUMMARY.md",
        "# Research Summary",
      );
      await createFile(projectDir, "CLAUDE.md", "# CLAUDE\n\nInstructions.");

      const { collectProjectSources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectProjectSources({
        name: "TestProject",
        path: projectDir,
        layer: "L2",
      });

      const researchEntries = sources.filter((s) =>
        s.filepath.replace(/\\/g, "/").includes(".planning/research/"),
      );
      expect(researchEntries.length).toBe(0);
    });
  });

  describe("collectL0Sources - category routing", () => {
    it("L0 pattern with category routes to L0-generic/patterns/{category}/{slug}.md", async () => {
      const patternWithCategory = `---
scope:
  - testing
sources:
  - official-docs
targets:
  - android
  - ios
category: testing
---
# Testing Patterns

Content here.
`;
      await createFile(toolkitDir, "docs/testing-patterns.md", patternWithCategory);

      const { collectL0Sources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectL0Sources(toolkitDir);

      const testingPattern = sources.find((s) =>
        s.relativePath.includes("testing-patterns"),
      );
      expect(testingPattern).toBeDefined();
      expect(testingPattern!.relativePath).toBe(
        "L0-generic/patterns/testing/testing-patterns.md",
      );
    });

    it("L0 pattern without category routes to L0-generic/patterns/uncategorized/{slug}.md", async () => {
      const patternNoCategory = `---
scope:
  - misc
sources:
  - official-docs
targets:
  - android
---
# Misc Pattern

Content here.
`;
      await createFile(toolkitDir, "docs/misc-pattern.md", patternNoCategory);

      const { collectL0Sources } = await import(
        "../../../src/vault/collector.js"
      );

      const sources = await collectL0Sources(toolkitDir);

      const miscPattern = sources.find((s) =>
        s.relativePath.includes("misc-pattern"),
      );
      expect(miscPattern).toBeDefined();
      expect(miscPattern!.relativePath).toBe(
        "L0-generic/patterns/uncategorized/misc-pattern.md",
      );
    });
  });
});
