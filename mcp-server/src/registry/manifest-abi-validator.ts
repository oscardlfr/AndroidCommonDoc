/**
 * Manifest ABI/API stability validator (BL-W31.7-11).
 *
 * Compares two snapshots of `.claude/registry/agents.manifest.yaml` (HEAD vs
 * a baseline ref / file) and classifies each per-agent and per-field change
 * as BREAKING | ADDITIVE | NEUTRAL. Output is a structured `AbiDiffResult`
 * suitable for both human-readable summaries and CI machine parsing.
 *
 * Lives alongside `manifest-validator.ts` (which catches byte-level drift).
 * Reuses `parseManifest` + `Manifest` type from there to avoid duplicating
 * YAML parsing or schema modeling.
 *
 * Severity rules (the full table) come from the approved design at
 * `.claude/plans/kind-brewing-puppy.md` — keep in sync if either side moves.
 *
 * arch-platform PREP advisories applied here:
 *   - A: tools.banned.* operates at subkey level (top_level, bash_subcommands,
 *     grep_patterns, glob_patterns, read_patterns, mcp_tools_blocked) — not as
 *     a single blob.
 *   - B: applicable_project_types absent is normalized to ["any"] before
 *     comparison so absent ↔ ["any"] = NEUTRAL.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseManifest } from "./manifest-validator.js";

// ── Public types ─────────────────────────────────────────────────────────────

export type AbiSeverity = "BREAKING" | "ADDITIVE" | "NEUTRAL";
export type AbiOperation = "add" | "remove" | "change" | "reorder";
export type AbiKind = "added" | "removed" | "modified";

export interface AbiChange {
  severity: AbiSeverity;
  /** Dot-path: "tools.allowed", "dispatch.dispatched_by", "tools.banned.top_level". */
  field: string;
  operation: AbiOperation;
  before?: unknown;
  after?: unknown;
}

export interface AbiAgentDiff {
  agent: string;
  kind: AbiKind;
  changes: AbiChange[];
}

export interface AbiBaselineSource {
  ref?: string;
  file?: string;
  commit?: string;
}

export interface AbiDiffResult {
  /** PASS = no BREAKING; FAIL = >=1 BREAKING. */
  status: "PASS" | "FAIL";
  summary: string;
  baseline: AbiBaselineSource;
  diffs: AbiAgentDiff[];
  totalsBySeverity: { BREAKING: number; ADDITIVE: number; NEUTRAL: number };
  /** Single-chunk diff for the cross-cutting `invariants` block, if changed. */
  invariantsChange?: AbiChange;
}

export interface AbiDiffOptions {
  projectRoot: string;
  /** Default: "develop". Ignored when `baselineFile` is set. */
  baselineRef?: string;
  /** Overrides `baselineRef`. Reads literal YAML from disk. */
  baselineFile?: string;
  /** Default: <projectRoot>/.claude/registry/agents.manifest.yaml */
  manifestPath?: string;
  /** Include NEUTRAL entries in `diffs[].changes`. Default false. */
  includeNeutral?: boolean;
}

/**
 * Thrown by `loadBaselineManifest` when the baseline cannot be read.
 * `exitCode` is the recommended process exit code (always 2 for invocation
 * errors); CLI catches and forwards.
 */
export class AbiBaselineError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "AbiBaselineError";
    this.exitCode = exitCode;
  }
}

// ── Internal types (shape we read out of Manifest) ───────────────────────────

interface AnyAgentEntry {
  canonical_name?: string;
  subagent_type?: string;
  template_version?: string;
  category?: string;
  lifecycle?: string;
  description?: string;
  domain?: string;
  memory?: string;
  notes?: string;
  superseded_by?: string;
  replaces?: string;
  intent?: string[];
  aliases?: string[];
  skills_referenced?: string[];
  optional_capabilities?: string[];
  applicable_project_types?: string[];
  template_frontmatter_sha256?: string;
  runtime?: { model?: string; token_budget?: number };
  tools?: {
    allowed?: string[];
    banned?: Record<string, unknown>;
  };
  dispatch?: {
    spawn_method?: string;
    dispatched_by?: string[];
    can_dispatch_to?: string[];
    can_send_to?: string[] | "*";
  };
}

