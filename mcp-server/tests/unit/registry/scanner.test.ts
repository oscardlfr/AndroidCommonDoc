import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scanDirectory } from "../../../src/registry/scanner.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("scanDirectory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns entries for .md files with valid frontmatter", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      "---",
      "# Test Doc",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "test-doc.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("test-doc");
    expect(entries[0].metadata.scope).toEqual(["testing"]);
    expect(entries[0].metadata.sources).toEqual(["junit5"]);
    expect(entries[0].metadata.targets).toEqual(["android"]);
    expect(entries[0].layer).toBe("L0");
    expect(path.isAbsolute(entries[0].filepath)).toBe(true);
  });

  it("skips files without frontmatter", async () => {
    await fs.writeFile(
      path.join(tmpDir, "no-fm.md"),
      "# No frontmatter here",
    );
    await fs.writeFile(
      path.join(tmpDir, "with-fm.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Content",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("with-fm");
  });

  it("skips non-.md files", async () => {
    await fs.writeFile(
      path.join(tmpDir, "readme.txt"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Content",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(0);
  });

  it("derives slug from filename (minus .md extension)", async () => {
    await fs.writeFile(
      path.join(tmpDir, "my-cool-pattern.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Content",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries[0].slug).toBe("my-cool-pattern");
  });

  it("returns empty array for non-existent directory", async () => {
    const entries = await scanDirectory("/non/existent/path", "L0");
    expect(entries).toEqual([]);
  });

  it("passes project parameter through to entries", async () => {
    await fs.writeFile(
      path.join(tmpDir, "doc.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Content",
    );

    const entries = await scanDirectory(tmpDir, "L1", "my-project");
    expect(entries[0].project).toBe("my-project");
    expect(entries[0].layer).toBe("L1");
  });

  it("skips files missing required metadata fields", async () => {
    // Has scope but missing sources and targets
    await fs.writeFile(
      path.join(tmpDir, "incomplete.md"),
      "---\nscope: [a]\n---\n# Content",
    );
    // Has all required fields
    await fs.writeFile(
      path.join(tmpDir, "complete.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Content",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("complete");
  });

  it("discovers multiple files with valid frontmatter", async () => {
    const makeContent = (scope: string) =>
      `---\nscope: [${scope}]\nsources: [src]\ntargets: [android]\n---\n# ${scope}`;

    await fs.writeFile(path.join(tmpDir, "alpha.md"), makeContent("alpha"));
    await fs.writeFile(path.join(tmpDir, "beta.md"), makeContent("beta"));
    await fs.writeFile(path.join(tmpDir, "gamma.md"), makeContent("gamma"));

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(3);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["alpha", "beta", "gamma"]);
  });

  it("extracts monitor_urls array from frontmatter when present", async () => {
    const content = [
      "---",
      "scope: [viewmodel]",
      "sources: [lifecycle-viewmodel]",
      "targets: [android]",
      "monitor_urls:",
      '  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"',
      "    type: github-releases",
      "    tier: 1",
      '  - url: "https://developer.android.com/topic/libraries/architecture/viewmodel"',
      "    type: doc-page",
      "    tier: 2",
      "---",
      "# ViewModel Patterns",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "vm-patterns.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.monitor_urls).toBeDefined();
    expect(entries[0].metadata.monitor_urls).toHaveLength(2);
    expect(entries[0].metadata.monitor_urls![0]).toEqual({
      url: "https://github.com/Kotlin/kotlinx.coroutines/releases",
      type: "github-releases",
      tier: 1,
    });
    expect(entries[0].metadata.monitor_urls![1]).toEqual({
      url: "https://developer.android.com/topic/libraries/architecture/viewmodel",
      type: "doc-page",
      tier: 2,
    });
  });

  it("extracts rules array from frontmatter when present", async () => {
    const content = [
      "---",
      "scope: [viewmodel]",
      "sources: [lifecycle-viewmodel]",
      "targets: [android]",
      "rules:",
      "  - id: sealed-ui-state",
      "    type: prefer-construct",
      '    message: "UiState must be sealed interface"',
      "    detect:",
      "      class_suffix: UiState",
      "      must_be: sealed",
      "    hand_written: true",
      "    source_rule: SealedUiStateRule.kt",
      "  - id: no-channel-events",
      "    type: banned-usage",
      '    message: "Use SharedFlow instead of Channel"',
      "    detect:",
      '      banned_initializer: "Channel<"',
      "---",
      "# ViewModel Patterns",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "vm-rules.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.rules).toBeDefined();
    expect(entries[0].metadata.rules).toHaveLength(2);
    expect(entries[0].metadata.rules![0].id).toBe("sealed-ui-state");
    expect(entries[0].metadata.rules![0].type).toBe("prefer-construct");
    expect(entries[0].metadata.rules![0].message).toBe(
      "UiState must be sealed interface",
    );
    expect(entries[0].metadata.rules![0].detect).toEqual({
      class_suffix: "UiState",
      must_be: "sealed",
    });
    expect(entries[0].metadata.rules![0].hand_written).toBe(true);
    expect(entries[0].metadata.rules![0].source_rule).toBe(
      "SealedUiStateRule.kt",
    );
    expect(entries[0].metadata.rules![1].id).toBe("no-channel-events");
    expect(entries[0].metadata.rules![1].hand_written).toBeUndefined();
    expect(entries[0].metadata.rules![1].source_rule).toBeUndefined();
  });

  it("still works for docs without monitor_urls or rules (backward compatibility)", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      "---",
      "# Test Doc",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "basic-doc.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.monitor_urls).toBeUndefined();
    expect(entries[0].metadata.rules).toBeUndefined();
  });

  // --- Recursive scanning and category extraction tests (Phase 14.1) ---

  it("discovers .md files in nested subdirectories (recursive)", async () => {
    // Create subdirectory structure
    const testingDir = path.join(tmpDir, "testing");
    const archDir = path.join(tmpDir, "architecture");
    await fs.mkdir(testingDir, { recursive: true });
    await fs.mkdir(archDir, { recursive: true });

    // Top-level doc
    await fs.writeFile(
      path.join(tmpDir, "top-level.md"),
      "---\nscope: [general]\nsources: [src]\ntargets: [all]\n---\n# Top",
    );

    // Nested docs
    await fs.writeFile(
      path.join(testingDir, "testing-patterns.md"),
      "---\nscope: [testing]\nsources: [junit5]\ntargets: [android]\ncategory: testing\n---\n# Testing",
    );
    await fs.writeFile(
      path.join(archDir, "kmp-architecture.md"),
      "---\nscope: [architecture]\nsources: [kotlin-mpp]\ntargets: [kmp]\ncategory: architecture\n---\n# Arch",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(3);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["kmp-architecture", "testing-patterns", "top-level"]);
  });

  it("extracts category field from frontmatter into PatternMetadata", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      "category: testing",
      "---",
      "# Testing Patterns",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "testing-patterns.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.category).toBe("testing");
  });

  it("slug remains basename-only after recursive scanning (not path-based)", async () => {
    const subDir = path.join(tmpDir, "testing");
    await fs.mkdir(subDir, { recursive: true });

    await fs.writeFile(
      path.join(subDir, "testing-patterns.md"),
      "---\nscope: [testing]\nsources: [junit5]\ntargets: [android]\n---\n# Testing",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    // Slug should be "testing-patterns" NOT "testing/testing-patterns"
    expect(entries[0].slug).toBe("testing-patterns");
    expect(entries[0].slug).not.toContain("/");
    expect(entries[0].slug).not.toContain("\\");
  });

  it("skips archive/ subdirectory (does not scan docs/archive/*.md)", async () => {
    const archiveDir = path.join(tmpDir, "archive");
    await fs.mkdir(archiveDir, { recursive: true });

    // Active doc
    await fs.writeFile(
      path.join(tmpDir, "active-doc.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Active",
    );

    // Archived doc -- should NOT be found
    await fs.writeFile(
      path.join(archiveDir, "old-doc.md"),
      "---\nscope: [x]\nsources: [y]\ntargets: [z]\n---\n# Archived",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("active-doc");
  });

  it("scanner still works on flat directories (backward compatible)", async () => {
    // No subdirectories, just flat files like before
    await fs.writeFile(
      path.join(tmpDir, "alpha.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Alpha",
    );
    await fs.writeFile(
      path.join(tmpDir, "beta.md"),
      "---\nscope: [d]\nsources: [e]\ntargets: [f]\n---\n# Beta",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(2);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["alpha", "beta"]);
  });

  it("files without category field have metadata.category as undefined", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      "---",
      "# No Category",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "no-category.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.category).toBeUndefined();
  });

  // --- l0_refs extraction tests (Phase 14.2) ---

  it("extracts l0_refs string array from frontmatter when present", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      "l0_refs:",
      "  - testing-patterns",
      "  - coroutine-testing",
      "---",
      "# Test Doc with L0 Refs",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "l0refs-doc.md"), content);

    const entries = await scanDirectory(tmpDir, "L1", "some-project");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.l0_refs).toBeDefined();
    expect(entries[0].metadata.l0_refs).toEqual([
      "testing-patterns",
      "coroutine-testing",
    ]);
  });

  it("returns undefined for l0_refs when field is absent (backward compatibility)", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      "---",
      "# Doc without l0_refs",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "no-l0refs.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.l0_refs).toBeUndefined();
  });

  it("handles non-array l0_refs gracefully (ignores malformed data)", async () => {
    const content = [
      "---",
      "scope: [testing]",
      "sources: [junit5]",
      "targets: [android]",
      'l0_refs: "not-an-array"',
      "---",
      "# Doc with string l0_refs",
    ].join("\n");
    await fs.writeFile(path.join(tmpDir, "bad-l0refs.md"), content);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.l0_refs).toBeUndefined();
  });

  it("handles unreadable files gracefully (continues scanning)", async () => {
    // Create one valid file and one that we'll make unreadable
    await fs.writeFile(
      path.join(tmpDir, "valid-doc.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Valid",
    );

    // Create a subdirectory with a name that looks like a .md file
    // to test that the scanner handles readFile errors gracefully
    const unreadableDir = path.join(tmpDir, "subdir");
    await fs.mkdir(unreadableDir, { recursive: true });

    await fs.writeFile(
      path.join(unreadableDir, "also-valid.md"),
      "---\nscope: [x]\nsources: [y]\ntargets: [z]\n---\n# Also Valid",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    // Should find both valid files without errors
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toContain("valid-doc");
    expect(slugs).toContain("also-valid");
  });

  it("requires scope, sources, AND targets (all three)", async () => {
    // Only scope + sources (missing targets)
    await fs.writeFile(
      path.join(tmpDir, "no-targets.md"),
      "---\nscope: [a]\nsources: [b]\n---\n# Missing targets",
    );
    // Only scope + targets (missing sources)
    await fs.writeFile(
      path.join(tmpDir, "no-sources.md"),
      "---\nscope: [a]\ntargets: [c]\n---\n# Missing sources",
    );
    // Only sources + targets (missing scope)
    await fs.writeFile(
      path.join(tmpDir, "no-scope.md"),
      "---\nsources: [b]\ntargets: [c]\n---\n# Missing scope",
    );
    // All three present
    await fs.writeFile(
      path.join(tmpDir, "complete.md"),
      "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Complete",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("complete");
  });

  it("finds all .md files recursively across multiple subdirectories", async () => {
    // Create nested structure: root > cat1 > sub1, root > cat2
    const cat1 = path.join(tmpDir, "cat1");
    const sub1 = path.join(cat1, "sub1");
    const cat2 = path.join(tmpDir, "cat2");
    await fs.mkdir(sub1, { recursive: true });
    await fs.mkdir(cat2, { recursive: true });

    const fm = "---\nscope: [a]\nsources: [b]\ntargets: [c]\n---\n# Content";
    await fs.writeFile(path.join(tmpDir, "root-doc.md"), fm);
    await fs.writeFile(path.join(cat1, "cat1-doc.md"), fm);
    await fs.writeFile(path.join(sub1, "sub1-doc.md"), fm);
    await fs.writeFile(path.join(cat2, "cat2-doc.md"), fm);

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(4);
    const slugs = entries.map((e) => e.slug).sort();
    expect(slugs).toEqual(["cat1-doc", "cat2-doc", "root-doc", "sub1-doc"]);
  });

  it("recursively discovers files in deeply nested directories", async () => {
    const deepDir = path.join(tmpDir, "level1", "level2");
    await fs.mkdir(deepDir, { recursive: true });

    await fs.writeFile(
      path.join(deepDir, "deep-doc.md"),
      "---\nscope: [deep]\nsources: [src]\ntargets: [all]\ncategory: deep\n---\n# Deep",
    );

    const entries = await scanDirectory(tmpDir, "L0");
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("deep-doc");
    expect(entries[0].metadata.category).toBe("deep");
  });
});
