/**
 * Tests for the check-version-sync MCP tool.
 *
 * Covers: parseOutput() edge cases including NO_CONSUMERS_CONFIGURED.
 */
import { describe, it, expect } from "vitest";
import { parseOutput } from "../../../src/tools/check-version-sync.js";

describe("parseOutput", () => {
  it("returns NO_CONSUMERS_CONFIGURED when stdout is empty and exitCode is 0", () => {
    const result = parseOutput("", "", 0, 0);
    expect(result.status).toBe("NO_CONSUMERS_CONFIGURED");
    expect(result.summary).toContain("consumer-paths");
    expect(result.details).toHaveLength(0);
  });

  it("returns NO_CONSUMERS_CONFIGURED when stdout is whitespace-only", () => {
    const result = parseOutput("   \n  ", "", 0, 0);
    expect(result.status).toBe("NO_CONSUMERS_CONFIGURED");
  });

  it("returns TIMEOUT when exitCode is 124", () => {
    const result = parseOutput("", "", 124, 5000);
    expect(result.status).toBe("TIMEOUT");
    expect(result.summary).toContain("timed out");
  });

  it("returns PASS when script outputs PASS lines and exits 0", () => {
    const stdout = "PASS: version 1.0.0 matches catalog\nPASS: ktor 3.4.0 in sync";
    const result = parseOutput(stdout, "", 0, 100);
    expect(result.status).toBe("PASS");
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details.every((d) => d.status === "PASS")).toBe(true);
  });

  it("returns FAIL when script outputs FAIL lines", () => {
    const stdout = "FAIL: version mismatch for koin-core";
    const result = parseOutput(stdout, "", 0, 100);
    expect(result.status).toBe("FAIL");
  });

  it("returns FAIL when exitCode is non-zero", () => {
    const stdout = "PASS: version 1.0.0 matches catalog";
    const result = parseOutput(stdout, "", 1, 100);
    expect(result.status).toBe("FAIL");
  });

  it("includes duration_ms in result", () => {
    const result = parseOutput("", "", 0, 42);
    expect(result.duration_ms).toBe(42);
  });

  it("falls back to raw stdout when no PASS/FAIL pattern matched but stdout non-empty", () => {
    const stdout = "Some unstructured output from script";
    const result = parseOutput(stdout, "", 0, 100);
    expect(result.status).toBe("PASS");
    expect(result.details).toHaveLength(1);
    expect(result.details[0].message).toContain("unstructured");
  });
});