interface ManifestShape {
  manifest?: unknown;
  invariants?: unknown;
  agents?: Record<string, AnyAgentEntry>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BASELINE_REF = "develop";

const MANIFEST_REL_PATH = path.posix.join(
  ".claude",
  "registry",
  "agents.manifest.yaml",
);

/** Subkeys we recognize under tools.banned. Per arch-platform advisory A. */
const BANNED_SUBKEYS = [
  "top_level",
  "bash_subcommands",
  "grep_patterns",
  "glob_patterns",
  "read_patterns",
  "mcp_tools_blocked",
] as const;

/**
 * Per-field severity table (subset of fields whose value-change rule is uniform
 * regardless of operation). Used by classifyFieldChange when the value changes
 * (not array add/remove/reorder, which have their own logic).
 */
const VALUE_CHANGE_SEVERITY: Record<string, AbiSeverity> = {
  category: "BREAKING",
  lifecycle: "BREAKING",
  description: "NEUTRAL",
  "runtime.model": "BREAKING",
  "dispatch.spawn_method": "BREAKING",
  template_frontmatter_sha256: "NEUTRAL",
  template_version: "NEUTRAL",
  domain: "BREAKING",
  memory: "NEUTRAL",
  notes: "NEUTRAL",
  superseded_by: "BREAKING",
  replaces: "NEUTRAL",
};

/**
 * Array fields where add=ADDITIVE, remove=BREAKING (callers depend on entries
 * being present), reorder=NEUTRAL.
 */
const ARRAY_FIELDS_REMOVE_BREAKING = new Set<string>([
  "tools.allowed",
  "dispatch.dispatched_by",
  "dispatch.can_dispatch_to",
  "dispatch.can_send_to",
  "applicable_project_types",
  "intent",
  "optional_capabilities",
  "aliases",
]);

/**
 * Array fields where remove is NEUTRAL (no contract — discoverability only).
 */
const ARRAY_FIELDS_REMOVE_NEUTRAL = new Set<string>([
  "skills_referenced",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function arraysEqualSameOrder(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function arraysEqualAsSet(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const x of a) if (!setB.has(x)) return false;
  return true;
}

/** Return entries in `before` not in `after`, and vice versa (set-style). */
function setDiff(before: unknown[], after: unknown[]): {
  removed: unknown[];
  added: unknown[];
} {
  const setBefore = new Set(before);
  const setAfter = new Set(after);
  return {
    removed: before.filter((x) => !setAfter.has(x)),
    added: after.filter((x) => !setBefore.has(x)),
  };
}

/** Per arch-platform advisory B: undefined ↔ ["any"] is NEUTRAL. */
function normalizeApplicableProjectTypes(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return ["any"];
  if (Array.isArray(v)) return v as string[];
  return undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!deepEqual((a as any)[aKeys[i]], (b as any)[bKeys[i]])) return false;
    }
    return true;
  }
  return false;
}

// ── Field change classification ──────────────────────────────────────────────

/**
 * Classify a single field change. Returns 0..N AbiChange records:
 *   - 0 if before == after (no change).
 *   - 1 for scalar fields.
 *   - N for array fields where multiple add/remove ops can co-exist; one
 *     reorder record when contents are equal-as-set but order differs.
 *
 * The `field` argument is a dot-path (e.g. "tools.allowed", "dispatch.can_send_to").
 * The function dispatches based on the path.
 */
export function classifyFieldChange(
  field: string,
  before: unknown,
  after: unknown,
): AbiChange[] {
  // dispatch.can_send_to has special * <-> list rules — handle before generic array logic.
  if (field === "dispatch.can_send_to") {
    return classifyCanSendTo(before, after);
  }

  // applicable_project_types: normalize undefined ↔ ["any"] per advisory B.
  if (field === "applicable_project_types") {
    const normBefore = normalizeApplicableProjectTypes(before);
    const normAfter = normalizeApplicableProjectTypes(after);
    return classifyArrayField(
      field,
      normBefore ?? [],
      normAfter ?? [],
      "BREAKING",
    );
  }

  // tools.banned.<subkey>: same as ARRAY_FIELDS_REMOVE_BREAKING but keyed by subkey.
  if (field.startsWith("tools.banned.")) {
    return classifyArrayField(
      field,
      asArray(before),
      asArray(after),
      "BREAKING",
    );
  }

  // tools.allowed and the other array fields with remove=BREAKING.
  if (ARRAY_FIELDS_REMOVE_BREAKING.has(field)) {
    return classifyArrayField(field, asArray(before), asArray(after), "BREAKING");
  }

  // skills_referenced: remove is NEUTRAL.
  if (ARRAY_FIELDS_REMOVE_NEUTRAL.has(field)) {
    return classifyArrayField(field, asArray(before), asArray(after), "NEUTRAL");
  }

  // runtime.token_budget: ADDITIVE if increased, BREAKING if decreased.
  if (field === "runtime.token_budget") {
    return classifyTokenBudget(before, after);
  }

  // Generic scalar: any change is severity-from-table; default to NEUTRAL.
  if (deepEqual(before, after)) return [];
  const severity = VALUE_CHANGE_SEVERITY[field] ?? "NEUTRAL";
  return [
    {
      severity,
      field,
      operation: "change",
      before,
      after,
    },
  ];
}

