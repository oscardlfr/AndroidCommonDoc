/**
 * MCP tool: check-doc-patterns
 *
 * Detects when pattern docs have enforceable rules (MUST/NEVER/ALWAYS)
 * without Detekt rule definitions, and when existing generated rules
 * have drifted from their source docs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { parseFrontmatter } from "../registry/frontmatter.js";
import { parseRuleDefinitions } from "../generation/rule-parser.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface RuleCandidate {
  doc: string;
  slug: string;
  reason: string;
}

interface OrphanedRule {
  rule_id: string;
  reason: string;
}

interface RuleAlignment {
  rule: string;
  status: "aligned" | "drifted";
  details?: string;
}

interface CheckResult {
  new_rule_candidates: RuleCandidate[];
  orphaned_rules: OrphanedRule[];
  rule_doc_alignment: RuleAlignment[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Walk directory tree collecting .md files. */
function walkMdFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "archive" || entry.name.startsWith(".")) continue;
        results.push(...walkMdFiles(full));
      } else if (entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results;
}

/** Walk directory tree collecting .kt files. */
function walkKtFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkKtFiles(full));
      } else if (entry.name.endsWith(".kt")) {
        results.push(full);
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results;
}

/** Normative language patterns that suggest enforceable rules. */
const NORMATIVE_RE = /\b(MUST|NEVER|ALWAYS|FORBIDDEN|REQUIRED)\b/;

/**
 * Check if a doc has normative language but no `rules:` frontmatter.
 * These are candidates for Detekt rule generation.
 */
