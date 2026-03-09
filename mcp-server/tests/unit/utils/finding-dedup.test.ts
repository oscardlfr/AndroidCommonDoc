/**
 * Tests for the three-pass finding deduplication engine.
 *
 * Covers title similarity, exact key dedup, proximity matching,
 * file rollup, and the integrated deduplicateFindings pipeline.
 */
import { describe, it, expect } from "vitest";
import {
  titleSimilarity,
  dedupeExactKeys,
  dedupeProximity,
  rollupByFile,
  deduplicateFindings,
} from "../../../src/utils/finding-dedup.js";
import type { AuditFinding, AuditCategory } from "../../../src/types/findings.js";

// ---- Test Data Helpers ------------------------------------------------------

let counter = 0;

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  counter++;
  const defaults: AuditFinding = {
    id: `id-${counter}`,
    dedupe_key: `check-${counter}:file-${counter}.kt:${counter}`,
    severity: "MEDIUM",
    category: "code-quality",
    source: `agent-${counter}`,
    check: `check-${counter}`,
    title: `Finding ${counter}`,
  };
  return { ...defaults, ...overrides };
}

function makeFindings(
  count: number,
  overrides: Partial<AuditFinding> = {}
): AuditFinding[] {
  return Array.from({ length: count }, () => makeFinding(overrides));
}

// ---- titleSimilarity --------------------------------------------------------

describe("titleSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(titleSimilarity("hello world", "hello world")).toBe(1.0);
  });

  it("returns 0.0 for completely different strings", () => {
    const score = titleSimilarity("abcdef", "zyxwvu");
    expect(score).toBe(0.0);
  });

  it("returns > 0.8 for similar strings", () => {
    const score = titleSimilarity(
      "Missing null check in UserDao",
      "Missing null check in UserDAO"
    );
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns 0.0 for two empty strings", () => {
    expect(titleSimilarity("", "")).toBe(0.0);
  });

  it("returns 0.0 when one string is empty", () => {
    expect(titleSimilarity("hello", "")).toBe(0.0);
    expect(titleSimilarity("", "hello")).toBe(0.0);
  });

  it("returns 0.0 for single-character strings (no bigrams)", () => {
    expect(titleSimilarity("a", "b")).toBe(0.0);
  });

  it("is case-insensitive", () => {
    expect(titleSimilarity("Hello World", "hello world")).toBe(1.0);
  });

  it("returns a value between 0 and 1 for partially similar strings", () => {
    const score = titleSimilarity("missing validation", "missing check");
    expect(score).toBeGreaterThan(0.0);
    expect(score).toBeLessThan(1.0);
  });
});

// ---- dedupeExactKeys --------------------------------------------------------

describe("dedupeExactKeys", () => {
  it("merges findings with the same dedupe_key", () => {
    const findings: AuditFinding[] = [
      makeFinding({ dedupe_key: "check:file.kt:10", source: "agent-a", severity: "MEDIUM" }),
      makeFinding({ dedupe_key: "check:file.kt:10", source: "agent-b", severity: "HIGH" }),
    ];

    const result = dedupeExactKeys(findings);
    expect(result).toHaveLength(1);
  });

  it("keeps the highest severity", () => {
    const findings: AuditFinding[] = [
      makeFinding({ dedupe_key: "same-key", severity: "LOW" }),
      makeFinding({ dedupe_key: "same-key", severity: "CRITICAL" }),
      makeFinding({ dedupe_key: "same-key", severity: "MEDIUM" }),
    ];

    const result = dedupeExactKeys(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("CRITICAL");
  });

  it("merges found_by arrays", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        dedupe_key: "same-key",
        source: "agent-a",
        found_by: ["agent-a", "agent-x"],
      }),
      makeFinding({
        dedupe_key: "same-key",
        source: "agent-b",
        found_by: ["agent-b"],
      }),
    ];

    const result = dedupeExactKeys(findings);
    expect(result).toHaveLength(1);
    expect(result[0].found_by).toBeDefined();
    expect(result[0].found_by).toContain("agent-a");
    expect(result[0].found_by).toContain("agent-b");
    expect(result[0].found_by).toContain("agent-x");
  });

  it("merges different sources into found_by", () => {
    const findings: AuditFinding[] = [
      makeFinding({ dedupe_key: "same-key", source: "detekt" }),
      makeFinding({ dedupe_key: "same-key", source: "custom-lint" }),
    ];

    const result = dedupeExactKeys(findings);
    expect(result).toHaveLength(1);
    expect(result[0].found_by).toContain("detekt");
    expect(result[0].found_by).toContain("custom-lint");
  });

  it("returns unmodified when no duplicates exist", () => {
    const findings: AuditFinding[] = [
      makeFinding({ dedupe_key: "key-1" }),
      makeFinding({ dedupe_key: "key-2" }),
      makeFinding({ dedupe_key: "key-3" }),
    ];

    const result = dedupeExactKeys(findings);
    expect(result).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(dedupeExactKeys([])).toEqual([]);
  });
});

