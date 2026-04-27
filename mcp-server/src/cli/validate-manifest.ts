/* eslint-disable no-console */
/**
 * CLI entrypoint for validate-manifest.
 *
 * Allows quality-gater, /pre-pr, drift-audit CI, and any Bash workflow to
 * run the agents-manifest validator without needing an MCP client.
 *
 * Usage:
 *   node build/cli/validate-manifest.js [PROJECT_ROOT] [options]
 *
 * Options:
 *   --strict             Exit 1 on findings (Phase 4 default; Phase 2 must NOT pass this in CI)
 *   --format summary|json   Output format (default: summary)
 *   --help, -h           Show usage
 *
 * Exit codes:
 *   0 = no findings, OR findings present in WARN mode (default)
 *   1 = findings present AND --strict was passed (Phase 4 readiness)
 *   2 = error (manifest unreadable, schema invalid, bad CLI args, etc.)
 *
 * In CI, the GitHub Actions wrapper job appends warnings to
 * `$GITHUB_STEP_SUMMARY` and always exits 0, even when this CLI exits 1
 * (we keep `--strict` available for local checks and Phase 4).
 */

import path from "node:path";
import {
  validateManifest,
  type Finding,
  type ValidationResult,
} from "../registry/manifest-validator.js";

interface CliOptions {
  projectRoot: string;
  strict: boolean;
  format: "summary" | "json";
}

function printUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    "Usage: node build/cli/validate-manifest.js [PROJECT_ROOT] [options]\n\n" +
      "Validates .claude/registry/agents.manifest.yaml against agent template\n" +
      "frontmatter. WARN mode by default (Phase 2).\n\n" +
      "Options:\n" +
      "  --strict             Exit 1 if findings present (Phase 4 default)\n" +
      "  --format summary|json   Output format (default: summary)\n" +
      "  --help, -h           Show this message\n\n" +
      "Exit codes:\n" +
      "  0 = no findings, OR findings present in WARN mode\n" +
      "  1 = findings present AND --strict was passed\n" +
      "  2 = error (manifest unreadable, bad arguments, etc.)\n",
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
      // Positional: PROJECT_ROOT (first one wins).
      projectRoot = path.resolve(arg);
    }
  }

  return { projectRoot, strict, format };
}

function formatFinding(f: Finding): string {
  const sev = f.severity.toUpperCase().padEnd(7);
  const agentTag = f.agent ? `[${f.agent}]` : "[*]";
  const fieldTag = f.field ? ` <${f.field}>` : "";
  return `${sev} ${agentTag}${fieldTag} ${f.message}`;
}

function formatSummary(result: ValidationResult, projectRoot: string): string {
  const lines: string[] = [];
  lines.push(`Manifest validator — ${projectRoot}`);
  lines.push(
    `  agents: ${result.totalAgents}  findings: ${result.totalFindings} ` +
      `(errors: ${result.findingsBySeverity.error}, warnings: ${result.findingsBySeverity.warning})`,
  );
  lines.push(`  invariantsOk: ${result.invariantsOk ? "yes" : "NO"}`);

  if (result.findings.length === 0) {
    lines.push("");
    lines.push("[OK] no findings");
    return lines.join("\n");
  }

  // Group by category for readability.
  const byCategory = new Map<string, Finding[]>();
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

  let result: ValidationResult;
  try {
    result = validateManifest({ projectRoot: opts.projectRoot });
  } catch (err) {
    process.stderr.write(
      `validate-manifest: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  const text =
    opts.format === "json"
      ? JSON.stringify(result, null, 2)
      : formatSummary(result, opts.projectRoot);
  process.stdout.write(text + "\n");

  // Schema-category errors (e.g. unparseable manifest) always exit 2.
  const hasSchemaError = result.findings.some(
    (f) => f.category === "schema" && f.severity === "error",
  );
  if (hasSchemaError) {
    process.exit(2);
  }

  // WARN mode (default Phase 2): always exit 0 unless --strict.
  const hasIssues = result.findingsBySeverity.error > 0;
  if (opts.strict && hasIssues) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`validate-manifest CLI error: ${err}\n`);
  process.exit(2);
});
