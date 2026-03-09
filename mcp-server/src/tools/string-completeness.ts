/**
 * MCP tool: string-completeness
 *
 * Validates Android string resource completeness across locales. Finds
 * base values/strings.xml files and compares them against locale variants
 * (values-XX/strings.xml) to detect missing translations.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ── String extraction ───────────────────────────────────────────────────────

const STRING_NAME_PATTERN = /<string\s+name="([^"]+)"[^>]*>/g;

function extractStringNames(xmlContent: string): Set<string> {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(STRING_NAME_PATTERN.source, "g");
  while ((match = regex.exec(xmlContent)) !== null) {
    names.add(match[1]);
  }
  return names;
}

// ── Recursive directory walker ──────────────────────────────────────────────

interface StringsFileInfo {
  locale: string; // "base", "es", "fr", etc.
  filePath: string;
  names: Set<string>;
}

function findStringsFiles(dir: string): StringsFileInfo[] {
  const results: StringsFileInfo[] = [];

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
        // Check for values/ or values-XX/ directories
        const valuesMatch = entry.name.match(/^values(-([a-zA-Z]{2,3}))?$/);
        if (valuesMatch) {
          const locale = valuesMatch[2] || "base";
          const stringsPath = path.join(fullPath, "strings.xml");
          try {
            const content = readFileSync(stringsPath, "utf-8");
            results.push({
              locale,
              filePath: stringsPath,
              names: extractStringNames(content),
            });
          } catch {
            // strings.xml doesn't exist in this values dir - skip
          }
        } else {
          // Recurse into non-values directories to find res/values/
          walk(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ── Locale comparison ───────────────────────────────────────────────────────

interface LocaleReport {
  locale: string;
  total_base_strings: number;
  translated: number;
  missing: string[];
  coverage_percent: number;
}

interface CompletenessReport {
  project_root: string;
  module_path?: string;
  base_string_count: number;
  locales: LocaleReport[];
  overall_coverage_percent: number;
}

function computeReport(
  baseNames: Set<string>,
  localeFiles: StringsFileInfo[],
  filterLocales?: string[],
): { localeReports: LocaleReport[]; overallCoverage: number } {
  const localeReports: LocaleReport[] = [];
  const targetLocales = localeFiles.filter(
    (f) =>
      f.locale !== "base" &&
      (!filterLocales || filterLocales.length === 0 || filterLocales.includes(f.locale)),
  );

  for (const localeFile of targetLocales) {
    const missing: string[] = [];
    for (const name of baseNames) {
      if (!localeFile.names.has(name)) {
        missing.push(name);
      }
    }
    const translated = baseNames.size - missing.length;
    const coverage =
      baseNames.size > 0 ? Math.round((translated / baseNames.size) * 100) : 100;
    localeReports.push({
      locale: localeFile.locale,
      total_base_strings: baseNames.size,
      translated,
      missing,
      coverage_percent: coverage,
    });
  }

  const overallCoverage =
    localeReports.length > 0
      ? Math.round(
          localeReports.reduce((sum, lr) => sum + lr.coverage_percent, 0) /
            localeReports.length,
        )
      : 100;

  return { localeReports, overallCoverage };
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: CompletenessReport): string {
  const lines: string[] = [
    "## String Completeness Report",
    "",
    `**Project:** ${report.project_root}`,
    report.module_path ? `**Module:** ${report.module_path}` : "",
    `**Base strings:** ${report.base_string_count}`,
    `**Overall coverage:** ${report.overall_coverage_percent}%`,
    "",
  ].filter(Boolean);

  if (report.locales.length === 0) {
    lines.push("No locale variants found.");
    return lines.join("\n");
  }

  lines.push("| Locale | Translated | Missing | Coverage |");
  lines.push("|--------|------------|---------|----------|");

  for (const locale of report.locales) {
    lines.push(
      `| ${locale.locale} | ${locale.translated}/${locale.total_base_strings} | ${locale.missing.length} | ${locale.coverage_percent}% |`,
    );
  }

  // Detail missing strings per locale
  for (const locale of report.locales) {
    if (locale.missing.length > 0) {
      lines.push("");
      lines.push(`### Missing in ${locale.locale}`);
      for (const name of locale.missing) {
        lines.push(`- \`${name}\``);
      }
    }
  }

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerStringCompletenessTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "string-completeness",
    "Check Android string resource completeness across locales. Finds missing translations by comparing base strings.xml against locale variants.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the Android/KMP project root"),
      module_path: z
        .string()
        .optional()
        .describe("Specific module path relative to project root (e.g., 'app' or 'feature/auth')"),
      locales: z
        .array(z.string())
        .optional()
        .describe("Filter to specific locales (e.g., ['es', 'fr']). Omit to check all."),
    },
    async ({ project_root, module_path, locales: filterLocales }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "string-completeness");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const searchRoot = module_path
          ? path.join(project_root, module_path)
          : project_root;

        // Verify search root exists
        try {
          statSync(searchRoot);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: `Directory not found: ${searchRoot}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const stringsFiles = findStringsFiles(searchRoot);

        // Collect all base strings
        const baseFiles = stringsFiles.filter((f) => f.locale === "base");
        const baseNames = new Set<string>();
        for (const bf of baseFiles) {
          for (const name of bf.names) {
            baseNames.add(name);
          }
        }

        if (baseNames.size === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No base strings.xml files found in the project. Ensure values/strings.xml exists.",
              },
            ],
          };
        }

        const { localeReports, overallCoverage } = computeReport(
          baseNames,
          stringsFiles,
          filterLocales,
        );

        const report: CompletenessReport = {
          project_root,
          module_path,
          base_string_count: baseNames.size,
          locales: localeReports,
          overall_coverage_percent: overallCoverage,
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
        logger.error(`string-completeness error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `string-completeness failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
