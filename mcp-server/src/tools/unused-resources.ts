/**
 * MCP tool: unused-resources
 *
 * Scans an Android/KMP project for unused string and drawable resources.
 * Parses strings.xml files, searches .kt source files for references
 * (R.string.X, Res.string.X, stringResource(Res.string.X)), and reports
 * resources with no references found.
 *
 * Emits AuditFinding (severity: LOW, category: code-quality) per unused resource.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { createFinding, buildDedupeKey } from "../types/findings.js";
import type { AuditFinding } from "../types/findings.js";

// ─── File walking ────────────────────────────────────────────────────────────

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
 * Walk a directory and return all files (regardless of extension) inside
 * directories whose name starts with a given prefix.
 */
function walkDrawableFiles(resDir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(resDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("drawable")) {
        const drawableDir = path.join(resDir, entry.name);
        try {
          for (const file of readdirSync(drawableDir, { withFileTypes: true })) {
            if (file.isFile()) {
              results.push(path.join(drawableDir, file.name));
            }
          }
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return results;
}

// ─── String resource extraction ──────────────────────────────────────────────

interface ResourceEntry {
  name: string;
  file: string;
  line: number;
}

/**
 * Find all strings.xml files under a project root (or specific module path).
 * Glob pattern: {any}/src/{variant}/res/values/strings.xml
 */
function findStringsXmlFiles(root: string): string[] {
  const results: string[] = [];

  function scanForStringsXml(dir: string, depth: number): void {
    if (depth > 8) return; // prevent deep recursion
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "build" || entry.name === ".gradle") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanForStringsXml(full, depth + 1);
        } else if (entry.name === "strings.xml") {
          // Verify it's in a res/values/ path
          const relPath = path.relative(root, full);
          if (relPath.includes(path.join("res", "values"))) {
            results.push(full);
          }
        }
      }
    } catch {
      /* skip unreadable dirs */
    }
  }

  scanForStringsXml(root, 0);
  return results;
}

/**
 * Extract string resource names from a strings.xml file.
 * Matches: <string name="resource_name">...</string>
 */
function extractStringNames(xmlPath: string): ResourceEntry[] {
  const entries: ResourceEntry[] = [];
  try {
    const content = readFileSync(xmlPath, "utf-8");
    const lines = content.split("\n");
    const pattern = /<string\s+name="([^"]+)"/;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(pattern);
      if (match) {
        entries.push({
          name: match[1],
          file: xmlPath,
          line: i + 1,
        });
      }
    }
  } catch {
    /* skip unreadable files */
  }
  return entries;
}

// ─── Drawable resource extraction ────────────────────────────────────────────

/**
 * Find all res/ directories under a project root and extract drawable filenames.
 */
function findDrawableResources(root: string): ResourceEntry[] {
  const entries: ResourceEntry[] = [];

  function scanForResDir(dir: string, depth: number): void {
    if (depth > 8) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "build" || entry.name === ".gradle") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "res") {
            // Found a res/ directory, scan for drawables
            const drawableFiles = walkDrawableFiles(full);
            for (const drawableFile of drawableFiles) {
              const baseName = path.basename(drawableFile, path.extname(drawableFile));
              entries.push({
                name: baseName,
                file: drawableFile,
                line: 1,
              });
            }
          } else {
            scanForResDir(full, depth + 1);
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  scanForResDir(root, 0);
  return entries;
}

// ─── Reference search ────────────────────────────────────────────────────────

/**
 * Build a combined source corpus from all .kt files for efficient searching.
 */
function buildSourceCorpus(root: string): string {
  const ktFiles = walkFiles(root, ".kt");
  const xmlFiles = walkFiles(root, ".xml");
  const chunks: string[] = [];
  for (const filePath of [...ktFiles, ...xmlFiles]) {
    try {
      chunks.push(readFileSync(filePath, "utf-8"));
    } catch {
      /* skip */
    }
  }
  return chunks.join("\n");
}

/**
 * Check if a string resource name is referenced anywhere in the source corpus.
 * Patterns checked:
 *   R.string.{name}
 *   Res.string.{name}
 *   stringResource(Res.string.{name})
 *   @string/{name}  (XML references)
 */
function isStringReferenced(name: string, corpus: string): boolean {
  return (
    corpus.includes(`R.string.${name}`) ||
    corpus.includes(`Res.string.${name}`) ||
    corpus.includes(`@string/${name}`)
  );
}

/**
 * Check if a drawable resource name is referenced anywhere in the source corpus.
 * Patterns checked:
 *   R.drawable.{name}
 *   Res.drawable.{name}
 *   painterResource(Res.drawable.{name})
 *   @drawable/{name}  (XML references)
 */
function isDrawableReferenced(name: string, corpus: string): boolean {
  return (
    corpus.includes(`R.drawable.${name}`) ||
    corpus.includes(`Res.drawable.${name}`) ||
    corpus.includes(`@drawable/${name}`)
  );
}

// ─── Report types ────────────────────────────────────────────────────────────

