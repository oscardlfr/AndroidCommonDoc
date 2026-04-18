/* eslint-disable no-console */
/**
 * CLI entrypoint for android-layout-diff.
 *
 * Retrofit for Phase 19 — the existing `ui-validation.yml` workflow
 * referenced a CLI that did not yet exist. This file closes that gap so
 * CI can run runtime layout validation on a connected Android device/emulator
 * without MCP.
 *
 * Usage:
 *   node build/cli/android-layout-diff.js --baseline <path> [--device-serial <serial>] [--timeout-ms <n>] [--format json]
 *
 * The tool captures the current device layout by invoking the Android CLI,
 * diffs it against the baseline JSON, and prints findings.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  captureCurrentLayout,
  diffLayouts,
  toFindings,
  type LayoutElement,
  type LayoutFinding,
} from "../tools/android-layout-diff.js";

interface CliArgs {
  baseline?: string;
  deviceSerial?: string;
  timeoutMs: number;
  format: "human" | "json";
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { timeoutMs: 30_000, format: "human", help: false };
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
      case "--device-serial":
        args.deviceSerial = take();
        break;
      case "--timeout-ms":
        args.timeoutMs = parseInt(take() ?? "30000", 10);
        break;
      case "--format":
        args.format = take() === "json" ? "json" : "human";
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (arg.startsWith("--baseline=")) args.baseline = arg.slice(11);
        else if (arg.startsWith("--device-serial="))
          args.deviceSerial = arg.slice(16);
        else if (arg.startsWith("--timeout-ms="))
          args.timeoutMs = parseInt(arg.slice(13), 10);
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
      "android-layout-diff — capture current Android layout and diff against a baseline",
      "",
      "Usage:",
      "  node build/cli/android-layout-diff.js --baseline <path> [--device-serial <serial>] [--timeout-ms <n>] [--format json]",
      "",
      "Options:",
      "  --baseline <path>         Committed baseline JSON (from `android layout --pretty`)",
      "  --device-serial <serial>  adb device serial (required if multiple devices connected)",
      "  --timeout-ms <n>          CLI timeout in ms (default 30000)",
      "  --format human|json       Output format (default: human)",
      "  -h, --help                Show this help",
      "",
      "Exit codes:",
      "  0  No HIGH findings",
      "  1  At least one HIGH finding",
      "  2  Invalid arguments, missing baseline, CLI missing, or device unreachable",
    ].join("\n"),
  );
}

function renderHumanReport(
  deviceSerial: string | undefined,
  baselineCount: number,
  currentCount: number,
  diffCounts: { added: number; removed: number; modified: number },
  findings: LayoutFinding[],
): string {
  const lines = [
    `Android Layout Diff${deviceSerial ? ` — device ${deviceSerial}` : ""}`,
    `Baseline elements: ${baselineCount}  Current: ${currentCount}`,
    `Δ added/removed/modified: ${diffCounts.added}/${diffCounts.removed}/${diffCounts.modified}`,
    "",
  ];
  if (findings.length === 0) {
    lines.push("[OK] No layout drift detected.");
    return lines.join("\n");
  }
  lines.push(`Findings: ${findings.length}`);
  for (const f of findings) {
    lines.push(`  [${f.severity}] ${f.title}`);
    if (f.suggestion) lines.push(`    → ${f.suggestion}`);
  }
  return lines.join("\n");
}

function loadBaseline(
  p: string,
): { ok: true; elements: LayoutElement[] } | { ok: false; message: string } {
  if (!existsSync(p)) {
    return { ok: false, message: `Baseline file not found: ${p}` };
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as LayoutElement[];
    if (!Array.isArray(parsed)) {
      return { ok: false, message: "Baseline is not a JSON array" };
    }
    return { ok: true, elements: parsed };
  } catch (e) {
    return { ok: false, message: `Baseline parse error: ${(e as Error).message}` };
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.baseline) {
    console.error("ERROR: --baseline is required. Use --help for usage.");
    return 2;
  }

  const baseline = loadBaseline(args.baseline);
  if (!baseline.ok) {
    console.error(`ERROR: ${baseline.message}`);
    return 2;
  }

  const capture = await captureCurrentLayout(args.deviceSerial, args.timeoutMs);
  if (!capture.ok) {
    console.error(`ERROR: capture failed (${capture.kind}): ${capture.message}`);
    return 2;
  }

  const diff = diffLayouts(baseline.elements, capture.elements);
  const findings = toFindings(diff);
  const diffCounts = {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
  };

  if (args.format === "json") {
    const payload = {
      device_serial: args.deviceSerial,
      baseline_path: args.baseline,
      baseline_elements: baseline.elements.length,
      current_elements: capture.elements.length,
      diff: diffCounts,
      findings,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      renderHumanReport(
        args.deviceSerial,
        baseline.elements.length,
        capture.elements.length,
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

main(process.argv.slice(2)).then((code) => process.exit(code));