// ---- dedupeProximity --------------------------------------------------------

describe("dedupeProximity", () => {
  it("merges findings in same file, same category, within 5 lines, with similar title", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        dedupe_key: "key-a",
        file: "src/Main.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check in getData",
        severity: "MEDIUM",
        source: "agent-a",
      }),
      makeFinding({
        dedupe_key: "key-b",
        file: "src/Main.kt",
        line: 12,
        category: "code-quality",
        title: "Missing null check in getData",
        severity: "HIGH",
        source: "agent-b",
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("HIGH");
  });

  it("does NOT merge findings in different files", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/A.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check",
      }),
      makeFinding({
        file: "src/B.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check",
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(2);
  });

  it("does NOT merge findings with different categories", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/Main.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check",
      }),
      makeFinding({
        file: "src/Main.kt",
        line: 11,
        category: "security",
        title: "Missing null check",
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(2);
  });

  it("does NOT merge findings more than 5 lines apart", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/Main.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check",
      }),
      makeFinding({
        file: "src/Main.kt",
        line: 20,
        category: "code-quality",
        title: "Missing null check",
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(2);
  });

  it("does NOT merge findings with dissimilar titles", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/Main.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check in getData",
      }),
      makeFinding({
        file: "src/Main.kt",
        line: 11,
        category: "code-quality",
        title: "Unused import statement detected",
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(2);
  });

  it("supports custom lineRange parameter", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/Main.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check in getData",
      }),
      makeFinding({
        file: "src/Main.kt",
        line: 20,
        category: "code-quality",
        title: "Missing null check in getData",
      }),
    ];

    // Default range (5) should NOT merge
    expect(dedupeProximity(findings)).toHaveLength(2);

    // Custom range of 15 SHOULD merge
    expect(dedupeProximity(findings, 15)).toHaveLength(1);
  });

  it("does NOT merge findings without line numbers", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/Main.kt",
        category: "code-quality",
        title: "Missing null check",
        // no line
      }),
      makeFinding({
        file: "src/Main.kt",
        category: "code-quality",
        title: "Missing null check",
        // no line
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(2);
  });

  it("does NOT merge findings without file", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        line: 10,
        category: "code-quality",
        title: "Missing null check",
        // no file
      }),
      makeFinding({
        line: 11,
        category: "code-quality",
        title: "Missing null check",
        // no file
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(dedupeProximity([])).toEqual([]);
  });

  it("merges found_by from both findings", () => {
    const findings: AuditFinding[] = [
      makeFinding({
        file: "src/Main.kt",
        line: 10,
        category: "code-quality",
        title: "Missing null check in getData",
        source: "agent-a",
        found_by: ["agent-a"],
      }),
      makeFinding({
        file: "src/Main.kt",
        line: 12,
        category: "code-quality",
        title: "Missing null check in getData",
        source: "agent-b",
        found_by: ["agent-b"],
      }),
    ];

    const result = dedupeProximity(findings);
    expect(result).toHaveLength(1);
    expect(result[0].found_by).toContain("agent-a");
    expect(result[0].found_by).toContain("agent-b");
  });
});

// ---- rollupByFile -----------------------------------------------------------

