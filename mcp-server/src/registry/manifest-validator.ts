/**
 * Agents-manifest validator (Phase 2 — WARN mode).
 *
 * Compares `.claude/registry/agents.manifest.yaml` against actual agent
 * template frontmatter in `setup/agent-templates/` and the mirror copies
 * in `.claude/agents/`. Reports drift as findings; the CLI/CI layer
 * decides whether to fail (--strict / Phase 4) or just warn (Phase 2).
 *
 * Five invariants enforced (see manifest lines 52-87):
 *   - ARCHITECT_NO_FILE_WRITE
 *   - IN_PROCESS_NO_AGENT
 *   - NAMING_CONVENTION
 *   - CANONICAL_NAME_MATCHES_SUBAGENT_TYPE
 *   - CONTEXT_PROVIDER_READ_ONLY
 *
 * Five field comparisons (template frontmatter vs manifest):
 *   - name           ↔ canonical_name        (exact)
 *   - template_version ↔ template_version    (exact semver)
 *   - model          ↔ runtime.model         (exact enum)
 *   - tools (CSV)    ↔ tools.allowed (array) (set equality)
 *   - description    ↔ description           (whitespace-normalized exact)
 *
 * Plus file existence + orphan detection:
 *   - Every manifest entry → file in BOTH `setup/agent-templates/` and
 *     `.claude/agents/`.
 *   - Every file in those dirs → manifest entry (orphans → warning).
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseFrontmatter } from "./frontmatter.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

export type FindingCategory =
  | "field-mismatch"
  | "missing-file"
  | "orphan"
  | "invariant"
  | "schema";

export interface Finding {
  severity: Severity;
  /** canonical_name of the agent, or omitted for global findings. */
  agent?: string;
  category: FindingCategory;
  /** Field path involved (e.g. "tools", "runtime.model"). Optional. */
  field?: string;
  expected?: string;
  actual?: string;
  message: string;
  /** Absolute path to the offending file, when relevant. */
  file?: string;
}

export interface ValidationResult {
  totalAgents: number;
  totalFindings: number;
  findingsBySeverity: { error: number; warning: number; info: number };
  findings: Finding[];
  /** True iff zero invariant-category findings exist. */
  invariantsOk: boolean;
}

export interface ValidateOptions {
  projectRoot: string;
  /** Default: <projectRoot>/.claude/registry/agents.manifest.yaml */
  manifestPath?: string;
  /** Default: <projectRoot>/setup/agent-templates */
  templatesDir?: string;
  /** Default: <projectRoot>/.claude/agents */
  mirrorDir?: string;
}

// Manifest shape (only the fields we read).
interface ManifestAgentEntry {
  canonical_name: string;
  subagent_type: string;
  template_version: string;
  category: string;
  lifecycle: string;
  description: string;
  runtime: { model: string; token_budget?: number };
  tools: {
    allowed: string[];
    banned?: {
      top_level?: string[];
      bash_subcommands?: string[];
      grep_patterns?: string[];
      glob_patterns?: string[];
      read_patterns?: string[];
      mcp_tools_blocked?: string[];
    };
  };
  dispatch: {
    spawn_method: string;
    dispatched_by: string[];
    can_dispatch_to: string[];
    can_send_to: string[] | "*";
  };
}

interface InvariantRule {
  id: string;
  description?: string;
  applies_to?: Record<string, unknown>;
  require?: Record<string, unknown>;
  rationale_ref?: string;
}

