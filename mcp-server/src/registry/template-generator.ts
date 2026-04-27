/**
 * Agent template generator (Phase 3 — round 1).
 *
 * Pure, idempotent rendering from a manifest entry to an agent template
 * `.md` file. Body content is preserved byte-for-byte across regeneration;
 * only the YAML frontmatter is authored from manifest data.
 *
 * Field rendering follows a single canonical order so the same manifest
 * entry always produces the same frontmatter bytes (the round-1 SHA-256
 * baseline anchors this contract). Variance in current templates is
 * treated as drift the generator REPAIRS on first run.
 *
 * Companion to `manifest-validator.ts`: the validator detects drift,
 * the generator eliminates it.
 */
import { createHash } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Subset of the manifest agent entry the generator reads. Mirrors the shape
 * declared in `manifest-validator.ts` but kept separate so generator + validator
 * can evolve independently.
 */
export interface ManifestAgentEntry {
  canonical_name: string;
  subagent_type: string;
  template_version: string;
  template_frontmatter_sha256?: string | null;
  category: string;
  lifecycle: string;
  description: string;
  domain?: string;
  intent?: string[];
  runtime: { model: string; token_budget?: number };
  tools: { allowed: string[] };
  skills_referenced?: string[];
  optional_capabilities?: string[];
  memory?: string | null;
}

