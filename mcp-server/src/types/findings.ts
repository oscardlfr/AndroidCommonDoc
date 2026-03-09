/**
 * Unified audit finding types for the full-audit system.
 *
 * These types provide a structured, deduplicated schema for all audit
 * findings across agents, skills, and scripts. Severity is normalized
 * to a canonical 5-level scale.
 */

import { createHash } from "node:crypto";

// ─── Core Types ─────────────────────────────────────────────────────────────

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type AuditCategory =
  | "architecture"
  | "code-quality"
  | "testing"
  | "security"
  | "documentation"
  | "release-readiness"
  | "platform-parity"
  | "ui-accessibility"
  | "compliance"
  | "performance";

export interface AuditFinding {
  /** Stable identity: sha256(dedupe_key), first 16 hex chars */
  id: string;
  /** Dedup key: "{check}:{file}:{line}" or "{check}:{module}" */
  dedupe_key: string;
  severity: AuditSeverity;
  category: AuditCategory;
  /** Agent/skill/script name that produced this finding */
  source: string;
  /** Rule identifier e.g. "cancellation-exception-swallowed" */
  check: string;
  /** One-line summary */
  title: string;
  /** Full explanation (optional) */
  detail?: string;
  /** Relative file path (optional) */
  file?: string;
  /** Line number (optional) */
  line?: number;
  /** Actionable fix suggestion (optional) */
  suggestion?: string;
  /** L0 pattern doc reference (optional) */
  pattern_doc?: string;
  /** Populated after dedup -- multiple sources that found the same issue */
  found_by?: string[];
  /** Child findings when category rollup is applied */
  children?: AuditFinding[];
}

export interface FindingsLogEntry {
  ts: string;
  run_id: string;
  commit: string;
  branch: string;
  status?: "open" | "resolved";
  finding: AuditFinding;
}

export interface FindingsReport {
  project: string;
  profile: string;
  timestamp: string;
  commit: string;
  branch: string;
  health: "CRITICAL" | "WARNING" | "HEALTHY" | "NO_DATA";
  summary: FindingsSummary;
  findings: AuditFinding[];
  checks_run: number;
  checks_total: number;
  duration_ms: number;
  deduped_count: number;
}

export interface FindingsSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  by_category: Partial<Record<AuditCategory, number>>;
  resolved_since_last?: number;
}

// ─── Severity Normalization ─────────────────────────────────────────────────

/**
 * Map from legacy/inconsistent labels used by various agents/scripts
 * to the canonical 5-level severity scale.
 *
 * Labels that indicate success (OK, PASS) return null -- no finding emitted.
 */
const SEVERITY_MAP: Record<string, AuditSeverity | null> = {
  // CRITICAL tier
  BLOCKER: "CRITICAL",
  BLOCK: "CRITICAL",
  CRITICAL: "CRITICAL",
  // HIGH tier
  ERROR: "HIGH",
  FAIL: "HIGH",
  HIGH: "HIGH",
  // MEDIUM tier
  WARNING: "MEDIUM",
  WARN: "MEDIUM",
  MEDIUM: "MEDIUM",
  // LOW tier
  LOW: "LOW",
  // INFO tier
  INFO: "INFO",
  // No finding emitted
  OK: null,
  PASS: null,
};

/**
 * Normalize a severity label from any agent/script to the canonical scale.
 * Returns null for labels that indicate success (no finding should be emitted).
 * Throws on completely unknown labels.
 */
export function normalizeSeverity(label: string): AuditSeverity | null {
  const upper = label.toUpperCase().trim();
  if (upper in SEVERITY_MAP) {
    return SEVERITY_MAP[upper];
  }
  throw new Error(`Unknown severity label: "${label}"`);
}

// ─── ID Generation ──────────────────────────────────────────────────────────

/**
 * Generate a stable finding ID from a dedupe key.
 * Uses first 16 hex chars of sha256 for compact but collision-resistant IDs.
 */
export function generateFindingId(dedupeKey: string): string {
  return createHash("sha256").update(dedupeKey).digest("hex").slice(0, 16);
}

/**
 * Build a dedupe key from components.
 * Format: "{check}:{file}:{line}" or "{check}:{module}" if no file.
 */
export function buildDedupeKey(check: string, file?: string, line?: number): string {
  if (file && line !== undefined) {
    return `${check}:${file}:${line}`;
  }
  if (file) {
    return `${check}:${file}`;
  }
  return check;
}

/**
 * Create an AuditFinding with auto-generated id from dedupe_key.
 */
export function createFinding(params: Omit<AuditFinding, "id">): AuditFinding {
  return {
    ...params,
    id: generateFindingId(params.dedupe_key),
  };
}

// ─── Severity Ordering ──────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

/**
 * Compare two severities. Returns negative if a is more severe than b.
 */
export function compareSeverity(a: AuditSeverity, b: AuditSeverity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

/**
 * Return the more severe of two severity levels.
 */
export function maxSeverity(a: AuditSeverity, b: AuditSeverity): AuditSeverity {
  return compareSeverity(a, b) <= 0 ? a : b;
}

/**
 * Compute overall health from findings summary.
 */
export function computeFindingsHealth(summary: FindingsSummary): FindingsReport["health"] {
  if (summary.total === 0) return "HEALTHY";
  if (summary.critical > 0) return "CRITICAL";
  if (summary.high > 0) return "WARNING";
  return "HEALTHY";
}

/**
 * Build a FindingsSummary from a list of findings.
 */
export function summarizeFindings(findings: AuditFinding[]): FindingsSummary {
  const summary: FindingsSummary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    by_category: {},
  };

  for (const f of findings) {
    summary[f.severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"]++;
    summary.by_category[f.category] = (summary.by_category[f.category] ?? 0) + 1;
  }

  return summary;
}
