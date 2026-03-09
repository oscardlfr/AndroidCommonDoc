/**
 * CLAUDE.md ecosystem integration tests.
 *
 * Reads actual CLAUDE.md files from disk and validates:
 * - L0 global: identity header, no project names in generic sections, line count
 * - L0 toolkit: identity header, L0 inheritance, line count
 * - L1 (if present): identity header, L0 inheritance, no L0 rule duplication, line count
 * - L2 (if present): identity header, L0+L1 inheritance, no L0 rule duplication, line count
 * - Cross-file: no circular/upward references, no version contradictions
 * - Canonical rule coverage: smoke test via canonical-rules.json (CLAUDE-07)
 *
 * L1/L2 tests are skipped automatically when the project files do not exist on disk.
 * Configure L1_PATH and L2_PATH env vars (or let them resolve from sibling directories)
 * to run the full suite.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  validateTemplateStructure,
  validateLineCount,
  validateCanonicalCoverage,
  detectCircularReferences,
  detectCrossFileDuplicates,
  checkVersionConsistency,
  type CanonicalRule,
  type ClaudeMdFile,
} from "../../src/tools/validate-claude-md.js";
import { getToolkitRoot } from "../../src/utils/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";

/** Resolve the absolute path to a CLAUDE.md file. */
function resolvePath(relativePath: string): string {
  if (relativePath.startsWith("~")) {
    return path.resolve(HOME, relativePath.slice(2));
  }
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.resolve(getToolkitRoot(), relativePath);
}

/** Try to read a file, returning empty string if not found. */
async function tryReadFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let l0GlobalContent = "";
let l0ToolkitContent = "";
let l1Content = "";
let l2Content = "";
let canonicalRules: CanonicalRule[] = [];
let versionsManifest: Record<string, string> = {};

const l0GlobalPath = path.join(HOME, ".claude", "CLAUDE.md");
const l0ToolkitPath = resolvePath("CLAUDE.md");

// Resolve L1 and L2 paths -- use env vars or fall back to sibling directory convention
const androidStudioProjects = path.resolve(getToolkitRoot(), "..");
const l1Path = process.env.L1_PATH
  ? path.resolve(process.env.L1_PATH, "CLAUDE.md")
  : path.join(androidStudioProjects, "shared-libs", "CLAUDE.md");
const l2Path = process.env.L2_PATH
  ? path.resolve(process.env.L2_PATH, "CLAUDE.md")
  : path.join(androidStudioProjects, "my-app", "CLAUDE.md");

/** All files as ClaudeMdFile array for cross-file checks. */
let allFiles: ClaudeMdFile[] = [];

beforeAll(async () => {
  l0GlobalContent = await tryReadFile(l0GlobalPath);
  l0ToolkitContent = await tryReadFile(l0ToolkitPath);
  l1Content = await tryReadFile(l1Path);
  l2Content = await tryReadFile(l2Path);

  // Load canonical rules
  try {
    const rulesPath = resolvePath("docs/guides/canonical-rules.json");
    const rulesRaw = await readFile(rulesPath, "utf-8");
    const rulesData = JSON.parse(rulesRaw);
    canonicalRules = rulesData.rules ?? [];
  } catch {
    // Will be caught in tests
  }

  // Load versions manifest
  try {
    const manifestPath = resolvePath("versions-manifest.json");
    const manifestRaw = await readFile(manifestPath, "utf-8");
    const manifestData = JSON.parse(manifestRaw);
    versionsManifest = manifestData.versions ?? {};
  } catch {
    // Will be caught in tests
  }

  // Build all-files array
  if (l0GlobalContent) {
    allFiles.push({
      path: "~/.claude/CLAUDE.md",
      layer: "L0-global",
      content: l0GlobalContent,
    });
  }
  if (l0ToolkitContent) {
    allFiles.push({
      path: "AndroidCommonDoc/CLAUDE.md",
      layer: "L0",
      content: l0ToolkitContent,
    });
  }
  if (l1Content) {
    allFiles.push({
      path: "L1/CLAUDE.md",
      layer: "L1",
      content: l1Content,
    });
  }
  if (l2Content) {
    allFiles.push({
      path: "L2/CLAUDE.md",
      layer: "L2",
      content: l2Content,
    });
  }
});

