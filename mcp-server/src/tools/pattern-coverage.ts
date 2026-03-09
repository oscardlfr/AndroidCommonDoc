/**
 * MCP tool: pattern-coverage
 *
 * Scans the toolkit's docs/ directory for pattern documents, extracts slugs
 * from YAML frontmatter, then checks for enforcement mechanisms across
 * detekt-rules/, scripts/sh/, and .claude/agents/. Reports an enforcement
 * matrix and overall coverage percentage.
 *
 * Coverage = (docs with at least 1 enforcement) / total docs * 100
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively walk a directory and return all files matching a given extension.
 */
function walkFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFiles(full, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  } catch {
    /* ignore unreadable dirs */
  }
  return results;
}

/**
 * Read all files in a directory tree and return their contents.
 * Used to build a searchable corpus of enforcement files.
 */
function readAllFiles(dir: string, ext: string): Array<{ path: string; content: string }> {
  const files = walkFiles(dir, ext);
  const results: Array<{ path: string; content: string }> = [];
  for (const filePath of files) {
    try {
      results.push({ path: filePath, content: readFileSync(filePath, "utf-8") });
    } catch {
      /* skip unreadable files */
    }
  }
  return results;
}

/**
 * Extract the slug field from YAML frontmatter between --- markers.
 */
function extractSlug(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const slugMatch = match[1].match(/^slug:\s*(.+)$/m);
  return slugMatch?.[1]?.trim() ?? null;
}

// ─── Coverage computation ────────────────────────────────────────────────────

interface PatternEnforcement {
  slug: string;
  doc_path: string;
  has_detekt_rule: boolean;
  has_script_check: boolean;
  has_agent_mention: boolean;
  enforced: boolean;
}

interface CoverageReport {
  total_docs: number;
  enforced_docs: number;
  coverage_pct: number;
  patterns: PatternEnforcement[];
  gaps: PatternEnforcement[];
}

function computeCoverage(toolkitRoot: string): CoverageReport {
  const docsDir = path.join(toolkitRoot, "docs");
  const detektDir = path.join(toolkitRoot, "detekt-rules");
  const scriptsDir = path.join(toolkitRoot, "scripts", "sh");
  const agentsDir = path.join(toolkitRoot, ".claude", "agents");

  // Scan all docs and extract slugs
  const docFiles = walkFiles(docsDir, ".md");
  const patterns: PatternEnforcement[] = [];

  // Pre-load enforcement corpora for efficient searching
  const detektFiles = readAllFiles(detektDir, ".kt").concat(
    readAllFiles(detektDir, ".kts"),
  );
  const scriptFiles = readAllFiles(scriptsDir, ".sh");
  const agentFiles = readAllFiles(agentsDir, ".md");

  for (const docPath of docFiles) {
    let content: string;
    try {
      content = readFileSync(docPath, "utf-8");
    } catch {
      continue;
    }

    const slug = extractSlug(content);
    if (!slug) continue;

    const hasDetekt = detektFiles.some((f) => f.content.includes(slug));
    const hasScript = scriptFiles.some((f) => f.content.includes(slug));
    const hasAgent = agentFiles.some((f) => f.content.includes(slug));

    patterns.push({
      slug,
      doc_path: path.relative(toolkitRoot, docPath),
      has_detekt_rule: hasDetekt,
      has_script_check: hasScript,
      has_agent_mention: hasAgent,
      enforced: hasDetekt || hasScript || hasAgent,
    });
  }

  const enforcedDocs = patterns.filter((p) => p.enforced).length;
  const totalDocs = patterns.length;
  const coveragePct = totalDocs > 0 ? Math.round((enforcedDocs / totalDocs) * 1000) / 10 : 0;
  const gaps = patterns.filter((p) => !p.enforced);

  return {
    total_docs: totalDocs,
    enforced_docs: enforcedDocs,
    coverage_pct: coveragePct,
    patterns,
    gaps,
  };
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: CoverageReport): string {
  const statusIcon = report.coverage_pct >= 80 ? "HEALTHY" : report.coverage_pct >= 50 ? "WARNING" : "LOW";

  const lines: string[] = [
    `## Pattern Enforcement Coverage`,
    `**Coverage:** ${report.coverage_pct}% (${report.enforced_docs}/${report.total_docs} patterns enforced) -- ${statusIcon}`,
    "",
    "| Slug | Detekt | Script | Agent | Enforced |",
    "|------|--------|--------|-------|----------|",
  ];

  for (const p of report.patterns) {
    const d = p.has_detekt_rule ? "Y" : "-";
    const s = p.has_script_check ? "Y" : "-";
    const a = p.has_agent_mention ? "Y" : "-";
    const e = p.enforced ? "YES" : "**NO**";
    lines.push(`| ${p.slug} | ${d} | ${s} | ${a} | ${e} |`);
  }

  if (report.gaps.length > 0) {
    lines.push("");
    lines.push("### Enforcement Gaps");
    lines.push("");
    for (const g of report.gaps) {
      lines.push(`- **${g.slug}** (${g.doc_path})`);
    }
  }

  return lines.join("\n");
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerPatternCoverageTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "pattern-coverage",
    "Compute enforcement coverage for pattern docs. Checks each doc slug against detekt-rules, scripts, and agent mentions. Reports coverage % and gaps.",
    {
      toolkit_root: z
        .string()
        .optional()
        .describe(
          "Path to AndroidCommonDoc root (defaults to ANDROID_COMMON_DOC env var or auto-detected path)",
        ),
      format: z
        .enum(["json", "markdown", "both"])
        .default("both")
        .describe("Output format (default: both)"),
    },
    async ({ toolkit_root, format = "both" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "pattern-coverage");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const root = toolkit_root ?? getToolkitRoot();
        const report = computeCoverage(root);

        const parts: string[] = [];

        if (format === "json" || format === "both") {
          parts.push("```json\n" + JSON.stringify(report, null, 2) + "\n```");
        }
        if (format === "markdown" || format === "both") {
          parts.push(renderMarkdown(report));
        }

        return {
          content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
        };
      } catch (error) {
        logger.error(`pattern-coverage error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
