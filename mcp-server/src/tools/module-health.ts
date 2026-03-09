/**
 * MCP tool: module-health
 *
 * Discovers Gradle modules from settings.gradle.kts, then collects per-module
 * health metrics: source file count, test file count, LOC (approximate), and
 * project dependency count. Returns a markdown table and/or JSON.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import {
  parseSettingsModules,
  parseModuleDependencies,
} from "../utils/gradle-parser.js";

// ── Recursive .kt file collector ────────────────────────────────────────────

interface FileStats {
  count: number;
  loc: number;
}

async function collectKtFiles(
  dir: string,
  filter: (relPath: string) => boolean,
): Promise<FileStats> {
  const result: FileStats = { count: 0, loc: 0 };

  async function walk(current: string, relBase: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist — skip gracefully
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith(".kt")) {
        if (filter(relPath)) {
          result.count++;
          try {
            const content = await readFile(fullPath, "utf-8");
            result.loc += content.split("\n").length;
          } catch {
            // unreadable file — skip
          }
        }
      }
    }
  }

  await walk(dir, "");
  return result;
}

// ── Module health data ──────────────────────────────────────────────────────

interface ModuleHealth {
  module: string;
  src_files: number;
  test_files: number;
  loc: number;
  dep_count: number;
}

async function collectModuleHealth(
  projectRoot: string,
  modulePath: string,
): Promise<ModuleHealth> {
  // Convert :core:network to core/network
  const moduleDir = modulePath.replace(/^:/, "").replace(/:/g, "/");
  const absModuleDir = path.join(projectRoot, moduleDir);

  // Source files: anything under */main/** or */commonMain/**
  const srcStats = await collectKtFiles(absModuleDir, (rel) => {
    const normalized = rel.replace(/\\/g, "/");
    return (
      normalized.includes("/main/") ||
      normalized.includes("/commonMain/")
    );
  });

  // Test files: anything under a directory segment containing "test"
  // (matches: test/, commonTest/, androidTest/, testFixtures/, etc.)
  const testStats = await collectKtFiles(absModuleDir, (rel) => {
    const normalized = rel.replace(/\\/g, "/");
    return /\/[^/]*[Tt]est[^/]*\//.test(normalized);
  });

  // Dependencies from build.gradle.kts
  let depCount = 0;
  const buildFile = path.join(absModuleDir, "build.gradle.kts");
  try {
    const deps = await parseModuleDependencies(buildFile);
    depCount = deps.api.length + deps.implementation.length;
  } catch {
    // build file missing or unreadable
  }

  return {
    module: modulePath,
    src_files: srcStats.count,
    test_files: testStats.count,
    loc: srcStats.loc + testStats.loc,
    dep_count: depCount,
  };
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(modules: ModuleHealth[]): string {
  const lines: string[] = [
    "## Module Health Report",
    "",
    "| Module | Src Files | Test Files | LOC | Dependencies |",
    "|--------|-----------|------------|-----|--------------|",
  ];

  for (const m of modules) {
    lines.push(
      `| ${m.module} | ${m.src_files} | ${m.test_files} | ${m.loc} | ${m.dep_count} |`,
    );
  }

  const totalSrc = modules.reduce((s, m) => s + m.src_files, 0);
  const totalTest = modules.reduce((s, m) => s + m.test_files, 0);
  const totalLoc = modules.reduce((s, m) => s + m.loc, 0);
  const totalDeps = modules.reduce((s, m) => s + m.dep_count, 0);

  lines.push(
    `| **Total** | **${totalSrc}** | **${totalTest}** | **${totalLoc}** | **${totalDeps}** |`,
  );

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerModuleHealthTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "module-health",
    "Analyze Gradle modules for source/test file counts, LOC, and dependency counts. Provides a quick project health overview.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the Gradle project root"),
      modules: z
        .array(z.string())
        .optional()
        .describe(
          "Specific modules to analyze (e.g. [\":core:network\"]). Omit for all.",
        ),
      format: z.enum(["json", "markdown", "both"]).default("both"),
    },
    async ({ project_root, modules: filterModules, format = "both" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "module-health");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const settingsPath = path.join(project_root, "settings.gradle.kts");
        let allModules: string[];
        try {
          allModules = await parseSettingsModules(settingsPath);
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: `Could not read settings.gradle.kts: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Apply module filter if provided
        const targetModules =
          filterModules && filterModules.length > 0
            ? allModules.filter((m) => filterModules.includes(m))
            : allModules;

        const results: ModuleHealth[] = [];
        for (const mod of targetModules) {
          results.push(await collectModuleHealth(project_root, mod));
        }

        const parts: string[] = [];

        if (format === "json" || format === "both") {
          parts.push(JSON.stringify({ modules: results }, null, 2));
        }
        if (format === "markdown" || format === "both") {
          parts.push(renderMarkdown(results));
        }

        return {
          content: [
            { type: "text" as const, text: parts.join("\n\n---\n\n") },
          ],
        };
      } catch (error) {
        logger.error(`module-health error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `module-health failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
