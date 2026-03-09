#!/usr/bin/env node
/**
 * CLI entrypoint for doc source monitoring.
 *
 * Runs directly via Node.js without MCP transport -- designed for
 * CI (GitHub Actions cron) and manual invocation. Uses the same
 * monitoring engine as the MCP tool but outputs a JSON report file
 * and a human-readable summary to stdout.
 *
 * Usage:
 *   node build/cli/monitor-sources.js --tier all --output reports/monitoring-report.json
 *
 * IMPORTANT: Uses stderr for logging (via logger) to prevent output
 * corruption. stdout is reserved for the summary output only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { scanDirectory } from "../registry/scanner.js";
import { detectChanges } from "../monitoring/change-detector.js";
import {
  loadReviewState,
  filterNewFindings,
  getStaleDeferrals,
} from "../monitoring/review-state.js";
import { generateReport } from "../monitoring/report-generator.js";
import type { RegistryEntry, MonitoringTier } from "../registry/types.js";
import { logger } from "../utils/logger.js";

/** Parse command-line arguments into typed options. */
interface CliOptions {
  tier: MonitoringTier | "all";
  output: string;
  projectRoot: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  let tier: MonitoringTier | "all" = "all";
  let output = "reports/monitoring-report.json";
  let projectRoot =
    process.env.ANDROID_COMMON_DOC ||
    path.resolve(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
      "..",
      "..",
    );

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--tier" && next) {
      if (next === "all") {
        tier = "all";
      } else {
        const parsed = parseInt(next, 10);
        if (parsed >= 1 && parsed <= 3) {
          tier = parsed as MonitoringTier;
        } else {
          logger.warn(`Invalid tier "${next}", using "all"`);
        }
      }
      i++;
    } else if (arg === "--output" && next) {
      output = next;
      i++;
    } else if (arg === "--project-root" && next) {
      projectRoot = next;
      i++;
    }
  }

  return { tier, output, projectRoot };
}

/**
 * Filter registry entries to only include sources matching the given tier.
 * Creates new entries with monitor_urls filtered to the specified tier.
 */
function filterByTier(
  entries: RegistryEntry[],
  tier: MonitoringTier,
): RegistryEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      metadata: {
        ...entry.metadata,
        monitor_urls: entry.metadata.monitor_urls!.filter(
          (mu) => mu.tier === tier,
        ),
      },
    }))
    .filter((entry) => entry.metadata.monitor_urls!.length > 0);
}

/** Format the monitoring report as a human-readable summary for stdout. */
function formatSummary(
  report: ReturnType<typeof generateReport>,
  tierFilter: MonitoringTier | "all",
): string {
  const lines: string[] = [];

  lines.push("# Doc Source Monitoring Report");
  lines.push("");
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Tier filter: ${tierFilter}`);
  lines.push(`Sources checked: ${report.checked}`);
  lines.push(`Errors: ${report.errors}`);
  lines.push("");
  lines.push("## Findings");
  lines.push(`Total: ${report.findings.total}`);
  lines.push(`New: ${report.findings.new}`);
  lines.push(`  HIGH: ${report.findings.high}`);
  lines.push(`  MEDIUM: ${report.findings.medium}`);
  lines.push(`  LOW: ${report.findings.low}`);

  if (report.stale_deferrals.length > 0) {
    lines.push("");
    lines.push(`## Stale Deferrals: ${report.stale_deferrals.length}`);
  }

  if (report.details.length > 0) {
    lines.push("");
    lines.push("## Details");
    for (const finding of report.details) {
      lines.push("");
      lines.push(`[${finding.severity}] ${finding.summary}`);
      lines.push(`  Slug: ${finding.slug}`);
      lines.push(`  Source: ${finding.source_url}`);
      lines.push(`  Detail: ${finding.details}`);
    }
  }

  return lines.join("\n");
}

/** Main CLI execution. */
async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  logger.info(`Doc Source Monitoring CLI`);
  logger.info(`Project root: ${options.projectRoot}`);
  logger.info(`Tier filter: ${options.tier}`);
  logger.info(`Output: ${options.output}`);

  // Scan docs directory for registry entries
  const docsDir = path.join(options.projectRoot, "docs");
  const allEntries = await scanDirectory(docsDir, "L0");

  // Filter to entries with monitor_urls
  let monitorableEntries = allEntries.filter(
    (e) => e.metadata.monitor_urls && e.metadata.monitor_urls.length > 0,
  );

  logger.info(`Found ${monitorableEntries.length} entries with monitor_urls`);

  // Apply tier filter if not "all"
  if (options.tier !== "all") {
    monitorableEntries = filterByTier(monitorableEntries, options.tier);
    logger.info(
      `After tier ${options.tier} filter: ${monitorableEntries.length} entries`,
    );
  }

  // Run change detection
  const manifestPath = path.join(options.projectRoot, "versions-manifest.json");
  const changeReport = await detectChanges(monitorableEntries, manifestPath);

  // Load review state for filtering
  const reviewStatePath = path.join(
    options.projectRoot,
    ".androidcommondoc",
    "monitoring-state.json",
  );
  const reviewState = await loadReviewState(reviewStatePath);

  // Filter findings
  const staleDeferrals = getStaleDeferrals(
    changeReport.findings,
    reviewState,
  );
  const newFindings = filterNewFindings(changeReport.findings, reviewState);

  // Generate report
  const report = generateReport(
    changeReport,
    newFindings,
    options.tier,
    staleDeferrals,
  );

  // Write report JSON to output path
  const outputPath = path.resolve(options.projectRoot, options.output);
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
  logger.info(`Report written to: ${outputPath}`);

  // Write summary to stdout (for GitHub Actions workflow summary)
  const summary = formatSummary(report, options.tier);
  process.stdout.write(summary + "\n");

  // Always exit 0 -- monitoring failures are reported as findings, not exit codes.
  // Per 10-RESEARCH.md pitfall 6: workflow failure only on infrastructure issues.
  logger.info("Monitoring complete");
}

main().catch((error: unknown) => {
  logger.error(
    `CLI failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
