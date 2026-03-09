import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Full layer-first end-to-end integration test for the vault sync pipeline.
 *
 * Creates a complete fixture tree simulating:
 * - L0 toolkit (AndroidCommonDoc) with pattern docs, skills, CLAUDE.md
 * - L1 project (mock-shared-libs) with CLAUDE.md, docs/conventions.md
 * - L2 project (mock-app) with CLAUDE.md, docs, architecture, sub-project
 *
 * Tests initVault, syncVault, and getVaultStatus with real filesystem I/O.
 */
describe("vault-sync integration (layer-first)", () => {
  let tmpDir: string;
  let toolkitDir: string;
  let l1Path: string;
  let l2Path: string;
  let vaultDir: string;

  /**
   * Valid pattern doc frontmatter (scanner requires scope/sources/targets).
   */
  const VALID_PATTERN_1 = `---
scope:
  - testing
sources:
  - official-docs
targets:
  - android
  - ios
---
# Testing Patterns

Cross-project testing conventions.
`;

  const VALID_PATTERN_2 = `---
scope:
  - error
sources:
  - best-practices
targets:
  - android
---
# Error Handling

Standard error handling patterns.
`;

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

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "vault-sync-integration-"),
    );

    // --- Toolkit root (L0) ---
    toolkitDir = path.join(tmpDir, "toolkit");
    await fs.mkdir(toolkitDir, { recursive: true });

    // Pattern docs
    await createFile(
      toolkitDir,
      "docs/testing-patterns.md",
      VALID_PATTERN_1,
    );
    await createFile(
      toolkitDir,
      "docs/error-handling.md",
      VALID_PATTERN_2,
    );

    // Skill
    await createFile(
      toolkitDir,
      "skills/test-skill/SKILL.md",
      "# Test Skill\n\nSkill description.",
    );

    // Toolkit CLAUDE.md
    await createFile(
      toolkitDir,
      "CLAUDE.md",
      "# CLAUDE\n\nToolkit instructions.",
    );

    // --- L1 project: mock-shared-libs ---
    l1Path = path.join(tmpDir, "mock-shared-libs");
    await fs.mkdir(l1Path, { recursive: true });

    await createFile(
      l1Path,
      "CLAUDE.md",
      "# CLAUDE\n\nShared libs instructions.",
    );
    await createFile(
      l1Path,
      "docs/conventions.md",
      "# Conventions\n\nEcosystem conventions.",
    );
    await createFile(l1Path, "README.md", "# my-shared-libs\n\nOverview.");

    // --- L2 project: mock-app ---
    l2Path = path.join(tmpDir, "mock-app");
    await fs.mkdir(l2Path, { recursive: true });

    // Also create a Gradle marker so sub-project detection works
    await createFile(
      l2Path,
      "build.gradle.kts",
      "// Gradle build file",
    );
    await createFile(l2Path, "CLAUDE.md", "# CLAUDE\n\nApp instructions.");
    await createFile(
      l2Path,
      "docs/feature.md",
      "# Feature Doc\n\nFeature description.",
    );
    await createFile(
      l2Path,
      ".planning/codebase/ARCHITECTURE.md",
      "# Architecture\n\nApp architecture.",
    );
    await createFile(
      l2Path,
      ".planning/PROJECT.md",
      "# Project\n\nProject overview.",
    );

    // Sub-project: mock-app/SubWidget (cross-tech signal: CMakeLists.txt)
    await createFile(
      l2Path,
      "SubWidget/CMakeLists.txt",
      "cmake_minimum_required(VERSION 3.10)",
    );
    await createFile(
      l2Path,
      "SubWidget/README.md",
      "# SubWidget\n\nNative widget docs.",
    );

    // --- Vault output directory ---
    vaultDir = path.join(tmpDir, "vault-output");

    // Stub the toolkit root env var
    vi.stubEnv("ANDROID_COMMON_DOC", toolkitDir);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("initVault", () => {
    let initResult: Awaited<
      ReturnType<typeof import("../../../mcp-server/src/vault/sync-engine.js").initVault>
    >;

    beforeAll(async () => {
      const { initVault } = await import(
        "../../src/vault/sync-engine.js"
      );

      initResult = await initVault({
        version: 1,
        vaultPath: vaultDir,
        projects: [
          { name: "mock-shared-libs", path: l1Path, layer: "L1" },
          {
            name: "mock-app",
            path: l2Path,
            layer: "L2",
            features: { subProjectScanDepth: 1 },
          },
        ],
        autoClean: false,
      });
    });

    it("SyncResult.written > 0 and errors empty", () => {
      expect(initResult.written).toBeGreaterThan(0);
      expect(initResult.errors).toHaveLength(0);
    });

    it("creates .obsidian/ directory with config files", async () => {
      const obsidianDir = path.join(vaultDir, ".obsidian");
      await expect(fs.access(obsidianDir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(obsidianDir, "app.json")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(obsidianDir, "graph.json")),
      ).resolves.toBeUndefined();
    });

    it("creates _vault-meta/ with manifest and README", async () => {
      const metaDir = path.join(vaultDir, "_vault-meta");
      await expect(fs.access(metaDir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(metaDir, "sync-manifest.json")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(metaDir, "README.md")),
      ).resolves.toBeUndefined();
    });

    it("creates L0-generic/ directory with patterns/ and skills/ subdirs", async () => {
      const l0Dir = path.join(vaultDir, "L0-generic");
      await expect(fs.access(l0Dir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(l0Dir, "patterns")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(l0Dir, "skills")),
      ).resolves.toBeUndefined();
    });

    it("creates L1-ecosystem/mock-shared-libs/ with ai/ and docs/ subdirs", async () => {
      const l1Dir = path.join(
        vaultDir,
        "L1-ecosystem",
        "mock-shared-libs",
      );
      await expect(fs.access(l1Dir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(l1Dir, "ai")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(l1Dir, "docs")),
      ).resolves.toBeUndefined();
    });

    it("creates L2-apps/mock-app/ with ai/ and docs/ subdirs", async () => {
      const l2Dir = path.join(vaultDir, "L2-apps", "mock-app");
      await expect(fs.access(l2Dir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(l2Dir, "ai")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(l2Dir, "docs")),
      ).resolves.toBeUndefined();
    });

    it("creates L2-apps/mock-app/planning/ with architecture docs", async () => {
      const planningDir = path.join(
        vaultDir,
        "L2-apps",
        "mock-app",
        "planning",
      );
      await expect(fs.access(planningDir)).resolves.toBeUndefined();
    });

    it("auto-detects sub-project SubWidget under L2 parent", async () => {
      const subProjectDir = path.join(
        vaultDir,
        "L2-apps",
        "mock-app",
        "sub-projects",
        "SubWidget",
      );
      await expect(fs.access(subProjectDir)).resolves.toBeUndefined();
    });

    it("creates 00-MOC/ directory with Home.md and other MOC files", async () => {
      const mocDir = path.join(vaultDir, "00-MOC");
      await expect(fs.access(mocDir)).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(mocDir, "Home.md")),
      ).resolves.toBeUndefined();

      // Read Home.md to verify it has layer content
      const homeContent = await fs.readFile(
        path.join(mocDir, "Home.md"),
        "utf-8",
      );
      expect(homeContent).toContain("L0 Generic");
      expect(homeContent).toContain("L1 Ecosystem");
      expect(homeContent).toContain("L2 Apps");

      // Count MOC files (7: Home, All Patterns, All Modules, All Skills, All Decisions, By Layer, By Project)
      const mocFiles = await fs.readdir(mocDir);
      const mdFiles = mocFiles.filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBe(7);
    });
  });

  describe("syncVault (incremental)", () => {
    it("unchanged files report SyncResult.unchanged > 0 and minimal writes", async () => {
      const { syncVault } = await import(
        "../../src/vault/sync-engine.js"
      );

      const syncResult = await syncVault({
        version: 1,
        vaultPath: vaultDir,
        projects: [
          { name: "mock-shared-libs", path: l1Path, layer: "L1" },
          {
            name: "mock-app",
            path: l2Path,
            layer: "L2",
            features: { subProjectScanDepth: 1 },
          },
        ],
        autoClean: false,
      });

      // Files haven't changed, so most should be unchanged
      expect(syncResult.unchanged).toBeGreaterThan(0);
      expect(syncResult.errors).toHaveLength(0);
    });
  });

  describe("getVaultStatus", () => {
    it("configured: true after init", async () => {
      const { getVaultStatus } = await import(
        "../../src/vault/sync-engine.js"
      );

      const status = await getVaultStatus({
        version: 1,
        vaultPath: vaultDir,
        projects: [
          { name: "mock-shared-libs", path: l1Path, layer: "L1" },
          {
            name: "mock-app",
            path: l2Path,
            layer: "L2",
            features: { subProjectScanDepth: 1 },
          },
        ],
        autoClean: false,
      });

      expect(status.configured).toBe(true);
    });

    it("fileCount > 0", async () => {
      const { getVaultStatus } = await import(
        "../../src/vault/sync-engine.js"
      );

      const status = await getVaultStatus({
        version: 1,
        vaultPath: vaultDir,
        projects: [
          { name: "mock-shared-libs", path: l1Path, layer: "L1" },
          {
            name: "mock-app",
            path: l2Path,
            layer: "L2",
            features: { subProjectScanDepth: 1 },
          },
        ],
        autoClean: false,
      });

      expect(status.fileCount).toBeGreaterThan(0);
    });

    it("layers.L0 > 0, layers.L1 > 0, layers.L2 > 0", async () => {
      const { getVaultStatus } = await import(
        "../../src/vault/sync-engine.js"
      );

      const status = await getVaultStatus({
        version: 1,
        vaultPath: vaultDir,
        projects: [
          { name: "mock-shared-libs", path: l1Path, layer: "L1" },
          {
            name: "mock-app",
            path: l2Path,
            layer: "L2",
            features: { subProjectScanDepth: 1 },
          },
        ],
        autoClean: false,
      });

      expect(status.layers.L0).toBeGreaterThan(0);
      expect(status.layers.L1).toBeGreaterThan(0);
      expect(status.layers.L2).toBeGreaterThan(0);
    });

    it("projects includes configured project names", async () => {
      const { getVaultStatus } = await import(
        "../../src/vault/sync-engine.js"
      );

      const status = await getVaultStatus({
        version: 1,
        vaultPath: vaultDir,
        projects: [
          { name: "mock-shared-libs", path: l1Path, layer: "L1" },
          {
            name: "mock-app",
            path: l2Path,
            layer: "L2",
            features: { subProjectScanDepth: 1 },
          },
        ],
        autoClean: false,
      });

      expect(status.projects).toContain("mock-shared-libs");
      expect(status.projects).toContain("mock-app");
    });
  });
});