interface Manifest {
  manifest?: { version: number; generated_at: string };
  categories?: string[];
  lifecycles?: string[];
  invariants?: InvariantRule[];
  agents?: Record<string, ManifestAgentEntry>;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Fallback regex (matches manifest line 72) used when the manifest lacks the invariant. */
const NAMING_CONVENTION_FALLBACK =
  "^(arch-.+|.+-specialist|.+-orchestrator|.+-validator|.+-auditor|.+-agent|.+-mapper|.+-strategist|.+-creator|.+-lead|.+-migrator|.+-lifecycle|.+-detector|.+-alignment|context-provider|doc-updater|quality-gater|team-lead|advisor|debugger|researcher|verifier|planner)$";

/** Tools forbidden for architects (ARCHITECT_NO_FILE_WRITE). */
const ARCHITECT_BANNED_TOOLS = new Set(["Write", "Edit", "Agent"]);

/** Tools forbidden for context category (CONTEXT_PROVIDER_READ_ONLY). */
const CONTEXT_BANNED_TOOLS = new Set(["Write", "Edit", "Agent"]);

/**
 * Files inside `setup/agent-templates/` and `.claude/agents/` that are NOT
 * agent templates (e.g. README, INDEX). Excluded from the orphan check.
 */
const NON_AGENT_FILENAMES = new Set([
  "README.md",
  "readme.md",
  "INDEX.md",
  "index.md",
  "MIGRATIONS.json",
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Frontmatter `tools:` field is a comma-separated string in agent templates
 * (e.g. `tools: Read, Bash, SendMessage`). Manifest stores the same set as
 * a YAML array. Convert CSV → array, trimming whitespace and dropping empties.
 */
export function parseToolsCsv(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Order-insensitive set equality on string arrays. */
export function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  for (const item of a) {
    if (!setB.has(item)) return false;
  }
  return true;
}

/** Compute set difference: items in `expected` not in `actual` and vice versa. */
export function setDiff(
  actual: string[],
  expected: string[],
): { missing: string[]; extra: string[] } {
  const setActual = new Set(actual);
  const setExpected = new Set(expected);
  return {
    missing: expected.filter((e) => !setActual.has(e)),
    extra: actual.filter((a) => !setExpected.has(a)),
  };
}

/** Normalize whitespace for description comparison: trim + collapse runs of WS. */
function normalizeDescription(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.trim().replace(/\s+/g, " ");
}

/** Truncate a string for diff display (so we don't dump multi-line text). */
function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/**
 * Read the NAMING_CONVENTION regex from the manifest's invariants section.
 * Falls back to the hardcoded `NAMING_CONVENTION_FALLBACK` if absent or malformed.
 * Single source of truth: the manifest, not this validator.
 */
function getNamingConventionRegex(manifest: Manifest): RegExp {
  const inv = manifest.invariants?.find((i) => i.id === "NAMING_CONVENTION");
  const pattern = inv?.require?.["canonical_name.pattern"];
  const source = typeof pattern === "string" && pattern.length > 0
    ? pattern
    : NAMING_CONVENTION_FALLBACK;
  try {
    return new RegExp(source);
  } catch {
    return new RegExp(NAMING_CONVENTION_FALLBACK);
  }
}

/**
 * Detect whether an agent template is a "scaffold" — its `name:` field
 * contains a `{{PLACEHOLDER}}` token, meaning it is meant to be cloned and
 * instantiated at L2 with a different name (e.g. `feature-domain-specialist`
 * ships as `{{DOMAIN}}-specialist` and becomes `auth-specialist` etc. in the
 * consuming project).
 *
 * Templates that only carry placeholders in `description:` (e.g.
 * `{{PROJECT_NAME}}`) are NOT scaffolds — those placeholders survive
 * substitution and the manifest stores the same literal text, so direct
 * comparison still works.
 *
 * Manifest header line 110 documents the scaffold case as intentional.
 */
function isScaffoldTemplate(frontmatter: Record<string, unknown>): boolean {
  const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
  return /\{\{[A-Z_]+\}\}/.test(name);
}

// ── Manifest parsing ─────────────────────────────────────────────────────────

/**
 * Read + parse the YAML manifest. Throws on I/O or YAML error — callers
 * should catch and convert to a Finding.
 */
export function parseManifest(manifestPath: string): Manifest {
  const raw = readFileSync(manifestPath, "utf-8");
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Manifest is not a YAML object");
  }
  return parsed as Manifest;
}

// ── Field comparisons ────────────────────────────────────────────────────────

function compareAgentFields(
  canonical: string,
  manifestEntry: ManifestAgentEntry,
  frontmatter: Record<string, unknown>,
  templatePath: string,
): Finding[] {
  const findings: Finding[] = [];
  const isScaffold = isScaffoldTemplate(frontmatter);

  // template_version + model are checked even for scaffolds; name/tools/description
  // are skipped because scaffolds carry literal `{{PLACEHOLDER}}` tokens.
  if (isScaffold) {
    findings.push({
      severity: "info",
      agent: canonical,
      category: "field-mismatch",
      message: `scaffold template (contains {{...}} placeholder); name/tools/description checks skipped per manifest exemption`,
      file: templatePath,
    });
  }

  // 1. name ↔ canonical_name
  if (!isScaffold && frontmatter.name !== manifestEntry.canonical_name) {
    findings.push({
      severity: "error",
      agent: canonical,
      category: "field-mismatch",
      field: "name",
      expected: manifestEntry.canonical_name,
      actual: String(frontmatter.name ?? "<missing>"),
      message: `frontmatter 'name' (${String(frontmatter.name ?? "<missing>")}) does not match manifest canonical_name (${manifestEntry.canonical_name})`,
      file: templatePath,
    });
  }

  // 2. template_version
  if (frontmatter.template_version !== manifestEntry.template_version) {
    findings.push({
      severity: "error",
      agent: canonical,
      category: "field-mismatch",
      field: "template_version",
      expected: manifestEntry.template_version,
      actual: String(frontmatter.template_version ?? "<missing>"),
      message: `template_version mismatch — frontmatter=${String(frontmatter.template_version ?? "<missing>")}, manifest=${manifestEntry.template_version}`,
      file: templatePath,
    });
  }

  // 3. model ↔ runtime.model
  if (frontmatter.model !== manifestEntry.runtime?.model) {
    findings.push({
      severity: "error",
      agent: canonical,
      category: "field-mismatch",
      field: "model",
      expected: manifestEntry.runtime?.model ?? "<missing>",
      actual: String(frontmatter.model ?? "<missing>"),
      message: `model mismatch — frontmatter=${String(frontmatter.model ?? "<missing>")}, manifest=${manifestEntry.runtime?.model ?? "<missing>"}`,
      file: templatePath,
    });
  }

  // 4. tools (CSV) ↔ tools.allowed (array)
  const fmTools = parseToolsCsv(frontmatter.tools);
  const manifestTools = manifestEntry.tools?.allowed ?? [];
  if (!isScaffold && !setEqual(fmTools, manifestTools)) {
    const diff = setDiff(fmTools, manifestTools);
    findings.push({
      severity: "error",
      agent: canonical,
      category: "field-mismatch",
      field: "tools",
      expected: manifestTools.join(", "),
      actual: fmTools.join(", "),
      message: `tools mismatch — missing in frontmatter: [${diff.missing.join(", ")}]; extra in frontmatter: [${diff.extra.join(", ")}]`,
      file: templatePath,
    });
  }

  // 5. description (whitespace-normalized)
  const fmDesc = normalizeDescription(frontmatter.description);
  const manifestDesc = normalizeDescription(manifestEntry.description);
  if (!isScaffold && fmDesc !== manifestDesc) {
    findings.push({
      severity: "warning",
      agent: canonical,
      category: "field-mismatch",
      field: "description",
      expected: truncate(manifestDesc),
      actual: truncate(fmDesc),
      message: `description mismatch (whitespace-normalized)`,
      file: templatePath,
    });
  }

  return findings;
}

// ── Invariant checks ─────────────────────────────────────────────────────────

function checkInvariants(
  canonical: string,
  entry: ManifestAgentEntry,
  namingRegex: RegExp,
): Finding[] {
  const findings: Finding[] = [];
  const allowed = entry.tools?.allowed ?? [];

  // ARCHITECT_NO_FILE_WRITE
  if (entry.category === "architect") {
    const violations = allowed.filter((t) => ARCHITECT_BANNED_TOOLS.has(t));
    if (violations.length > 0) {
      findings.push({
        severity: "error",
        agent: canonical,
        category: "invariant",
        field: "tools.allowed",
        message: `ARCHITECT_NO_FILE_WRITE violated: architect has banned tools [${violations.join(", ")}]`,
      });
    }
  }

  // IN_PROCESS_NO_AGENT
  if (entry.dispatch?.spawn_method === "TeamCreate-peer") {
    if (allowed.includes("Agent")) {
      findings.push({
        severity: "error",
        agent: canonical,
        category: "invariant",
        field: "tools.allowed",
        message: `IN_PROCESS_NO_AGENT violated: TeamCreate-peer cannot have Agent tool`,
      });
    }
  }

  // NAMING_CONVENTION (regex sourced dynamically from manifest)
  if (!namingRegex.test(canonical)) {
    findings.push({
      severity: "error",
      agent: canonical,
      category: "invariant",
      field: "canonical_name",
      message: `NAMING_CONVENTION violated: '${canonical}' does not match required pattern`,
    });
  }

  // CANONICAL_NAME_MATCHES_SUBAGENT_TYPE
  if (entry.canonical_name !== entry.subagent_type) {
    findings.push({
      severity: "error",
      agent: canonical,
      category: "invariant",
      field: "subagent_type",
      message: `CANONICAL_NAME_MATCHES_SUBAGENT_TYPE violated: canonical_name (${entry.canonical_name}) != subagent_type (${entry.subagent_type})`,
    });
  }

  // CONTEXT_PROVIDER_READ_ONLY
  if (entry.category === "context") {
    const violations = allowed.filter((t) => CONTEXT_BANNED_TOOLS.has(t));
    if (violations.length > 0) {
      findings.push({
        severity: "error",
        agent: canonical,
        category: "invariant",
        field: "tools.allowed",
        message: `CONTEXT_PROVIDER_READ_ONLY violated: context agent has banned tools [${violations.join(", ")}]`,
      });
    }
  }

  return findings;
}

// ── Main entrypoint ──────────────────────────────────────────────────────────

/**
 * Run all manifest validations and return a structured result.
 * Never throws — I/O and parse errors are converted to findings.
 */
export function validateManifest(opts: ValidateOptions): ValidationResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const manifestPath =
    opts.manifestPath ??
    path.join(projectRoot, ".claude", "registry", "agents.manifest.yaml");
  const templatesDir =
    opts.templatesDir ?? path.join(projectRoot, "setup", "agent-templates");
  const mirrorDir =
    opts.mirrorDir ?? path.join(projectRoot, ".claude", "agents");

  const findings: Finding[] = [];

  // Parse manifest. Failure here is fatal — return early.
  let manifest: Manifest;
  try {
    manifest = parseManifest(manifestPath);
  } catch (err) {
    findings.push({
      severity: "error",
      category: "schema",
      message: `failed to parse manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      file: manifestPath,
    });
    return summarize(findings, 0);
  }

  if (!manifest.agents || typeof manifest.agents !== "object") {
    findings.push({
      severity: "error",
      category: "schema",
      message: `manifest 'agents' field is missing or not an object`,
      file: manifestPath,
    });
    return summarize(findings, 0);
  }

  const agentNames = Object.keys(manifest.agents);
  const namingRegex = getNamingConventionRegex(manifest);

  // For each manifest entry: invariants + file existence + frontmatter compare
  for (const canonical of agentNames) {
    const entry = manifest.agents[canonical];

    findings.push(...checkInvariants(canonical, entry, namingRegex));

    const templatePath = path.join(templatesDir, `${canonical}.md`);
    const mirrorPath = path.join(mirrorDir, `${canonical}.md`);

    if (!existsSync(templatePath)) {
      findings.push({
        severity: "error",
        agent: canonical,
        category: "missing-file",
        message: `template missing: ${path.relative(projectRoot, templatePath)}`,
        file: templatePath,
      });
      // Skip frontmatter compare; continue to mirror check below.
    }
    if (!existsSync(mirrorPath)) {
      findings.push({
        severity: "error",
        agent: canonical,
        category: "missing-file",
        message: `mirror missing: ${path.relative(projectRoot, mirrorPath)}`,
        file: mirrorPath,
      });
    }

    if (existsSync(templatePath)) {
      const raw = readFileSync(templatePath, "utf-8");
      const fmResult = parseFrontmatter(raw);
      if (!fmResult) {
        findings.push({
          severity: "error",
          agent: canonical,
          category: "schema",
          message: `cannot parse frontmatter from ${path.relative(projectRoot, templatePath)}`,
          file: templatePath,
        });
        continue;
      }
      findings.push(
        ...compareAgentFields(canonical, entry, fmResult.data, templatePath),
      );
    }
  }

  // Orphan checks: files without a manifest entry. Skip non-agent meta files
  // (README, INDEX, MIGRATIONS) per `NON_AGENT_FILENAMES`.
  const checkOrphans = (dir: string, label: string): void => {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".md") && !NON_AGENT_FILENAMES.has(f),
    );
    for (const file of files) {
      const name = file.replace(/\.md$/, "");
      if (!agentNames.includes(name)) {
        findings.push({
          severity: "warning",
          agent: name,
          category: "orphan",
          message: `${label} ${file} has no manifest entry`,
          file: path.join(dir, file),
        });
      }
    }
  };
  checkOrphans(templatesDir, "template");
  checkOrphans(mirrorDir, "mirror");

  return summarize(findings, agentNames.length);
}

function summarize(findings: Finding[], totalAgents: number): ValidationResult {
  const findingsBySeverity = {
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  const invariantsOk =
    findings.filter((f) => f.category === "invariant").length === 0;
  return {
    totalAgents,
    totalFindings: findings.length,
    findingsBySeverity,
    findings,
    invariantsOk,
  };
}
