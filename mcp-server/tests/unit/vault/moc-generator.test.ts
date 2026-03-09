import { describe, it, expect } from "vitest";
import {
  generateAllMOCs,
  generateHomeMOC,
  generateAllPatternsMOC,
  generateAllModulesMOC,
  generateByLayerMOC,
  generateByProjectMOC,
  generateAllDecisionsMOC,
} from "../../../src/vault/moc-generator.js";
import type { VaultEntry } from "../../../src/vault/types.js";

/**
 * Helper to create a minimal VaultEntry for testing.
 */
function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    slug: "test-doc",
    vaultPath: "L0-generic/patterns/test-doc.md",
    content: "# Test\n\nContent.",
    frontmatter: {},
    sourceType: "pattern",
    layer: "L0",
    tags: ["pattern", "l0"],
    ...overrides,
  };
}

/**
 * Build a representative set of entries across all layers.
 * Now includes category frontmatter for category-grouped MOC tests.
 */
function buildTestEntries(): VaultEntry[] {
  return [
    // L0 entries with categories
    makeEntry({
      slug: "testing-patterns",
      vaultPath: "L0-generic/patterns/testing/testing-patterns.md",
      sourceType: "pattern",
      layer: "L0",
      tags: ["pattern", "l0"],
      frontmatter: { scope: ["testing"], category: "testing" },
    }),
    makeEntry({
      slug: "error-handling",
      vaultPath: "L0-generic/patterns/error-handling/error-handling.md",
      sourceType: "pattern",
      layer: "L0",
      tags: ["pattern", "l0"],
      frontmatter: { scope: ["error"], category: "error-handling" },
    }),
    makeEntry({
      slug: "compose-resources",
      vaultPath: "L0-generic/patterns/compose/compose-resources.md",
      sourceType: "pattern",
      layer: "L0",
      tags: ["pattern", "l0"],
      frontmatter: { scope: ["compose"], category: "compose" },
    }),
    makeEntry({
      slug: "no-category-doc",
      vaultPath: "L0-generic/patterns/uncategorized/no-category-doc.md",
      sourceType: "pattern",
      layer: "L0",
      tags: ["pattern", "l0"],
      frontmatter: { scope: ["misc"] },
    }),
    makeEntry({
      slug: "sync-vault",
      vaultPath: "L0-generic/skills/sync-vault.md",
      sourceType: "skill",
      layer: "L0",
      tags: ["skill", "l0"],
    }),
    makeEntry({
      slug: "PROJECT",
      vaultPath: "L0-generic/AndroidCommonDoc/planning/PROJECT.md",
      sourceType: "planning",
      layer: "L0",
      tags: ["planning", "l0"],
    }),
    // L1 entries
    makeEntry({
      slug: "my-shared-libs-CLAUDE",
      vaultPath: "L1-ecosystem/my-shared-libs/ai/CLAUDE.md",
      sourceType: "claude-md",
      layer: "L1",
      project: "my-shared-libs",
      tags: ["reference", "l1", "ecosystem", "my-shared-libs"],
    }),
    makeEntry({
      slug: "my-shared-libs-conventions",
      vaultPath: "L1-ecosystem/my-shared-libs/docs/conventions.md",
      sourceType: "docs",
      layer: "L1",
      project: "my-shared-libs",
      tags: ["reference", "l1", "ecosystem", "my-shared-libs"],
    }),
    // L1 module entries (core-* module READMEs)
    makeEntry({
      slug: "my-shared-libs-core-common",
      vaultPath: "L1-ecosystem/my-shared-libs/docs/core-common/README.md",
      sourceType: "docs",
      layer: "L1",
      project: "my-shared-libs",
      tags: ["reference", "l1", "ecosystem", "my-shared-libs"],
      frontmatter: { category: "architecture", description: "Common utilities and ID generation" },
    }),
    makeEntry({
      slug: "my-shared-libs-core-encryption",
      vaultPath: "L1-ecosystem/my-shared-libs/docs/core-encryption/README.md",
      sourceType: "docs",
      layer: "L1",
      project: "my-shared-libs",
      tags: ["reference", "l1", "ecosystem", "my-shared-libs"],
      frontmatter: { category: "security", description: "Platform-native AES encryption" },
    }),
    makeEntry({
      slug: "my-shared-libs-core-error-network",
      vaultPath: "L1-ecosystem/my-shared-libs/docs/core-error-network/README.md",
      sourceType: "docs",
      layer: "L1",
      project: "my-shared-libs",
      tags: ["reference", "l1", "ecosystem", "my-shared-libs"],
      frontmatter: { category: "data", description: "Maps NetworkException to DomainException" },
    }),
    // L2 entries
    makeEntry({
      slug: "MyApp-CLAUDE",
      vaultPath: "L2-apps/MyApp/ai/CLAUDE.md",
      sourceType: "claude-md",
      layer: "L2",
      project: "MyApp",
      tags: ["reference", "l2", "app", "myapp"],
    }),
    makeEntry({
      slug: "MyApp-feature",
      vaultPath: "L2-apps/MyApp/docs/feature.md",
      sourceType: "docs",
      layer: "L2",
      project: "MyApp",
      tags: ["reference", "l2", "app", "myapp"],
    }),
    makeEntry({
      slug: "MyApp-ARCHITECTURE",
      vaultPath: "L2-apps/MyApp/planning/ARCHITECTURE.md",
      sourceType: "architecture",
      layer: "L2",
      project: "MyApp",
      tags: ["architecture", "l2", "app", "myapp"],
    }),
    // L2 sub-project entry
    makeEntry({
      slug: "MyApp-SubWidget-README",
      vaultPath:
        "L2-apps/MyApp/sub-projects/SubWidget/docs/README.md",
      sourceType: "docs",
      layer: "L2",
      project: "MyApp",
      subProject: "SubWidget",
      tags: ["reference", "l2", "app", "myapp", "subwidget"],
    }),
  ];
}

