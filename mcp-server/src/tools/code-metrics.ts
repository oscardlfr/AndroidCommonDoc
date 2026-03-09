/**
 * MCP tool: code-metrics
 *
 * Computes code metrics per module: .kt file counts, LOC, test file
 * counts, public function counts, max nesting depth, and average
 * function length. Optionally persists a code_metrics event to
 * audit-log.jsonl.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { parseSettingsModules } from "../utils/gradle-parser.js";

// ── File walker ──────────────────────────────────────────────────────────────

function walkDir(dir: string, filter: (name: string) => boolean): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, filter));
    } else if (filter(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Metric computation ───────────────────────────────────────────────────────

interface ModuleMetrics {
  module: string;
  kt_files: number;
  test_kt_files: number;
  loc: number;
  public_functions: number;
  max_nesting_depth: number;
  avg_function_length: number;
}

/**
 * Determine if a path segment represents a test source directory.
 * Uses path segments to avoid false positives from directory names
 * that contain "test" as a substring (e.g., "test-project").
 */
function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  // Check if any path segment is exactly "test", "androidTest", or "testFixtures"
  return (
    segments.some((s) => s === "test" || s === "androidTest" || s === "testFixtures") ||
    normalized.endsWith("Test.kt")
  );
}

/**
 * Count max nesting depth in a Kotlin file by tracking brace levels.
 */
function computeMaxNesting(lines: string[]): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const line of lines) {
    for (const ch of line) {
      if (ch === "{") {
        currentDepth++;
        if (currentDepth > maxDepth) maxDepth = currentDepth;
      } else if (ch === "}") {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }
  }

  return maxDepth;
}

/**
 * Compute average function length by counting lines between `fun ` declarations.
 */
function computeAvgFunctionLength(lines: string[]): number {
  const funLineIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/\bfun\s+/.test(lines[i])) {
      funLineIndices.push(i);
    }
  }

  if (funLineIndices.length <= 1) {
    return funLineIndices.length === 1 ? lines.length - funLineIndices[0] : 0;
  }

  let totalLength = 0;
  for (let i = 0; i < funLineIndices.length - 1; i++) {
    totalLength += funLineIndices[i + 1] - funLineIndices[i];
  }
  // Last function to end of file
  totalLength += lines.length - funLineIndices[funLineIndices.length - 1];

  return Math.round(totalLength / funLineIndices.length);
}

