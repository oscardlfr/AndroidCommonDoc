/**
 * Shared result types for MCP tool responses.
 *
 * These types provide a consistent structure for all validation tool
 * results, making it easy for AI agents to parse and act on results.
 */

// Re-export finding types for consumers that import from results.ts
export type {
  AuditFinding,
  AuditCategory,
  AuditSeverity,
  FindingsLogEntry,
  FindingsReport,
  FindingsSummary,
} from "./findings.js";

export type ValidationStatus = "PASS" | "FAIL" | "ERROR" | "TIMEOUT";
export type DetailStatus = "PASS" | "FAIL" | "WARN";

export interface ValidationDetail {
  check: string;
  status: DetailStatus;
  message: string;
  file?: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  summary: string;
  details: ValidationDetail[];
  duration_ms: number;
}

export interface ToolResult {
  tool: string;
  result: ValidationResult;
}
