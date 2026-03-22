/**
 * MCP tool: validate-claude-md
 *
 * Validates CLAUDE.md files for ecosystem alignment:
 * - Template structure (identity header, mandatory sections, delegation)
 * - Line count budget (warn >150, error >200)
 * - Canonical rule coverage (per-layer rule matching)
 * - Circular reference detection (L0 must not reference L1/L2 upward)
 * - Override validation (overrides must reference valid rule IDs)
 * - Version consistency (cross-check against versions-manifest.json)
 * - Cross-file duplicate detection (verbatim rules across layers)
 *
 * Returns structured JSON matching ValidationResult pattern.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import { discoverProjects } from "../registry/project-discovery.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single validation issue. */
export interface ValidationIssue {
  level: "error" | "warning";
  category: string;
  file: string;
  message: string;
}

/** Aggregated validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  summary: string;
}

/** A canonical rule from canonical-rules.json. */
export interface CanonicalRule {
  id: string;
  category: string;
  rule: string;
  layer: string;
  overridable: boolean;
  source?: string;
}

/** A CLAUDE.md file with its content and layer classification. */
export interface ClaudeMdFile {
  path: string;
  layer: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Known project names for circular reference detection
// ---------------------------------------------------------------------------

/**
 * L1 and L2 project names used to detect upward references in CLAUDE.md files.
 *
 * These are ecosystem-specific and MUST be configured by each team consuming
 * this toolkit. Leave empty to skip cross-reference validation, or populate
 * with your own project names.
 *
 * Example:
 *   const L1_PROJECT_NAMES = ["my-shared-libs"];
 *   const L2_PROJECT_NAMES = ["MyApp", "MyOtherApp"];
 */
const L1_PROJECT_NAMES: string[] = [];

/** L2 project names that L0/L1 should not reference in generic sections. */
const L2_PROJECT_NAMES: string[] = [];

// ---------------------------------------------------------------------------
// Template structure validation
// ---------------------------------------------------------------------------

/**
 * Validate the template structure of a CLAUDE.md file.
 *
 * Accepts two styles:
 * - **Legacy**: `> **Layer:** L{n}` + `> **Inherits:**` + `> **Purpose:**`
 * - **Boris Cherny**: `> L{n} {Type} — description` one-liner + Workflow Orchestration section
 *
 * L0-global (~/.claude/CLAUDE.md) is exempt from identity header requirement
 * since it is the root of the hierarchy.
 *
 * @param content - Raw file content
 * @param layer - Layer classification ("L0", "L0-global", "L1", "L2")
 * @returns Array of validation issues
 */
export function validateTemplateStructure(
  content: string,
  layer: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const file = "CLAUDE.md";

  // L0-global is the root -- exempt from identity header
  if (layer === "L0-global") {
    return issues;
  }

  // Detect which style: Boris Cherny or Legacy
  const hasBorisChernyHeader = /^>\s*L[012]\s+(Application|Ecosystem|Generic|Toolkit)/m.test(content);
  const hasLegacyHeader = />\s*\*\*Layer:\*\*/.test(content);

  if (hasBorisChernyHeader) {
    // Boris Cherny style validation
    const hasWorkflowOrchestration = /^##\s+Workflow Orchestration/m.test(content);
    const hasAgentDelegation = /Agent Delegation|Agent Roster|MUST delegate/i.test(content);
    const hasVerification = /Verification Before Done/i.test(content);
    const hasConstraints = /^##\s+Project Constraints/m.test(content);

    if (!hasWorkflowOrchestration) {
      issues.push({
        level: "warning",
        category: "template-structure",
        file,
        message: "Boris Cherny style: missing '## Workflow Orchestration' section",
      });
    }

    if (!hasAgentDelegation) {
      issues.push({
        level: "warning",
        category: "template-structure",
        file,
        message: "Boris Cherny style: missing Agent Delegation section or Agent Roster table",
      });
    }

    if (!hasVerification) {
      issues.push({
        level: "warning",
        category: "template-structure",
        file,
        message: "Boris Cherny style: missing 'Verification Before Done' section",
      });
    }

    if (!hasConstraints) {
      issues.push({
        level: "warning",
        category: "template-structure",
        file,
        message: "Boris Cherny style: missing '## Project Constraints' section",
      });
    }
  } else if (hasLegacyHeader) {
    // Legacy style validation (original behavior)
    const hasInherits = />\s*\*\*Inherits:\*\*/.test(content);
    const hasPurpose = />\s*\*\*Purpose:\*\*/.test(content);

    if (!hasInherits) {
      issues.push({
        level: "error",
        category: "template-structure",
        file,
        message: "Missing identity header: Inherits field not found (expected `> **Inherits:** path`)",
      });
    }

    if (!hasPurpose) {
      issues.push({
        level: "error",
        category: "template-structure",
        file,
        message: "Missing identity header: Purpose field not found (expected `> **Purpose:** description`)",
      });
    }

    // Check for delegation statement
    const hasDelegation =
      /[Dd]elegat(es?|ion)\s+(to|via)\s/.test(content) ||
      /[Dd]elegat(es?|ion)\s.*CLAUDE\.md/.test(content);
    if (!hasDelegation) {
      issues.push({
        level: "warning",
        category: "template-structure",
        file,
        message: "Missing delegation statement (expected text like 'Delegates to ~/.claude/CLAUDE.md')",
      });
    }
  } else {
    // Neither style detected
    issues.push({
      level: "error",
      category: "template-structure",
      file,
      message: "No recognized CLAUDE.md format. Expected Boris Cherny style (`> L{n} Type — description`) or legacy (`> **Layer:** L{n}`)",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Line count validation
// ---------------------------------------------------------------------------

/**
 * Validate line count budget for a CLAUDE.md file.
 *
 * @param content - Raw file content
 * @param filePath - File path for issue reporting
 * @returns Array of validation issues
 */
export function validateLineCount(
  content: string,
  filePath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lineCount = content.split("\n").length;

  if (lineCount > 200) {
    issues.push({
      level: "error",
      category: "line-count",
      file: filePath,
      message: `File exceeds 200 line hard limit: ${lineCount} lines`,
    });
  } else if (lineCount > 150) {
    issues.push({
      level: "warning",
      category: "line-count",
      file: filePath,
      message: `File exceeds 150 line soft limit: ${lineCount} lines`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Canonical coverage validation
// ---------------------------------------------------------------------------

/**
 * Extract keywords from a canonical rule for matching.
 * Uses the most distinctive words/phrases from the rule text.
 */
function extractKeywords(rule: string): string[] {
  // Extract key terms: words longer than 3 chars, excluding common ones
  const commonWords = new Set([
    "the",
    "for",
    "and",
    "with",
    "that",
    "from",
    "only",
    "when",
    "must",
    "not",
    "all",
    "use",
    "each",
    "never",
    "always",
    "should",
  ]);

  // Get distinctive terms from the rule
  const words = rule
    .replace(/[(),:;]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !commonWords.has(w.toLowerCase()));

  // Return the top distinctive words (at least 2 for reliable matching)
  return words.slice(0, Math.max(2, Math.min(4, words.length)));
}

/**
 * Validate canonical rule coverage for a CLAUDE.md file.
 *
 * Checks each rule assigned to the given layer and verifies
 * the CLAUDE.md content contains matching keywords.
 *
 * @param content - Raw file content
 * @param layer - Layer classification ("L0", "L0-global", "L1", "L2")
 * @param rules - Canonical rule checklist
 * @returns Array of validation issues
 */
export function validateCanonicalCoverage(
  content: string,
  layer: string,
  rules: CanonicalRule[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const contentLower = content.toLowerCase();

  // Filter rules to only those assigned to this layer
  const layerRules = rules.filter((r) => {
    if (layer === "L0-global" || layer === "L0") {
      return r.layer === "L0";
    }
    return r.layer === layer;
  });

  if (layerRules.length === 0) return issues;

  let covered = 0;

  for (const rule of layerRules) {
    const keywords = extractKeywords(rule.rule);

    // Check if at least half of keywords appear in the content
    const matches = keywords.filter((kw) =>
      contentLower.includes(kw.toLowerCase()),
    );
    const threshold = Math.max(1, Math.ceil(keywords.length / 2));

    if (matches.length >= threshold) {
      covered++;
    } else {
      issues.push({
        level: "warning",
        category: "canonical-coverage",
        file: "CLAUDE.md",
        message: `Missing canonical rule ${rule.id}: "${rule.rule}" (matched ${matches.length}/${keywords.length} keywords)`,
      });
    }
  }

  // Add coverage summary as info (if any missing)
  if (issues.length > 0) {
    const percent = Math.round((covered / layerRules.length) * 100);
    issues.push({
      level: "warning",
      category: "canonical-coverage",
      file: "CLAUDE.md",
      message: `Canonical coverage: ${covered}/${layerRules.length} rules (${percent}%) for layer ${layer}`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Circular reference detection
// ---------------------------------------------------------------------------

/**
 * Extract sections from CLAUDE.md content, identifying the Developer Context
 * section which is exempt from circular reference checks.
 * Content inside code fences is also excluded from generic sections
 * since it may contain legitimate path references (e.g., includeBuild paths).
 */
function extractSections(content: string): {
  devContext: string;
  genericSections: string;
} {
  const lines = content.split("\n");
  let devContext = "";
  let genericSections = "";
  let inDevContext = false;
  let inCodeFence = false;

  for (const line of lines) {
    // Track code fence boundaries
    if (/^```/.test(line.trim())) {
      inCodeFence = !inCodeFence;
    }

    // Detect Developer Context section start
    if (!inCodeFence && /^##\s+Developer Context/i.test(line)) {
      inDevContext = true;
      devContext += line + "\n";
      continue;
    }

    // End Developer Context at next section
    if (!inCodeFence && inDevContext && /^##\s+/.test(line)) {
      inDevContext = false;
    }

    if (inDevContext || inCodeFence) {
      if (inDevContext) devContext += line + "\n";
      // Code fence content is excluded from both
    } else {
      genericSections += line + "\n";
    }
  }

  return { devContext, genericSections };
}

/**
 * Detect circular/upward references in CLAUDE.md files.
 *
 * Rules:
 * - L0 must not reference L1/L2 project names in generic sections
 * - L1 must not reference L2 project names
 * - Developer Context section is exempt (user-scoped)
 * - L2 can reference anything (downward is allowed)
 *
 * @param files - Array of CLAUDE.md files with layer info
 * @returns Array of validation issues
 */
export function detectCircularReferences(
  files: ClaudeMdFile[],
  options?: { l1Names?: string[]; l2Names?: string[] },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const l1Names = options?.l1Names ?? L1_PROJECT_NAMES;
  const l2Names = options?.l2Names ?? L2_PROJECT_NAMES;

  for (const file of files) {
    const { genericSections } = extractSections(file.content);

    if (file.layer === "L0" || file.layer === "L0-global") {
      // L0 must not reference L1 or L2 project names in generic sections
      // Strip inline code (backtick-wrapped) since code examples legitimately reference paths
      const strippedSections = genericSections.replace(/`[^`]+`/g, "");
      for (const name of [...l1Names, ...l2Names]) {
        // Use word boundary to avoid partial matches
        const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, "g");
        if (regex.test(strippedSections)) {
          issues.push({
            level: "error",
            category: "circular-reference",
            file: file.path,
            message: `L0 file references project "${name}" in generic section (only allowed in Developer Context)`,
          });
        }
      }
    } else if (file.layer === "L1") {
      // L1 must not reference L2 project names
      for (const name of l2Names) {
        const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, "g");
        if (regex.test(genericSections)) {
          issues.push({
            level: "error",
            category: "circular-reference",
            file: file.path,
            message: `L1 file references L2 project "${name}" (upward reference not allowed)`,
          });
        }
      }
    }
    // L2 can reference anything -- no checks needed
  }

  return issues;
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Override validation
// ---------------------------------------------------------------------------

/**
 * Validate L0 Override declarations in a CLAUDE.md file.
 *
 * Parses the "L0 Overrides" table and validates:
 * - Each override references a valid rule ID from canonical-rules.json
 * - Warns if overriding a non-overridable rule
 *
 * @param content - Raw file content
 * @param rules - Canonical rule checklist
 * @returns Array of validation issues
 */
export function validateOverrides(
  content: string,
  rules: CanonicalRule[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Look for L0 Overrides section
  const overrideSection = content.match(
    /##\s+L0\s+Overrides\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/,
  );
  if (!overrideSection) return issues;

  const sectionContent = overrideSection[1];

  // Build rule lookup
  const ruleMap = new Map<string, CanonicalRule>();
  for (const rule of rules) {
    ruleMap.set(rule.id, rule);
  }

  // Parse table rows: | RULE-ID | ... | ... |
  const tableRowRegex = /^\|\s*([A-Z]+-\d+)\s*\|/gm;
  let match: RegExpExecArray | null;

  while ((match = tableRowRegex.exec(sectionContent)) !== null) {
    const ruleId = match[1];

    // Skip the header row separator
    if (ruleId === "Rule ID") continue;

    const canonicalRule = ruleMap.get(ruleId);

    if (!canonicalRule) {
      issues.push({
        level: "error",
        category: "override-validation",
        file: "CLAUDE.md",
        message: `Override references invalid rule ID: ${ruleId} (not found in canonical-rules.json)`,
      });
    } else if (!canonicalRule.overridable) {
      issues.push({
        level: "warning",
        category: "override-validation",
        file: "CLAUDE.md",
        message: `Override of non-overridable rule ${ruleId}: "${canonicalRule.rule}" -- this rule is marked as not overridable in canonical checklist`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Version consistency
// ---------------------------------------------------------------------------

/**
 * Known version patterns to look for in CLAUDE.md content.
 *
 * Maps manifest keys to regex patterns that match version references
 * in the document text.
 */
const VERSION_PATTERNS: Record<string, RegExp> = {
  kotlin: /\bKotlin\s+(\d+\.\d+\.\d+)/i,
  koin: /\bKoin\s+(\d+\.\d+\.\d+)/i,
  kover: /\bKover\s+(\d+\.\d+\.\d+)/i,
  agp: /\bAGP\s+(\d+\.\d+\.\d+)/i,
  "compose-multiplatform": /\bCompose[\s-]Multiplatform\s+(\d+\.\d+\.\d+)/i,
  "kotlinx-coroutines": /\bkotlinx[- ]coroutines\s+(\d+\.\d+\.\d+)/i,
  detekt: /\bDetekt\s+(\d+\.\d+\.\d+[-\w.]*)/i,
};

/**
 * Check version numbers in CLAUDE.md against versions-manifest.json.
 *
 * @param content - Raw file content
 * @param manifest - Version manifest (key -> version string)
 * @returns Array of validation issues
 */
export function checkVersionConsistency(
  content: string,
  manifest: Record<string, string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const [key, pattern] of Object.entries(VERSION_PATTERNS)) {
    const match = content.match(pattern);
    if (!match) continue;

    const foundVersion = match[1];
    const expectedVersion = manifest[key];

    if (!expectedVersion) continue;

    if (foundVersion !== expectedVersion) {
      issues.push({
        level: "warning",
        category: "version-consistency",
        file: "CLAUDE.md",
        message: `Version mismatch for ${key}: CLAUDE.md says "${foundVersion}", versions-manifest.json says "${expectedVersion}"`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Cross-file duplicate detection
// ---------------------------------------------------------------------------

/**
 * Extract rule-like lines from CLAUDE.md content.
 *
 * A "rule-like line" is a line starting with `-` that contains
 * meaningful content (not just a header or empty).
 */
function extractRuleLines(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("-") && line.trim().length > 20)
    .map((line) => line.trim().replace(/^-\s*/, "").trim());
}

/**
 * Detect verbatim rule duplication across layer files.
 *
 * Finds rules that appear identically in multiple CLAUDE.md files
 * (across different layers), which indicates drift risk.
 *
 * @param files - Array of CLAUDE.md files with layer info
 * @returns Array of validation issues
 */
export function detectCrossFileDuplicates(
  files: ClaudeMdFile[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Build map: rule text -> list of files containing it
  const ruleToFiles = new Map<string, string[]>();

  for (const file of files) {
    const rules = extractRuleLines(file.content);
    for (const rule of rules) {
      const normalized = rule.toLowerCase();
      const existing = ruleToFiles.get(normalized) ?? [];
      existing.push(file.path);
      ruleToFiles.set(normalized, existing);
    }
  }

  // Find rules appearing in multiple files
  for (const [rule, filePaths] of ruleToFiles) {
    // Only flag if the same rule appears in different files
    const uniquePaths = [...new Set(filePaths)];
    if (uniquePaths.length > 1) {
      issues.push({
        level: "warning",
        category: "cross-file-duplicate",
        file: uniquePaths.join(", "),
        message: `Duplicate rule across layers: "${rule}" -- drift risk if one file is updated without the other`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all CLAUDE.md validations and return a structured result.
 *
 * @param rootDir - L0 toolkit root directory
 * @param projectName - Optional specific project to validate
 * @param checkCanonical - Whether to check canonical rule coverage (default true)
 * @param checkVersions - Whether to check version consistency (default true)
 * @returns Aggregated validation result
 */
export async function validateClaudeMd(
  rootDir: string,
  projectName?: string,
  checkCanonical = true,
  checkVersions = true,
): Promise<ValidationResult> {
  const allIssues: ValidationIssue[] = [];

  // Load canonical rules
  let canonicalRules: CanonicalRule[] = [];
  if (checkCanonical) {
    try {
      const rulesPath = path.join(rootDir, "docs", "guides", "canonical-rules.json");
      const rulesRaw = await readFile(rulesPath, "utf-8");
      const rulesData = JSON.parse(rulesRaw);
      canonicalRules = rulesData.rules ?? [];
    } catch (error) {
      allIssues.push({
        level: "warning",
        category: "canonical-coverage",
        file: "docs/guides/canonical-rules.json",
        message: `Cannot load canonical-rules.json: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Load versions manifest
  let versionsManifest: Record<string, string> = {};
  if (checkVersions) {
    try {
      const manifestPath = path.join(rootDir, "versions-manifest.json");
      const manifestRaw = await readFile(manifestPath, "utf-8");
      const manifestData = JSON.parse(manifestRaw);
      versionsManifest = manifestData.versions ?? {};
    } catch (error) {
      allIssues.push({
        level: "warning",
        category: "version-consistency",
        file: "versions-manifest.json",
        message: `Cannot load versions-manifest.json: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Discover CLAUDE.md files
  const claudeFiles: ClaudeMdFile[] = [];

  // Always check global CLAUDE.md
  try {
    const globalPath = path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? "",
      ".claude",
      "CLAUDE.md",
    );
    const globalContent = await readFile(globalPath, "utf-8");
    claudeFiles.push({
      path: "~/.claude/CLAUDE.md",
      layer: "L0-global",
      content: globalContent,
    });
  } catch {
    allIssues.push({
      level: "warning",
      category: "file-discovery",
      file: "~/.claude/CLAUDE.md",
      message: "Global CLAUDE.md not found at ~/.claude/CLAUDE.md",
    });
  }

  // Check toolkit CLAUDE.md (L0)
  try {
    const toolkitClaudeMd = path.join(rootDir, "CLAUDE.md");
    const toolkitContent = await readFile(toolkitClaudeMd, "utf-8");
    claudeFiles.push({
      path: "CLAUDE.md",
      layer: "L0",
      content: toolkitContent,
    });
  } catch {
    allIssues.push({
      level: "error",
      category: "file-discovery",
      file: "CLAUDE.md",
      message: "Toolkit CLAUDE.md not found at project root",
    });
  }

  // Discover project CLAUDE.md files
  if (projectName) {
    // Validate specific project
    const projects = await discoverProjects();
    const project = projects.find(
      (p) => p.name.toLowerCase() === projectName.toLowerCase(),
    );
    if (project) {
      try {
        const projClaudeMd = path.join(project.path, "CLAUDE.md");
        const projContent = await readFile(projClaudeMd, "utf-8");
        // Determine layer from content — supports both formats
        const layerMatch = projContent.match(
          />\s*\*\*Layer:\*\*\s*(L[012])/,
        ) ?? projContent.match(
          /^>\s*(L[012])\s+/m,
        );
        const layer = layerMatch ? layerMatch[1] : "L2";
        claudeFiles.push({
          path: `${project.name}/CLAUDE.md`,
          layer,
          content: projContent,
        });
      } catch {
        allIssues.push({
          level: "warning",
          category: "file-discovery",
          file: `${project.name}/CLAUDE.md`,
          message: `CLAUDE.md not found for project ${project.name}`,
        });
      }
    }
  } else {
    // Discover all projects
    const projects = await discoverProjects();
    for (const project of projects) {
      try {
        const projClaudeMd = path.join(project.path, "CLAUDE.md");
        const projContent = await readFile(projClaudeMd, "utf-8");
        const layerMatch = projContent.match(
          />\s*\*\*Layer:\*\*\s*(L[012])/,
        );
        const layer = layerMatch ? layerMatch[1] : "L2";
        claudeFiles.push({
          path: `${project.name}/CLAUDE.md`,
          layer,
          content: projContent,
        });
      } catch {
        // Silently skip projects without CLAUDE.md
      }
    }
  }

  // Run validations on each file
  for (const file of claudeFiles) {
    // 1. Template structure
    const structureIssues = validateTemplateStructure(file.content, file.layer);
    for (const issue of structureIssues) {
      issue.file = file.path;
      allIssues.push(issue);
    }

    // 2. Line count
    const lineIssues = validateLineCount(file.content, file.path);
    allIssues.push(...lineIssues);

    // 3. Canonical coverage
    if (checkCanonical && canonicalRules.length > 0) {
      const coverageIssues = validateCanonicalCoverage(
        file.content,
        file.layer,
        canonicalRules,
      );
      for (const issue of coverageIssues) {
        issue.file = file.path;
        allIssues.push(issue);
      }
    }

    // 4. Override validation
    const overrideIssues = validateOverrides(file.content, canonicalRules);
    for (const issue of overrideIssues) {
      issue.file = file.path;
      allIssues.push(issue);
    }

    // 5. Version consistency
    if (checkVersions && Object.keys(versionsManifest).length > 0) {
      const versionIssues = checkVersionConsistency(
        file.content,
        versionsManifest,
      );
      for (const issue of versionIssues) {
        issue.file = file.path;
        allIssues.push(issue);
      }
    }
  }

  // Cross-file checks
  if (claudeFiles.length > 1) {
    // 6. Circular references
    const circularIssues = detectCircularReferences(claudeFiles);
    allIssues.push(...circularIssues);

    // 7. Cross-file duplicates
    const duplicateIssues = detectCrossFileDuplicates(claudeFiles);
    allIssues.push(...duplicateIssues);
  }

  const errors = allIssues.filter((i) => i.level === "error").length;
  const warnings = allIssues.filter((i) => i.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings,
    issues: allIssues,
    summary: `CLAUDE.md validation: ${errors} error(s), ${warnings} warning(s) across ${claudeFiles.length} file(s)`,
  };
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

/**
 * Register the validate-claude-md MCP tool.
 *
 * @param server - MCP server instance
 * @param limiter - Optional rate limiter
 */
export function registerValidateClaudeMdTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-claude-md",
    {
      title: "Validate CLAUDE.md",
      description:
        "Validates CLAUDE.md files for ecosystem alignment: template structure, canonical rule coverage, circular references, override validity, version consistency, and cross-file duplicates. Returns structured JSON with errors, warnings, and pass/fail status.",
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe(
            "Optional specific project name to validate (validates all discovered projects if omitted)",
          ),
        check_canonical: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to check canonical rule coverage (default true)"),
        check_versions: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to check version consistency against versions-manifest.json (default true)",
          ),
      }),
    },
    async ({ project, check_canonical, check_versions }) => {
      const rateLimitResponse = checkRateLimit(limiter, "validate-claude-md");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const rootDir = getToolkitRoot();
        const result = await validateClaudeMd(
          rootDir,
          project,
          check_canonical,
          check_versions,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error(`validate-claude-md error: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );
}
