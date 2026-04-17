/**
 * MCP tool: android-layout-diff
 *
 * Runtime UI layout validation powered by Google's Android CLI (v0.7+).
 *
 * Fetches the current device layout via `android layout --pretty`, diffs it
 * against a committed baseline JSON, and emits structured findings in the
 * `/full-audit` schema. Closes the "tests pass but app renders broken" gap
 * that Compose Preview audits alone cannot catch — those are static; this is
 * runtime on a real device or emulator.
 *
 * Statelessness: the tool does NOT use `android layout --diff` (which depends
 * on CLI-internal snapshot state). Instead it captures the full tree and
 * diffs manually against the user-provided baseline — composable with CI,
 * caching, and multiple concurrent invocations.
 *
 * Parser contract derived from 19-POC-FINDINGS.md (schema observed on
 * Android CLI v0.7.15222914). See that doc for edge-case behavior.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ── Schema types (from POC) ─────────────────────────────────────────────────

/**
 * Layout element as emitted by `android layout --pretty`.
 *
 * Note: `key` is a snapshot/window identifier, NOT a stable per-element ID.
 * Element identity is inferred from (resource-id, text/content-desc, bounds).
 */
export interface LayoutElement {
  text?: string;
  "content-desc"?: string;
  interactions?: string[];
  center: string;
  bounds?: string;
  "resource-id"?: string;
  state?: string[];
  key?: number;
}

/** Finding emitted back to `/full-audit` orchestrator. */
export interface LayoutFinding {
  dedupe_key: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  source: "android-layout-diff";
  check: "layout-diff";
  title: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// ── Abstraction over child_process for testability ──────────────────────────

/** Injectable runner — production uses spawn, tests stub. */
export type AndroidLayoutRunner = (
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const SEPARATOR_40 = "----------------------------------------";

// ── Element identity ─────────────────────────────────────────────────────────

/**
 * Composite identity key for an element.
 *
 * Preference order: resource-id > content-desc > text > bounds/center.
 * Always returns a non-empty string so elements can be compared in sets.
 */
export function elementIdentity(el: LayoutElement): string {
  const id = el["resource-id"];
  const desc = el["content-desc"];
  const txt = el.text;
  const pos = el.bounds ?? el.center ?? "?";
  const primary = id ?? desc ?? txt ?? "anon";
  return `${primary}@${pos}`;
}

// ── Diff algorithm ───────────────────────────────────────────────────────────

interface DiffResult {
  added: LayoutElement[];
  removed: LayoutElement[];
  /**
   * Element identity appeared in both sides, but at least one attribute
   * (text, content-desc, state, interactions) differs. This is a
   * synthetic modified[] since `android layout --pretty` emits a flat list
   * without explicit diff semantics.
   */
  modified: Array<{
    baseline: LayoutElement;
    current: LayoutElement;
    changedFields: string[];
  }>;
}

/**
 * Compute a stateless diff between two full layout captures.
 *
 * Elements are indexed by {@link elementIdentity}. Collision risk is low
 * because the composite key uses resource-id first (most stable) and falls
 * back to content text + position.
 */
export function diffLayouts(
  baseline: LayoutElement[],
  current: LayoutElement[],
): DiffResult {
  const baselineIdx = new Map<string, LayoutElement>();
  for (const el of baseline) baselineIdx.set(elementIdentity(el), el);
  const currentIdx = new Map<string, LayoutElement>();
  for (const el of current) currentIdx.set(elementIdentity(el), el);

  const added: LayoutElement[] = [];
  const removed: LayoutElement[] = [];
  const modified: DiffResult["modified"] = [];

  for (const [key, el] of currentIdx) {
    const base = baselineIdx.get(key);
    if (!base) {
      added.push(el);
      continue;
    }
    const changed = diffAttributes(base, el);
    if (changed.length > 0) {
      modified.push({ baseline: base, current: el, changedFields: changed });
    }
  }
  for (const [key, el] of baselineIdx) {
    if (!currentIdx.has(key)) removed.push(el);
  }

  return { added, removed, modified };
}

function diffAttributes(a: LayoutElement, b: LayoutElement): string[] {
  const fields: string[] = [];
  if (a.text !== b.text) fields.push("text");
  if (a["content-desc"] !== b["content-desc"]) fields.push("content-desc");
  if (!arraysEqual(a.interactions, b.interactions)) fields.push("interactions");
  if (!arraysEqual(a.state, b.state)) fields.push("state");
  return fields;
}

function arraysEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((v, i) => v === bSorted[i]);
}

// ── Fetcher: current layout via `android layout --pretty` ───────────────────

/** Default real-spawn runner. */
const defaultLayoutRunner: AndroidLayoutRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("android", args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({
          stdout,
          stderr: stderr || `timed out after ${timeoutMs}ms`,
          exitCode: 124,
        });
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: 127 });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      }
    });
  });