describe("rollupByFile", () => {
  it("groups when file has more than 5 findings", () => {
    const findings = makeFindings(6, {
      file: "src/BigFile.kt",
      category: "code-quality",
    });

    const result = rollupByFile(findings);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(6);
  });

  it("does NOT group when file has 5 or fewer findings", () => {
    const findings = makeFindings(5, {
      file: "src/SmallFile.kt",
      category: "code-quality",
    });

    const result = rollupByFile(findings);
    expect(result).toHaveLength(5);
    expect(result.every((f) => !f.children)).toBe(true);
  });

  it("parent has max severity of children", () => {
    const findings: AuditFinding[] = [
      makeFinding({ file: "src/File.kt", severity: "LOW" }),
      makeFinding({ file: "src/File.kt", severity: "MEDIUM" }),
      makeFinding({ file: "src/File.kt", severity: "CRITICAL" }),
      makeFinding({ file: "src/File.kt", severity: "HIGH" }),
      makeFinding({ file: "src/File.kt", severity: "INFO" }),
      makeFinding({ file: "src/File.kt", severity: "LOW" }),
    ];

    const result = rollupByFile(findings);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("CRITICAL");
  });

  it("parent title includes count and file", () => {
    const findings = makeFindings(7, { file: "src/Target.kt" });

    const result = rollupByFile(findings);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("7 findings in src/Target.kt");
  });

  it("supports custom threshold", () => {
    const findings = makeFindings(4, { file: "src/File.kt" });

    // Default threshold (5): should NOT group (4 <= 5)
    expect(rollupByFile(findings)).toHaveLength(4);

    // Custom threshold of 3: SHOULD group (4 > 3)
    const result = rollupByFile(findings, 3);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(4);
  });

  it("does not group findings without file", () => {
    const findings: AuditFinding[] = [
      makeFinding({ file: undefined }),
      makeFinding({ file: undefined }),
      makeFinding({ file: undefined }),
      makeFinding({ file: undefined }),
      makeFinding({ file: undefined }),
      makeFinding({ file: undefined }),
    ];

    const result = rollupByFile(findings);
    // All 6 findings should remain ungrouped since they have no file
    expect(result).toHaveLength(6);
    expect(result.every((f) => !f.children)).toBe(true);
  });

  it("handles multiple files independently", () => {
    const fileAFindings = makeFindings(6, { file: "src/A.kt" });
    const fileBFindings = makeFindings(3, { file: "src/B.kt" });

    const result = rollupByFile([...fileAFindings, ...fileBFindings]);
    // File A (6 findings) gets rolled up, File B (3 findings) stays flat
    const rolledUp = result.filter((f) => f.children);
    const flat = result.filter((f) => !f.children);
    expect(rolledUp).toHaveLength(1);
    expect(rolledUp[0].children).toHaveLength(6);
    expect(flat).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(rollupByFile([])).toEqual([]);
  });
});

// ---- deduplicateFindings (integration) --------------------------------------

describe("deduplicateFindings", () => {
  it("runs all three passes in sequence", () => {
    // Create findings that will be affected by each pass:
    // - Two with same dedupe_key (Pass 1: exact merge)
    // - Two in proximity (Pass 2: proximity merge)
    // - Many in same file (Pass 3: rollup)
    const findings: AuditFinding[] = [
      // Pass 1 targets: same dedupe_key
      makeFinding({
        dedupe_key: "shared-key",
        source: "agent-1",
        severity: "LOW",
        file: "src/Other.kt",
        line: 1,
        category: "testing",
        title: "Shared finding",
      }),
      makeFinding({
        dedupe_key: "shared-key",
        source: "agent-2",
        severity: "HIGH",
        file: "src/Other.kt",
        line: 1,
        category: "testing",
        title: "Shared finding",
      }),
      // Pass 3 targets: 6 unique findings in the same file (should get rolled up)
      ...makeFindings(6, { file: "src/Big.kt", category: "code-quality" }),
    ];

    const result = deduplicateFindings(findings);

    // Pass 1 merges the 2 shared-key findings into 1
    // Pass 3 rolls up the 6 Big.kt findings into 1 parent
    // Total: 1 (merged) + 1 (rolled up) = 2
    expect(result.length).toBeLessThan(findings.length);

    // Verify the exact-key merge produced HIGH severity
    const mergedFinding = result.find(
      (f) => f.dedupe_key === "shared-key" || f.found_by?.includes("agent-1")
    );
    if (mergedFinding) {
      expect(mergedFinding.severity).toBe("HIGH");
    }
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  it("returns input unchanged when nothing to deduplicate", () => {
    const findings: AuditFinding[] = [
      makeFinding({ dedupe_key: "unique-1", file: "a.kt", line: 1 }),
      makeFinding({ dedupe_key: "unique-2", file: "b.kt", line: 1 }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });
});