function computeModuleMetrics(moduleDir: string, moduleName: string): ModuleMetrics {
  const ktFiles = walkDir(moduleDir, (name) => name.endsWith(".kt"));

  const srcFiles: string[] = [];
  const testFiles: string[] = [];

  for (const f of ktFiles) {
    if (isTestPath(f)) {
      testFiles.push(f);
    } else {
      srcFiles.push(f);
    }
  }

  let totalLoc = 0;
  let totalPublicFunctions = 0;
  let maxNesting = 0;
  const allFunctionLengths: number[] = [];

  for (const filePath of srcFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    totalLoc += lines.length;

    // Count public functions (simple heuristic: `fun ` occurrences)
    for (const line of lines) {
      if (/\bfun\s+/.test(line)) {
        totalPublicFunctions++;
      }
    }

    const fileNesting = computeMaxNesting(lines);
    if (fileNesting > maxNesting) maxNesting = fileNesting;

    const avgLen = computeAvgFunctionLength(lines);
    if (avgLen > 0) allFunctionLengths.push(avgLen);
  }

  const avgFunctionLength =
    allFunctionLengths.length > 0
      ? Math.round(
          allFunctionLengths.reduce((a, b) => a + b, 0) / allFunctionLengths.length,
        )
      : 0;

  return {
    module: moduleName,
    kt_files: srcFiles.length,
    test_kt_files: testFiles.length,
    loc: totalLoc,
    public_functions: totalPublicFunctions,
    max_nesting_depth: maxNesting,
    avg_function_length: avgFunctionLength,
  };
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(metrics: ModuleMetrics[]): string {
  const lines: string[] = [
    "## Code Metrics",
    "",
    "| Module | .kt Files | Test Files | LOC | Public Fns | Max Nesting | Avg Fn Length |",
    "|--------|-----------|------------|-----|------------|-------------|---------------|",
  ];

  let totalKt = 0;
  let totalTest = 0;
  let totalLoc = 0;
  let totalFns = 0;

  for (const m of metrics) {
    lines.push(
      `| ${m.module} | ${m.kt_files} | ${m.test_kt_files} | ${m.loc} | ${m.public_functions} | ${m.max_nesting_depth} | ${m.avg_function_length} |`,
    );
    totalKt += m.kt_files;
    totalTest += m.test_kt_files;
    totalLoc += m.loc;
    totalFns += m.public_functions;
  }

  lines.push(
    `| **Total** | **${totalKt}** | **${totalTest}** | **${totalLoc}** | **${totalFns}** | - | - |`,
  );

  return lines.join("\n");
}

// ── Audit log persistence ────────────────────────────────────────────────────

function persistMetrics(projectRoot: string, metrics: ModuleMetrics[]): void {
  const auditDir = path.join(projectRoot, ".androidcommondoc");
  mkdirSync(auditDir, { recursive: true });

  const logPath = path.join(auditDir, "audit-log.jsonl");
  const entry = {
    ts: new Date().toISOString(),
    event: "code_metrics",
    data: {
      modules: metrics.length,
      total_kt_files: metrics.reduce((s, m) => s + m.kt_files, 0),
      total_test_files: metrics.reduce((s, m) => s + m.test_kt_files, 0),
      total_loc: metrics.reduce((s, m) => s + m.loc, 0),
      total_public_functions: metrics.reduce((s, m) => s + m.public_functions, 0),
      per_module: metrics,
    },
  };

  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerCodeMetricsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "code-metrics",
    "Compute code metrics per module: .kt file counts, LOC, test coverage ratio, public functions, nesting depth, and average function length.",
    {
      project_root: z.string().describe("Absolute path to the project root"),
      modules: z
        .array(z.string())
        .optional()
        .describe("Specific module paths to analyze (default: auto-detect from settings.gradle.kts)"),
      format: z
        .enum(["json", "markdown", "both"])
        .default("both")
        .describe("Output format (default: both)"),
      persist: z
        .boolean()
        .default(true)
        .describe("Write code_metrics event to audit-log.jsonl (default: true)"),
    },
    async ({ project_root, modules, format = "both", persist = true }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "code-metrics");
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      let moduleList: string[];

      if (modules && modules.length > 0) {
        moduleList = modules;
      } else {
        // Try to auto-detect modules from settings.gradle.kts
        const settingsPath = path.join(project_root, "settings.gradle.kts");
        try {
          const parsed = await parseSettingsModules(settingsPath);
          moduleList = parsed.map((m) => m.replace(/^:/, "").replace(/:/g, "/"));
        } catch {
          // Fallback: treat project root as a single module
          moduleList = ["."];
        }
      }

      const metrics: ModuleMetrics[] = [];

      for (const mod of moduleList) {
        const moduleDir =
          mod === "." ? project_root : path.join(project_root, mod);

        let stat;
        try {
          stat = statSync(moduleDir);
        } catch {
          continue; // module directory doesn't exist
        }

        if (!stat.isDirectory()) continue;

        const m = computeModuleMetrics(moduleDir, mod);
        // Only include modules that have at least one .kt file
        if (m.kt_files > 0 || m.test_kt_files > 0) {
          metrics.push(m);
        }
      }

      if (metrics.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No Kotlin files found in any module. Ensure project_root points to a Kotlin project.",
            },
          ],
        };
      }

      if (persist) {
        try {
          persistMetrics(project_root, metrics);
          logger.info(`code-metrics: persisted metrics for ${metrics.length} modules`);
        } catch (err) {
          logger.error(`code-metrics: failed to persist: ${err}`);
        }
      }

      const parts: string[] = [];

      if (format === "json" || format === "both") {
        parts.push("```json\n" + JSON.stringify({ modules: metrics }, null, 2) + "\n```");
      }
      if (format === "markdown" || format === "both") {
        parts.push(renderMarkdown(metrics));
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
      };
    },
  );
}