/** Result of splitting a markdown file into its frontmatter and body. */
export interface SplitResult {
  /** YAML content WITHOUT the surrounding `---` markers. */
  yamlBlock: string;
  /** Everything after the closing `---\n` delimiter. */
  body: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Canonical frontmatter field order. Anchors the round-1 SHA-256 baseline.
 *
 * Optional fields are omitted entirely when the manifest value is null,
 * undefined, or an empty array. The order itself never changes — even
 * when an optional field is omitted, the surrounding fields keep their
 * relative position.
 */
export const CANONICAL_FIELD_ORDER = [
  "name",
  "description",
  "tools",
  "model",
  "domain",
  "intent",
  "token_budget",
  "template_version",
  "memory",
  "skills",
  "optional_capabilities",
] as const;

// ── Frontmatter rendering ────────────────────────────────────────────────────

/**
 * YAML-quote a scalar string when it contains characters that would be
 * mis-parsed otherwise. Mirrors the conservative quoting used in existing
 * templates: simple identifiers stay unquoted; descriptions and anything
 * with punctuation are double-quoted with backslash-escapes.
 */
function quoteYamlScalar(s: string): string {
  // Always quote if any YAML-ambiguous char is present
  if (/[:#\[\]{},&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s) || s.includes("\n")) {
    const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return s;
}

/**
 * Render an inline-array YAML value (e.g. `[a, b, c]`). Items are quoted
 * only when necessary. Used for `intent` field.
 */
function renderInlineArray(items: string[]): string {
  const parts = items.map(quoteYamlScalar);
  return `[${parts.join(", ")}]`;
}

/**
 * Render frontmatter content (YAML between `---` markers) from a manifest
 * entry. Output excludes the `---` delimiters themselves.
 *
 * Field order is fixed by `CANONICAL_FIELD_ORDER`. Optional fields with
 * null / undefined / empty values are omitted entirely.
 */
export function renderFrontmatter(entry: ManifestAgentEntry): string {
  const lines: string[] = [];

  // 1. name (required, unquoted — canonical_name pattern is identifier-safe)
  lines.push(`name: ${entry.canonical_name}`);

  // 2. description (required, always double-quoted per template convention)
  const descEscaped = entry.description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  lines.push(`description: "${descEscaped}"`);

  // 3. tools (required, CSV-flat — validator parses with parseToolsCsv)
  lines.push(`tools: ${entry.tools.allowed.join(", ")}`);

  // 4. model (required)
  lines.push(`model: ${entry.runtime.model}`);

  // 5. domain (optional)
  if (entry.domain && entry.domain.length > 0) {
    lines.push(`domain: ${quoteYamlScalar(entry.domain)}`);
  }

  // 6. intent (optional inline array)
  if (entry.intent && entry.intent.length > 0) {
    lines.push(`intent: ${renderInlineArray(entry.intent)}`);
  }

  // 7. token_budget (optional integer)
  if (
    entry.runtime.token_budget !== undefined &&
    entry.runtime.token_budget !== null
  ) {
    lines.push(`token_budget: ${entry.runtime.token_budget}`);
  }

  // 8. template_version (required, always quoted — SemVer must not be parsed as float)
  lines.push(`template_version: "${entry.template_version}"`);

  // 9. memory (optional scalar)
  if (entry.memory !== null && entry.memory !== undefined && entry.memory !== "") {
    lines.push(`memory: ${quoteYamlScalar(entry.memory)}`);
  }

  // 10. skills (optional block list — from skills_referenced)
  if (entry.skills_referenced && entry.skills_referenced.length > 0) {
    lines.push("skills:");
    for (const skill of entry.skills_referenced) {
      lines.push(`  - ${quoteYamlScalar(skill)}`);
    }
  }

  // 11. optional_capabilities (optional block list)
  if (entry.optional_capabilities && entry.optional_capabilities.length > 0) {
    lines.push("optional_capabilities:");
    for (const cap of entry.optional_capabilities) {
      lines.push(`  - ${quoteYamlScalar(cap)}`);
    }
  }

  return lines.join("\n");
}

// ── Body extraction ──────────────────────────────────────────────────────────

/**
 * Split a raw markdown file into its frontmatter YAML block and body.
 *
 * Returns `null` when no frontmatter is detected. On success, `yamlBlock`
 * is the YAML content WITHOUT the surrounding `---` markers, and `body`
 * is everything after the closing `---\n` (including any leading blank
 * line).
 *
 * Handles BOM and CRLF — output is always LF-normalized.
 */
export function splitFrontmatterAndBody(raw: string): SplitResult | null {
  if (!raw) return null;

  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  text = text.replace(/\r\n/g, "\n");

  if (!text.startsWith("---\n")) return null;

  const closingIdx = text.indexOf("\n---\n", 3);
  if (closingIdx === -1) {
    // Tolerate a closing --- at the very end of the file (no trailing newline).
    if (text.endsWith("\n---")) {
      const yamlBlock = text.slice(4, text.length - 4);
      return { yamlBlock, body: "" };
    }
    return null;
  }

  const yamlBlock = text.slice(4, closingIdx);
  const body = text.slice(closingIdx + 5); // skip `\n---\n`
  return { yamlBlock, body };
}

// ── Full template generation ─────────────────────────────────────────────────

/**
 * Generate a complete template (frontmatter + body). The body is preserved
 * verbatim — round 1 of Phase 3 NEVER mutates body content. Mirrors are
 * generated from the same output, guaranteeing byte-for-byte parity between
 * `setup/agent-templates/{name}.md` and `.claude/agents/{name}.md`.
 *
 * Output always ends with a trailing newline if the body had one (or no
 * trailing newline if the original body lacked one) — preservation is exact.
 */
export function generateTemplate(
  entry: ManifestAgentEntry,
  body: string,
): string {
  const frontmatter = renderFrontmatter(entry);
  return `---\n${frontmatter}\n---\n${body}`;
}

// ── Hash computation ─────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a frontmatter YAML block. The block
 * passed in MUST exclude the `---` markers (the same shape `renderFrontmatter`
 * returns). Newlines are normalized to LF and trailing whitespace is trimmed
 * before hashing, so the hash is invariant across CRLF / trailing-newline
 * differences.
 */
export function computeFrontmatterSha256(yamlBlock: string): string {
  const normalized = yamlBlock.replace(/\r\n/g, "\n").trimEnd() + "\n";
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
