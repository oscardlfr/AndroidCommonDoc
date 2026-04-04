/**
 * MCP tool: validate-doc-update
 *
 * Pre-write validation for doc-updater. Checks proposed content before
 * writing to detect duplicates, anti-patterns, coherence issues, and
 * size limit violations. Returns VALID, FIXABLE, or REJECTED status.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import {
  tokenize,
  jaccardSimilarity,
  normalizeForComparison,
} from "../utils/doc-scoring.js";
import {
  APPROVED_CATEGORIES,
  SUBDIR_TO_CATEGORIES,
  checkSizeLimits,
} from "./validate-doc-structure.js";
import { parseFrontmatter } from "../registry/frontmatter.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface ValidationIssue {
  type: "generated" | "duplicate" | "incoherent" | "forbidden" | "oversized" | "overlap";
  severity: "HIGH" | "MEDIUM";
  message: string;
  auto_fixable: boolean;
  suggestion?: string;
}

interface RelatedDoc {
  slug: string;
  overlap_score: number;
}

interface ValidationResult {
  status: "VALID" | "FIXABLE" | "REJECTED";
  issues: ValidationIssue[];
  related_docs: RelatedDoc[];
  split_suggestion?: { recommended_sections: string[] };
}

// ── Anti-pattern conventions ────────────────────────────────────────────────

/**
 * L0 conventions that should never be contradicted in documentation.
 * Each pattern triggers a REJECTED status if found recommending the opposite.
 */
