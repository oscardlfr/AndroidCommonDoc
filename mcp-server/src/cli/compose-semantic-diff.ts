/* eslint-disable no-console */
/**
 * CLI entrypoint for compose-semantic-diff.
 *
 * Allows CI jobs and quality-gater to run the semantic diff without MCP.
 * Exit code 1 on any HIGH finding, 0 otherwise — enables /ui-validation.yml
 * to fail the build on a HIGH regression.
 *
 * Usage:
 *   node build/cli/compose-semantic-diff.js --baseline <path> --current <path> [--screen-name <name>] [--format json]
 */
import {
  parseSemanticTreeFile,
  diffTrees,
  flattenTree,
  toFindings,
  type LayoutFinding,
} from "../tools/compose-semantic-diff.js";

interface CliArgs {
  baseline?: string;
  current?: string;
  screenName?: string;
  format: "human" | "json";
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { format: "human", help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = () => {
      i++;
      return next;
    };
    switch (arg) {
      case "--baseline":
        args.baseline = take();
        break;
      case "--current":
        args.current = take();
        break;
      case "--screen-name":
        args.screenName = take();
        break;
      case "--format":
        args.format = take() === "json" ? "json" : "human";
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        // Allow `--baseline=path` form.
        if (arg.startsWith("--baseline=")) args.baseline = arg.slice(11);
        else if (arg.startsWith("--current=")) args.current = arg.slice(10);
        else if (arg.startsWith("--screen-name=")) args.screenName = arg.slice(14);
        else if (arg.startsWith("--format=")) {
          const v = arg.slice(9);
          args.format = v === "json" ? "json" : "human";
        }
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      "compose-semantic-diff — diff a committed baseline tree against a current capture",
      "",
      "Usage:",
      "  node build/cli/compose-semantic-diff.js --baseline <path> --current <path> [--screen-name <name>] [--format json]",
      "",
      "Options:",
      "  --baseline <path>       Committed baseline .txt (from printToString capture)",
      "  --current <path>        Current capture .txt",
      "  --screen-name <name>    Optional screen identifier for the report",
      "  --format human|json     Output format (default: human)",
      "  -h, --help              Show this help",
      "",
      "Exit codes:",
      "  0  No HIGH findings",
      "  1  At least one HIGH finding",
      "  2  Invalid arguments or IO error",
    ].join("\n"),
  );
}

function renderHumanReport(
  screenName: string | undefined,
  baselineCount: number,
  currentCount: number,
  diffCounts: { added: number; removed: number; modified: number },
  findings: LayoutFinding[],
): string {
  const lines = [
    `Compose Semantic Diff${screenName ? ` — ${screenName}` : ""}`,
    `Baseline nodes: ${baselineCount}  Current nodes: ${currentCount}`,
    `Δ added/removed/modified: ${diffCounts.added}/${diffCounts.removed}/${diffCounts.modified}`,
    "",
  ];
  if (findings.length === 0) {
    lines.push("[OK] No semantic drift detected.");
    return lines.join("\n");
  }
  lines.push(`Findings: ${findings.length}`);
  for (const f of findings) {
    lines.push(`  [${f.severity}] ${f.title}`);
    if (f.suggestion) lines.push(`    → ${f.suggestion}`);
  }
  return lines.join("\n");
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.baseline || !args.current) {
    console.error(
      "ERROR: --baseline and --current are required. Use --help for usage.",
    );
    return 2;
  }

  const baseline = parseSemanticTreeFile(args.baseline);
  if (!baseline.ok) {
    console.error(`ERROR: baseline load failed (${baseline.kind}): ${baseline.message}`);
    return 2;
  }
  const current = parseSemanticTreeFile(args.current);
  if (!current.ok) {
    console.error(`ERROR: current load failed (${current.kind}): ${current.message}`);
    return 2;
  }

  const diff = diffTrees(baseline.nodes, current.nodes);
  const findings = toFindings(diff);
  const diffCounts = {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
  };
  const baselineCount = flattenTree(baseline.nodes).length;
  const currentCount = flattenTree(current.nodes).length;

  if (args.format === "json") {
    const payload = {
      screen_name: args.screenName,
      baseline_path: args.baseline,
      current_path: args.current,
      baseline_nodes: baselineCount,
      current_nodes: currentCount,
      diff: diffCounts,
      findings,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      renderHumanReport(
        args.screenName,
        baselineCount,
        currentCount,
        diffCounts,
        findings,
      ),
    );
  }

  const hasHigh = findings.some((f) => f.severity === "HIGH");
  if (hasHigh) {
    for (const f of findings.filter((f) => f.severity === "HIGH")) {
      console.error(`[HIGH] ${f.title}`);
    }
    return 1;
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
