/* eslint-disable no-console */
/**
 * CLI entrypoint for validate-wave-topology.
 *
 * Validates wave planning directory structure against wave-topology.yaml
 * phase gate config. Reports missing PLAN.md and quality-gate sentinels
 * across all .planning/wave-{slug}/ directories.
 *
 * Sentinel location is read from wave-topology.yaml phase_gates config
 * (FIND-17 fix, BL-W42 PR1): sentinels live in .claude/wave-quality-gates/{slug}.md
 * rather than the gitignored .planning/wave-{slug}/quality-gate.md.
 *
 * Usage:
 *   node build/cli/validate-wave-topology.js [PROJECT_ROOT] [options]
 *
 * Options:
 *   --strict             Exit 1 on findings (default: WARN mode, exit 0)
 *   --format summary|json   Output format (default: summary)
 *   --help, -h           Show usage
 *
 * Exit codes:
 *   0 = no findings, OR findings present in WARN mode (default)
 *   1 = findings present AND --strict was passed
 *   2 = error (wave-topology.yaml unreadable, bad CLI args, etc.)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

interface CliOptions {
  projectRoot: string;
  strict: boolean;
  format: "summary" | "json";
}

function printUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    "Usage: node build/cli/validate-wave-topology.js [PROJECT_ROOT] [options]\n\n" +
      "Validates .planning/wave-{slug}/ directories against wave-topology.yaml\n" +
      "phase gate config. WARN mode by default.\n\n" +
      "Options:\n" +
      "  --strict             Exit 1 if findings present\n" +
      "  --format summary|json   Output format (default: summary)\n" +
      "  --help, -h           Show this message\n\n" +
      "Exit codes:\n" +
      "  0 = no findings, OR findings present in WARN mode\n" +
      "  1 = findings present AND --strict was passed\n" +
      "  2 = error (wave-topology.yaml unreadable, bad arguments, etc.)\n",
  );
}

function parseArgs(argv: string[]): CliOptions | null {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return null;
  }

  let projectRoot = process.cwd();
  let strict = false;
  let format: "summary" | "json" = "summary";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--strict") {
      strict = true;
    } else if (arg === "--format") {
      const next = args[i + 1];
      if (next !== "summary" && next !== "json") {
        process.stderr.write(
          `ERROR: --format must be 'summary' or 'json' (got '${next ?? "<missing>"}')\n`,
        );
        process.exit(2);
      }
      format = next;
      i++;
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "summary" && value !== "json") {
        process.stderr.write(
          `ERROR: --format must be 'summary' or 'json' (got '${value}')\n`,
        );
        process.exit(2);
      }
      format = value;
    } else if (arg.startsWith("--")) {
      process.stderr.write(`ERROR: unknown option '${arg}'\n`);
      process.exit(2);
    } else {
      projectRoot = path.resolve(arg);
    }
  }

  return { projectRoot, strict, format };
}

interface TopologyFinding {
  severity: "error" | "warn" | "info";
  category: string;
  message: string;
}

interface TopologyResult {
  findings: TopologyFinding[];
  findingsBySeverity: { error: number; warn: number; info: number };
}

interface PhaseGateConfig {
  plan_required_before_arch_dispatch?: boolean;
  quality_gate_required_before_push?: boolean;
  sentinel_dir?: string;
  sentinel_filename_template?: string;
}

function resolveSentinelPath(
  projectRoot: string,
  slug: string,
  phaseGates: PhaseGateConfig,
): string {
  const sentinelDir = phaseGates.sentinel_dir ?? ".claude/wave-quality-gates";
  const template = phaseGates.sentinel_filename_template ?? "{slug}.md";
  const filename = template.replace("{slug}", slug);
  return path.join(projectRoot, sentinelDir, filename);
}

function validateWaveTopology(projectRoot: string): TopologyResult {
  const findings: TopologyFinding[] = [];

  const topoPath = path.join(projectRoot, ".claude", "registry", "wave-topology.yaml");
  if (!existsSync(topoPath)) {
    findings.push({
      severity: "error",
      category: "schema",
      message: `wave-topology.yaml not found at ${topoPath}`,
    });
    return buildResult(findings);
  }

  let topology: Record<string, unknown>;
  try {
    topology = parseYaml(readFileSync(topoPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    findings.push({
      severity: "error",
      category: "schema",
      message: `Failed to parse wave-topology.yaml: ${err instanceof Error ? err.message : String(err)}`,
    });
    return buildResult(findings);
  }

  const phaseGates = (topology.phase_gates ?? {}) as PhaseGateConfig;
  const planRequired = phaseGates.plan_required_before_arch_dispatch === true;
  const qualityGateRequired = phaseGates.quality_gate_required_before_push === true;

  const planningDir = path.join(projectRoot, ".planning");
  if (!existsSync(planningDir)) {
    return buildResult(findings);
  }

  let entries: string[];
  try {
    entries = readdirSync(planningDir);
  } catch {
    return buildResult(findings);
  }

  const waveDirs = entries.filter((e) => /^wave-/.test(e));

  for (const waveDir of waveDirs) {
    const wavePath = path.join(planningDir, waveDir);
    const slug = waveDir.slice("wave-".length);

    if (planRequired && !existsSync(path.join(wavePath, "PLAN.md"))) {
      findings.push({
        severity: "warn",
        category: "phase-gate",
        message: `${waveDir}: PLAN.md missing (plan_required_before_arch_dispatch = true)`,
      });
    }

    if (qualityGateRequired) {
      const sentinelPath = resolveSentinelPath(projectRoot, slug, phaseGates);
      if (!existsSync(sentinelPath)) {
        findings.push({
          severity: "warn",
          category: "phase-gate",
          message: `${waveDir}: quality-gate sentinel missing (quality_gate_required_before_push = true)\n  Expected: ${path.relative(projectRoot, sentinelPath)}`,
        });
      }
    }
  }

  return buildResult(findings);
}

function buildResult(findings: TopologyFinding[]): TopologyResult {
  return {
    findings,
    findingsBySeverity: {
      error: findings.filter((f) => f.severity === "error").length,
      warn: findings.filter((f) => f.severity === "warn").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
  };
}

function formatFinding(f: TopologyFinding): string {
  const sev = f.severity.toUpperCase().padEnd(7);
  return `${sev} [${f.category}] ${f.message}`;
}

function formatSummary(result: TopologyResult, projectRoot: string): string {
  const lines: string[] = [];
  lines.push(`Wave topology validator — ${projectRoot}`);
  lines.push(
    `  findings: ${result.findings.length} ` +
      `(errors: ${result.findingsBySeverity.error}, warnings: ${result.findingsBySeverity.warn})`,
  );

  if (result.findings.length === 0) {
    lines.push("");
    lines.push("[OK] no findings");
    return lines.join("\n");
  }

  const byCategory = new Map<string, TopologyFinding[]>();
  for (const f of result.findings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  for (const [category, list] of byCategory) {
    lines.push("");
    lines.push(`-- ${category} (${list.length}) --`);
    for (const f of list) {
      lines.push(formatFinding(f));
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts === null) {
    printUsage(process.stdout);
    process.exit(0);
  }

  let result: TopologyResult;
  try {
    result = validateWaveTopology(opts.projectRoot);
  } catch (err) {
    process.stderr.write(
      `validate-wave-topology: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  const text =
    opts.format === "json"
      ? JSON.stringify(result, null, 2)
      : formatSummary(result, opts.projectRoot);
  process.stdout.write(text + "\n");

  const hasSchemaError = result.findings.some(
    (f) => f.category === "schema" && f.severity === "error",
  );
  if (hasSchemaError) {
    process.exit(2);
  }

  const hasFindings = result.findings.length > 0;
  if (opts.strict && hasFindings) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`validate-wave-topology CLI error: ${err}\n`);
  process.exit(2);
});
