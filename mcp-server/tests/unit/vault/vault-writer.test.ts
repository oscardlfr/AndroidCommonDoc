import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  migrateToLayerFirst,
  writeVault,
  loadManifest,
} from "../../../src/vault/vault-writer.js";
import type { VaultEntry } from "../../../src/vault/types.js";

describe("vault writer", () => {
  let tmpDir: string;

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-writer-test-"));
    return tmpDir;
  }

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create a minimal VaultEntry.
   */
  function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
    return {
      slug: "test-doc",
      vaultPath: "L0-generic/patterns/test-doc.md",
      content: "---\ntags:\n  - pattern\n---\n# Test\n\nContent.",
      frontmatter: { tags: ["pattern"] },
      sourceType: "pattern",
      layer: "L0",
      tags: ["pattern"],
      ...overrides,
    };
  }

  describe("migrateToLayerFirst", () => {
    it("detects old flat structure and removes patterns/, skills/, projects/", async () => {
      const vaultPath = await makeTmpDir();

      // Create old structure
      await fs.mkdir(path.join(vaultPath, "patterns"), { recursive: true });
      await fs.mkdir(path.join(vaultPath, "skills"), { recursive: true });
      await fs.mkdir(path.join(vaultPath, "projects"), { recursive: true });
      await fs.writeFile(
        path.join(vaultPath, "patterns", "test.md"),
        "# old",
        "utf-8",
      );

      const migrated = await migrateToLayerFirst(vaultPath);

      expect(migrated).toBe(true);

      // Old directories should be gone
      await expect(
        fs.access(path.join(vaultPath, "patterns")),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(vaultPath, "skills")),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(vaultPath, "projects")),
      ).rejects.toThrow();
    });

    it("preserves .obsidian/ during migration", async () => {
      const vaultPath = await makeTmpDir();

      // Create old structure + .obsidian/
      await fs.mkdir(path.join(vaultPath, "patterns"), { recursive: true });
      await fs.mkdir(path.join(vaultPath, ".obsidian"), { recursive: true });
      await fs.writeFile(
        path.join(vaultPath, ".obsidian", "app.json"),
        '{"key":"value"}',
        "utf-8",
      );

      await migrateToLayerFirst(vaultPath);

      // .obsidian/ should still exist
      const appJson = await fs.readFile(
        path.join(vaultPath, ".obsidian", "app.json"),
        "utf-8",
      );
      expect(appJson).toContain("value");
    });

    it("returns false when no old structure exists", async () => {
      const vaultPath = await makeTmpDir();

      const migrated = await migrateToLayerFirst(vaultPath);

      expect(migrated).toBe(false);
    });

    it("returns false when new L0-generic structure already exists", async () => {
      const vaultPath = await makeTmpDir();

      // New structure already in place
      await fs.mkdir(path.join(vaultPath, "L0-generic"), { recursive: true });

      const migrated = await migrateToLayerFirst(vaultPath);

      expect(migrated).toBe(false);
    });
  });

  describe("writeVault", () => {
    it("creates layer-first directory structure", async () => {
      const vaultPath = await makeTmpDir();

      const entries = [
        makeEntry({
          slug: "testing",
          vaultPath: "L0-generic/patterns/testing.md",
          layer: "L0",
        }),
        makeEntry({
          slug: "my-shared-libs-conv",
          vaultPath: "L1-ecosystem/my-shared-libs/docs/conv.md",
          layer: "L1",
          project: "my-shared-libs",
        }),
        makeEntry({
          slug: "MyApp-CLAUDE",
          vaultPath: "L2-apps/MyApp/ai/CLAUDE.md",
          layer: "L2",
          project: "MyApp",
        }),
      ];

      const result = await writeVault(vaultPath, entries, { init: true });

      expect(result.written).toBe(3);
      expect(result.errors).toHaveLength(0);

      // Verify directory structure
      await expect(
        fs.access(path.join(vaultPath, "L0-generic", "patterns", "testing.md")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(
          path.join(
            vaultPath,
            "L1-ecosystem",
            "my-shared-libs",
            "docs",
            "conv.md",
          ),
        ),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(
          path.join(vaultPath, "L2-apps", "MyApp", "ai", "CLAUDE.md"),
        ),
      ).resolves.toBeUndefined();
    });

    it("manifest entries include layer field", async () => {
      const vaultPath = await makeTmpDir();

      const entries = [
        makeEntry({
          slug: "testing",
          vaultPath: "L0-generic/patterns/testing.md",
          layer: "L0",
        }),
        makeEntry({
          slug: "MyApp-doc",
          vaultPath: "L2-apps/MyApp/docs/doc.md",
          layer: "L2",
          project: "MyApp",
        }),
      ];

      await writeVault(vaultPath, entries);

      const manifest = await loadManifest(vaultPath);

      const l0Entry = manifest.files["L0-generic/patterns/testing.md"];
      expect(l0Entry).toBeDefined();
      expect(l0Entry.layer).toBe("L0");

      const l2Entry = manifest.files["L2-apps/MyApp/docs/doc.md"];
      expect(l2Entry).toBeDefined();
      expect(l2Entry.layer).toBe("L2");
    });

    it(".obsidian/ only created on init, not on sync", async () => {
      const vaultPath = await makeTmpDir();

      // Sync mode (not init)
      await writeVault(vaultPath, [makeEntry()], { init: false });

      // .obsidian/ should NOT be created
      await expect(
        fs.access(path.join(vaultPath, ".obsidian")),
      ).rejects.toThrow();

      // Init mode
      await writeVault(vaultPath, [makeEntry()], { init: true });

      // .obsidian/ should now exist
      await expect(
        fs.access(path.join(vaultPath, ".obsidian")),
      ).resolves.toBeUndefined();
    });

    it("incremental sync skips unchanged files", async () => {
      const vaultPath = await makeTmpDir();

      const entries = [makeEntry()];

      // First write
      const result1 = await writeVault(vaultPath, entries);
      expect(result1.written).toBe(1);
      expect(result1.unchanged).toBe(0);

      // Second write (same content)
      const result2 = await writeVault(vaultPath, entries);
      expect(result2.written).toBe(0);
      expect(result2.unchanged).toBe(1);
    });
  });
});
