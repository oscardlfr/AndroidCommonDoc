/**
 * Tests for the unified audit finding types and utility functions.
 *
 * Covers severity normalization, ID generation, dedupe key building,
 * finding creation, severity comparison, health computation, and summarization.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeSeverity,
  generateFindingId,
  buildDedupeKey,
  createFinding,
  compareSeverity,
  maxSeverity,
  computeFindingsHealth,
  summarizeFindings,
} from "../../../src/types/findings.js";
import type {
  AuditFinding,
  AuditSeverity,
  FindingsSummary,
} from "../../../src/types/findings.js";

// ---- Helpers ----------------------------------------------------------------

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  const defaults: AuditFinding = {
    id: "0000000000000000",
    dedupe_key: "test-check:file.kt:1",
    severity: "MEDIUM",
    category: "code-quality",
    source: "test-agent",
    check: "test-check",
    title: "Test finding",
  };
  return { ...defaults, ...overrides };
}

function makeSummary(overrides: Partial<FindingsSummary> = {}): FindingsSummary {
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    by_category: {},
    ...overrides,
  };
}

// ---- normalizeSeverity ------------------------------------------------------

describe("normalizeSeverity", () => {
  describe("CRITICAL tier mappings", () => {
    it("maps BLOCKER to CRITICAL", () => {
      expect(normalizeSeverity("BLOCKER")).toBe("CRITICAL");
    });

    it("maps BLOCK to CRITICAL", () => {
      expect(normalizeSeverity("BLOCK")).toBe("CRITICAL");
    });

    it("maps CRITICAL to CRITICAL", () => {
      expect(normalizeSeverity("CRITICAL")).toBe("CRITICAL");
    });
  });

  describe("HIGH tier mappings", () => {
    it("maps ERROR to HIGH", () => {
      expect(normalizeSeverity("ERROR")).toBe("HIGH");
    });

    it("maps FAIL to HIGH", () => {
      expect(normalizeSeverity("FAIL")).toBe("HIGH");
    });

    it("maps HIGH to HIGH", () => {
      expect(normalizeSeverity("HIGH")).toBe("HIGH");
    });
  });

  describe("MEDIUM tier mappings", () => {
    it("maps WARNING to MEDIUM", () => {
      expect(normalizeSeverity("WARNING")).toBe("MEDIUM");
    });

    it("maps WARN to MEDIUM", () => {
      expect(normalizeSeverity("WARN")).toBe("MEDIUM");
    });

    it("maps MEDIUM to MEDIUM", () => {
      expect(normalizeSeverity("MEDIUM")).toBe("MEDIUM");
    });
  });

  describe("LOW tier", () => {
    it("maps LOW to LOW", () => {
      expect(normalizeSeverity("LOW")).toBe("LOW");
    });
  });

  describe("INFO tier", () => {
    it("maps INFO to INFO", () => {
      expect(normalizeSeverity("INFO")).toBe("INFO");
    });
  });

  describe("success labels return null", () => {
    it("maps OK to null", () => {
      expect(normalizeSeverity("OK")).toBeNull();
    });

    it("maps PASS to null", () => {
      expect(normalizeSeverity("PASS")).toBeNull();
    });
  });

  describe("case insensitivity", () => {
    it("handles lowercase input", () => {
      expect(normalizeSeverity("blocker")).toBe("CRITICAL");
    });

    it("handles mixed-case input", () => {
      expect(normalizeSeverity("Warning")).toBe("MEDIUM");
    });

    it("handles input with whitespace", () => {
      expect(normalizeSeverity("  HIGH  ")).toBe("HIGH");
    });
  });

  describe("unknown labels", () => {
    it("throws on unknown label", () => {
      expect(() => normalizeSeverity("UNKNOWN")).toThrow(
        'Unknown severity label: "UNKNOWN"'
      );
    });

    it("throws on empty string", () => {
      expect(() => normalizeSeverity("")).toThrow("Unknown severity label");
    });
  });
});

// ---- generateFindingId ------------------------------------------------------

describe("generateFindingId", () => {
  it("produces deterministic output for the same key", () => {
    const id1 = generateFindingId("my-check:file.kt:10");
    const id2 = generateFindingId("my-check:file.kt:10");
    expect(id1).toBe(id2);
  });

  it("produces different IDs for different keys", () => {
    const id1 = generateFindingId("check-a:file.kt:10");
    const id2 = generateFindingId("check-b:file.kt:10");
    expect(id1).not.toBe(id2);
  });

  it("returns a 16-character hex string", () => {
    const id = generateFindingId("any-key");
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---- buildDedupeKey ---------------------------------------------------------

describe("buildDedupeKey", () => {
  it("builds key with file and line", () => {
    expect(buildDedupeKey("my-check", "src/Main.kt", 42)).toBe(
      "my-check:src/Main.kt:42"
    );
  });

  it("builds key with file only (no line)", () => {
    expect(buildDedupeKey("my-check", "src/Main.kt")).toBe(
      "my-check:src/Main.kt"
    );
  });

  it("builds key with check only (no file, no line)", () => {
    expect(buildDedupeKey("my-check")).toBe("my-check");
  });

  it("handles line number 0", () => {
    expect(buildDedupeKey("my-check", "src/Main.kt", 0)).toBe(
      "my-check:src/Main.kt:0"
    );
  });
});

// ---- createFinding ----------------------------------------------------------

describe("createFinding", () => {
  it("auto-generates id from dedupe_key", () => {
    const dedupeKey = "test-check:file.kt:1";
    const finding = createFinding({
      dedupe_key: dedupeKey,
      severity: "HIGH",
      category: "code-quality",
      source: "test-agent",
      check: "test-check",
      title: "Test finding",
    });

    expect(finding.id).toBe(generateFindingId(dedupeKey));
  });

  it("preserves all provided fields", () => {
    const finding = createFinding({
      dedupe_key: "check:file:1",
      severity: "CRITICAL",
      category: "security",
      source: "security-agent",
      check: "sql-injection",
      title: "SQL injection detected",
      detail: "User input not sanitized",
      file: "src/Dao.kt",
      line: 55,
      suggestion: "Use parameterized queries",
      pattern_doc: "docs/security/sql-injection.md",
    });

    expect(finding.severity).toBe("CRITICAL");
    expect(finding.category).toBe("security");
    expect(finding.source).toBe("security-agent");
    expect(finding.check).toBe("sql-injection");
    expect(finding.title).toBe("SQL injection detected");
    expect(finding.detail).toBe("User input not sanitized");
    expect(finding.file).toBe("src/Dao.kt");
    expect(finding.line).toBe(55);
    expect(finding.suggestion).toBe("Use parameterized queries");
    expect(finding.pattern_doc).toBe("docs/security/sql-injection.md");
  });
});

// ---- compareSeverity --------------------------------------------------------

describe("compareSeverity", () => {
  it("returns negative when a is more severe than b", () => {
    expect(compareSeverity("CRITICAL", "HIGH")).toBeLessThan(0);
  });

  it("returns positive when a is less severe than b", () => {
    expect(compareSeverity("INFO", "CRITICAL")).toBeGreaterThan(0);
  });

  it("returns 0 for equal severities", () => {
    expect(compareSeverity("MEDIUM", "MEDIUM")).toBe(0);
  });

  it("maintains full ordering: CRITICAL < HIGH < MEDIUM < LOW < INFO", () => {
    const severities: AuditSeverity[] = [
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
      "INFO",
    ];
    for (let i = 0; i < severities.length - 1; i++) {
      expect(compareSeverity(severities[i], severities[i + 1])).toBeLessThan(0);
    }
  });
});

// ---- maxSeverity ------------------------------------------------------------

describe("maxSeverity", () => {
  it("returns CRITICAL when compared with HIGH", () => {
    expect(maxSeverity("CRITICAL", "HIGH")).toBe("CRITICAL");
  });

  it("returns CRITICAL regardless of argument order", () => {
    expect(maxSeverity("HIGH", "CRITICAL")).toBe("CRITICAL");
  });

  it("returns the same severity when both are equal", () => {
    expect(maxSeverity("MEDIUM", "MEDIUM")).toBe("MEDIUM");
  });

  it("returns HIGH over LOW", () => {
    expect(maxSeverity("LOW", "HIGH")).toBe("HIGH");
  });

  it("returns MEDIUM over INFO", () => {
    expect(maxSeverity("INFO", "MEDIUM")).toBe("MEDIUM");
  });
});

// ---- computeFindingsHealth --------------------------------------------------

describe("computeFindingsHealth", () => {
  it("returns HEALTHY when total is 0", () => {
    expect(computeFindingsHealth(makeSummary({ total: 0 }))).toBe("HEALTHY");
  });

  it("returns CRITICAL when critical count > 0", () => {
    expect(
      computeFindingsHealth(makeSummary({ total: 3, critical: 2, high: 1 }))
    ).toBe("CRITICAL");
  });

  it("returns WARNING when high count > 0 and no criticals", () => {
    expect(
      computeFindingsHealth(makeSummary({ total: 5, high: 3, medium: 2 }))
    ).toBe("WARNING");
  });

  it("returns HEALTHY when only medium findings", () => {
    expect(
      computeFindingsHealth(makeSummary({ total: 4, medium: 4 }))
    ).toBe("HEALTHY");
  });

  it("returns HEALTHY when only low findings", () => {
    expect(
      computeFindingsHealth(makeSummary({ total: 2, low: 2 }))
    ).toBe("HEALTHY");
  });

  it("returns HEALTHY when only info findings", () => {
    expect(
      computeFindingsHealth(makeSummary({ total: 1, info: 1 }))
    ).toBe("HEALTHY");
  });
});

// ---- summarizeFindings ------------------------------------------------------

describe("summarizeFindings", () => {
  it("returns zero counts for empty array", () => {
    const summary = summarizeFindings([]);
    expect(summary.total).toBe(0);
    expect(summary.critical).toBe(0);
    expect(summary.high).toBe(0);
    expect(summary.medium).toBe(0);
    expect(summary.low).toBe(0);
    expect(summary.info).toBe(0);
    expect(summary.by_category).toEqual({});
  });

  it("counts findings by severity", () => {
    const findings: AuditFinding[] = [
      makeFinding({ severity: "CRITICAL" }),
      makeFinding({ severity: "CRITICAL" }),
      makeFinding({ severity: "HIGH" }),
      makeFinding({ severity: "MEDIUM" }),
      makeFinding({ severity: "LOW" }),
      makeFinding({ severity: "INFO" }),
      makeFinding({ severity: "INFO" }),
    ];
    const summary = summarizeFindings(findings);
    expect(summary.total).toBe(7);
    expect(summary.critical).toBe(2);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(1);
    expect(summary.low).toBe(1);
    expect(summary.info).toBe(2);
  });

  it("counts findings by category", () => {
    const findings: AuditFinding[] = [
      makeFinding({ category: "security" }),
      makeFinding({ category: "security" }),
      makeFinding({ category: "code-quality" }),
      makeFinding({ category: "testing" }),
    ];
    const summary = summarizeFindings(findings);
    expect(summary.by_category).toEqual({
      security: 2,
      "code-quality": 1,
      testing: 1,
    });
  });

  it("handles mixed severities and categories", () => {
    const findings: AuditFinding[] = [
      makeFinding({ severity: "CRITICAL", category: "security" }),
      makeFinding({ severity: "HIGH", category: "security" }),
      makeFinding({ severity: "MEDIUM", category: "code-quality" }),
    ];
    const summary = summarizeFindings(findings);
    expect(summary.total).toBe(3);
    expect(summary.critical).toBe(1);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(1);
    expect(summary.by_category).toEqual({
      security: 2,
      "code-quality": 1,
    });
  });
});
