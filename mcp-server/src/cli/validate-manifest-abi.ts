/* eslint-disable no-console */
/**
 * CLI entrypoint for validate-manifest-abi (BL-W31.7-11).
 *
 * Diffs `.claude/registry/agents.manifest.yaml` against a baseline (default
 * git ref `develop`) and classifies each change as BREAKING | ADDITIVE |
 * NEUTRAL.
 *
 * Usage:
 *   node build/cli/validate-manifest-abi.js [PROJECT_ROOT] [options]
 *
 * Options:
 *   --baseline-ref <ref>     Git ref to compare against (default: develop)
 *   --baseline-file <path>   YAML file path; overrides --baseline-ref
 *   --format summary|json    Output format (default: summary)
 *   --strict                 Exit 1 if BREAKING present (default WARN mode)
 *   --include-neutral        Include NEUTRAL changes in output (default false)
 *   --help, -h               Show usage
 *
 * Exit codes:
 *   0 = no BREAKING (or WARN mode)
 *   1 = BREAKING present AND --strict
 *   2 = invocation error (baseline unreadable, bad args, etc.)
 */

import path from "node:path";
import {
  AbiBaselineError,
  diffManifestAbi,
  type AbiAgentDiff,
  type AbiChange,
  type AbiDiffResult,
} from "../registry/manifest-abi-validator.js";

interface CliOptions {
  projectRoot: string;
  baselineRef?: string;
  baselineFile?: string;
  format: "summary" | "json";
  strict: boolean;
  includeNeutral: boolean;
}

function printUsage(stream: NodeJS.WriteStream = process.stderr): void {
  stream.write(
    "Usage: node build/cli/validate-manifest-abi.js [PROJECT_ROOT] [options]\n\n" +
      "Diffs .claude/registry/agents.manifest.yaml against a baseline and classifies\n" +
      "each change as BREAKING | ADDITIVE | NEUTRAL.\n\n" +
      "Options:\n" +
      "  --baseline-ref <ref>     Git ref to compare against (default: develop)\n" +
      "  --baseline-file <path>   YAML file path; overrides --baseline-ref\n" +
      "  --format summary|json    Output format (default: summary)\n" +
      "  --strict                 Exit 1 if BREAKING present (default WARN mode)\n" +
      "  --include-neutral        Include NEUTRAL changes in output\n" +
      "  --help, -h               Show this message\n\n" +
      "Exit codes:\n" +
      "  0 = no BREAKING (or WARN mode)\n" +
      "  1 = BREAKING present AND --strict\n" +
      "  2 = invocation error\n",
  );
}

function fail(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions | null {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return null;
  }

  let projectRoot = process.cwd();
  let baselineRef: string | undefined;
  let baselineFile: string | undefined;
  let format: "summary" | "json" = "summary";
  let strict = false;
  let includeNeutral = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--strict") {
      strict = true;
    } else if (arg === "--include-neutral") {
      includeNeutral = true;
    } else if (arg === "--baseline-ref") {
      const next = args[i + 1];
      if (typeof next !== "string" || next.length === 0) {
        fail("--baseline-ref requires a value");
      }
      baselineRef = next;
      i++;
    } else if (arg.startsWith("--baseline-ref=")) {
      const value = arg.slice("--baseline-ref=".length);
      if (value.length === 0) fail("--baseline-ref requires a value");
      baselineRef = value;
    } else if (arg === "--baseline-file") {
      const next = args[i + 1];
      if (typeof next !== "string" || next.length === 0) {
        fail("--baseline-file requires a value");
      }
      baselineFile = next;
      i++;
    } else if (arg.startsWith("--baseline-file=")) {
      const value = arg.slice("--baseline-file=".length);
      if (value.length === 0) fail("--baseline-file requires a value");
      baselineFile = value;
    } else if (arg === "--format") {
      const next = args[i + 1];
      if (next !== "summary" && next !== "json") {
        fail(`--format must be 'summary' or 'json' (got '${next ?? "<missing>"}')`);
      }
      format = next;
      i++;
    } else if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "summary" && value !== "json") {
        fail(`--format must be 'summary' or 'json' (got '${value}')`);
      }
      format = value;
    } else if (arg.startsWith("--")) {
      fail(`unknown option '${arg}'`);
    } else {
      projectRoot = path.resolve(arg);
    }
  }

  return {
    projectRoot,
    ...(baselineRef !== undefined ? { baselineRef } : {}),
    ...(baselineFile !== undefined ? { baselineFile } : {}),
    format,
    strict,
    includeNeutral,
  };
}

function describeBaseline(result: AbiDiffResult): string {
  const { baseline } = result;
  if (baseline.file) {
    return `file ${baseline.file}`;
  }
  const ref = baseline.ref ?? "develop";
  return baseline.commit ? `${ref} (commit ${baseline.commit})` : ref;
}

function formatChange(c: AbiChange): string {
  const sev = c.severity.padEnd(10);
  const field = c.field.padEnd(30);
  const op = c.operation.padEnd(8);
  const renderVal = (v: unknown): string => {
    if (v === undefined) return "";
    if (typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  if (c.operation === "add") return `  ${sev} ${field} ${op} ${renderVal(c.after)}`;
  if (c.operation === "remove") return `  ${sev} ${field} ${op} ${renderVal(c.before)}`;
  return `  ${sev} ${field} ${op} ${renderVal(c.before)} -> ${renderVal(c.after)}`;
}

function formatAgent(diff: AbiAgentDiff): string {
  const lines: string[] = [];
  if (diff.kind === "added") {
    lines.push(`agent: ${diff.agent}  [ADDED]`);
    return lines.join("\n");
  }
  if (diff.kind === "removed") {
    lines.push(`agent: ${diff.agent}  [REMOVED]`);
    lines.push("  BREAKING  agent removed");
    return lines.join("\n");
  }
  lines.push(`agent: ${diff.agent}`);
  for (const c of diff.changes) {
    lines.push(formatChange(c));
  }
  return lines.join("\n");
}

function formatSummary(result: AbiDiffResult): string {
  const lines: string[] = [];
  lines.push(`Manifest ABI diff vs ${describeBaseline(result)}`);
  lines.push("");

  if (result.diffs.length === 0 && !result.invariantsChange) {
    lines.push("(no agent diffs)");
  } else {
    for (const d of result.diffs) {
      lines.push(formatAgent(d));
      lines.push("");
    }
    if (result.invariantsChange) {
      lines.push("invariants: [CHANGED]");
      lines.push(`  ${result.invariantsChange.severity}  invariants block changed`);
      lines.push("");
    }
  }

  lines.push(`Totals: ${result.summary}`);
  lines.push(`Status: ${result.status}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts === null) {
    printUsage(process.stdout);
    process.exit(0);
  }

  let result: AbiDiffResult;
  try {
    result = diffManifestAbi({
      projectRoot: opts.projectRoot,
      ...(opts.baselineRef !== undefined ? { baselineRef: opts.baselineRef } : {}),
      ...(opts.baselineFile !== undefined ? { baselineFile: opts.baselineFile } : {}),
      includeNeutral: opts.includeNeutral,
    });
  } catch (err) {
    process.stderr.write(
      `validate-manifest-abi: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    if (err instanceof AbiBaselineError) {
      process.exit(err.exitCode);
    }
    process.exit(2);
  }

  const text =
    opts.format === "json"
      ? JSON.stringify(result, null, 2)
      : formatSummary(result);
  process.stdout.write(text + "\n");

  if (opts.strict && result.status === "FAIL") {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`validate-manifest-abi CLI error: ${err}\n`);
  process.exit(2);
});
