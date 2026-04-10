/**
 * MCP tool: search-patterns
 *
 * Semantic pattern search backed by a Chroma vector database.
 * Invokes Python scripts directly via execFile (not script-runner — Python, not bash).
 * Falls back gracefully when chromadb is not installed or the DB is not indexed.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

interface PatternResult {
  slug: string;
  score: number;
  excerpt: string;
  path: string;
  category: string;
}

interface SearchResponse {
  status: "OK" | "SKIPPED" | "NOT_INDEXED" | "ERROR";
  query: string;
  total: number;
  results: PatternResult[];
  hint?: string;
}

// ── Python invoker ────────────────────────────────────────────────────────────

async function runPython(
  scriptPath: string,
  args: string[],
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    "python3",
    [scriptPath, ...args],
    {
      timeout: timeoutMs,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return { stdout, stderr };
}

// ── Index builder ─────────────────────────────────────────────────────────────

async function rebuildIndex(
  indexScript: string,
  projectRoot: string,
): Promise<{ indexed: number; dbPath: string } | { status: string; reason: string }> {
  try {
    const { stdout } = await runPython(
      indexScript,
      ["--project-root", projectRoot, "--force-rebuild"],
      120000,
    );
    return JSON.parse(stdout.trim()) as { indexed: number; dbPath: string };
  } catch (error) {
    return {
      status: "ERROR",
      reason: `Index rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── Query runner ──────────────────────────────────────────────────────────────

async function queryPatterns(
  queryScript: string,
  query: string,
  n: number,
  dbPath: string,
): Promise<PatternResult[] | { status: string; hint?: string; reason?: string }> {
  try {
    const { stdout } = await runPython(
      queryScript,
      ["--query", query, "--n", String(n), "--db-path", dbPath],
      30000,
    );

    const trimmed = stdout.trim();
    if (!trimmed) return [];

    const parsed = JSON.parse(trimmed) as
      | PatternResult[]
      | { status: string; hint?: string; reason?: string };

    return parsed;
  } catch (error) {
    return {
      status: "ERROR",
      reason: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerSearchPatternsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "search-patterns",
    "Semantic search over KMP pattern documentation using a Chroma vector database. Returns ranked pattern docs matching the query. Requires chromadb + sentence-transformers; returns SKIPPED if not installed.",
    {
      query: z.string().describe("Natural language search query"),
      n: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(5)
        .describe("Number of results to return (default: 5)"),
      projectRoot: z
        .string()
        .optional()
        .describe("Project root containing docs/ and .chroma/ (defaults to toolkit root)"),
      rebuild: z
        .boolean()
        .default(false)
        .describe("Force rebuild of the Chroma index before querying"),
    },
    async ({ query, n = 5, projectRoot, rebuild = false }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "search-patterns");
      if (rateLimitResponse) return rateLimitResponse;

      const toolkitRoot = getToolkitRoot();
      const resolvedRoot = projectRoot ?? toolkitRoot;
      const dbPath = path.join(resolvedRoot, ".chroma");

      const scriptsDir = path.join(toolkitRoot, "scripts", "py");
      const indexScript = path.join(scriptsDir, "index-patterns-chroma.py");
      const queryScript = path.join(scriptsDir, "search-patterns-chroma.py");

      try {
        // Optional index rebuild
        if (rebuild) {
          logger.info("search-patterns: rebuilding Chroma index...");
          const rebuildResult = await rebuildIndex(indexScript, resolvedRoot);

          if ("status" in rebuildResult && rebuildResult.status === "SKIPPED") {
            const response: SearchResponse = {
              status: "SKIPPED",
              query,
              total: 0,
              results: [],
              hint: (rebuildResult as { reason: string }).reason,
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
            };
          }

          if ("status" in rebuildResult && rebuildResult.status === "ERROR") {
            const response: SearchResponse = {
              status: "ERROR",
              query,
              total: 0,
              results: [],
              hint: (rebuildResult as { reason: string }).reason,
            };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
              isError: true,
            };
          }

          logger.info(`search-patterns: indexed ${(rebuildResult as { indexed: number }).indexed} documents`);
        }

        // Run query
        const queryResult = await queryPatterns(queryScript, query, n, dbPath);

        // Handle non-array responses (SKIPPED, NOT_INDEXED, ERROR)
        if (!Array.isArray(queryResult)) {
          const statusObj = queryResult as { status: string; hint?: string; reason?: string };
          const status = statusObj.status as SearchResponse["status"];

          const response: SearchResponse = {
            status,
            query,
            total: 0,
            results: [],
            hint: statusObj.hint ?? statusObj.reason,
          };

          return {
            content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
          };
        }

        // Success path
        const response: SearchResponse = {
          status: "OK",
          query,
          total: queryResult.length,
          results: queryResult,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        logger.error(`search-patterns failed: ${String(error)}`);
        const response: SearchResponse = {
          status: "ERROR",
          query,
          total: 0,
          results: [],
          hint: `search-patterns failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
