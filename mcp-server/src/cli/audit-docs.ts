/**
 * CLI entrypoint for audit-docs.
 *
 * Usage:
 *   node build/cli/audit-docs.js
 *   node build/cli/audit-docs.js --with-upstream
 *   node build/cli/audit-docs.js --layer L1 --project-root /path/to/l1
 *   node build/cli/audit-docs.js --waves 1,2
 */

import path from "node:path";
import { auditDocs, type AuditResult } from "../monitoring/audit-docs.js";
import { logger } from "../utils/logger.js";

interface CliOptions {
  projectRoot: string;
  layer: "L0" | "L1" | "L2";
  waves?: number[];
  withUpstream: boolean;
  cacheTtlHours?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  let projectRoot = process.cwd();
  let layer: "L0" | "L1" | "L2" = "L0";
  let waves: number[] | undefined;
  let withUpstream = false;
  let cacheTtlHours: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--project-root" && next) {
      projectRoot = path.resolve(next);
      i++;
    } else if (arg === "--layer" && next) {
      if (next === "L0" || next === "L1" || next === "L2") {
        layer = next;
      }
      i++;
    } else if (arg === "--waves" && next) {
      waves = next
        .split(",")
        .map((w) => parseInt(w.trim(), 10))
        .filter((w) => !isNaN(w));
      i++;
    } else if (arg === "--with-upstream") {
      withUpstream = true;
    } else if (arg === "--cache-ttl" && next) {
      cacheTtlHours = parseInt(next, 10);
      i++;
    }
  }

  return { projectRoot, layer, waves, withUpstream, cacheTtlHours };
}

function formatReport(result: AuditResult): string {
  const lines: string[] = [];

  lines.push("# Documentation Audit Report");
  lines.push("");
  lines.push(`Project: ${result.projectRoot}`);
  lines.push(`Layer: ${result.layer}`);
  lines.push(`Waves: ${result.wavesRun.join(", ")}`);
  lines.push(`Timestamp: ${result.timestamp}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(`Total findings: ${result.summary.total}`);
  lines.push(`  HIGH: ${result.summary.high}`);
  lines.push(`  MEDIUM: ${result.summary.medium}`);
  lines.push(`  LOW: ${result.summary.low}`);

  if (result.findings.length > 0) {
    lines.push("");
    lines.push("## Findings");

    for (const wave of result.wavesRun) {
      const waveFindings = result.findings.filter((f) => f.wave === wave);
      if (waveFindings.length === 0) continue;

      const waveName =
        wave === 1 ? "Structure" : wave === 2 ? "Coherence" : "Upstream";
      lines.push("");
      lines.push(`### Wave ${wave}: ${waveName} (${waveFindings.length})`);

      for (const finding of waveFindings) {
        const fileStr = finding.file ? ` (${finding.file})` : "";
        lines.push(`  [${finding.severity}] ${finding.message}${fileStr}`);
      }
    }
  }

  lines.push("");
  if (result.summary.high === 0 && result.summary.medium === 0) {
    lines.push("✅ Documentation audit passed.");
  } else {
    lines.push(
      `❌ ${result.summary.high + result.summary.medium} issues require attention.`,
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  logger.info("Documentation Audit CLI");
  logger.info(`Project: ${options.projectRoot}`);
  logger.info(`Layer: ${options.layer}`);
  logger.info(`Upstream: ${options.withUpstream}`);

  const result = await auditDocs(options);

  // Print human-readable report to stdout
  process.stdout.write(formatReport(result) + "\n");

  // Exit with error if HIGH findings
  if (result.summary.high > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  logger.warn(`Fatal: ${error}`);
  process.exit(2);
});
