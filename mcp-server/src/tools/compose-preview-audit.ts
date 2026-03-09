/**
 * MCP tool: compose-preview-audit
 *
 * Audits Compose @Preview annotations for quality: checks for
 * PreviewParameter usage, light/dark theme variants, and multiple
 * screen size configurations. Computes per-file and overall quality scores.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ── Regex patterns ──────────────────────────────────────────────────────────

const PREVIEW_REGEX = /@Preview(\s*\(|$|\s)/m;
const PREVIEW_PARAMETER_REGEX = /@PreviewParameter/;
const NIGHT_MODE_REGEX = /UI_MODE_NIGHT|uiMode.*NIGHT/;
const SCREEN_SIZE_REGEX = /widthDp|heightDp|device\s*=/;

// ── File scanning ───────────────────────────────────────────────────────────

interface PreviewFileAudit {
  file: string;
  relative_path: string;
  preview_count: number;
  has_preview_parameter: boolean;
  has_dark_mode: boolean;
  has_screen_sizes: boolean;
  quality_score: number;
  recommendations: string[];
}

function auditPreviewFile(filePath: string, relativePath: string): PreviewFileAudit | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  // Check if file contains @Preview at all
  if (!PREVIEW_REGEX.test(content)) {
    return null;
  }

  // Count @Preview annotations
  const previewMatches = content.match(/@Preview(\s*\(|$|\s)/gm);
  const previewCount = previewMatches ? previewMatches.length : 0;

  if (previewCount === 0) {
    return null;
  }

  const hasPreviewParameter = PREVIEW_PARAMETER_REGEX.test(content);
  const hasDarkMode = NIGHT_MODE_REGEX.test(content);
  const hasScreenSizes = SCREEN_SIZE_REGEX.test(content);

  // Compute quality score: 0-100
  // Base: 25 points for having previews at all
  // +25 for PreviewParameter
  // +25 for dark mode variant
  // +25 for screen size variants
  let score = 25;
  if (hasPreviewParameter) score += 25;
  if (hasDarkMode) score += 25;
  if (hasScreenSizes) score += 25;

  const recommendations: string[] = [];
  if (!hasPreviewParameter) {
    recommendations.push("Add @PreviewParameter for data-driven previews");
  }
  if (!hasDarkMode) {
    recommendations.push("Add dark mode preview (uiMode = Configuration.UI_MODE_NIGHT_YES)");
  }
  if (!hasScreenSizes) {
    recommendations.push("Add screen size variants (widthDp/heightDp or device parameter)");
  }

  return {
    file: filePath,
    relative_path: relativePath,
    preview_count: previewCount,
    has_preview_parameter: hasPreviewParameter,
    has_dark_mode: hasDarkMode,
    has_screen_sizes: hasScreenSizes,
    quality_score: score,
    recommendations,
  };
}

// ── Recursive .kt file finder ───────────────────────────────────────────────

function findKtFiles(dir: string, baseDir: string): PreviewFileAudit[] {
  const results: PreviewFileAudit[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip build directories and hidden directories
        if (entry.name === "build" || entry.name.startsWith(".")) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".kt")) {
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
        const audit = auditPreviewFile(fullPath, relativePath);
        if (audit) {
          results.push(audit);
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ── Report types ────────────────────────────────────────────────────────────

interface PreviewAuditReport {
  project_root: string;
  module_path?: string;
  files_with_previews: number;
  total_previews: number;
  overall_score: number;
  files: PreviewFileAudit[];
  summary: {
    with_preview_parameter: number;
    with_dark_mode: number;
    with_screen_sizes: number;
  };
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: PreviewAuditReport): string {
  const lines: string[] = [
    "## Compose Preview Audit Report",
    "",
    `**Project:** ${report.project_root}`,
    report.module_path ? `**Module:** ${report.module_path}` : "",
    `**Files with previews:** ${report.files_with_previews}`,
    `**Total @Preview annotations:** ${report.total_previews}`,
    `**Overall quality score:** ${report.overall_score}/100`,
    "",
  ].filter(Boolean);

  if (report.files.length === 0) {
    lines.push("No files with @Preview annotations found.");
    return lines.join("\n");
  }

  lines.push("### Feature Coverage");
  lines.push(`- PreviewParameter: ${report.summary.with_preview_parameter}/${report.files_with_previews} files`);
  lines.push(`- Dark mode variant: ${report.summary.with_dark_mode}/${report.files_with_previews} files`);
  lines.push(`- Screen size variants: ${report.summary.with_screen_sizes}/${report.files_with_previews} files`);
  lines.push("");

  lines.push("### Per-File Scores");
  lines.push("");
  lines.push("| File | Previews | Score | Parameter | Dark | Sizes |");
  lines.push("|------|----------|-------|-----------|------|-------|");

  for (const f of report.files) {
    const param = f.has_preview_parameter ? "Y" : "-";
    const dark = f.has_dark_mode ? "Y" : "-";
    const sizes = f.has_screen_sizes ? "Y" : "-";
    lines.push(
      `| ${f.relative_path} | ${f.preview_count} | ${f.quality_score} | ${param} | ${dark} | ${sizes} |`,
    );
  }

  // Recommendations for low-scoring files
  const lowScoreFiles = report.files.filter((f) => f.quality_score < 75);
  if (lowScoreFiles.length > 0) {
    lines.push("");
    lines.push("### Recommendations");
    for (const f of lowScoreFiles) {
      lines.push("");
      lines.push(`**${f.relative_path}** (score: ${f.quality_score})`);
      for (const rec of f.recommendations) {
        lines.push(`- ${rec}`);
      }
    }
  }

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerComposePreviewAuditTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "compose-preview-audit",
    "Audit Compose @Preview annotations for quality: PreviewParameter usage, light/dark variants, and screen size configurations.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the Android/KMP project root"),
      module_path: z
        .string()
        .optional()
        .describe("Specific module path relative to project root"),
    },
    async ({ project_root, module_path }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "compose-preview-audit");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const searchRoot = module_path
          ? path.join(project_root, module_path)
          : project_root;

        const fileAudits = findKtFiles(searchRoot, searchRoot);

        const totalPreviews = fileAudits.reduce((sum, f) => sum + f.preview_count, 0);
        const overallScore =
          fileAudits.length > 0
            ? Math.round(
                fileAudits.reduce((sum, f) => sum + f.quality_score, 0) /
                  fileAudits.length,
              )
            : 0;

        const report: PreviewAuditReport = {
          project_root,
          module_path,
          files_with_previews: fileAudits.length,
          total_previews: totalPreviews,
          overall_score: overallScore,
          files: fileAudits,
          summary: {
            with_preview_parameter: fileAudits.filter((f) => f.has_preview_parameter).length,
            with_dark_mode: fileAudits.filter((f) => f.has_dark_mode).length,
            with_screen_sizes: fileAudits.filter((f) => f.has_screen_sizes).length,
          },
        };

        const markdown = renderMarkdown(report);
        const json = JSON.stringify(report, null, 2);

        return {
          content: [
            {
              type: "text" as const,
              text: `${markdown}\n\n---\n\n\`\`\`json\n${json}\n\`\`\``,
            },
          ],
        };
      } catch (error) {
        logger.error(`compose-preview-audit error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `compose-preview-audit failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