function findRuleCandidates(docsDir: string): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  const mdFiles = walkMdFiles(docsDir);

  for (const filepath of mdFiles) {
    let content: string;
    try {
      content = readFileSync(filepath, "utf-8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm) continue;

    const slug = String(fm.data.slug ?? path.basename(filepath, ".md"));
    const hasRules = Array.isArray(fm.data.rules) && fm.data.rules.length > 0;
    const generated = fm.data.generated === true;

    // Skip generated docs and docs that already have rules
    if (generated || hasRules) continue;

    // Check content (not frontmatter) for normative language
    if (NORMATIVE_RE.test(fm.content)) {
      // Count normative instances
      const matches = fm.content.match(/\b(MUST|NEVER|ALWAYS|FORBIDDEN|REQUIRED)\b/g);
      const count = matches?.length ?? 0;

      if (count >= 2) {
        candidates.push({
          doc: path.basename(filepath),
          slug,
          reason: `${count} normative statements (MUST/NEVER/ALWAYS) without rules: frontmatter`,
        });
      }
    }
  }

  return candidates;
}

/**
 * Find generated Detekt rules that no longer have a source doc
 * (orphaned because the doc was archived or deleted).
 */
function findOrphanedRules(
  docsDir: string,
  detektDir: string,
): OrphanedRule[] {
  const orphaned: OrphanedRule[] = [];

  // Collect all slugs from active docs
  const activeSlugs = new Set<string>();
  for (const filepath of walkMdFiles(docsDir)) {
    try {
      const content = readFileSync(filepath, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm?.data.slug) {
        activeSlugs.add(String(fm.data.slug));
      }
    } catch {
      continue;
    }
  }

  // Check generated rules directory
  const generatedDir = path.join(
    detektDir, "src", "main", "kotlin",
    "com", "androidcommondoc", "detekt", "rules", "generated",
  );

  let ruleFiles: string[];
  try {
    ruleFiles = walkKtFiles(generatedDir);
  } catch {
    return orphaned;
  }

  for (const ruleFile of ruleFiles) {
    if (path.basename(ruleFile) === ".gitkeep") continue;

    let content: string;
    try {
      content = readFileSync(ruleFile, "utf-8");
    } catch {
      continue;
    }

    // Extract rule ID from class name or @Generated annotation
    const classMatch = content.match(/class\s+(\w+)/);
    if (!classMatch) continue;

    const ruleId = classMatch[1];

    // Check if any active doc references this rule
    // Simple heuristic: rule class name usually derives from doc slug
    const ruleSlug = ruleId
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");

    // Check if there's a doc that defined this rule
    let hasSource = false;
    for (const filepath of walkMdFiles(docsDir)) {
      try {
        const docContent = readFileSync(filepath, "utf-8");
        const fm = parseFrontmatter(docContent);
        if (!fm) continue;

        const rules = parseRuleDefinitions(fm.data);
        if (rules.some((r) => r.id === ruleId || r.id === ruleSlug)) {
          hasSource = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!hasSource) {
      orphaned.push({
        rule_id: ruleId,
        reason: "No active pattern doc defines this rule",
      });
    }
  }

  return orphaned;
}

/**
 * Check alignment between rule definitions in docs and generated rule files.
 */
function checkRuleAlignment(
  docsDir: string,
  detektDir: string,
): RuleAlignment[] {
  const alignments: RuleAlignment[] = [];

  const generatedDir = path.join(
    detektDir, "src", "main", "kotlin",
    "com", "androidcommondoc", "detekt", "rules", "generated",
  );

  // Collect all rule definitions from docs
  for (const filepath of walkMdFiles(docsDir)) {
    let content: string;
    try {
      content = readFileSync(filepath, "utf-8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm) continue;

    const rules = parseRuleDefinitions(fm.data);
    for (const rule of rules) {
      // Check if generated file exists
      const expectedFile = path.join(generatedDir, `${rule.id}.kt`);
      let ruleExists = false;
      try {
        statSync(expectedFile);
        ruleExists = true;
      } catch {
        // Try PascalCase variant
        const pascalName = rule.id
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("");
        try {
          statSync(path.join(generatedDir, `${pascalName}.kt`));
          ruleExists = true;
        } catch {
          // Rule file not found
        }
      }

      if (!ruleExists) {
        alignments.push({
          rule: rule.id,
          status: "drifted",
          details: "Rule defined in doc but no generated file found",
        });
      } else {
        alignments.push({
          rule: rule.id,
          status: "aligned",
        });
      }
    }
  }

  return alignments;
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerCheckDocPatternsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "check-doc-patterns",
    "Detect pattern docs with enforceable rules lacking Detekt definitions, orphaned rules, and rule-doc alignment drift.",
    {
      project_root: z
        .string()
        .optional()
        .describe("Project root (default: L0 toolkit root)"),
    },
    async ({ project_root }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "check-doc-patterns");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const root = project_root ?? getToolkitRoot();
        const docsDir = path.join(root, "docs");
        const detektDir = path.join(root, "detekt-rules");

        const newCandidates = findRuleCandidates(docsDir);
        const orphaned = findOrphanedRules(docsDir, detektDir);
        const alignment = checkRuleAlignment(docsDir, detektDir);

        const result: CheckResult = {
          new_rule_candidates: newCandidates,
          orphaned_rules: orphaned,
          rule_doc_alignment: alignment,
        };

        const summary = [
          `## Doc-Pattern Check`,
          ``,
          `- **New rule candidates**: ${newCandidates.length} docs with normative language but no rules:`,
          `- **Orphaned rules**: ${orphaned.length} generated rules without source doc`,
          `- **Alignment**: ${alignment.filter((a) => a.status === "aligned").length} aligned, ${alignment.filter((a) => a.status === "drifted").length} drifted`,
        ];

        if (newCandidates.length > 0) {
          summary.push("", "### Rule Candidates");
          for (const c of newCandidates) {
            summary.push(`- **${c.slug}** (${c.doc}): ${c.reason}`);
          }
        }

        if (orphaned.length > 0) {
          summary.push("", "### Orphaned Rules");
          for (const o of orphaned) {
            summary.push(`- **${o.rule_id}**: ${o.reason}`);
          }
        }

        const drifted = alignment.filter((a) => a.status === "drifted");
        if (drifted.length > 0) {
          summary.push("", "### Drifted Rules");
          for (const d of drifted) {
            summary.push(`- **${d.rule}**: ${d.details}`);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: summary.join("\n") + "\n\n```json\n" + JSON.stringify(result, null, 2) + "\n```",
            },
          ],
        };
      } catch (error) {
        logger.error(`check-doc-patterns error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