interface CaptureResult {
  ok: true;
  elements: LayoutElement[];
}
interface CaptureError {
  ok: false;
  kind:
    | "cli_missing"
    | "adb_offline"
    | "multi_device"
    | "json_parse"
    | "timeout"
    | "unknown";
  message: string;
  stderr?: string;
}

/**
 * Capture the current layout from a device.
 *
 * Classifies common failure modes (offline device, multi-device, CLI
 * missing) into typed errors so callers can produce actionable suggestions.
 */
export async function captureCurrentLayout(
  deviceSerial: string | undefined,
  timeoutMs: number,
  runner: AndroidLayoutRunner = defaultLayoutRunner,
): Promise<CaptureResult | CaptureError> {
  const args = ["layout", "--pretty"];
  if (deviceSerial) args.push(`--device=${deviceSerial}`);

  const { stdout, stderr, exitCode } = await runner(args, timeoutMs);

  if (exitCode === 124) {
    return { ok: false, kind: "timeout", message: stderr, stderr };
  }
  if (exitCode !== 0) {
    if (/command not found|ENOENT|is not recognized/i.test(stderr)) {
      return {
        ok: false,
        kind: "cli_missing",
        message:
          "Android CLI not on PATH. See docs/guides/getting-started/android-cli-windows.md",
        stderr,
      };
    }
    if (/AdbDeviceFailResponseException|device offline/i.test(stderr)) {
      return {
        ok: false,
        kind: "adb_offline",
        message: `Device offline or unavailable${deviceSerial ? ` (${deviceSerial})` : ""}. Check \`adb devices\` — the device must be authorized.`,
        stderr,
      };
    }
    if (/more than one device/i.test(stderr)) {
      return {
        ok: false,
        kind: "multi_device",
        message:
          "Multiple devices connected — pass `device_serial` (get from `adb devices`).",
        stderr,
      };
    }
    return {
      ok: false,
      kind: "unknown",
      message: stderr.trim().split("\n")[0] ?? `exit ${exitCode}`,
      stderr,
    };
  }

  // The `android layout` CLI may prepend "Layout tree written to ..." status
  // lines when --output is used. With --pretty alone it writes JSON to stdout.
  const payload = extractJsonPayload(stdout);
  try {
    const parsed = JSON.parse(payload) as LayoutElement[];
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        kind: "json_parse",
        message: "Expected JSON array at top level",
      };
    }
    return { ok: true, elements: parsed };
  } catch (e) {
    return {
      ok: false,
      kind: "json_parse",
      message: `JSON parse failed: ${(e as Error).message}`,
    };
  }
}

/**
 * Strip non-JSON prelude lines (e.g. "Waiting for index...", the 40-dash
 * separator) before the first `[` that opens the array.
 */
function extractJsonPayload(stdout: string): string {
  const bracketIdx = stdout.indexOf("[");
  if (bracketIdx < 0) return stdout;
  const sepIdx = stdout.indexOf(SEPARATOR_40);
  // If a separator appears before the `[`, skip past it.
  if (sepIdx >= 0 && sepIdx < bracketIdx) {
    return stdout.slice(sepIdx + SEPARATOR_40.length).trimStart();
  }
  return stdout.slice(bracketIdx);
}

