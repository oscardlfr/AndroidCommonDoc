/**
 * Generation writer module -- full pipeline orchestrator.
 *
 * Coordinates the end-to-end rule generation pipeline:
 * 1. Scan docs directory for pattern documents with `rules:` frontmatter
 * 2. Parse rule definitions (collectAllRules from rule-parser)
 * 3. Emit Kotlin source code (emitRule from kotlin-emitter)
 * 4. Emit Kotlin test source code (emitRuleTest from test-emitter)
 * 5. Write .kt files to the generated/ directories
 * 6. Detect and remove orphaned generated files
 * 7. Generate RuleSetProvider update block and config YAML
 *
 * Supports dry-run mode: returns what would change without writing files.
 * Never touches hand-written rules -- only writes to the generated/ directories.
 */

import { readdir, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { collectAllRules } from "./rule-parser.js";
import { emitRule, emitRuleSetProviderUpdate } from "./kotlin-emitter.js";
import { emitRuleTest } from "./test-emitter.js";
import { emitFullConfig } from "./config-emitter.js";
import type { RuleDefinition } from "../registry/types.js";

/** Result of a generation run. */
export interface GenerationResult {
  /** Successfully generated rules with their output file paths. */
  generated: Array<{
    ruleId: string;
    ruleFile: string;
    testFile: string;
  }>;
  /** Rules that were skipped (hand_written or unsupported type). */
  skipped: Array<{
    ruleId: string;
    reason: string;
  }>;
  /** Filenames of orphaned generated files that were removed. */
  removed: string[];
  /** Code snippet for updating AndroidCommonDocRuleSetProvider. */
  providerUpdateBlock: string;
  /** Full detekt config YAML for the AndroidCommonDoc rule set. */
  configYaml: string;
  /** Whether this was a dry-run (no files written/deleted). */
  dryRun: boolean;
}

/** Options for writeGeneratedRules. */
export interface WriteGeneratedRulesOptions {
  /** Absolute path to the docs directory to scan for pattern docs. */
  docsDir: string;
  /** Absolute path to write generated rule .kt files. */
  rulesOutputDir: string;
  /** Absolute path to write generated rule test .kt files. */
  testsOutputDir: string;
  /** If true, returns what would change without writing files. */
  dryRun?: boolean;
}

/**
 * Convert a kebab-case rule ID to PascalCase.
 *
 * @example toPascalCase("prefer-kotlin-time") => "PreferKotlinTime"
 */
function toPascalCase(kebab: string): string {
  return kebab
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Orchestrate the full rule generation pipeline.
 *
 * Scans the docs directory, parses rule definitions, emits Kotlin source
 * and test files, detects orphaned files, and returns a structured result.
 *
 * @param options - Configuration for the generation run
 * @returns Structured result with generated, skipped, removed counts
 */
export async function writeGeneratedRules(
  options: WriteGeneratedRulesOptions,
): Promise<GenerationResult> {
  const { docsDir, rulesOutputDir, testsOutputDir, dryRun = false } = options;

  const generated: GenerationResult["generated"] = [];
  const skipped: GenerationResult["skipped"] = [];
  const removed: string[] = [];
  const allRules: RuleDefinition[] = [];
  const generatedClassNames: string[] = [];
  const generatedRuleFilenames = new Set<string>();

  // Step 1: Collect all rules from docs directory
  const collectedRules = await collectAllRules(docsDir);

  // Step 2: Process each rule
  for (const { rule } of collectedRules) {
    allRules.push(rule);

    // Skip hand-written rules
    if (rule.hand_written === true) {
      skipped.push({ ruleId: rule.id, reason: "hand_written" });
      continue;
    }

    // Emit Kotlin rule source
    const ruleSource = emitRule(rule);
    if (ruleSource === null) {
      skipped.push({ ruleId: rule.id, reason: "unsupported_type" });
      continue;
    }

    // Emit Kotlin test source
    const testSource = emitRuleTest(rule);
    if (testSource === null) {
      skipped.push({ ruleId: rule.id, reason: "unsupported_test_type" });
      continue;
    }

    // Derive file paths
    const className = toPascalCase(rule.id) + "Rule";
    const ruleFilename = `${className}.kt`;
    const testFilename = `${className}Test.kt`;
    const ruleFile = path.join(rulesOutputDir, ruleFilename);
    const testFile = path.join(testsOutputDir, testFilename);

    // Track generated filenames for orphan detection
    generatedRuleFilenames.add(ruleFilename);
    generatedClassNames.push(className);

    // Write files (unless dry-run)
    if (!dryRun) {
      await mkdir(rulesOutputDir, { recursive: true });
      await mkdir(testsOutputDir, { recursive: true });
      await writeFile(ruleFile, ruleSource, "utf-8");
      await writeFile(testFile, testSource, "utf-8");
    }

    generated.push({ ruleId: rule.id, ruleFile, testFile });
  }

  // Step 3: Detect and remove orphaned files
  try {
    const existingFiles = await readdir(rulesOutputDir);
    for (const filename of existingFiles) {
      // Skip non-Kotlin files (e.g., .gitkeep)
      if (!filename.endsWith(".kt")) {
        continue;
      }
      // If this .kt file is not in our generated set, it's orphaned
      if (!generatedRuleFilenames.has(filename)) {
        removed.push(filename);
        if (!dryRun) {
          await unlink(path.join(rulesOutputDir, filename));
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read -- no orphans to detect
  }

  // Step 4: Generate RuleSetProvider update block
  const providerUpdateBlock = emitRuleSetProviderUpdate(generatedClassNames);

  // Step 5: Generate config YAML
  const configYaml = emitFullConfig(allRules);

  return {
    generated,
    skipped,
    removed,
    providerUpdateBlock,
    configYaml,
    dryRun,
  };
}
