import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeGeneratedRules } from "../../../src/generation/writer.js";
import type { GenerationResult } from "../../../src/generation/writer.js";

/**
 * Tests for the generation writer module.
 *
 * The writer orchestrates the full pipeline: scan docs -> parse rules ->
 * emit Kotlin -> write files -> detect orphans. Uses real filesystem with
 * temp directories for isolation.
 */

/** Create a mock docs directory with pattern docs containing rules frontmatter. */
async function createMockDocsDir(
  tmpDir: string,
): Promise<{ docsDir: string; rulesDir: string; testsDir: string }> {
  const docsDir = path.join(tmpDir, "docs");
  const rulesDir = path.join(tmpDir, "generated-rules");
  const testsDir = path.join(tmpDir, "generated-tests");

  await fs.mkdir(docsDir, { recursive: true });
  await fs.mkdir(rulesDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

  // Pattern doc with a generatable banned-import rule
  const doc1 = [
    "---",
    "scope: [time]",
    "sources: [kotlin-time]",
    "targets: [android, jvm]",
    "rules:",
    "  - id: prefer-kotlin-time",
    "    type: banned-import",
    '    message: "Use kotlin.time instead of java.time"',
    "    detect:",
    "      banned_import: java.time",
    "      prefer: kotlin.time",
    "---",
    "# Time Patterns",
  ].join("\n");

  // Pattern doc with a hand-written rule (should be skipped)
  const doc2 = [
    "---",
    "scope: [viewmodel]",
    "sources: [lifecycle]",
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
    "---",
    "# ViewModel Patterns",
  ].join("\n");

  // Pattern doc with a generatable prefer-construct rule
  const doc3 = [
    "---",
    "scope: [state]",
    "sources: [compose]",
    "targets: [android, desktop]",
    "rules:",
    "  - id: sealed-screen-state",
    "    type: prefer-construct",
    '    message: "ScreenState must be sealed interface"',
    "    detect:",
    "      class_suffix: ScreenState",
    "      must_be: sealed",
    "---",
    "# Screen State Patterns",
  ].join("\n");

  await fs.writeFile(path.join(docsDir, "time-patterns.md"), doc1);
  await fs.writeFile(path.join(docsDir, "viewmodel-patterns.md"), doc2);
  await fs.writeFile(path.join(docsDir, "screen-state-patterns.md"), doc3);

  return { docsDir, rulesDir, testsDir };
}

describe("writeGeneratedRules", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "writer-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("scans docs, collects rules, emits Kotlin, and writes files", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    const result: GenerationResult = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
    });

    // Should have generated 2 rules (prefer-kotlin-time and sealed-screen-state)
    expect(result.generated).toHaveLength(2);

    // Check generated files exist on disk
    for (const gen of result.generated) {
      const ruleExists = await fs
        .stat(gen.ruleFile)
        .then(() => true)
        .catch(() => false);
      const testExists = await fs
        .stat(gen.testFile)
        .then(() => true)
        .catch(() => false);
      expect(ruleExists).toBe(true);
      expect(testExists).toBe(true);
    }
  });

  it("skips hand_written rules (does not write files for them)", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    const result = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
    });

    // hand_written rule should be in skipped
    const handWrittenSkip = result.skipped.find(
      (s) => s.ruleId === "sealed-ui-state",
    );
    expect(handWrittenSkip).toBeDefined();
    expect(handWrittenSkip?.reason).toBe("hand_written");

    // No file should be written for hand-written rule
    const handWrittenFile = path.join(rulesDir, "SealedUiStateRule.kt");
    const exists = await fs
      .stat(handWrittenFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("writes both rule .kt and test .kt files", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    const result = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
    });

    // Find the prefer-kotlin-time generated entry
    const timeRule = result.generated.find(
      (g) => g.ruleId === "prefer-kotlin-time",
    );
    expect(timeRule).toBeDefined();

    // Verify rule file content contains the correct class
    const ruleContent = await fs.readFile(timeRule!.ruleFile, "utf-8");
    expect(ruleContent).toContain("class PreferKotlinTimeRule");
    expect(ruleContent).toContain(
      "com.androidcommondoc.detekt.rules.generated",
    );

    // Verify test file content contains the correct test class
    const testContent = await fs.readFile(timeRule!.testFile, "utf-8");
    expect(testContent).toContain("class PreferKotlinTimeRuleTest");
    expect(testContent).toContain("rule.lint(code)");
  });

  it("generates updated RuleSetProvider import block", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    const result = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
    });

    // providerUpdateBlock should contain class names for generated rules
    expect(result.providerUpdateBlock).toContain("PreferKotlinTimeRule");
    expect(result.providerUpdateBlock).toContain("SealedScreenStateRule");
    // Should NOT contain hand-written rules
    expect(result.providerUpdateBlock).not.toContain("SealedUiStateRule");
  });

  it("removes orphaned generated files (rule removed from frontmatter)", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    // Create an orphaned .kt file that represents a previously generated rule
    await fs.writeFile(
      path.join(rulesDir, "ObsoleteRule.kt"),
      "// Old generated rule",
    );

    const result = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
    });

    // The orphaned file should be in removed list
    expect(result.removed).toContain("ObsoleteRule.kt");

    // The file should be deleted from disk
    const orphanExists = await fs
      .stat(path.join(rulesDir, "ObsoleteRule.kt"))
      .then(() => true)
      .catch(() => false);
    expect(orphanExists).toBe(false);
  });

  it("returns GenerationResult with counts of generated, skipped, removed", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    // Add an orphaned file
    await fs.writeFile(
      path.join(rulesDir, "StaleGeneratedRule.kt"),
      "// stale",
    );

    const result = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
    });

    // 2 generated, 1 skipped (hand_written), 1 removed (orphan)
    expect(result.generated.length).toBe(2);
    expect(result.skipped.length).toBe(1);
    expect(result.removed.length).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(result.configYaml).toContain("AndroidCommonDoc");
  });

  it("handles dry-run mode (returns what would change without writing)", async () => {
    const { docsDir, rulesDir, testsDir } = await createMockDocsDir(tmpDir);

    // Add an orphaned file that should NOT be deleted in dry-run
    await fs.writeFile(
      path.join(rulesDir, "OrphanRule.kt"),
      "// orphan in dry-run",
    );

    const result = await writeGeneratedRules({
      docsDir,
      rulesOutputDir: rulesDir,
      testsOutputDir: testsDir,
      dryRun: true,
    });

    // Result should be populated
    expect(result.generated.length).toBe(2);
    expect(result.skipped.length).toBe(1);
    expect(result.removed.length).toBe(1);
    expect(result.dryRun).toBe(true);

    // But no new files should be written on disk
    const generatedRuleFile = path.join(rulesDir, "PreferKotlinTimeRule.kt");
    const exists = await fs
      .stat(generatedRuleFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);

    // Orphaned file should still exist
    const orphanExists = await fs
      .stat(path.join(rulesDir, "OrphanRule.kt"))
      .then(() => true)
      .catch(() => false);
    expect(orphanExists).toBe(true);
  });
});
