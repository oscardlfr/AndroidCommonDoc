/**
 * MCP tool: skill-usage-analytics
 *
 * Reads audit-log.jsonl and findings-log.jsonl from a project,
 * groups entries by source/skill name, and computes usage statistics:
 * run counts, finding frequencies, most common checks, and trends
 * over a configurable lookback window.
 *
 * Read-only: does NOT write to logs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { readJsonlFile, fileExists } from "../utils/jsonl-reader.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLogEntry {
  ts: string;
  event: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface FindingsLogEntry {
  ts: string;
  run_id: string;
  commit: string;
  branch: string;
  finding: {
    source: string;
    check: string;
    [key: string]: unknown;
  };
}

interface SkillUsageStats {
  skill: string;
  run_count: number;
  last_run: string;
  total_findings: number;
  avg_findings_per_run: number;
  most_common_checks: string[];
}

interface UsageReport {
  project: string;
  weeks_lookback: number;
  audit_entries: number;
  findings_entries: number;
  skills: SkillUsageStats[];
  audit_sources: SkillUsageStats[];
  telemetry: {
    authoritative_for_disuse: false;
    skill_source: "explicit-data.skill_name-only";
    audit_source_scope: "audit-event-and-finding-source";
  };
}

// ── Time filter ──────────────────────────────────────────────────────────────

function isWithinWeeks(ts: string, weeksBack: number): boolean {
  const entryDate = new Date(ts);
  if (isNaN(entryDate.getTime())) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBack * 7);
  return entryDate >= cutoff;
}

// ── Analytics computation ────────────────────────────────────────────────────

function computeSkillUsage(
  auditEntries: AuditLogEntry[],
  findingsEntries: FindingsLogEntry[],
  weeksBack: number,
): { skills: SkillUsageStats[]; auditSources: SkillUsageStats[] } {
  // Filter by time window
  const recentAudit = auditEntries.filter((e) => isWithinWeeks(e.ts, weeksBack));
  const recentFindings = findingsEntries.filter((e) => isWithinWeeks(e.ts, weeksBack));

  type MutableStats = {
    runIds: Set<string>;
    lastTs: string;
    findings: number;
    checks: Map<string, number>;
  };
  const skillMap = new Map<string, MutableStats>();
  const sourceMap = new Map<string, MutableStats>();

  function ensure(map: Map<string, MutableStats>, name: string) {
    if (!map.has(name)) {
      map.set(name, {
        runIds: new Set(),
        lastTs: "",
        findings: 0,
        checks: new Map(),
      });
    }
    return map.get(name)!;
  }

  for (const entry of recentAudit) {
    const explicitSkill = entry.data?.skill_name;
    const isExplicitSkill = typeof explicitSkill === "string" && explicitSkill.trim().length > 0;
    const map = isExplicitSkill ? skillMap : sourceMap;
    const name = isExplicitSkill ? explicitSkill as string : entry.event;
    const stats = ensure(map, name);

    // Use run_id if available, otherwise treat each entry as a unique run
    const runId = (entry.data?.run_id as string) ?? entry.ts;
    stats.runIds.add(runId);

    if (!stats.lastTs || entry.ts > stats.lastTs) {
      stats.lastTs = entry.ts;
    }
  }

  for (const entry of recentFindings) {
    const sourceName = entry.finding.source;
    const stats = ensure(sourceMap, sourceName);

    stats.runIds.add(entry.run_id);
    stats.findings++;

    if (!stats.lastTs || entry.ts > stats.lastTs) {
      stats.lastTs = entry.ts;
    }

    const checkName = entry.finding.check;
    stats.checks.set(checkName, (stats.checks.get(checkName) ?? 0) + 1);
  }

  function finish(map: Map<string, MutableStats>): SkillUsageStats[] {
    const results: SkillUsageStats[] = [];
    for (const [skill, stats] of map.entries()) {
      const runCount = stats.runIds.size;
      const sortedChecks = [...stats.checks.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
      results.push({
        skill,
        run_count: runCount,
        last_run: stats.lastTs,
        total_findings: stats.findings,
        avg_findings_per_run: runCount > 0 ? Math.round((stats.findings / runCount) * 100) / 100 : 0,
        most_common_checks: sortedChecks,
      });
    }
    results.sort((a, b) => b.run_count - a.run_count);
    return results;
  }

  return { skills: finish(skillMap), auditSources: finish(sourceMap) };
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(report: UsageReport): string {
  const lines: string[] = [
    `## Skill Telemetry Analytics -- ${report.project}`,
    `**Lookback:** ${report.weeks_lookback} weeks | **Audit entries:** ${report.audit_entries} | **Findings entries:** ${report.findings_entries}`,
    "",
  ];

  if (report.skills.length === 0) {
    lines.push("No explicit skill invocation data found in the specified time window.");
  } else {
    lines.push("| Explicit Skill | Runs | Last Run | Findings | Avg/Run | Top Checks |");
    lines.push("|----------------|------|----------|----------|---------|------------|");

    for (const s of report.skills) {
      const lastRun = s.last_run ? s.last_run.split("T")[0] : "-";
      const topChecks = s.most_common_checks.length > 0 ? s.most_common_checks.join(", ") : "-";
      lines.push(
        `| ${s.skill} | ${s.run_count} | ${lastRun} | ${s.total_findings} | ${s.avg_findings_per_run} | ${topChecks} |`,
      );
    }
  }

  lines.push("", "> Absence from this report is not evidence of disuse; telemetry has no completeness sentinel.");
  if (report.audit_sources.length > 0) {
    lines.push("", "### Audit Sources (not skill invocations)");
    lines.push("| Source | Runs | Last Run | Findings | Avg/Run | Top Checks |");
    lines.push("|--------|------|----------|----------|---------|------------|");
  }
  for (const s of report.audit_sources) {
    const lastRun = s.last_run ? s.last_run.split("T")[0] : "-";
    const topChecks = s.most_common_checks.length > 0 ? s.most_common_checks.join(", ") : "-";
    lines.push(
      `| ${s.skill} | ${s.run_count} | ${lastRun} | ${s.total_findings} | ${s.avg_findings_per_run} | ${topChecks} |`,
    );
  }

  return lines.join("\n");
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerSkillUsageAnalyticsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "skill-usage-analytics",
    "Read audit and findings logs to report explicit skill usage telemetry separately from audit-event and finding-source activity. It never infers skill disuse from absence.",
    {
      project_root: z.string().describe("Absolute path to the project root"),
      weeks_lookback: z
        .number()
        .min(1)
        .max(52)
        .default(12)
        .describe("Number of weeks to look back (default: 12)"),
      format: z
        .enum(["json", "markdown", "both"])
        .default("both")
        .describe("Output format (default: both)"),
    },
    async ({ project_root, weeks_lookback = 12, format = "both" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "skill-usage-analytics");
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const auditLogPath = path.join(project_root, ".androidcommondoc", "audit-log.jsonl");
      const findingsLogPath = path.join(project_root, ".androidcommondoc", "findings-log.jsonl");

      let auditEntries: AuditLogEntry[] = [];
      let findingsEntries: FindingsLogEntry[] = [];

      // Read audit log (optional)
      if (fileExists(auditLogPath)) {
        try {
          auditEntries = await readJsonlFile<AuditLogEntry>(auditLogPath);
        } catch (err) {
          logger.error(`skill-usage-analytics: failed to read audit log: ${err}`);
        }
      }

      // Read findings log (optional)
      if (fileExists(findingsLogPath)) {
        try {
          findingsEntries = await readJsonlFile<FindingsLogEntry>(findingsLogPath);
        } catch (err) {
          logger.error(`skill-usage-analytics: failed to read findings log: ${err}`);
        }
      }

      if (auditEntries.length === 0 && findingsEntries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "No audit or findings data found.",
                "",
                `Checked:`,
                `  - ${auditLogPath}`,
                `  - ${findingsLogPath}`,
                "",
                "Run audit scripts to populate the logs.",
              ].join("\n"),
            },
          ],
        };
      }

      const usage = computeSkillUsage(auditEntries, findingsEntries, weeks_lookback);

      const projectName = path.basename(project_root);
      const report: UsageReport = {
        project: projectName,
        weeks_lookback,
        audit_entries: auditEntries.length,
        findings_entries: findingsEntries.length,
        skills: usage.skills,
        audit_sources: usage.auditSources,
        telemetry: {
          authoritative_for_disuse: false,
          skill_source: "explicit-data.skill_name-only",
          audit_source_scope: "audit-event-and-finding-source",
        },
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
