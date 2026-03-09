/**
 * MCP tool: findings-report
 *
 * Reads .androidcommondoc/findings-log.jsonl from a project root,
 * deduplicates findings, tracks resolution trends, and returns structured
 * finding data grouped by category/severity.
 *
 * Zero agent overhead — the log is written by scripts, never by the agent.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { readJsonlFile, fileExists } from "../utils/jsonl-reader.js";
import type {
  FindingsLogEntry,
  AuditFinding,
  FindingsSummary,
  AuditSeverity,
} from "../types/findings.js";
import { summarizeFindings, computeFindingsHealth } from "../types/findings.js";
import { deduplicateFindings } from "../utils/finding-dedup.js";

// ─── Severity filtering ──────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

function meetsMinSeverity(
  finding: AuditFinding,
  minSeverity: AuditSeverity,
): boolean {
  return SEVERITY_ORDER[finding.severity] <= SEVERITY_ORDER[minSeverity];
}

// ─── Resolution tracking ─────────────────────────────────────────────────────

interface ResolutionStats {
  new_this_run: number;
  resolved_since_last: number;
  persistent: number;
}

function computeResolution(
  currentRunFindings: AuditFinding[],
  previousRunFindings: AuditFinding[],
): ResolutionStats {
  const currentKeys = new Set(currentRunFindings.map((f) => f.dedupe_key));
  const previousKeys = new Set(previousRunFindings.map((f) => f.dedupe_key));

  let newThisRun = 0;
  let persistent = 0;
  let resolved = 0;

  for (const key of currentKeys) {
    if (previousKeys.has(key)) {
      persistent++;
    } else {
      newThisRun++;
    }
  }

  for (const key of previousKeys) {
    if (!currentKeys.has(key)) {
      resolved++;
    }
  }

  return {
    new_this_run: newThisRun,
    resolved_since_last: resolved,
    persistent,
  };
}

// ─── Report types ─────────────────────────────────────────────────────────────

interface FindingsReportOutput {
  project: string;
  log_path: string;
  run_id: string;
  commit: string;
  branch: string;
  health: "CRITICAL" | "WARNING" | "HEALTHY" | "NO_DATA";
  summary: FindingsSummary;
  findings: AuditFinding[];
  resolution: ResolutionStats;
  total_log_entries: number;
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: FindingsReportOutput): string {
  const healthEmoji = {
    CRITICAL: "🔴",
    WARNING: "🟡",
    HEALTHY: "🟢",
    NO_DATA: "⚪",
  }[report.health];

  const { summary } = report;
  const countParts: string[] = [];
  if (summary.critical > 0) countParts.push(`${summary.critical} CRIT`);
  if (summary.high > 0) countParts.push(`${summary.high} HIGH`);
  if (summary.medium > 0) countParts.push(`${summary.medium} MED`);
  if (summary.low > 0) countParts.push(`${summary.low} LOW`);
  if (summary.info > 0) countParts.push(`${summary.info} INFO`);

  const headerCountStr =
    countParts.length > 0
      ? `${summary.total} findings: ${countParts.join(", ")}`
      : "0 findings";

  const rows = report.findings.map((f, i) => {
    const line = f.line !== undefined ? String(f.line) : "-";
    const file = f.file ?? "-";
    return `| ${i + 1} | ${f.severity} | ${f.category} | ${f.check} | ${f.title} | ${file} | ${line} |`;
  });

  const { resolution } = report;

  const lines = [
    `## Findings Report -- ${report.project}`,
    `**Run:** ${report.run_id} | **Commit:** ${report.commit || "-"} | **Branch:** ${report.branch || "-"}`,
    `**Health:** ${healthEmoji} ${report.health} (${headerCountStr})`,
    "",
    "| # | Severity | Category | Check | Title | File | Line |",
    "|---|----------|----------|-------|-------|------|------|",
    ...rows,
    "",
    "### Resolution Trend",
    `- New this run: ${resolution.new_this_run}`,
    `- Resolved since last run: ${resolution.resolved_since_last}`,
    `- Persistent: ${resolution.persistent}`,
  ];

  return lines.join("\n");
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerFindingsReport(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "findings-report",
    "Read findings-log.jsonl from a project and return structured finding data grouped by category/severity with resolution trends.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the project root"),
      run_id: z
        .string()
        .optional()
        .describe("Filter to specific run ID"),
      severity_filter: z
        .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])
        .optional()
        .describe("Show only findings at this severity or above"),
      category_filter: z
        .string()
        .optional()
        .describe("Filter to specific category"),
      format: z.enum(["json", "markdown", "both"]).default("both"),
      include_resolved: z
        .boolean()
        .default(false)
        .describe("Include resolved findings"),
    },
    async ({
      project_root,
      run_id,
      severity_filter,
      category_filter,
      format = "both",
      include_resolved = false,
    }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "findings-report");
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const logPath = path.join(
        project_root,
        ".androidcommondoc",
        "findings-log.jsonl",
      );

      if (!fileExists(logPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `No findings log found at: ${logPath}`,
                "",
                "To start collecting findings, run audit scripts that use findings-append.sh or Add-Finding.",
                "The log is created automatically the first time a finding is recorded.",
                "",
                "Tip: add to .gitattributes:  .androidcommondoc/findings-log.jsonl merge=union",
              ].join("\n"),
            },
          ],
        };
      }

      let allEntries: FindingsLogEntry[];
      try {
        allEntries = await readJsonlFile<FindingsLogEntry>(logPath);
      } catch (err) {
        logger.error(`findings-report: failed to read log: ${err}`);
        return {
          content: [
            { type: "text" as const, text: `Failed to read findings log: ${err}` },
          ],
        };
      }

      if (allEntries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Findings log exists but contains no entries yet.",
            },
          ],
        };
      }

      // Determine unique run IDs (ordered by appearance)
      const runIds: string[] = [];
      const seenRuns = new Set<string>();
      for (const e of allEntries) {
        if (!seenRuns.has(e.run_id)) {
          seenRuns.add(e.run_id);
          runIds.push(e.run_id);
        }
      }

      // Determine the target run
      const targetRunId = run_id ?? runIds[runIds.length - 1];

      // Split entries by run
      const entriesForTarget = allEntries.filter(
        (e) => e.run_id === targetRunId,
      );

      // Determine previous run for resolution tracking
      const targetRunIndex = runIds.indexOf(targetRunId);
      const previousRunId =
        targetRunIndex > 0 ? runIds[targetRunIndex - 1] : undefined;
      const entriesForPrevious = previousRunId
        ? allEntries.filter((e) => e.run_id === previousRunId)
        : [];

      // Extract findings
      let currentFindings = entriesForTarget.map((e) => e.finding);
      const previousFindings = entriesForPrevious.map((e) => e.finding);

      // Deduplicate current findings
      currentFindings = deduplicateFindings(currentFindings);

      // Filter: exclude resolved unless requested
      if (!include_resolved) {
        const resolvedKeys = new Set<string>();
        for (const e of allEntries) {
          if (e.status === "resolved") {
            resolvedKeys.add(e.finding.dedupe_key);
          }
        }
        currentFindings = currentFindings.filter(
          (f) => !resolvedKeys.has(f.dedupe_key),
        );
      }

      // Filter by severity
      if (severity_filter) {
        currentFindings = currentFindings.filter((f) =>
          meetsMinSeverity(f, severity_filter),
        );
      }

      // Filter by category
      if (category_filter) {
        currentFindings = currentFindings.filter(
          (f) => f.category === category_filter,
        );
      }

      // Build summary
      const summary = summarizeFindings(currentFindings);
      const health =
        currentFindings.length === 0
          ? "NO_DATA"
          : computeFindingsHealth(summary);

      // Resolution tracking
      const resolution = computeResolution(
        currentFindings,
        deduplicateFindings(previousFindings),
      );

      // Metadata from the latest entry in target run
      const latestEntry = entriesForTarget[entriesForTarget.length - 1];

      const projectName = path.basename(project_root);

      const report: FindingsReportOutput = {
        project: projectName,
        log_path: logPath,
        run_id: targetRunId,
        commit: latestEntry?.commit ?? "",
        branch: latestEntry?.branch ?? "",
        health,
        summary,
        findings: currentFindings,
        resolution,
        total_log_entries: allEntries.length,
      };

      const parts: string[] = [];

      if (format === "json" || format === "both") {
        parts.push("```json\n" + JSON.stringify(report, null, 2) + "\n```");
      }
      if (format === "markdown" || format === "both") {
        parts.push(renderMarkdown(report));
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
      };
    },
  );
}
