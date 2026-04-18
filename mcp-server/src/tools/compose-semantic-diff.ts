/**
 * MCP tool: compose-semantic-diff
 *
 * Runtime UI validation for Compose Multiplatform JVM (desktop).
 *
 * Sibling of `android-layout-diff` — same finding schema, same severity
 * heuristics, same `/full-audit` integration contract. Different capture
 * source: parses the text tree emitted by
 * `composeTestRule.onRoot().printToString(maxDepth = Int.MAX_VALUE)` rather
 * than invoking the Android CLI. Closes the "tests pass but app is broken"
 * gap on consumers whose production UI lives in Compose desktop (e.g.,
 * DawSync desktopApp).
 *
 * Parser contract and normalization strategy come from
 * `.planning/phases/21-desktop-ui-validation/21-POC-FINDINGS.md` — Compose
 * version pinned per consumer `libs.versions.toml`.
 */
import { existsSync, readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ── Schema types (from 21-POC) ──────────────────────────────────────────────

/**
 * Parsed semantic node from `printToString()` output.
 *
 * Hierarchy is captured in `children`. Identity precedence: testTag >
 * contentDescription > text > role@depth. `bounds` is informational —
 * not used as identity because DPI/font metrics can vary by OS.
 */
export interface SemanticNode {
  depth: number;
  bounds?: { l: number; t: number; r: number; b: number };
  testTag?: string;
  contentDescription?: string;
  text?: string;
  role?: string;
  actions: string[];
  extras: Record<string, string>;
  children: SemanticNode[];
}

/** Finding emitted back to `/full-audit` orchestrator. Schema matches android-layout-diff. */
export interface LayoutFinding {
  dedupe_key: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  source: "compose-semantic-diff";
  check: "semantic-diff";
  title: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// ── Normalization (from 21-POC) ─────────────────────────────────────────────

/**
 * Strip the two observed unstable fields so captures from different JVM
 * runs compare cleanly:
 *
 * - `Node #<n>` — autoincremented across @Test methods in Compose runtime
 * - `@<hashcode>` — object identity hashcode in some `Shape` reprs
 */
export function normalizePrintToString(raw: string): string {
  return raw
    .replace(/Node #[0-9]+/g, "Node #N")
    .replace(/@[0-9a-f]{5,}/g, "@HASH");
}

// ── Parser ──────────────────────────────────────────────────────────────────

const NODE_LINE = /^(?<indent>[ |]*)\|?-?Node #[^ ]+ at \(l=(?<l>[\d.-]+), t=(?<t>[\d.-]+), r=(?<r>[\d.-]+), b=(?<b>[\d.-]+)\)px(?:, Tag: '(?<tag>[^']*)')?\s*$/;
const ROOT_NODE_LINE = /^Node #[^ ]+ at \(l=(?<l>[\d.-]+), t=(?<t>[\d.-]+), r=(?<r>[\d.-]+), b=(?<b>[\d.-]+)\)px(?:, Tag: '(?<tag>[^']*)')?\s*$/;
const ATTR_LINE = /^(?<indent>[ |]*)(?<key>[A-Za-z][A-Za-z0-9_]*)\s*(?:=\s*'(?<valueQ>[^']*)'|=\s*\[(?<listBracket>[^\]]*)\]|=\s*(?<valueBare>.+?))?\s*$/;
const HEADER_LINE = /^Printing with /;
const BARE_MARKER = /^(?<indent>[ |]*)\[(?<marker>[A-Za-z][A-Za-z0-9_]*)\]\s*$/;

/**
 * Parse `printToString()` text into a tree of {@link SemanticNode}.
 *
 * Accepts the raw output from `composeTestRule.onRoot().printToString(Int.MAX_VALUE)`.
 * Unknown attribute lines are captured in `extras` rather than dropped, so
 * the parser is forward-compatible with future Compose attributes.
 */
export function parseSemanticTree(raw: string): SemanticNode[] {
  const lines = normalizePrintToString(raw).split(/\r?\n/);
  const roots: SemanticNode[] = [];
  const stack: Array<{ node: SemanticNode; indent: number }> = [];
  let pendingAttributes: SemanticNode | null = null;

  for (const line of lines) {
    if (!line.trim() || HEADER_LINE.test(line)) continue;

    const rootMatch = ROOT_NODE_LINE.exec(line);
    const childMatch = rootMatch ? null : NODE_LINE.exec(line);
    if (rootMatch || childMatch) {
      const m = rootMatch ?? childMatch!;
      const indent = childMatch
        ? (childMatch.groups?.indent?.length ?? 0)
        : 0;
      const node: SemanticNode = {
        depth: Math.max(0, Math.floor(indent / 2)),
        bounds: {
          l: parseFloat(m.groups?.l ?? "0"),
          t: parseFloat(m.groups?.t ?? "0"),
          r: parseFloat(m.groups?.r ?? "0"),
          b: parseFloat(m.groups?.b ?? "0"),
        },
        testTag: m.groups?.tag || undefined,
        actions: [],
        extras: {},
        children: [],
      };
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      if (stack.length === 0) {
        roots.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }
      stack.push({ node, indent });
      pendingAttributes = node;
      continue;
    }

    if (!pendingAttributes) continue;
    const bare = BARE_MARKER.exec(line);
    if (bare && bare.groups) {
      pendingAttributes.extras[bare.groups.marker] = "true";
      continue;
    }
    const attr = ATTR_LINE.exec(line);
    if (attr && attr.groups) {
      applyAttribute(pendingAttributes, attr.groups.key, {
        quoted: attr.groups.valueQ,
        list: attr.groups.listBracket,
        bare: attr.groups.valueBare,
      });
    }
  }

  return roots;
}

function applyAttribute(
  node: SemanticNode,
  key: string,
  v: { quoted?: string; list?: string; bare?: string },
): void {
  const stringValue = v.quoted ?? v.bare ?? (v.list ? `[${v.list}]` : "");
  switch (key) {
    case "ContentDescription":
      node.contentDescription = unwrapBracket(v.quoted);
      return;
    case "Text":
      node.text = unwrapBracket(v.quoted);
      return;
    case "Role":
      node.role = v.quoted ?? v.bare;
      return;
    case "Actions":
      node.actions = splitList(v.list ?? "");
      return;
    default:
      node.extras[key] = stringValue;
  }
}

function unwrapBracket(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.startsWith("[") && raw.endsWith("]")) return raw.slice(1, -1);
  return raw;
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Flatten a tree into a single list, preserving tree order.
 */
export function flattenTree(roots: SemanticNode[]): SemanticNode[] {
  const out: SemanticNode[] = [];
  const walk = (node: SemanticNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

// ── Element identity ────────────────────────────────────────────────────────

/**
 * Composite identity key for a semantic node.
 *
 * Preference: testTag > contentDescription > text > role@depth.
 * Depth suffix acts as tiebreaker for duplicate tags in lists.
 */
export function elementIdentity(node: SemanticNode): string {
  const primary =
    node.testTag ??
    node.contentDescription ??
    node.text ??
    `${node.role ?? "anon"}@depth${node.depth}`;
  return `${primary}@depth${node.depth}`;
}

// ── Diff ────────────────────────────────────────────────────────────────────

interface DiffResult {
  added: SemanticNode[];
  removed: SemanticNode[];
  modified: Array<{
    baseline: SemanticNode;
    current: SemanticNode;
    changedFields: string[];
  }>;
}

/**
 * Compute a stateless diff between two parsed trees.
 *
 * Mirrors `android-layout-diff.diffLayouts` — same semantics, applied to
 * the flattened SemanticNode list.
 */
export function diffTrees(
  baseline: SemanticNode[],
  current: SemanticNode[],
): DiffResult {
  const flatBase = flattenTree(baseline);
  const flatCur = flattenTree(current);

  const baselineIdx = new Map<string, SemanticNode>();
  for (const el of flatBase) baselineIdx.set(elementIdentity(el), el);
  const currentIdx = new Map<string, SemanticNode>();
  for (const el of flatCur) currentIdx.set(elementIdentity(el), el);

  const added: SemanticNode[] = [];
  const removed: SemanticNode[] = [];
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

function diffAttributes(a: SemanticNode, b: SemanticNode): string[] {
  const fields: string[] = [];
  if (a.text !== b.text) fields.push("text");
  if (a.contentDescription !== b.contentDescription)
    fields.push("contentDescription");
  if (a.role !== b.role) fields.push("role");
  if (!arraysEqual(a.actions, b.actions)) fields.push("actions");
  const extraKeys = new Set([
    ...Object.keys(a.extras),
    ...Object.keys(b.extras),
  ]);
  for (const key of extraKeys) {
    if (a.extras[key] !== b.extras[key]) fields.push(`extras.${key}`);
  }
  return fields;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((v, i) => v === bs[i]);
}

// ── Baseline reader ─────────────────────────────────────────────────────────

interface ParseResult {
  ok: true;
  nodes: SemanticNode[];
}
interface ParseError {
  ok: false;
  kind: "capture_missing" | "parse_error" | "unknown";
  message: string;
}

/**
 * Load a `.txt` capture produced by
 * `composeTestRule.onRoot().printToString(Int.MAX_VALUE)` and parse it.
 */
export function parseSemanticTreeFile(
  path: string,
): ParseResult | ParseError {
  if (!existsSync(path)) {
    return {
      ok: false,
      kind: "capture_missing",
      message: `Capture file not found: ${path}. Run \`./gradlew captureUiBaselines\` first.`,
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const nodes = parseSemanticTree(raw);
    if (nodes.length === 0) {
      return {
        ok: false,
        kind: "parse_error",
        message: `No nodes parsed from ${path} — is this a valid printToString() dump?`,
      };
    }
    return { ok: true, nodes };
  } catch (e) {
    return {
      ok: false,
      kind: "unknown",
      message: (e as Error).message,
    };
  }
}

// ── Finding generation ──────────────────────────────────────────────────────

/**
 * Convert a diff into `/full-audit` findings.
 *
 * Heuristics (identical to android-layout-diff):
 * - Removed element with testTag → HIGH (classic "screen empties out" regression)
 * - Removed anonymous element → MEDIUM
 * - Added element with testTag → MEDIUM (likely new component — updatable baseline)
 * - Added anonymous element → LOW
 * - Modified with text/contentDescription drift → MEDIUM (string-resource regression)
 * - Modified with only role/actions/extras → LOW
 */
export function toFindings(diff: DiffResult): LayoutFinding[] {
  const findings: LayoutFinding[] = [];

  for (const el of diff.removed) {
    const tag = el.testTag;
    const severity: LayoutFinding["severity"] = tag ? "HIGH" : "MEDIUM";
    const label = tag ?? el.contentDescription ?? el.text ?? "anonymous";
    findings.push({
      dedupe_key: `compose-semantic-diff:removed:${elementIdentity(el)}`,
      severity,
      category: "ui-accessibility",
      source: "compose-semantic-diff",
      check: "semantic-diff",
      title: `Element disappeared from rendered layout: ${label}`,
      suggestion: tag
        ? `Element with testTag '${tag}' was in the baseline but not in the current capture. Check UiState branch handling — empty state rendering is the most common cause.`
        : `Element '${label}' was in the baseline but not in the current capture.`,
    });
  }

  for (const el of diff.added) {
    const tag = el.testTag;
    const severity: LayoutFinding["severity"] = tag ? "MEDIUM" : "LOW";
    const label = tag ?? el.contentDescription ?? el.text ?? "anonymous";
    findings.push({
      dedupe_key: `compose-semantic-diff:added:${elementIdentity(el)}`,
      severity,
      category: "ui-accessibility",
      source: "compose-semantic-diff",
      check: "semantic-diff",
      title: `Unexpected element in rendered layout: ${label}`,
      suggestion:
        "Element appeared in the current capture but not in the baseline. If intentional, update the baseline with `./gradlew captureUiBaselines`.",
    });
  }

  for (const m of diff.modified) {
    const tag = m.current.testTag;
    const label = tag ?? m.current.contentDescription ?? m.current.text ?? "anonymous";
    const textChanged =
      m.changedFields.includes("text") ||
      m.changedFields.includes("contentDescription");
    findings.push({
      dedupe_key: `compose-semantic-diff:modified:${elementIdentity(m.current)}`,
      severity: textChanged ? "MEDIUM" : "LOW",
      category: "ui-accessibility",
      source: "compose-semantic-diff",
      check: "semantic-diff",
      title: `Element content drifted: ${label} (${m.changedFields.join(", ")})`,
      suggestion: textChanged
        ? `Visible text changed — likely a string-resource regression or a UiState branch rendering the wrong copy.`
        : `Role/actions/extras changed. Update baseline if intentional.`,
    });
  }

  return findings;
}

// ── Report rendering ────────────────────────────────────────────────────────

interface SemanticDiffReport {
  baseline_path?: string;
  current_path?: string;
  screen_name?: string;
  baseline_nodes: number;
  current_nodes: number;
  diff: {
    added: number;
    removed: number;
    modified: number;
  };
  findings: LayoutFinding[];
}

function renderMarkdown(r: SemanticDiffReport): string {
  const lines = [
    "## Compose Semantic Diff",
    "",
    r.screen_name ? `**Screen:** ${r.screen_name}` : "",
    r.baseline_path ? `**Baseline:** ${r.baseline_path}` : "",
    r.current_path ? `**Current:** ${r.current_path}` : "",
    `**Baseline nodes:** ${r.baseline_nodes}`,
    `**Current nodes:** ${r.current_nodes}`,
    `**Δ added / removed / modified:** ${r.diff.added} / ${r.diff.removed} / ${r.diff.modified}`,
    "",
  ].filter(Boolean);

  if (r.findings.length === 0) {
    lines.push("[OK] No semantic drift detected.");
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

export function registerComposeSemanticDiffTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "compose-semantic-diff",
    "Runtime UI validation for Compose Multiplatform desktop. Parses `printToString()` baseline + current captures and emits findings for disappeared elements (tests-pass-but-app-broken), drifted text (string-resource regressions), and unexpected additions. Sibling of android-layout-diff — same schema, different capture source (no adb, no device required).",
    {
      baseline_path: z
        .string()
        .describe(
          "Absolute path to a committed baseline .txt produced by `composeTestRule.onRoot().printToString(maxDepth = Int.MAX_VALUE)`.",
        ),
      current_path: z
        .string()
        .describe(
          "Absolute path to the current capture .txt (typically produced in `build/ui-snapshots/` by a `./gradlew verifyUiBaselines` run).",
        ),
      screen_name: z
        .string()
        .optional()
        .describe("Identifier for the screen under test (used in the report)."),
    },
    async ({ baseline_path, current_path, screen_name }) => {
      const rateLimitResponse = checkRateLimit(
        rateLimiter,
        "compose-semantic-diff",
      );
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const baseline = parseSemanticTreeFile(baseline_path);
        if (!baseline.ok) {
          logger.warn(
            `compose-semantic-diff: baseline load failed (${baseline.kind}): ${baseline.message}`,
          );
          return errorResponse(baseline.kind, baseline.message);
        }
        const current = parseSemanticTreeFile(current_path);
        if (!current.ok) {
          logger.warn(
            `compose-semantic-diff: current load failed (${current.kind}): ${current.message}`,
          );
          return errorResponse(current.kind, current.message);
        }

        const diff = diffTrees(baseline.nodes, current.nodes);
        const findings = toFindings(diff);

        const report: SemanticDiffReport = {
          baseline_path,
          current_path,
          screen_name,
          baseline_nodes: flattenTree(baseline.nodes).length,
          current_nodes: flattenTree(current.nodes).length,
          diff: {
            added: diff.added.length,
            removed: diff.removed.length,
            modified: diff.modified.length,
          },
          findings,
        };

        return successResponse(report);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`compose-semantic-diff error: ${message}`);
        return errorResponse("unknown", message);
      }
    },
  );
}

function successResponse(report: SemanticDiffReport) {
  const markdown = renderMarkdown(report);
  const findingsBlock =
    report.findings.length > 0
      ? `\n\n<!-- FINDINGS_START -->\n${JSON.stringify(report.findings, null, 2)}\n<!-- FINDINGS_END -->`
      : "";
  const jsonSummary = JSON.stringify(report, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text: `${markdown}${findingsBlock}\n\n---\n\n\`\`\`json\n${jsonSummary}\n\`\`\``,
      },
    ],
  };
}

function errorResponse(kind: string, message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            status: "ERROR",
            kind,
            summary: message,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
