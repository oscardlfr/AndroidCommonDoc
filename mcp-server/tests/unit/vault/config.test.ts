import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("vault config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-config-test-"));
    // Mock getL2Dir to use our temp directory
    vi.doMock("../../../src/utils/paths.js", () => ({
      getL2Dir: () => tmpDir,
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("getDefaultConfig", () => {
    it("returns version: 1", async () => {
      const { getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );
      const config = getDefaultConfig();
      expect(config.version).toBe(1);
    });

    it("returns empty projects array (ProjectConfig[])", async () => {
      const { getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );
      const config = getDefaultConfig();
      expect(config.projects).toEqual([]);
      expect(config.projects.length).toBe(0);
    });

    it("does not include includeTemplates field", async () => {
      const { getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );
      const config = getDefaultConfig();
      expect("includeTemplates" in config).toBe(false);
    });

    it("autoClean defaults to false", async () => {
      const { getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );
      const config = getDefaultConfig();
      expect(config.autoClean).toBe(false);
    });
  });

  describe("getDefaultGlobs", () => {
    it("returns standard doc patterns for L1", async () => {
      const { getDefaultGlobs } = await import(
        "../../../src/vault/config.js"
      );
      const globs = getDefaultGlobs("L1");
      expect(globs).toContain("CLAUDE.md");
      expect(globs).toContain("AGENTS.md");
      expect(globs).toContain("README.md");
      expect(globs).toContain("docs/**/*.md");
      expect(globs).toContain(".planning/PROJECT.md");
      expect(globs).toContain(".planning/STATE.md");
      // .planning/codebase/ is now excluded (handled by L0 collectL0Sources only)
      expect(globs).not.toContain(".planning/codebase/**/*.md");
    });

    it("returns standard doc patterns for L2", async () => {
      const { getDefaultGlobs } = await import(
        "../../../src/vault/config.js"
      );
      const globs = getDefaultGlobs("L2");
      expect(globs).toContain("CLAUDE.md");
      expect(globs).toContain("docs/**/*.md");
      expect(globs).not.toContain(".planning/codebase/**/*.md");
    });
  });

  describe("getDefaultExcludes", () => {
    it("includes build, node_modules, .gradle, dist, archive patterns", async () => {
      const { getDefaultExcludes } = await import(
        "../../../src/vault/config.js"
      );
      const excludes = getDefaultExcludes();
      expect(excludes).toContain("**/build/**");
      expect(excludes).toContain("**/node_modules/**");
      expect(excludes).toContain("**/.gradle/**");
      expect(excludes).toContain("**/dist/**");
      expect(excludes).toContain("**/archive/**");
      expect(excludes).toContain("**/.androidcommondoc/**");
      expect(excludes).toContain("**/coverage-*.md");
    });

    it("excludes .planning/phases/**, .planning/research/**, and .planning/codebase/**", async () => {
      const { getDefaultExcludes } = await import(
        "../../../src/vault/config.js"
      );
      const excludes = getDefaultExcludes();

      expect(excludes).toContain("**/.planning/phases/**");
      expect(excludes).toContain("**/.planning/research/**");
      expect(excludes).toContain("**/.planning/codebase/**");
    });

    it("default globs do NOT include .planning/codebase (excluded separately)", async () => {
      const { getDefaultGlobs } = await import(
        "../../../src/vault/config.js"
      );
      const globs = getDefaultGlobs("L2");

      expect(globs).not.toContain(".planning/codebase/**/*.md");
    });
  });

  describe("loadVaultConfig", () => {
    it("loads new ProjectConfig schema from file", async () => {
      const { loadVaultConfig, saveVaultConfig } = await import(
        "../../../src/vault/config.js"
      );

      const customConfig = {
        version: 1 as const,
        vaultPath: "/custom/vault/path",
        projects: [
          { name: "MyApp", path: "/projects/MyApp", layer: "L2" as const },
          { name: "my-shared-libs", path: "/projects/my-shared-libs", layer: "L1" as const },
        ],
        autoClean: true,
        lastSync: "2026-03-14T00:00:00Z",
      };

      await saveVaultConfig(customConfig);
      const loaded = await loadVaultConfig();

      expect(loaded).toEqual(customConfig);
      expect(loaded.projects).toHaveLength(2);
      expect(loaded.projects[0].name).toBe("MyApp");
      expect(loaded.projects[0].layer).toBe("L2");
      expect(loaded.projects[1].layer).toBe("L1");
    });

    it("old string[] format returns defaults with warning", async () => {
      const { loadVaultConfig, getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );

      const defaults = getDefaultConfig();

      // Write old format config (no version, string[] projects)
      const oldConfig = {
        vaultPath: "/old/vault",
        projects: ["MyApp", "MyOtherApp"],
        autoClean: true,
        includeTemplates: false,
      };
      const configPath = path.join(tmpDir, "vault-config.json");
      await fs.writeFile(configPath, JSON.stringify(oldConfig));

      const loaded = await loadVaultConfig();

      // Should return defaults, not the old config
      expect(loaded).toEqual(defaults);
      expect(loaded.version).toBe(1);
    });

    it("missing version field treated as old format", async () => {
      const { loadVaultConfig, getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );

      const defaults = getDefaultConfig();

      // Write config without version field but with ProjectConfig-like entries
      const noVersionConfig = {
        vaultPath: "/test/vault",
        projects: [],
        autoClean: true,
      };
      const configPath = path.join(tmpDir, "vault-config.json");
      await fs.writeFile(configPath, JSON.stringify(noVersionConfig));

      const loaded = await loadVaultConfig();

      // No version = old format, returns defaults
      expect(loaded).toEqual(defaults);
    });

    it("returns defaults when file does not exist", async () => {
      const { loadVaultConfig, getDefaultConfig } = await import(
        "../../../src/vault/config.js"
      );

      const config = await loadVaultConfig();
      const defaults = getDefaultConfig();

      expect(config).toEqual(defaults);
    });

    it("skips invalid project entries", async () => {
      const { loadVaultConfig } = await import(
        "../../../src/vault/config.js"
      );

      const configWithBadEntries = {
        version: 1,
        vaultPath: "/test/vault",
        projects: [
          { name: "Good", path: "/projects/good", layer: "L2" },
          { name: "MissingLayer", path: "/projects/bad" },
          { path: "/projects/noname", layer: "L1" },
          { name: "InvalidLayer", path: "/projects/inv", layer: "L3" },
        ],
        autoClean: false,
      };
      const configPath = path.join(tmpDir, "vault-config.json");
      await fs.writeFile(configPath, JSON.stringify(configWithBadEntries));

      const loaded = await loadVaultConfig();

      expect(loaded.projects).toHaveLength(1);
      expect(loaded.projects[0].name).toBe("Good");
    });
  });

  describe("saveVaultConfig", () => {
    it("writes version: 1 to output file", async () => {
      const { saveVaultConfig } = await import(
        "../../../src/vault/config.js"
      );

      const config = {
        version: 1 as const,
        vaultPath: "/test",
        projects: [],
        autoClean: false,
      };

      await saveVaultConfig(config);

      const configPath = path.join(tmpDir, "vault-config.json");
      const raw = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);

      expect(parsed.version).toBe(1);
    });
  });
});