describe("vault moc-generator", () => {
  describe("generateAllMOCs", () => {
    it("returns 7 MOC entries", () => {
      const entries = buildTestEntries();
      const mocs = generateAllMOCs(entries);

      expect(mocs).toHaveLength(7);
    });

    it("all MOCs have moc tag", () => {
      const entries = buildTestEntries();
      const mocs = generateAllMOCs(entries);

      for (const moc of mocs) {
        expect(moc.tags).toContain("moc");
      }
    });

    it("all MOCs have vault_type 'moc' in frontmatter", () => {
      const entries = buildTestEntries();
      const mocs = generateAllMOCs(entries);

      for (const moc of mocs) {
        expect(moc.frontmatter.vault_type).toBe("moc");
      }
    });
  });

  describe("generateHomeMOC", () => {
    it("Home.md contains layer count table", () => {
      const entries = buildTestEntries();
      const home = generateHomeMOC(entries);

      expect(home.content).toContain("L0 Generic");
      expect(home.content).toContain("L1 Ecosystem");
      expect(home.content).toContain("L2 Apps");
      // Verify it has a table format
      expect(home.content).toContain("| Layer | Count | Description |");
    });

    it("Home.md contains MOC navigation links", () => {
      const entries = buildTestEntries();
      const home = generateHomeMOC(entries);

      expect(home.content).toContain("[[All Patterns]]");
      expect(home.content).toContain("[[All Modules]]");
      expect(home.content).toContain("[[All Skills]]");
      expect(home.content).toContain("[[All Decisions]]");
    });

    it("Home.md includes last sync date", () => {
      const entries = buildTestEntries();
      const home = generateHomeMOC(entries);

      expect(home.content).toMatch(/Last sync: \d{4}-\d{2}-\d{2}/);
    });

    it("Home.md has correct vault path", () => {
      const entries = buildTestEntries();
      const home = generateHomeMOC(entries);

      expect(home.vaultPath).toBe("00-MOC/Home.md");
    });
  });

  describe("generateByLayerMOC", () => {
    it("has descriptive sublabel: L0 -- Generic Patterns", () => {
      const entries = buildTestEntries();
      const byLayer = generateByLayerMOC(entries);

      expect(byLayer.content).toContain("## L0 -- Generic Patterns");
    });

    it("has descriptive sublabel: L1 -- Ecosystem", () => {
      const entries = buildTestEntries();
      const byLayer = generateByLayerMOC(entries);

      expect(byLayer.content).toContain(
        "## L1 -- Ecosystem",
      );
    });

    it("has descriptive sublabel: L2 -- App-Specific", () => {
      const entries = buildTestEntries();
      const byLayer = generateByLayerMOC(entries);

      expect(byLayer.content).toContain("## L2 -- App-Specific");
    });

    it("L2 entries grouped by project with sub-headers", () => {
      const entries = buildTestEntries();
      const byLayer = generateByLayerMOC(entries);

      expect(byLayer.content).toContain("### MyApp");
    });

    it("sub-projects listed under parent project", () => {
      const entries = buildTestEntries();
      const byLayer = generateByLayerMOC(entries);

      // Sub-project should appear as #### under the parent
      expect(byLayer.content).toContain("#### SubWidget");
    });
  });

  describe("generateByProjectMOC", () => {
    it("layer annotations after project headers", () => {
      const entries = buildTestEntries();
      const byProject = generateByProjectMOC(entries);

      expect(byProject.content).toContain("## MyApp (L2)");
      expect(byProject.content).toContain("## my-shared-libs (L1)");
      expect(byProject.content).toContain(
        "## AndroidCommonDoc (L0)",
      );
    });

    it("sub-projects in their own sub-section", () => {
      const entries = buildTestEntries();
      const byProject = generateByProjectMOC(entries);

      expect(byProject.content).toContain("### Sub-Projects");
      expect(byProject.content).toContain("#### SubWidget");
    });
  });

  describe("generateAllDecisionsMOC", () => {
    it("includes architecture sourceType entries", () => {
      const entries = buildTestEntries();
      const decisions = generateAllDecisionsMOC(entries);

      // Architecture entries should be included alongside planning entries
      expect(decisions.content).toContain("ARCHITECTURE");
      expect(decisions.content).toContain("(architecture)");
    });

    it("groups by project", () => {
      const entries = buildTestEntries();
      const decisions = generateAllDecisionsMOC(entries);

      expect(decisions.content).toContain("## MyApp");
      expect(decisions.content).toContain("## AndroidCommonDoc");
    });
  });

  describe("generateAllPatternsMOC - category grouping", () => {
    it("groups entries by category with category headers", () => {
      const entries = buildTestEntries();
      const moc = generateAllPatternsMOC(entries);

      // Should have category-based headers
      expect(moc.content).toContain("### testing");
      expect(moc.content).toContain("### error-handling");
      expect(moc.content).toContain("### compose");
    });

    it("entries without category grouped under Uncategorized", () => {
      const entries = buildTestEntries();
      const moc = generateAllPatternsMOC(entries);

      // no-category-doc should be under uncategorized
      expect(moc.content).toMatch(/###.*[Uu]ncategorized/);
      expect(moc.content).toContain("no-category-doc");
    });
  });

  describe("generateByLayerMOC - category grouping", () => {
    it("shows categories per layer instead of flat lists", () => {
      const entries = buildTestEntries();
      const moc = generateByLayerMOC(entries);

      // L0 section should have category sub-headers
      expect(moc.content).toMatch(/###.*testing/);
    });
  });

  describe("generateByProjectMOC - category summary", () => {
    it("shows category counts per project instead of every file", () => {
      const entries = buildTestEntries();
      const moc = generateByProjectMOC(entries);

      // AndroidCommonDoc (L0) section should have category summary
      expect(moc.content).toMatch(/\d+ docs?\)/);
    });
  });

  describe("generateHomeMOC - category navigation tree", () => {
    it("produces category-based navigation tree with pattern domain links", () => {
      const entries = buildTestEntries();
      const home = generateHomeMOC(entries);

      // Should have a "Patterns by Domain" or similar category navigation section
      expect(home.content).toMatch(/[Pp]atterns/);
      // Should have quick links to MOC pages
      expect(home.content).toContain("[[All Patterns]]");
      expect(home.content).toContain("[[All Modules]]");
      expect(home.content).toContain("[[All Skills]]");
      expect(home.content).toContain("[[All Decisions]]");
    });

    it("Home.md shows category names with doc counts", () => {
      const entries = buildTestEntries();
      const home = generateHomeMOC(entries);

      // Category entries should have counts (e.g., "testing (1)")
      expect(home.content).toMatch(/testing.*\(\d+\)/i);
    });
  });

  describe("generateAllModulesMOC", () => {
    it("has correct vault path", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      expect(moc.vaultPath).toBe("00-MOC/All Modules.md");
    });

    it("includes L1 module entries with core-* slugs", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      expect(moc.content).toContain("core-common");
      expect(moc.content).toContain("core-encryption");
      expect(moc.content).toContain("core-error-network");
    });

    it("excludes non-module L1 entries", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      // conventions doc is L1 docs but not a core-* module
      expect(moc.content).not.toContain("conventions");
    });

    it("groups modules by category", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      expect(moc.content).toContain("## architecture");
      expect(moc.content).toContain("## security");
      expect(moc.content).toContain("## data");
    });

    it("includes module descriptions from frontmatter", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      expect(moc.content).toContain("Common utilities and ID generation");
      expect(moc.content).toContain("Platform-native AES encryption");
    });

    it("shows total module count", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      expect(moc.content).toContain("**Total modules:** 3");
    });

    it("has moc tag", () => {
      const entries = buildTestEntries();
      const moc = generateAllModulesMOC(entries);

      expect(moc.tags).toContain("moc");
    });
  });
});