// ── Finding generation ───────────────────────────────────────────────────────

/**
 * Convert a diff into `/full-audit` findings.
 *
 * Heuristics:
 * - `removed` elements carrying a resource-id are HIGH — they were present
 *   in the baseline but disappeared, the most common bug shape behind
 *   "tests pass but app is broken".
 * - `added` elements without a resource-id are LOW (likely dynamic content,
 *   text injection). Added elements WITH a resource-id are MEDIUM.
 * - `modified` entries are MEDIUM if `text` or `content-desc` changed, LOW
 *   otherwise.
 */
export function toFindings(diff: DiffResult): LayoutFinding[] {
  const findings: LayoutFinding[] = [];

  for (const el of diff.removed) {
    const id = el["resource-id"];
    const severity: LayoutFinding["severity"] = id ? "HIGH" : "MEDIUM";
    const label = id ?? el["content-desc"] ?? el.text ?? "anonymous";
    findings.push({
      dedupe_key: `layout-diff:removed:${elementIdentity(el)}`,
      severity,
      category: "ui-accessibility",
      source: "android-layout-diff",
      check: "layout-diff",
      title: `Element disappeared from rendered layout: ${label}`,
      suggestion: id
        ? `Element with id '${id}' was in the baseline but not in the current capture. Check UiState branch handling — empty state rendering is the most common cause.`
        : `Element '${label}' was in the baseline but not in the current capture.`,
    });
  }

  for (const el of diff.added) {
    const id = el["resource-id"];
    const severity: LayoutFinding["severity"] = id ? "MEDIUM" : "LOW";
    const label = id ?? el["content-desc"] ?? el.text ?? "anonymous";
    findings.push({
      dedupe_key: `layout-diff:added:${elementIdentity(el)}`,
      severity,
      category: "ui-accessibility",
      source: "android-layout-diff",
      check: "layout-diff",
      title: `Unexpected element in rendered layout: ${label}`,
      suggestion:
        "Element appeared in the current capture but not in the baseline. If intentional, update the baseline.",
    });
  }

  for (const m of diff.modified) {
    const id = m.current["resource-id"];
    const label = id ?? m.current["content-desc"] ?? m.current.text ?? "anonymous";
    const textChanged =
      m.changedFields.includes("text") ||
      m.changedFields.includes("content-desc");
    findings.push({
      dedupe_key: `layout-diff:modified:${elementIdentity(m.current)}`,
      severity: textChanged ? "MEDIUM" : "LOW",
      category: "ui-accessibility",
      source: "android-layout-diff",
      check: "layout-diff",
      title: `Element content drifted: ${label} (${m.changedFields.join(", ")})`,
      suggestion: textChanged
        ? `Visible text changed — likely a string-resource regression or a UiState branch rendering the wrong copy.`
        : `Interaction/state fields changed. Update baseline if intentional.`,
    });
  }

  return findings;
}

// ── Report rendering ─────────────────────────────────────────────────────────

interface LayoutDiffReport {
  device_serial?: string;
  baseline_path?: string;
  baseline_elements: number;
  current_elements: number;
  diff: {
    added: number;
    removed: number;
    modified: number;
  };
  findings: LayoutFinding[];
}