const ANTI_PATTERNS: Array<{ pattern: RegExp; convention: string }> = [
  {
    pattern: /\bdata\s+class\b.*\bUiState\b/i,
    convention: "UiState must be sealed interface, not data class",
  },
  {
    pattern: /\bChannel\b.*\bevents?\b/i,
    convention: "Events must use SharedFlow(replay=0), not Channel",
  },
  {
    pattern: /\bDispatchers\.(Default|IO|Main)\b.*\b(ViewModel|UseCase)\b/i,
    convention: "Inject testDispatcher into UseCases, not hardcoded Dispatchers",
  },
  {
    pattern: /\bconsole\.log\b/i,
    convention: "MCP server must use logger utility, not console.log",
  },
  {
    pattern: /\bmockk?\b.*\b(repository|dao|store)\b/i,
    convention: "Use pure-Kotlin fakes over mocks (FakeRepository, FakeClock)",
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Walk a directory tree collecting .md files. */
async function collectDocs(dir: string): Promise<Array<{ path: string; content: string }>> {
  const docs: Array<{ path: string; content: string }> = [];

  let entries: string[];
  try {
    entries = await readdir(dir).then((e) => e.map((name) => path.join(dir, name)));
  } catch {
    return docs;
  }

  for (const entry of entries) {
    let s;
    try {
      s = await stat(entry);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      // Skip archive and hidden dirs
      const name = path.basename(entry);
      if (name === "archive" || name.startsWith(".")) continue;
      docs.push(...(await collectDocs(entry)));
    } else if (entry.endsWith(".md")) {
      try {
        const content = await readFile(entry, "utf-8");
        docs.push({ path: entry, content });
      } catch {
        // skip unreadable files
      }
    }
  }

  return docs;
}

/** Extract slug from frontmatter or filename. */
function extractSlug(filepath: string, content: string): string {
  const fm = parseFrontmatter(content);
  if (fm?.data?.slug) return String(fm.data.slug);
  return path.basename(filepath, ".md");
}

/** Check if a doc has `generated: true` in frontmatter. */
function isGenerated(content: string): boolean {
  const fm = parseFrontmatter(content);
  return fm?.data?.generated === true || fm?.data?.generated === "true";
}

/** Extract category from file path. */
function categoryFromPath(filepath: string): string | undefined {
  const normalized = filepath.replace(/\\/g, "/");
  const match = normalized.match(/\/docs\/([^/]+)\//);
  return match ? match[1] : undefined;
}

// ── Validation checks ───────────────────────────────────────────────────────

/** Check 1: Reject edits to generated files. */
function checkGeneratedGuard(targetFile: string, existingContent?: string): ValidationIssue | null {
  if (existingContent && isGenerated(existingContent)) {
    return {
      type: "generated",
      severity: "HIGH",
      message: `File is auto-generated (generated: true). Modify the source instead.`,
      auto_fixable: false,
      suggestion: "Run /generate-api-docs to regenerate, or modify KDoc in source code.",
    };
  }
  return null;
}

/** Check 2: Detect duplicate content via Jaccard similarity. */
function checkDuplicates(
  proposedTokens: string[],
  existingDocs: Array<{ slug: string; tokens: string[]; generated: boolean }>,
): { issues: ValidationIssue[]; related: RelatedDoc[] } {
  const issues: ValidationIssue[] = [];
  const related: RelatedDoc[] = [];

  for (const doc of existingDocs) {
    if (doc.generated) continue; // skip generated docs

    const score = jaccardSimilarity(proposedTokens, doc.tokens);
    if (score >= 0.7) {
      issues.push({
        type: "duplicate",
        severity: "HIGH",
        message: `Proposed content has ${Math.round(score * 100)}% overlap with "${doc.slug}"`,
        auto_fixable: false,
        suggestion: `Update "${doc.slug}" instead of creating duplicate content.`,
      });
    } else if (score >= 0.5) {
      related.push({ slug: doc.slug, overlap_score: Math.round(score * 100) / 100 });
    }
  }

  return { issues, related };
}

/** Check 3: Verify frontmatter coherence with target directory. */
function checkCoherence(targetFile: string, proposedContent: string): ValidationIssue | null {
  const category = categoryFromPath(targetFile);
  if (!category) return null;

  const fm = parseFrontmatter(proposedContent);
  if (!fm?.data?.category) return null;

  const fmCategory = String(fm.data.category).toLowerCase();
  const allowedCategories = SUBDIR_TO_CATEGORIES[category];

  if (allowedCategories && !allowedCategories.includes(fmCategory)) {
    return {
      type: "incoherent",
      severity: "MEDIUM",
      message: `Frontmatter category "${fmCategory}" doesn't match directory "${category}" (expected: ${allowedCategories.join(", ")})`,
      auto_fixable: true,
      suggestion: `Change category to "${allowedCategories[0]}" or move file to docs/${fmCategory}/`,
    };
  }

  return null;
}

/** Check 4: Detect anti-patterns. */
function checkAntiPatterns(proposedContent: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const { pattern, convention } of ANTI_PATTERNS) {
    if (pattern.test(proposedContent)) {
      issues.push({
        type: "forbidden",
        severity: "HIGH",
        message: `Content appears to document an anti-pattern: ${convention}`,
        auto_fixable: false,
        suggestion: `Rewrite to align with convention: ${convention}`,
      });
    }
  }

  return issues;
}

/** Check 5: Size limit pre-check. */
function checkSize(
  targetFile: string,
  proposedContent: string,
  updateType: string,
  existingContent?: string,
): { issues: ValidationIssue[]; splitSuggestion?: { recommended_sections: string[] } } {
  const merged = updateType === "append" && existingContent
    ? existingContent + "\n" + proposedContent
    : proposedContent;

  const result = checkSizeLimits(targetFile, merged, false);

  const issues: ValidationIssue[] = [];
  let splitSuggestion: { recommended_sections: string[] } | undefined;

  for (const err of result.errors) {
    issues.push({
      type: "oversized",
      severity: "HIGH",
      message: err,
      auto_fixable: false,
    });
  }

  if (issues.length > 0) {
    // Suggest splitting by H2 sections
    const sections = merged.match(/^## .+$/gm) ?? [];
    if (sections.length >= 2) {
      splitSuggestion = {
        recommended_sections: sections.map((s) => s.replace(/^## /, "")),
      };
    }
  }

  return { issues, splitSuggestion };
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerValidateDocUpdateTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "validate-doc-update",
    "Pre-write validation for documentation updates. Checks for duplicates, anti-patterns, coherence, and size limits before writing.",
    {
      target_file: z.string().describe("Absolute path to the doc file being updated"),
      proposed_content: z.string().describe("The new content to validate"),
      update_type: z
        .enum(["create", "update", "append"])
        .default("update")
        .describe("Type of update: create new file, replace content, or append"),
    },
    async ({ target_file, proposed_content, update_type = "update" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "validate-doc-update");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const issues: ValidationIssue[] = [];
        const relatedDocs: RelatedDoc[] = [];
        let splitSuggestion: { recommended_sections: string[] } | undefined;

        // Read existing file content if updating
        let existingContent: string | undefined;
        if (update_type !== "create") {
          try {
            existingContent = await readFile(target_file, "utf-8");
          } catch {
            // File doesn't exist yet — treat as create
          }
        }

        // Check 1: Generated file guard
        const genIssue = checkGeneratedGuard(target_file, existingContent);
        if (genIssue) {
          issues.push(genIssue);
          // Immediately reject — no point checking further
          const result: ValidationResult = {
            status: "REJECTED",
            issues,
            related_docs: [],
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // Check 2: Duplicate detection against existing docs
        const docsDir = path.resolve(target_file, "..", "..");
        // Try to find the docs/ root
        let docsRoot = docsDir;
        while (!docsRoot.replace(/\\/g, "/").endsWith("/docs") && docsRoot.length > 3) {
          docsRoot = path.dirname(docsRoot);
        }

        const proposedTokens = normalizeForComparison(proposed_content);
        const existingDocs: Array<{ slug: string; tokens: string[]; generated: boolean }> = [];

        try {
          const allDocs = await collectDocs(docsRoot);
          for (const doc of allDocs) {
            // Skip the target file itself
            if (path.resolve(doc.path) === path.resolve(target_file)) continue;

            existingDocs.push({
              slug: extractSlug(doc.path, doc.content),
              tokens: normalizeForComparison(doc.content),
              generated: isGenerated(doc.content),
            });
          }
        } catch {
          logger.warn("validate-doc-update: could not scan docs directory for duplicate check");
        }

        const dupResult = checkDuplicates(proposedTokens, existingDocs);
        issues.push(...dupResult.issues);
        relatedDocs.push(...dupResult.related);

        // Check 3: Coherence
        const coherenceIssue = checkCoherence(target_file, proposed_content);
        if (coherenceIssue) issues.push(coherenceIssue);

        // Check 4: Anti-patterns
        issues.push(...checkAntiPatterns(proposed_content));

        // Check 5: Size limits
        const sizeResult = checkSize(target_file, proposed_content, update_type, existingContent);
        issues.push(...sizeResult.issues);
        if (sizeResult.splitSuggestion) splitSuggestion = sizeResult.splitSuggestion;

        // Determine overall status
        let status: "VALID" | "FIXABLE" | "REJECTED";
        const hasHigh = issues.some((i) => i.severity === "HIGH" && !i.auto_fixable);
        const hasFixable = issues.some((i) => i.auto_fixable);

        if (hasHigh) {
          status = "REJECTED";
        } else if (hasFixable || issues.length > 0) {
          status = "FIXABLE";
        } else {
          status = "VALID";
        }

        const result: ValidationResult = {
          status,
          issues,
          related_docs: relatedDocs,
        };
        if (splitSuggestion) result.split_suggestion = splitSuggestion;

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(`validate-doc-update error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
