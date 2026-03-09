import { describe, it, expect } from "vitest";
import { detectDuplicates } from "../../../src/vault/sync-engine.js";
import type { VaultEntry } from "../../../src/vault/types.js";

/**
 * Helper to create a minimal VaultEntry for testing detectDuplicates.
 */
function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    slug: "test-slug",
    vaultPath: "L0-generic/patterns/test-doc.md",
    content: "# Test\n\nBody.",
    frontmatter: { vault_source: "/test/file.md" },
    sourceType: "pattern",
    layer: "L0",
    tags: ["pattern"],
    ...overrides,
  };
}

describe("detectDuplicates", () => {
  it("returns empty array for empty input", () => {
    const errors = detectDuplicates([]);
    expect(errors).toEqual([]);
  });

  it("returns empty array for unique entries", () => {
    const entries = [
      makeEntry({
        slug: "a",
        vaultPath: "L0-generic/patterns/a.md",
        frontmatter: { vault_source: "/test/a.md" },
      }),
      makeEntry({
        slug: "b",
        vaultPath: "L0-generic/patterns/b.md",
        frontmatter: { vault_source: "/test/b.md" },
      }),
    ];

    const errors = detectDuplicates(entries);
    expect(errors).toEqual([]);
  });

  it("detects case-insensitive vault path collision", () => {
    const entries = [
      makeEntry({
        slug: "architecture",
        vaultPath: "L2-apps/MyApp/planning/architecture.md",
        frontmatter: { vault_source: "/test/a.md" },
      }),
      makeEntry({
        slug: "ARCHITECTURE",
        vaultPath: "L2-apps/MyApp/planning/ARCHITECTURE.md",
        frontmatter: { vault_source: "/test/b.md" },
      }),
    ];

    const errors = detectDuplicates(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Duplicate vault path");
  });

  it("detects same source file mapped to multiple vault paths", () => {
    const entries = [
      makeEntry({
        slug: "doc-a",
        vaultPath: "L2-apps/MyApp/planning/arch.md",
        frontmatter: { vault_source: "/same/source.md" },
      }),
      makeEntry({
        slug: "doc-b",
        vaultPath: "L2-apps/MyApp/docs/arch.md",
        frontmatter: { vault_source: "/same/source.md" },
      }),
    ];

    const errors = detectDuplicates(entries);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("mapped to 2 vault paths");
  });

  it("ignores entries without vault_source (e.g., MOC pages)", () => {
    const entries = [
      makeEntry({
        slug: "moc-a",
        vaultPath: "L0-generic/MOC.md",
        frontmatter: {},
      }),
      makeEntry({
        slug: "moc-b",
        vaultPath: "L1-ecosystem/MOC.md",
        frontmatter: {},
      }),
    ];

    const errors = detectDuplicates(entries);
    expect(errors).toEqual([]);
  });
});