function classifyArrayField(
  field: string,
  before: unknown[],
  after: unknown[],
  removeSeverity: AbiSeverity,
): AbiChange[] {
  if (arraysEqualSameOrder(before, after)) return [];

  // Same set, different order → reorder = NEUTRAL.
  if (arraysEqualAsSet(before, after)) {
    return [
      {
        severity: "NEUTRAL",
        field,
        operation: "reorder",
        before,
        after,
      },
    ];
  }

  const { removed, added } = setDiff(before, after);
  const changes: AbiChange[] = [];
  for (const item of removed) {
    changes.push({
      severity: removeSeverity,
      field,
      operation: "remove",
      before: item,
    });
  }
  for (const item of added) {
    changes.push({
      severity: "ADDITIVE",
      field,
      operation: "add",
      after: item,
    });
  }
  return changes;
}

function classifyCanSendTo(before: unknown, after: unknown): AbiChange[] {
  const beforeIsStar = before === "*";
  const afterIsStar = after === "*";

  // * → * : no change.
  if (beforeIsStar && afterIsStar) return [];

  // * → list : narrowing = BREAKING.
  if (beforeIsStar && Array.isArray(after)) {
    return [
      {
        severity: "BREAKING",
        field: "dispatch.can_send_to",
        operation: "change",
        before,
        after,
      },
    ];
  }

  // list → * : broadening = ADDITIVE.
  if (Array.isArray(before) && afterIsStar) {
    return [
      {
        severity: "ADDITIVE",
        field: "dispatch.can_send_to",
        operation: "change",
        before,
        after,
      },
    ];
  }

  // list → list : standard array logic.
  return classifyArrayField(
    "dispatch.can_send_to",
    asArray(before),
    asArray(after),
    "BREAKING",
  );
}

function classifyTokenBudget(before: unknown, after: unknown): AbiChange[] {
  if (deepEqual(before, after)) return [];
  const numBefore = typeof before === "number" ? before : undefined;
  const numAfter = typeof after === "number" ? after : undefined;

  // Field added: any non-undefined "after" treated as informational add.
  if (numBefore === undefined && numAfter !== undefined) {
    return [
      {
        severity: "ADDITIVE",
        field: "runtime.token_budget",
        operation: "add",
        after: numAfter,
      },
    ];
  }

  // Field removed: contract gone = BREAKING.
  if (numBefore !== undefined && numAfter === undefined) {
    return [
      {
        severity: "BREAKING",
        field: "runtime.token_budget",
        operation: "remove",
        before: numBefore,
      },
    ];
  }

  if (numBefore !== undefined && numAfter !== undefined) {
    if (numAfter > numBefore) {
      return [
        {
          severity: "ADDITIVE",
          field: "runtime.token_budget",
          operation: "change",
          before: numBefore,
          after: numAfter,
        },
      ];
    }
    if (numAfter < numBefore) {
      return [
        {
          severity: "BREAKING",
          field: "runtime.token_budget",
          operation: "change",
          before: numBefore,
          after: numAfter,
        },
      ];
    }
  }

  // Fallback (shouldn't reach here): emit a generic NEUTRAL.
  return [
    {
      severity: "NEUTRAL",
      field: "runtime.token_budget",
      operation: "change",
      before,
      after,
    },
  ];
}

// ── Per-agent diff ───────────────────────────────────────────────────────────

/**
 * The set of fields we walk for a per-agent comparison. The order here is the
 * order findings appear in the output — chosen to be predictable for tests
 * and human reviewers.
 */
const SCALAR_AGENT_FIELDS: string[] = [
  "category",
  "lifecycle",
  "description",
  "domain",
  "memory",
  "notes",
  "superseded_by",
  "replaces",
  "template_version",
  "template_frontmatter_sha256",
  "runtime.model",
  "runtime.token_budget",
  "dispatch.spawn_method",
];

const ARRAY_AGENT_FIELDS: string[] = [
  "tools.allowed",
  "dispatch.dispatched_by",
  "dispatch.can_dispatch_to",
  "dispatch.can_send_to",
  "applicable_project_types",
  "intent",
  "skills_referenced",
  "optional_capabilities",
  "aliases",
];