interface UnusedResource {
  type: "string" | "drawable";
  name: string;
  defined_in: string;
  line: number;
}

interface UnusedResourcesReport {
  project: string;
  resource_type: string;
  total_strings: number;
  unused_strings: number;
  total_drawables: number;
  unused_drawables: number;
  unused: UnusedResource[];
  findings: AuditFinding[];
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: UnusedResourcesReport): string {
  const lines: string[] = [
    `## Unused Resources -- ${report.project}`,
    "",
  ];

  if (report.resource_type === "strings" || report.resource_type === "all") {
    lines.push(`**Strings:** ${report.unused_strings} unused / ${report.total_strings} total`);
  }
  if (report.resource_type === "drawables" || report.resource_type === "all") {
    lines.push(`**Drawables:** ${report.unused_drawables} unused / ${report.total_drawables} total`);
  }

  if (report.unused.length === 0) {
    lines.push("");
    lines.push("No unused resources found.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("| # | Type | Name | Defined In | Line |");
  lines.push("|---|------|------|------------|------|");

  for (let i = 0; i < report.unused.length; i++) {
    const r = report.unused[i];
    lines.push(`| ${i + 1} | ${r.type} | ${r.name} | ${r.defined_in} | ${r.line} |`);
  }

  return lines.join("\n");
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerUnusedResourcesTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "unused-resources",
    "Scan an Android/KMP project for unused string and drawable resources. Reports resources with no code references found.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the project root to scan"),
      resource_type: z
        .enum(["strings", "drawables", "all"])
        .default("all")
        .describe("Type of resources to check (default: all)"),
      module_path: z
        .string()
        .optional()
        .describe("Optional: restrict scan to a specific module subdirectory"),
      format: z
        .enum(["json", "markdown", "both"])
        .default("both")
        .describe("Output format (default: both)"),
    },
    async ({ project_root, resource_type = "all", module_path, format = "both" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "unused-resources");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const scanRoot = module_path
          ? path.join(project_root, module_path)
          : project_root;

        // Build source corpus once for efficient searching
        const corpus = buildSourceCorpus(scanRoot);

        const unused: UnusedResource[] = [];
        const findings: AuditFinding[] = [];

        let totalStrings = 0;
        let unusedStrings = 0;
        let totalDrawables = 0;
        let unusedDrawables = 0;

        // Scan strings
        if (resource_type === "strings" || resource_type === "all") {
          const stringsXmlFiles = findStringsXmlFiles(scanRoot);
          for (const xmlFile of stringsXmlFiles) {
            const stringEntries = extractStringNames(xmlFile);
            totalStrings += stringEntries.length;

            for (const entry of stringEntries) {
              if (!isStringReferenced(entry.name, corpus)) {
                unusedStrings++;
                const relFile = path.relative(project_root, entry.file);
                unused.push({
                  type: "string",
                  name: entry.name,
                  defined_in: relFile,
                  line: entry.line,
                });
                findings.push(
                  createFinding({
                    dedupe_key: buildDedupeKey("unused-string", relFile, entry.line),
                    severity: "LOW",
                    category: "code-quality",
                    source: "unused-resources",
                    check: "unused-string",
                    title: `Unused string resource: ${entry.name}`,
                    file: relFile,
                    line: entry.line,
                    suggestion: `Remove <string name="${entry.name}"> from ${path.basename(entry.file)} or add a reference in code.`,
                  }),
                );
              }
            }
          }
        }

        // Scan drawables
        if (resource_type === "drawables" || resource_type === "all") {
          const drawableEntries = findDrawableResources(scanRoot);
          // Deduplicate by name (same drawable may exist in multiple density folders)
          const seenDrawables = new Map<string, ResourceEntry>();
          for (const entry of drawableEntries) {
            if (!seenDrawables.has(entry.name)) {
              seenDrawables.set(entry.name, entry);
            }
          }

          totalDrawables = seenDrawables.size;

          for (const [name, entry] of seenDrawables) {
            if (!isDrawableReferenced(name, corpus)) {
              unusedDrawables++;
              const relFile = path.relative(project_root, entry.file);
              unused.push({
                type: "drawable",
                name,
                defined_in: relFile,
                line: 1,
              });
              findings.push(
                createFinding({
                  dedupe_key: buildDedupeKey("unused-drawable", relFile),
                  severity: "LOW",
                  category: "code-quality",
                  source: "unused-resources",
                  check: "unused-drawable",
                  title: `Unused drawable resource: ${name}`,
                  file: relFile,
                  suggestion: `Remove ${path.basename(entry.file)} or add a reference in code.`,
                }),
              );
            }
          }
        }

        const projectName = path.basename(project_root);
        const report: UnusedResourcesReport = {
          project: projectName,
          resource_type,
          total_strings: totalStrings,
          unused_strings: unusedStrings,
          total_drawables: totalDrawables,
          unused_drawables: unusedDrawables,
          unused,
          findings,
        };

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
        logger.error(`unused-resources error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Resource scan failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