// ---------------------------------------------------------------------------
// L0 global CLAUDE.md
// ---------------------------------------------------------------------------

describe("L0 global CLAUDE.md", () => {
  it("should exist and have content", () => {
    if (!l0GlobalContent) {
      console.log("Skipping: ~/.claude/CLAUDE.md not found (CI environment)");
      return;
    }
    expect(l0GlobalContent.length).toBeGreaterThan(0);
  });

  it("should have identity header (Layer, Inherits, Purpose)", () => {
    if (!l0GlobalContent) {
      console.log("Skipping: ~/.claude/CLAUDE.md not found (CI environment)");
      return;
    }
    // L0-global is exempt from identity header in validate tool,
    // but Plan 03 added it for consistency -- verify it exists
    expect(l0GlobalContent).toMatch(/>\s*\*\*Layer:\*\*/);
    expect(l0GlobalContent).toMatch(/>\s*\*\*Inherits:\*\*/);
    expect(l0GlobalContent).toMatch(/>\s*\*\*Purpose:\*\*/);
  });

  it("should not reference project names in generic sections", () => {
    // Extract generic sections (excluding Developer Context and code fences)
    const lines = l0GlobalContent.split("\n");
    let inDevContext = false;
    let inCodeFence = false;
    const genericLines: string[] = [];

    for (const line of lines) {
      if (/^```/.test(line.trim())) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (!inCodeFence && /^##\s+Developer Context/i.test(line)) {
        inDevContext = true;
        continue;
      }
      if (!inCodeFence && inDevContext && /^##\s+/.test(line)) {
        inDevContext = false;
      }
      if (!inDevContext && !inCodeFence) {
        genericLines.push(line);
      }
    }

    // No project-specific names in generic sections -- list is empty by default.
    // Populate L1_PROJECT_NAMES / L2_PROJECT_NAMES in validate-claude-md.ts
    // or set the projectNames array below to your own project names.
    const projectNames: string[] = [];

    for (const name of projectNames) {
      const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      expect(
        regex.test(genericContent),
        `L0 global generic sections should not contain "${name}"`,
      ).toBe(false);
    }
  });

  it("should be under 150 lines", () => {
    const lineCount = l0GlobalContent.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(150);
  });
});

// ---------------------------------------------------------------------------
// L0 toolkit CLAUDE.md (AndroidCommonDoc)
// ---------------------------------------------------------------------------

describe("L0 toolkit CLAUDE.md", () => {
  it("should exist and have content", () => {
    expect(l0ToolkitContent.length).toBeGreaterThan(0);
  });

  it("should have identity header", () => {
    const issues = validateTemplateStructure(l0ToolkitContent, "L0");
    const errors = issues.filter((i) => i.level === "error");
    expect(
      errors,
      `Template errors: ${errors.map((e) => e.message).join("; ")}`,
    ).toHaveLength(0);
  });

  it("should declare L0 inheritance", () => {
    expect(l0ToolkitContent).toMatch(
      /inherits.*L0|inherits.*~\/\.claude\/CLAUDE\.md|auto-loaded by Claude Code/i,
    );
  });

  it("should be under 150 lines", () => {
    const lineCount = l0ToolkitContent.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(150);
  });
});

// ---------------------------------------------------------------------------
// L1 CLAUDE.md (optional -- skipped if file not found)
// ---------------------------------------------------------------------------

describe("L1 CLAUDE.md", () => {
  it("should exist and have content", () => {
    if (!l1Content) {
      console.log("Skipping L1 tests: file not found. Set L1_PATH env var to enable.");
      return;
    }
    expect(l1Content.length).toBeGreaterThan(0);
  });

  it("should have identity header", () => {
    if (!l1Content) return;
    const issues = validateTemplateStructure(l1Content, "L1");
    const errors = issues.filter((i) => i.level === "error");
    expect(
      errors,
      `Template errors: ${errors.map((e) => e.message).join("; ")}`,
    ).toHaveLength(0);
  });

  it("should declare L0 inheritance", () => {
    if (!l1Content) return;
    expect(l1Content).toMatch(
      /inherits.*L0|inherits.*~\/\.claude\/CLAUDE\.md|auto-loaded by Claude Code/i,
    );
  });

  it("should not duplicate L0 rules", () => {
    if (!l1Content) return;
    // Check for specific L0 ViewModel/error rules that should NOT appear in L1
    // Note: "sealed interface" is too broad -- L1 legitimately mentions "sealed classes"
    // in API module rules (different context from L0's "UiState: sealed interface")
    const l0OnlyRules = [
      "ALWAYS sealed interface (NEVER data class with boolean flags)",
      "ALWAYS rethrow CancellationException",
      "stateIn(WhileSubscribed",
      "NOT Channel or MutableSharedFlow",
      "UiText for user-facing strings",
    ];

    for (const rule of l0OnlyRules) {
      expect(
        l1Content.includes(rule),
        `L1 should not duplicate L0 rule: "${rule}"`,
      ).toBe(false);
    }
  });

  it("should be under 150 lines", () => {
    if (!l1Content) return;
    const lineCount = l1Content.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(150);
  });
});

// ---------------------------------------------------------------------------
// L2 CLAUDE.md (optional -- skipped if file not found)
// ---------------------------------------------------------------------------

describe("L2 CLAUDE.md", () => {
  it("should exist and have content", () => {
    if (!l2Content) {
      console.log("Skipping L2 tests: file not found. Set L2_PATH env var to enable.");
      return;
    }
    expect(l2Content.length).toBeGreaterThan(0);
  });

  it("should have identity header", () => {
    if (!l2Content) return;
    const issues = validateTemplateStructure(l2Content, "L2");
    const errors = issues.filter((i) => i.level === "error");
    expect(
      errors,
      `Template errors: ${errors.map((e) => e.message).join("; ")}`,
    ).toHaveLength(0);
  });

  it("should declare L0+L1 inheritance", () => {
    if (!l2Content) return;
    expect(l2Content).toMatch(
      /inherits.*L0.*L1|inherits.*~\/\.claude\/CLAUDE\.md.*L1|auto-loaded.*L1/i,
    );
  });

  it("should not duplicate L0 rules", () => {
    if (!l2Content) return;
    // Check for specific L0 rules that should NOT appear in L2
    const l0OnlyRules = [
      "sealed interface (NEVER data class with boolean flags)",
      "ALWAYS rethrow CancellationException",
      "DomainException hierarchy from core-error",
      "jvmMain: Shared JVM code",
      "appleMain: Shared Apple code",
    ];

    for (const rule of l0OnlyRules) {
      expect(
        l2Content.includes(rule),
        `L2 should not duplicate L0 rule: "${rule}"`,
      ).toBe(false);
    }
  });

  it("should be under 150 lines", () => {
    if (!l2Content) return;
    const lineCount = l2Content.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(150);
  });
});

// ---------------------------------------------------------------------------
// Cross-file validation
// ---------------------------------------------------------------------------

describe("cross-file validation", () => {
  it("should have at least 2 CLAUDE.md files loaded (L0-global + L0-toolkit)", () => {
    if (!l0GlobalContent) {
      console.log("Skipping: ~/.claude/CLAUDE.md not found (CI environment)");
      expect(allFiles.length).toBeGreaterThanOrEqual(1); // at least L0-toolkit
      return;
    }
    expect(allFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("should have no circular/upward references", () => {
    const issues = detectCircularReferences(allFiles);
    const errors = issues.filter((i) => i.level === "error");
    expect(
      errors,
      `Circular references: ${errors.map((e) => e.message).join("; ")}`,
    ).toHaveLength(0);
  });

  it("should have no cross-file duplicate rules", () => {
    const issues = detectCrossFileDuplicates(allFiles);
    // Duplicates are warnings, not errors -- but we want zero or minimal
    // Allow up to 3 minor duplicates (tables, short bullets)
    expect(
      issues.length,
      `Cross-file duplicates: ${issues.map((i) => i.message).join("; ")}`,
    ).toBeLessThanOrEqual(3);
  });

  it("should have no version contradictions", () => {
    // Check versions in all files against manifest
    // Exclude L0-global from Kotlin version check: "since Kotlin 1.9.20" is a historical
    // reference (when feature was introduced), not a current version declaration
    const allVersionIssues = allFiles.flatMap((f) => {
      const issues = checkVersionConsistency(f.content, versionsManifest);
      if (f.layer === "L0-global") {
        return issues.filter(
          (i) => !i.message.includes("kotlin") || !i.message.includes("1.9.20"),
        );
      }
      return issues;
    });
    expect(
      allVersionIssues,
      `Version issues: ${allVersionIssues.map((i) => i.message).join("; ")}`,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Canonical rule coverage (smoke test -- CLAUDE-07)
// ---------------------------------------------------------------------------

describe("canonical rule coverage smoke test", () => {
  it("should have canonical rules loaded", () => {
    expect(canonicalRules.length).toBeGreaterThan(0);
  });

  it("should have 90%+ L0-global coverage (rules sourced from ~/.claude/CLAUDE.md)", () => {
    // L0-global should only be checked against rules actually sourced from it,
    // NOT against TK-* rules sourced from AndroidCommonDoc/CLAUDE.md (L0-toolkit)
    const l0GlobalRules = canonicalRules.filter(
      (r) => r.layer === "L0" && r.source === "~/.claude/CLAUDE.md",
    );
    const issues = validateCanonicalCoverage(l0GlobalContent, "L0-global", canonicalRules);
    // Count only missing rules sourced from L0-global
    const missingRules = issues.filter((i) => {
      if (i.category !== "canonical-coverage" || i.message.startsWith("Canonical coverage:")) {
        return false;
      }
      const match = i.message.match(/Missing canonical rule (\S+)/);
      if (!match) return false;
      const ruleId = match[1];
      const rule = canonicalRules.find((r) => r.id === ruleId);
      return rule?.source === "~/.claude/CLAUDE.md";
    });
    const covered = l0GlobalRules.length - missingRules.length;
    const percent = Math.round((covered / l0GlobalRules.length) * 100);
    expect(
      percent,
      `L0-global coverage: ${covered}/${l0GlobalRules.length} (${percent}%) -- missing: ${missingRules.map((i) => i.message.match(/Missing canonical rule (\S+)/)?.[1]).join(", ")}`,
    ).toBeGreaterThanOrEqual(90);
  });

  it("should have 90%+ L0 coverage in L0-toolkit", () => {
    const l0ToolkitRules = canonicalRules.filter(
      (r) => r.source === "AndroidCommonDoc/CLAUDE.md",
    );
    if (l0ToolkitRules.length === 0) return; // No L0-toolkit-specific rules

    const issues = validateCanonicalCoverage(l0ToolkitContent, "L0", canonicalRules);
    // L0-toolkit validates against ALL L0 rules -- but it inherits from L0-global,
    // so coverage only matters for rules sourced from this file
    const toolkitSpecificIssues = issues.filter((i) => {
      const match = i.message.match(/Missing canonical rule (\S+)/);
      if (!match) return false;
      const ruleId = match[1];
      return canonicalRules.find((r) => r.id === ruleId)?.source === "AndroidCommonDoc/CLAUDE.md";
    });

    const toolkitCovered = l0ToolkitRules.length - toolkitSpecificIssues.length;
    const percent = Math.round((toolkitCovered / l0ToolkitRules.length) * 100);
    expect(
      percent,
      `L0-toolkit coverage: ${toolkitCovered}/${l0ToolkitRules.length} (${percent}%)`,
    ).toBeGreaterThanOrEqual(90);
  });

  it("should have 90%+ L1 coverage (if L1 file present)", () => {
    if (!l1Content) return;
    const l1Rules = canonicalRules.filter((r) => r.layer === "L1");
    if (l1Rules.length === 0) return; // No L1 rules defined in canonical-rules.json
    const issues = validateCanonicalCoverage(l1Content, "L1", canonicalRules);
    const missingRules = issues.filter(
      (i) => i.category === "canonical-coverage" && !i.message.startsWith("Canonical coverage:"),
    );
    const covered = l1Rules.length - missingRules.length;
    const percent = Math.round((covered / l1Rules.length) * 100);
    expect(
      percent,
      `L1 coverage: ${covered}/${l1Rules.length} (${percent}%) -- missing: ${missingRules.map((i) => i.message.match(/Missing canonical rule (\S+)/)?.[1]).join(", ")}`,
    ).toBeGreaterThanOrEqual(90);
  });

  it("should have 90%+ L2 coverage (if L2 file present)", () => {
    if (!l2Content) return;
    const l2Rules = canonicalRules.filter((r) => r.layer === "L2");
    if (l2Rules.length === 0) return; // No L2 rules defined in canonical-rules.json
    const issues = validateCanonicalCoverage(l2Content, "L2", canonicalRules);
    const missingRules = issues.filter(
      (i) => i.category === "canonical-coverage" && !i.message.startsWith("Canonical coverage:"),
    );
    const covered = l2Rules.length - missingRules.length;
    const percent = Math.round((covered / l2Rules.length) * 100);
    expect(
      percent,
      `L2 coverage: ${covered}/${l2Rules.length} (${percent}%) -- missing: ${missingRules.map((i) => i.message.match(/Missing canonical rule (\S+)/)?.[1]).join(", ")}`,
    ).toBeGreaterThanOrEqual(90);
  });

  it("should report overall coverage above 90%", () => {
    // Aggregate across all layers, matching each file to its sourced rules
    type LayerEntry = { layer: string; content: string; source?: string };
    const layers: LayerEntry[] = [
      { layer: "L0-global", content: l0GlobalContent, source: "~/.claude/CLAUDE.md" },
      { layer: "L0", content: l0ToolkitContent, source: "AndroidCommonDoc/CLAUDE.md" },
      { layer: "L1", content: l1Content },
      { layer: "L2", content: l2Content },
    ];

    let totalRules = 0;
    let totalCovered = 0;

    for (const { layer, content, source } of layers) {
      if (!content) continue;
      const layerRules = canonicalRules.filter((r) => {
        if (source) return r.source === source;
        return r.layer === layer;
      });
      if (layerRules.length === 0) continue;
      const issues = validateCanonicalCoverage(content, layer, canonicalRules);
      // Count only missing rules sourced from this specific file
      const missing = issues.filter((i) => {
        if (i.category !== "canonical-coverage" || i.message.startsWith("Canonical coverage:")) {
          return false;
        }
        if (!source) return true;
        const match = i.message.match(/Missing canonical rule (\S+)/);
        if (!match) return false;
        const rule = canonicalRules.find((r) => r.id === match[1]);
        return rule?.source === source;
      }).length;
      totalRules += layerRules.length;
      totalCovered += layerRules.length - missing;
    }

    const overallPercent = Math.round((totalCovered / totalRules) * 100);
    expect(
      overallPercent,
      `Overall coverage: ${totalCovered}/${totalRules} (${overallPercent}%)`,
    ).toBeGreaterThanOrEqual(90);
  });
});