function readByDotPath(obj: unknown, dotPath: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const parts = dotPath.split(".");
  let cur: any = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function diffSingleAgent(
  canonical: string,
  before: AnyAgentEntry,
  after: AnyAgentEntry,
): AbiAgentDiff {
  const changes: AbiChange[] = [];

  // Special-case: canonical_name or subagent_type changed = BREAKING (rename).
  if (
    before.canonical_name !== undefined &&
    after.canonical_name !== undefined &&
    before.canonical_name !== after.canonical_name
  ) {
    changes.push({
      severity: "BREAKING",
      field: "canonical_name",
      operation: "change",
      before: before.canonical_name,
      after: after.canonical_name,
    });
  }
  if (
    before.subagent_type !== undefined &&
    after.subagent_type !== undefined &&
    before.subagent_type !== after.subagent_type
  ) {
    changes.push({
      severity: "BREAKING",
      field: "subagent_type",
      operation: "change",
      before: before.subagent_type,
      after: after.subagent_type,
    });
  }

  for (const field of SCALAR_AGENT_FIELDS) {
    const b = readByDotPath(before, field);
    const a = readByDotPath(after, field);
    changes.push(...classifyFieldChange(field, b, a));
  }

  for (const field of ARRAY_AGENT_FIELDS) {
    const b = readByDotPath(before, field);
    const a = readByDotPath(after, field);
    changes.push(...classifyFieldChange(field, b, a));
  }

  // tools.banned.<subkey>: enumerate known subkeys plus any extras seen.
  const beforeBanned = (before.tools?.banned ?? {}) as Record<string, unknown>;
  const afterBanned = (after.tools?.banned ?? {}) as Record<string, unknown>;
  const allBannedKeys = new Set<string>([
    ...BANNED_SUBKEYS,
    ...Object.keys(beforeBanned),
    ...Object.keys(afterBanned),
  ]);
  for (const subkey of allBannedKeys) {
    const field = `tools.banned.${subkey}`;
    const b = beforeBanned[subkey];
    const a = afterBanned[subkey];
    changes.push(...classifyFieldChange(field, b, a));
  }

  return {
    agent: canonical,
    kind: "modified",
    changes,
  };
}

// ── Baseline loading ─────────────────────────────────────────────────────────

/**
 * Load the baseline manifest based on options.
 * Throws on I/O / parse / git failure — caller converts to an exit-2 result.
 */
export function loadBaselineManifest(opts: AbiDiffOptions): {
  manifest: ManifestShape;
  source: AbiBaselineSource;
} {
  if (opts.baselineFile) {
    const file = path.resolve(opts.baselineFile);
    if (!existsSync(file)) {
      throw new AbiBaselineError(
        `--baseline-file does not exist: ${file}. ` +
          `Use --baseline-file /dev/null to treat baseline as empty.`,
      );
    }
    const raw = readFileSync(file, "utf-8");
    let parsed: ManifestShape;
    try {
      const yaml = parseYaml(raw);
      parsed =
        yaml && typeof yaml === "object"
          ? (yaml as ManifestShape)
          : ({ agents: {} } as ManifestShape);
    } catch (err) {
      throw new AbiBaselineError(
        `--baseline-file YAML parse failed (${file}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return { manifest: parsed, source: { file } };
  }

  const ref = opts.baselineRef ?? DEFAULT_BASELINE_REF;
  const projectRoot = path.resolve(opts.projectRoot);
  const target = `${ref}:${MANIFEST_REL_PATH}`;

  let raw: string;
  try {
    raw = execFileSync("git", ["-C", projectRoot, "show", target], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const refNotFound =
      msg.includes("unknown revision") ||
      msg.includes("bad revision") ||
      msg.includes("ambiguous argument");
    if (refNotFound) {
      throw new AbiBaselineError(
        `Baseline ref "${ref}" does not exist. ` +
          `If this is a fresh branch with no "${ref}" yet, use --baseline-file /dev/null ` +
          `(treats all agents as added). Or specify --baseline-ref <existing-ref>.`,
      );
    }
    throw new AbiBaselineError(
      `Manifest file not found at ref "${ref}" (path: ${MANIFEST_REL_PATH}). ` +
        `Check that the manifest existed at that ref. ` +
        `Use --baseline-file to provide a local YAML instead.`,
    );
  }

  let parsed: ManifestShape;
  try {
    const yaml = parseYaml(raw);
    parsed =
      yaml && typeof yaml === "object"
        ? (yaml as ManifestShape)
        : ({ agents: {} } as ManifestShape);
  } catch (err) {
    throw new AbiBaselineError(
      `baseline manifest at ${target} is not valid YAML: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Best-effort: resolve the commit SHA for the ref (for traceability in CI reports).
  let commit: string | undefined;
  try {
    const sha = execFileSync("git", ["-C", projectRoot, "rev-parse", "--short", ref], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha.length > 0) commit = sha;
  } catch {
    // Non-fatal — ref-based load already succeeded.
  }

  return { manifest: parsed, source: { ref, commit } };
}

// ── Top-level diff entrypoint ────────────────────────────────────────────────

export function diffManifestAbi(opts: AbiDiffOptions): AbiDiffResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const manifestPath =
    opts.manifestPath ??
    path.join(projectRoot, ".claude", "registry", "agents.manifest.yaml");

  // Load HEAD manifest via parseManifest (reuses manifest-validator's parser).
  const headManifest = parseManifest(manifestPath) as unknown as ManifestShape;
  const { manifest: baseManifest, source: baselineSource } =
    loadBaselineManifest(opts);

  const beforeAgents = (baseManifest.agents ?? {}) as Record<string, AnyAgentEntry>;
  const afterAgents = (headManifest.agents ?? {}) as Record<string, AnyAgentEntry>;

  const beforeNames = new Set(Object.keys(beforeAgents));
  const afterNames = new Set(Object.keys(afterAgents));

  const diffs: AbiAgentDiff[] = [];

  // Agents present in both → diff per-field.
  // Agents only in before → removed (BREAKING).
  // Agents only in after → added (ADDITIVE).
  const allNames = new Set<string>([...beforeNames, ...afterNames]);
  const sortedNames = Array.from(allNames).sort();

  for (const name of sortedNames) {
    const inBefore = beforeNames.has(name);
    const inAfter = afterNames.has(name);

    if (inBefore && inAfter) {
      const diff = diffSingleAgent(name, beforeAgents[name], afterAgents[name]);
      if (diff.changes.length > 0) {
        diffs.push(diff);
      }
    } else if (inBefore && !inAfter) {
      diffs.push({
        agent: name,
        kind: "removed",
        changes: [
          {
            severity: "BREAKING",
            field: "<agent>",
            operation: "remove",
            before: name,
          },
        ],
      });
    } else if (!inBefore && inAfter) {
      diffs.push({
        agent: name,
        kind: "added",
        changes: [
          {
            severity: "ADDITIVE",
            field: "<agent>",
            operation: "add",
            after: name,
          },
        ],
      });
    }
  }

  // Cross-cutting invariants block: single-chunk diff.
  let invariantsChange: AbiChange | undefined;
  const beforeInv = baseManifest.invariants ?? [];
  const afterInv = headManifest.invariants ?? [];
  if (!deepEqual(beforeInv, afterInv)) {
    invariantsChange = {
      severity: "BREAKING",
      field: "invariants",
      operation: "change",
      before: beforeInv,
      after: afterInv,
    };
  }

  // Filter NEUTRAL entries unless includeNeutral is set.
  const includeNeutral = opts.includeNeutral === true;
  if (!includeNeutral) {
    for (const d of diffs) {
      d.changes = d.changes.filter((c) => c.severity !== "NEUTRAL");
    }
  }

  // Drop diffs that became empty after NEUTRAL filtering, except agent-level
  // added/removed which carry their own severity in `kind`.
  const finalDiffs = diffs.filter(
    (d) => d.changes.length > 0 || d.kind !== "modified",
  );

  // Tally totals (count includes invariantsChange + per-agent changes).
  let breaking = 0;
  let additive = 0;
  let neutral = 0;
  for (const d of finalDiffs) {
    for (const c of d.changes) {
      if (c.severity === "BREAKING") breaking++;
      else if (c.severity === "ADDITIVE") additive++;
      else if (c.severity === "NEUTRAL") neutral++;
    }
  }
  if (invariantsChange) {
    if (invariantsChange.severity === "BREAKING") breaking++;
    else if (invariantsChange.severity === "ADDITIVE") additive++;
    else neutral++;
  }

  const status: "PASS" | "FAIL" = breaking > 0 ? "FAIL" : "PASS";
  const summary =
    `${breaking} BREAKING, ${additive} ADDITIVE, ${neutral} NEUTRAL ` +
    `across ${finalDiffs.length} agent${finalDiffs.length === 1 ? "" : "s"}`;

  return {
    status,
    summary,
    baseline: baselineSource,
    diffs: finalDiffs,
    totalsBySeverity: {
      BREAKING: breaking,
      ADDITIVE: additive,
      NEUTRAL: neutral,
    },
    ...(invariantsChange ? { invariantsChange } : {}),
  };
}
