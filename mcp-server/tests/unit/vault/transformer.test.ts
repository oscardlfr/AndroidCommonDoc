import { describe, it, expect } from "vitest";
import {
  transformSource,
  transformAll,
  deriveSlug,
} from "../../../src/vault/transformer.js";
import type { VaultSource } from "../../../src/vault/types.js";

/**
 * Helper to create a minimal VaultSource for testing.
 */
function makeSource(overrides: Partial<VaultSource> = {}): VaultSource {
  return {
    filepath: "/test/file.md",
    content: "---\nscope:\n  - testing\n---\n# Test\n\nBody text.",
    metadata: { scope: ["testing"] },
    sourceType: "pattern",
    layer: "L0",
    relativePath: "L0-generic/patterns/test-doc.md",
    ...overrides,
  };
}

describe("vault transformer", () => {
  describe("deriveSlug", () => {
    it("L0 source gets bare slug without project prefix", () => {
      const source = makeSource({
        layer: "L0",
        relativePath: "L0-generic/patterns/testing-patterns.md",
      });

      const slug = deriveSlug(source);

      expect(slug).toBe("testing-patterns");
    });

    it("L1 source gets project-prefixed slug", () => {
      const source = makeSource({
        layer: "L1",
        project: "my-shared-libs",
        relativePath: "L1-ecosystem/my-shared-libs/docs/conventions.md",
      });

      const slug = deriveSlug(source);

      expect(slug).toBe("my-shared-libs-conventions");
    });

    it("L2 source gets project-prefixed slug", () => {
      const source = makeSource({
        layer: "L2",
        project: "MyApp",
        relativePath: "L2-apps/MyApp/ai/CLAUDE.md",
      });

      const slug = deriveSlug(source);

      expect(slug).toBe("MyApp-CLAUDE");
    });

    it("L1 README uses parent directory for slug disambiguation", () => {
      const source = makeSource({
        layer: "L1",
        project: "my-shared-libs",
        relativePath: "L1-ecosystem/my-shared-libs/docs/core-common/README.md",
      });

      const slug = deriveSlug(source);

      expect(slug).toBe("my-shared-libs-core-common");
    });

    it("different module READMEs get different slugs", () => {
      const source1 = makeSource({
        layer: "L1",
        project: "my-shared-libs",
        relativePath: "L1-ecosystem/my-shared-libs/docs/core-common/README.md",
      });
      const source2 = makeSource({
        layer: "L1",
        project: "my-shared-libs",
        relativePath: "L1-ecosystem/my-shared-libs/docs/core-encryption/README.md",
      });

      expect(deriveSlug(source1)).toBe("my-shared-libs-core-common");
      expect(deriveSlug(source2)).toBe("my-shared-libs-core-encryption");
      expect(deriveSlug(source1)).not.toBe(deriveSlug(source2));
    });

    it("L0 README uses parent directory for slug", () => {
      const source = makeSource({
        layer: "L0",
        relativePath: "L0-generic/AndroidCommonDoc/docs/README.md",
      });

      const slug = deriveSlug(source);

      // Should use parent dir "docs" instead of "README"
      expect(slug).toBe("docs");
    });
  });

  describe("transformSource", () => {
    it("layer field populated on VaultEntry from source", () => {
      const source = makeSource({ layer: "L1", project: "test" });
      const allSlugs = new Set(["test-test-doc"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.layer).toBe("L1");
    });

    it("vault_source_path added to enriched frontmatter", () => {
      const source = makeSource({
        filepath: "/path/to/file.md",
      });
      const allSlugs = new Set(["test-doc"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.frontmatter.vault_source_path).toBe("/path/to/file.md");
    });

    it("architecture sourceType mapped to vault_type 'architecture'", () => {
      const source = makeSource({
        sourceType: "architecture",
        content: "# Architecture\n\nDesign doc.",
        metadata: null,
      });
      const allSlugs = new Set(["test-doc"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.frontmatter.vault_type).toBe("architecture");
    });

    it("vault_synced date present in frontmatter", () => {
      const source = makeSource();
      const allSlugs = new Set(["test-doc"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.frontmatter.vault_synced).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("tags generated and included in entry", () => {
      const source = makeSource({
        metadata: { scope: ["compose"], targets: ["android"] },
      });
      const allSlugs = new Set(["test-doc"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.tags).toContain("compose");
      expect(entry.tags).toContain("android");
      expect(entry.tags).toContain("pattern");
    });

    it("category field from source metadata passes through to VaultEntry frontmatter", () => {
      const source = makeSource({
        content: "---\nscope:\n  - testing\ncategory: testing\n---\n# Test\n\nBody text.",
        metadata: { scope: ["testing"], category: "testing" },
      });
      const allSlugs = new Set(["test-doc"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.frontmatter.category).toBe("testing");
    });

    it("vaultPath normalizes UPPERCASE filenames to lowercase-kebab-case", () => {
      const source = makeSource({
        layer: "L2",
        project: "MyApp",
        relativePath: "L2-apps/MyApp/planning/ARCHITECTURE.md",
      });
      const allSlugs = new Set(["MyApp-ARCHITECTURE"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.vaultPath).toBe(
        "L2-apps/MyApp/planning/architecture.md",
      );
    });

    it("vaultPath normalizes UPPERCASE_SNAKE to lowercase-kebab-case", () => {
      const source = makeSource({
        layer: "L2",
        project: "MyApp",
        relativePath: "L2-apps/MyApp/planning/TESTING_STRATEGY.md",
      });
      const allSlugs = new Set(["MyApp-TESTING_STRATEGY"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.vaultPath).toBe(
        "L2-apps/MyApp/planning/testing-strategy.md",
      );
    });

    it("vaultPath preserves already-lowercase-kebab filenames", () => {
      const source = makeSource({
        layer: "L0",
        relativePath: "L0-generic/patterns/testing-patterns.md",
      });
      const allSlugs = new Set(["testing-patterns"]);

      const entry = transformSource(source, allSlugs);

      expect(entry.vaultPath).toBe(
        "L0-generic/patterns/testing-patterns.md",
      );
    });
  });

  describe("transformAll", () => {
    it("all slugs are unique across layers", () => {
      const sources = [
        makeSource({
          layer: "L0",
          relativePath: "L0-generic/patterns/testing.md",
        }),
        makeSource({
          layer: "L1",
          project: "my-shared-libs",
          relativePath: "L1-ecosystem/my-shared-libs/docs/testing.md",
        }),
      ];

      const entries = transformAll(sources);

      const slugs = entries.map((e) => e.slug);
      expect(slugs[0]).toBe("testing");
      expect(slugs[1]).toBe("my-shared-libs-testing");
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it("body wikilink injection is disabled — body text is preserved as-is", () => {
      // Body wikilink injection was disabled because Obsidian resolves body
      // wikilinks by filename first (not alias), causing empty ghost notes for
      // alias-based entries like readme.md files. Graph connectivity comes
      // exclusively from MOC pages which use explicit, curated wikilinks.
      const sources = [
        makeSource({
          layer: "L0",
          content: "# Testing\n\nRefer to error-handling guide.",
          metadata: null,
          relativePath: "L0-generic/patterns/testing.md",
        }),
        makeSource({
          layer: "L0",
          content: "# Error Handling\n\nBody.",
          metadata: null,
          relativePath: "L0-generic/patterns/error-handling.md",
        }),
      ];

      const entries = transformAll(sources);
      const testingEntry = entries.find((e) => e.slug === "testing")!;

      // Body should be preserved verbatim — no wikilinks injected
      expect(testingEntry.content).toContain("Refer to error-handling guide.");
      expect(testingEntry.content).not.toContain("[[error-handling]]");
    });
  });
});