function renderMarkdown(r: LayoutDiffReport): string {
  const lines = [
    "## Android Layout Diff",
    "",
    r.device_serial ? `**Device:** ${r.device_serial}` : "**Device:** (default)",
    r.baseline_path ? `**Baseline:** ${r.baseline_path}` : "",
    `**Baseline elements:** ${r.baseline_elements}`,
    `**Current elements:** ${r.current_elements}`,
    `**Δ added / removed / modified:** ${r.diff.added} / ${r.diff.removed} / ${r.diff.modified}`,
    "",
  ].filter(Boolean);

  if (r.findings.length === 0) {
    lines.push("✅ No layout drift detected.");
    return lines.join("\n");
  }

  lines.push("### Findings");
  lines.push("");
  lines.push("| Severity | Title | Suggestion |");
  lines.push("|---|---|---|");
  for (const f of r.findings) {
    const title = f.title.replace(/\|/g, "\\|");
    const suggestion = (f.suggestion ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${f.severity} | ${title} | ${suggestion} |`);
  }
  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerAndroidLayoutDiffTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "android-layout-diff",
    "Runtime UI validation via Google Android CLI. Captures the current on-device layout, diffs against a committed baseline JSON, and emits findings covering disappeared elements (tests-pass-but-app-broken), drifted text, and unexpected additions. Requires Android CLI v0.7+ on PATH and an authorized adb device.",
    {
      device_serial: z
        .string()
        .optional()
        .describe(
          "adb device serial (from `adb devices`). Required only when multiple devices are connected.",
        ),
      baseline_path: z
        .string()
        .optional()
        .describe(
          "Absolute path to a committed baseline JSON produced by `android layout --pretty --output=...`. If omitted, the tool returns the current capture without diffing.",
        ),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .max(120_000)
        .optional()
        .default(30_000)
        .describe("Maximum time to wait for the CLI call (default 30s)."),
    },
    async ({ device_serial, baseline_path, timeout_ms }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "android-layout-diff");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const capture = await captureCurrentLayout(device_serial, timeout_ms);
        if (!capture.ok) {
          logger.warn(
            `android-layout-diff: capture failed (${capture.kind}): ${capture.message}`,
          );
          return errorResponse(capture.kind, capture.message, capture.stderr);
        }

        const current = capture.elements;

        if (!baseline_path) {
          const report: LayoutDiffReport = {
            device_serial,
            baseline_elements: 0,
            current_elements: current.length,
            diff: { added: 0, removed: 0, modified: 0 },
            findings: [],
          };
          return successResponse(report, current);
        }

        if (!existsSync(baseline_path)) {
          return errorResponse(
            "unknown",
            `Baseline file not found: ${baseline_path}`,
          );
        }
        const baseline = parseBaseline(baseline_path);
        if (!baseline.ok) {
          return errorResponse("json_parse", baseline.message);
        }

        const diff = diffLayouts(baseline.elements, current);
        const findings = toFindings(diff);

        const report: LayoutDiffReport = {
          device_serial,
          baseline_path,
          baseline_elements: baseline.elements.length,
          current_elements: current.length,
          diff: {
            added: diff.added.length,
            removed: diff.removed.length,
            modified: diff.modified.length,
          },
          findings,
        };

        return successResponse(report, current);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`android-layout-diff error: ${message}`);
        return errorResponse("unknown", message);
      }
    },
  );
}

function parseBaseline(
  filePath: string,
): { ok: true; elements: LayoutElement[] } | { ok: false; message: string } {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as LayoutElement[];
    if (!Array.isArray(parsed)) {
      return { ok: false, message: "Baseline is not a JSON array" };
    }
    return { ok: true, elements: parsed };
  } catch (e) {
    return { ok: false, message: `Baseline parse error: ${(e as Error).message}` };
  }
}

function successResponse(report: LayoutDiffReport, capture: LayoutElement[]) {
  const markdown = renderMarkdown(report);
  const findingsBlock =
    report.findings.length > 0
      ? `\n\n<!-- FINDINGS_START -->\n${JSON.stringify(report.findings, null, 2)}\n<!-- FINDINGS_END -->`
      : "";
  const jsonSummary = JSON.stringify(
    {
      report,
      captured_elements: capture.length,
    },
    null,
    2,
  );
  return {
    content: [
      {
        type: "text" as const,
        text: `${markdown}${findingsBlock}\n\n---\n\n\`\`\`json\n${jsonSummary}\n\`\`\``,
      },
    ],
  };
}

function errorResponse(kind: string, message: string, stderr?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            status: "ERROR",
            kind,
            summary: message,
            stderr: stderr?.trim().slice(0, 500),
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
