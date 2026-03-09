/**
 * Structured monitoring report generator.
 *
 * Produces a tiered summary report from change detection findings,
 * aggregating by severity and tracking stale deferrals for review
 * awareness.
 */

import type { MonitoringFinding, MonitoringTier } from "../registry/types.js";
import type { ChangeReport } from "./change-detector.js";

/** Structured monitoring report with severity counts and details. */
export interface MonitoringReport {
  timestamp: string;
  tier_filter: MonitoringTier | "all";
  total_sources: number;
  checked: number;
  errors: number;
  findings: {
    total: number;
    new: number;
    high: number;
    medium: number;
    low: number;
  };
  details: MonitoringFinding[];
  stale_deferrals: string[];
}

/**
 * Generate a structured monitoring report from change detection results.
 *
 * Aggregates severity counts from the new (review-filtered) findings,
 * while using the full change report for total counts. Includes stale
 * deferral hashes for review awareness.
 *
 * @param changeReport - Raw change detection report with all findings
 * @param newFindings - Findings after review-aware filtering
 * @param tierFilter - The tier filter that was applied (1, 2, 3, or "all")
 * @param staleDeferrals - Hashes of deferred findings that have expired
 */
export function generateReport(
  changeReport: ChangeReport,
  newFindings: MonitoringFinding[],
  tierFilter: MonitoringTier | "all",
  staleDeferrals: string[],
): MonitoringReport {
  // Count severities in new (filtered) findings
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const finding of newFindings) {
    switch (finding.severity) {
      case "HIGH":
        high++;
        break;
      case "MEDIUM":
        medium++;
        break;
      case "LOW":
        low++;
        break;
      // INFO findings are not counted in high/medium/low
    }
  }

  return {
    timestamp: new Date().toISOString(),
    tier_filter: tierFilter,
    total_sources: changeReport.checked,
    checked: changeReport.checked,
    errors: changeReport.errors,
    findings: {
      total: changeReport.findings.length,
      new: newFindings.length,
      high,
      medium,
      low,
    },
    details: newFindings,
    stale_deferrals: staleDeferrals,
  };
}
