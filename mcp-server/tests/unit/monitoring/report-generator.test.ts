/**
 * Tests for the monitoring report generator.
 *
 * Verifies report structure, severity aggregation, and stale deferral
 * tracking in generated monitoring reports.
 */
import { describe, it, expect } from "vitest";
import type { MonitoringFinding } from "../../../src/registry/types.js";
import type { ChangeReport } from "../../../src/monitoring/change-detector.js";
import {
  generateReport,
  type MonitoringReport,
} from "../../../src/monitoring/report-generator.js";

describe("report-generator", () => {
  const makeFinding = (
    severity: "HIGH" | "MEDIUM" | "LOW" | "INFO",
    hash: string,
  ): MonitoringFinding => ({
    slug: "test-doc",
    source_url: "https://example.com",
    severity,
    category: "version-drift",
    summary: `Finding ${hash}`,
    details: `Details for ${hash}`,
    finding_hash: hash,
  });

  it("groups findings by severity and includes tier information", () => {
    const changeReport: ChangeReport = {
      findings: [
        makeFinding("HIGH", "h1"),
        makeFinding("HIGH", "h2"),
        makeFinding("MEDIUM", "m1"),
        makeFinding("LOW", "l1"),
        makeFinding("INFO", "i1"),
      ],
      checked: 10,
      errors: 1,
      timestamp: "2026-03-14T00:00:00Z",
    };

    const newFindings = [
      makeFinding("HIGH", "h1"),
      makeFinding("MEDIUM", "m1"),
      makeFinding("LOW", "l1"),
    ];

    const report = generateReport(changeReport, newFindings, 1, []);

    expect(report.tier_filter).toBe(1);
    expect(report.checked).toBe(10);
    expect(report.errors).toBe(1);
    expect(report.findings.high).toBe(1);
    expect(report.findings.medium).toBe(1);
    expect(report.findings.low).toBe(1);
    expect(report.findings.new).toBe(3);
    expect(report.findings.total).toBe(5);
    expect(report.details).toHaveLength(3);
  });

  it("includes summary counts (total, new, high, medium, low)", () => {
    const changeReport: ChangeReport = {
      findings: [
        makeFinding("HIGH", "h1"),
        makeFinding("MEDIUM", "m1"),
        makeFinding("MEDIUM", "m2"),
      ],
      checked: 5,
      errors: 0,
      timestamp: "2026-03-14T00:00:00Z",
    };

    const newFindings = [
      makeFinding("HIGH", "h1"),
      makeFinding("MEDIUM", "m1"),
    ];

    const report = generateReport(changeReport, newFindings, "all", []);

    expect(report.findings.total).toBe(3);
    expect(report.findings.new).toBe(2);
    expect(report.findings.high).toBe(1);
    expect(report.findings.medium).toBe(1);
    expect(report.findings.low).toBe(0);
    expect(report.tier_filter).toBe("all");
  });

  it("includes stale deferral hashes in report", () => {
    const changeReport: ChangeReport = {
      findings: [],
      checked: 3,
      errors: 0,
      timestamp: "2026-03-14T00:00:00Z",
    };

    const staleDeferrals = ["stale-hash-1", "stale-hash-2"];
    const report = generateReport(changeReport, [], "all", staleDeferrals);

    expect(report.stale_deferrals).toEqual(["stale-hash-1", "stale-hash-2"]);
  });

  it("includes valid timestamp in report", () => {
    const changeReport: ChangeReport = {
      findings: [],
      checked: 0,
      errors: 0,
      timestamp: "2026-03-14T00:00:00Z",
    };

    const report = generateReport(changeReport, [], "all", []);

    expect(report.timestamp).toBeDefined();
    // Should be a valid ISO date string
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).getTime()).not.toBeNaN();
  });

  it("handles empty findings gracefully", () => {
    const changeReport: ChangeReport = {
      findings: [],
      checked: 0,
      errors: 0,
      timestamp: "2026-03-14T00:00:00Z",
    };

    const report = generateReport(changeReport, [], 2, []);

    expect(report.findings.total).toBe(0);
    expect(report.findings.new).toBe(0);
    expect(report.findings.high).toBe(0);
    expect(report.findings.medium).toBe(0);
    expect(report.findings.low).toBe(0);
    expect(report.details).toHaveLength(0);
    expect(report.stale_deferrals).toHaveLength(0);
  });
});
