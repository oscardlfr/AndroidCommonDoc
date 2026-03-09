/**
 * MCP tool: audit-report
 *
 * Reads .androidcommondoc/audit-log.jsonl from a project root,
 * aggregates events by ISO week, and returns structured trend data
 * suitable for manager-facing reports.
 *
 * Zero agent overhead — the log is written by scripts, never by the agent.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { readJsonlFile } from "../utils/jsonl-reader.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditEntry {
  ts: string;
  event: string;
  result: "pass" | "warn" | "fail";
  project: string;
  layer: string;
  branch: string;
  commit: string;
  // coverage fields
  coverage_pct?: number;
  modules_total?: number;
  modules_passed?: number;
  modules_at_100?: number;
  missed_lines?: number;
  duration_s?: number;
  detekt_violations?: number;
  detekt_rules_fired?: number;
  // sbom fields
  cve_critical?: number;
  cve_high?: number;
  cve_medium?: number;
  cve_low?: number;
  files_scanned?: number;
  // android_test fields
  tests_total?: number;
  tests_passed?: number;
  tests_failed?: number;
  pass_rate?: number;
  // kmp_verify fields
  errors?: number;
  warnings?: number;
}

interface WeekBucket {
  week: string; // ISO week label e.g. "2026-W11"
  coverage_pct?: number;
  detekt_violations?: number;
  tests_pass_rate?: number;
  cve_critical?: number;
  cve_high?: number;
  cve_medium?: number;
  cve_low?: number;
  kmp_errors?: number;
  result_coverage?: string;
  result_sbom?: string;
  result_tests?: string;
  result_kmp?: string;
  runs: number;
}

interface AuditReport {
  project: string;
  layer: string;
  log_path: string;
  total_events: number;
  weeks: WeekBucket[];
  latest: {
    ts: string;
    branch: string;
    commit: string;
    coverage_pct?: number;
    detekt_violations?: number;
    tests_pass_rate?: number;
    cve_critical?: number;
    cve_high?: number;
  };
  trend: {
    coverage_delta_pp?: number;
    detekt_delta_pct?: number;
    tests_delta_pp?: number;
    cve_critical_delta?: number;
  };
  health: "HEALTHY" | "WARNING" | "CRITICAL" | "NO_DATA";
  summary: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoWeek(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "unknown";
  // ISO week: Thursday determines the week number
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const daysDiff = Math.floor((d.getTime() - startOfWeek1.getTime()) / 86400000);
  const weekNum = Math.floor(daysDiff / 7) + 1;
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

async function readJsonl(logPath: string): Promise<AuditEntry[]> {
  return readJsonlFile<AuditEntry>(logPath);
}

function trafficLight(metric: "coverage" | "detekt" | "tests" | "cve", val?: number): string {
  if (val === undefined) return "⚪";
  switch (metric) {
    case "coverage": return val >= 80 ? "🟢" : val >= 60 ? "🟡" : "🔴";
    case "detekt":   return val === 0 ? "🟢" : val <= 10 ? "🟡" : "🔴";
    case "tests":    return val >= 99 ? "🟢" : val >= 90 ? "🟡" : "🔴";
    case "cve":      return val === 0 ? "🟢" : val <= 2 ? "🟡" : "🔴";
  }
}

function computeHealth(latest: AuditReport["latest"]): AuditReport["health"] {
  const critical =
    (latest.cve_critical !== undefined && latest.cve_critical > 0) ||
    (latest.tests_pass_rate !== undefined && latest.tests_pass_rate < 80) ||
    (latest.coverage_pct !== undefined && latest.coverage_pct < 40);
  const warn =
    (latest.cve_critical !== undefined && latest.cve_critical === 0 && (latest.cve_high ?? 0) > 5) ||
    (latest.coverage_pct !== undefined && latest.coverage_pct < 60) ||
    (latest.tests_pass_rate !== undefined && latest.tests_pass_rate < 90) ||
    (latest.detekt_violations !== undefined && latest.detekt_violations > 20);
  if (critical) return "CRITICAL";
  if (warn) return "WARNING";
  return "HEALTHY";
}

function renderMarkdown(report: AuditReport, weeksBack: number): string {
  const healthEmoji = { HEALTHY: "🟢", WARNING: "🟡", CRITICAL: "🔴", NO_DATA: "⚪" }[report.health];

  const rows = report.weeks.map(w => {
    const cov = w.coverage_pct !== undefined ? `${w.coverage_pct}%` : "—";
    const det = w.detekt_violations !== undefined ? String(w.detekt_violations) : "—";
    const tst = w.tests_pass_rate !== undefined ? `${w.tests_pass_rate}%` : "—";
    const cvc = w.cve_critical !== undefined ? String(w.cve_critical) : "—";
    const cvh = w.cve_high !== undefined ? String(w.cve_high) : "—";
    return `| ${w.week} | ${cov} | ${det} | ${tst} | ${cvc} | ${cvh} |`;
  });

  const { trend, latest } = report;
  const deltaCov = trend.coverage_delta_pp !== undefined
    ? (trend.coverage_delta_pp >= 0 ? `+${trend.coverage_delta_pp}pp` : `${trend.coverage_delta_pp}pp`)
    : "—";
  const deltaDet = trend.detekt_delta_pct !== undefined
    ? (trend.detekt_delta_pct <= 0 ? `${trend.detekt_delta_pct}%` : `+${trend.detekt_delta_pct}%`)
    : "—";
  const deltaTst = trend.tests_delta_pp !== undefined
    ? (trend.tests_delta_pp >= 0 ? `+${trend.tests_delta_pp}pp` : `${trend.tests_delta_pp}pp`)
    : "—";
  const deltaCvc = trend.cve_critical_delta !== undefined
    ? (trend.cve_critical_delta <= 0 ? `${trend.cve_critical_delta}` : `+${trend.cve_critical_delta}`)
    : "—";

  return [
    `## ${healthEmoji} Calidad del Proyecto — ${report.project}${report.layer ? ` (${report.layer})` : ""}`,
    `Período: ${weeksBack} semanas | Última actualización: ${latest.ts.split("T")[0]} | Commit: \`${latest.commit || "—"}\` | Rama: \`${latest.branch || "—"}\``,
    "",
    `| Semana | Cobertura | Detekt violations | Tests (pass rate) | CVE críticos | CVE altos |`,
    `|--------|-----------|-------------------|-------------------|--------------|-----------|`,
    ...rows,
    "",
    "### Última medición",
    `| Métrica | Valor | Estado | Δ período |`,
    `|---------|-------|--------|-----------|`,
    `| ${trafficLight("coverage", latest.coverage_pct)} Cobertura media | ${latest.coverage_pct !== undefined ? `${latest.coverage_pct}%` : "—"} | ${trafficLight("coverage", latest.coverage_pct)} | ${deltaCov} |`,
    `| ${trafficLight("detekt", latest.detekt_violations)} Violaciones Detekt | ${latest.detekt_violations !== undefined ? latest.detekt_violations : "—"} | ${trafficLight("detekt", latest.detekt_violations)} | ${deltaDet} |`,
    `| ${trafficLight("tests", latest.tests_pass_rate)} Tests (pass rate) | ${latest.tests_pass_rate !== undefined ? `${latest.tests_pass_rate}%` : "—"} | ${trafficLight("tests", latest.tests_pass_rate)} | ${deltaTst} |`,
    `| ${trafficLight("cve", latest.cve_critical)} CVEs críticos | ${latest.cve_critical !== undefined ? latest.cve_critical : "—"} | ${trafficLight("cve", latest.cve_critical)} | ${deltaCvc} |`,
    "",
    `**Estado general: ${healthEmoji} ${report.health}** | ${report.total_events} eventos registrados`,
  ].join("\n");
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerAuditReport(server: McpServer, rateLimiter: RateLimiter): void {
  server.tool(
    "audit-report",
    "Read .androidcommondoc/audit-log.jsonl from a project and return aggregated quality trend data. Returns both structured JSON and manager-friendly markdown.",
    {
      project_root: z.string().describe("Absolute path to the project root containing .androidcommondoc/audit-log.jsonl"),
      weeks_lookback: z.number().min(1).max(52).default(6).describe("Number of ISO weeks to include in the trend (default: 6)"),
      format: z.enum(["json", "markdown", "both"]).default("both").describe("Output format (default: both)"),
    },
    async ({ project_root, weeks_lookback = 6, format = "both" }) => {
      const allowed = await checkRateLimit(rateLimiter, "audit-report");
      if (!allowed) {
        return { content: [{ type: "text", text: "Rate limit exceeded. Try again in a minute." }] };
      }

      const logPath = path.join(project_root, ".androidcommondoc", "audit-log.jsonl");

      if (!existsSync(logPath)) {
        return {
          content: [{
            type: "text",
            text: [
              `No audit log found at: ${logPath}`,
              "",
              "To start collecting audit data, ensure your project uses AndroidCommonDoc scripts.",
              "The log is created automatically the first time a script runs (coverage, sbom-scan, android-test, verify-kmp).",
              "",
              "Tip: add to .gitattributes:  .androidcommondoc/audit-log.jsonl merge=union",
            ].join("\n"),
          }],
        };
      }

      let entries: AuditEntry[];
      try {
        entries = await readJsonl(logPath);
      } catch (err) {
        logger.error(`audit-report: failed to read log: ${err}`);
        return { content: [{ type: "text", text: `Failed to read audit log: ${err}` }] };
      }

      if (entries.length === 0) {
        return { content: [{ type: "text", text: "Audit log exists but contains no entries yet." }] };
      }

      // Filter to requested week window
      const now = new Date();
      const cutoff = new Date(now.getTime() - weeks_lookback * 7 * 24 * 3600 * 1000);
      const recent = entries.filter(e => new Date(e.ts) >= cutoff);

      // Build week buckets
      const bucketMap = new Map<string, WeekBucket>();
      for (const e of recent) {
        const week = isoWeek(e.ts);
        if (!bucketMap.has(week)) {
          bucketMap.set(week, { week, runs: 0 });
        }
        const b = bucketMap.get(week)!;
        b.runs++;
        if (e.event === "coverage") {
          // last run of week wins
          if (e.coverage_pct !== undefined) b.coverage_pct = e.coverage_pct;
          if (e.detekt_violations !== undefined) b.detekt_violations = e.detekt_violations;
          b.result_coverage = e.result;
        }
        if (e.event === "sbom_scan") {
          if (e.cve_critical !== undefined) b.cve_critical = e.cve_critical;
          if (e.cve_high !== undefined) b.cve_high = e.cve_high;
          if (e.cve_medium !== undefined) b.cve_medium = e.cve_medium;
          if (e.cve_low !== undefined) b.cve_low = e.cve_low;
          b.result_sbom = e.result;
        }
        if (e.event === "android_test") {
          if (e.pass_rate !== undefined) b.tests_pass_rate = e.pass_rate;
          b.result_tests = e.result;
        }
        if (e.event === "kmp_verify") {
          if (e.errors !== undefined) b.kmp_errors = e.errors;
          b.result_kmp = e.result;
        }
      }

      // Sort weeks chronologically
      const weeks = Array.from(bucketMap.values()).sort((a, b) => a.week.localeCompare(b.week));

      // Latest values from all-time last event per metric
      const lastCoverage = [...entries].reverse().find(e => e.event === "coverage");
      const lastSbom = [...entries].reverse().find(e => e.event === "sbom_scan");
      const lastTest = [...entries].reverse().find(e => e.event === "android_test");
      const lastTs = entries[entries.length - 1]?.ts ?? "";

      const latest: AuditReport["latest"] = {
        ts: lastTs,
        branch: entries[entries.length - 1]?.branch ?? "",
        commit: entries[entries.length - 1]?.commit ?? "",
        coverage_pct: lastCoverage?.coverage_pct,
        detekt_violations: lastCoverage?.detekt_violations,
        tests_pass_rate: lastTest?.pass_rate,
        cve_critical: lastSbom?.cve_critical,
        cve_high: lastSbom?.cve_high,
      };

      // Trend: compare first vs last week in the window
      const firstWeek = weeks[0];
      const lastWeek = weeks[weeks.length - 1];
      const trend: AuditReport["trend"] = {};
      if (firstWeek && lastWeek && firstWeek !== lastWeek) {
        if (firstWeek.coverage_pct !== undefined && lastWeek.coverage_pct !== undefined) {
          trend.coverage_delta_pp = Math.round((lastWeek.coverage_pct - firstWeek.coverage_pct) * 10) / 10;
        }
        if (firstWeek.detekt_violations !== undefined && lastWeek.detekt_violations !== undefined && firstWeek.detekt_violations > 0) {
          trend.detekt_delta_pct = Math.round(((lastWeek.detekt_violations - firstWeek.detekt_violations) / firstWeek.detekt_violations) * 100);
        }
        if (firstWeek.tests_pass_rate !== undefined && lastWeek.tests_pass_rate !== undefined) {
          trend.tests_delta_pp = Math.round((lastWeek.tests_pass_rate - firstWeek.tests_pass_rate) * 10) / 10;
        }
        if (firstWeek.cve_critical !== undefined && lastWeek.cve_critical !== undefined) {
          trend.cve_critical_delta = lastWeek.cve_critical - firstWeek.cve_critical;
        }
      }

      const projectName = entries.find(e => e.project)?.project ?? path.basename(project_root);
      const layer = entries.find(e => e.layer)?.layer ?? "";
      const health = entries.length === 0 ? "NO_DATA" : computeHealth(latest);

      const report: AuditReport = {
        project: projectName,
        layer,
        log_path: logPath,
        total_events: entries.length,
        weeks,
        latest,
        trend,
        health,
        summary: `${health} — ${weeks.length} weeks of data, ${entries.length} total events`,
      };

      const parts: string[] = [];

      if (format === "json" || format === "both") {
        parts.push("```json\n" + JSON.stringify(report, null, 2) + "\n```");
      }
      if (format === "markdown" || format === "both") {
        parts.push(renderMarkdown(report, weeks_lookback));
      }

      return { content: [{ type: "text", text: parts.join("\n\n---\n\n") }] };
    }
  );
}
