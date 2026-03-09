/**
 * MCP tool: script-parity
 *
 * Validates that scripts/sh/ and scripts/ps1/ directories have matching
 * script basenames. This is a direct implementation (not a script wrapper)
 * that compares the two directories and reports mismatches.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import type { ValidationResult, ValidationDetail } from "../types/results.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Get script basenames from a directory, excluding lib/ subdirectory.
 */
async function getScriptNames(
  dirPath: string,
  extension: string,
): Promise<Set<string>> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const scripts = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name.replace(extension, ""));
    return new Set(scripts);
  } catch {
    return new Set();
  }
}

export function registerScriptParityTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "script-parity",
    {
      title: "Script Parity",
      description:
        "Validate that scripts/sh/ and scripts/ps1/ directories have matching script basenames",
      inputSchema: z.object({
        projectRoot: z
          .string()
          .optional()
          .describe(
            "Path to AndroidCommonDoc root (defaults to ANDROID_COMMON_DOC env var)",
          ),
      }),
    },
    async ({ projectRoot }) => {
      const rateLimitResponse = checkRateLimit(limiter, "script-parity");
      if (rateLimitResponse) return rateLimitResponse;

      const root = projectRoot ?? getToolkitRoot();
      const startTime = Date.now();

      try {
        const shDir = path.join(root, "scripts", "sh");
        const ps1Dir = path.join(root, "scripts", "ps1");

        const shScripts = await getScriptNames(shDir, ".sh");
        const ps1Scripts = await getScriptNames(ps1Dir, ".ps1");

        const details: ValidationDetail[] = [];
        let failCount = 0;

        // Check for SH scripts without PS1 counterpart
        for (const name of shScripts) {
          if (ps1Scripts.has(name)) {
            details.push({
              check: `parity-${name}`,
              status: "PASS",
              message: `${name}: both .sh and .ps1 exist`,
            });
          } else {
            failCount++;
            details.push({
              check: `parity-${name}`,
              status: "FAIL",
              message: `${name}: .sh exists but .ps1 missing`,
              file: `scripts/sh/${name}.sh`,
            });
          }
        }

        // Check for PS1 scripts without SH counterpart
        for (const name of ps1Scripts) {
          if (!shScripts.has(name)) {
            failCount++;
            details.push({
              check: `parity-${name}`,
              status: "FAIL",
              message: `${name}: .ps1 exists but .sh missing`,
              file: `scripts/ps1/${name}.ps1`,
            });
          }
        }

        const durationMs = Date.now() - startTime;
        const totalPairs = new Set([...shScripts, ...ps1Scripts]).size;

        const result: ValidationResult = {
          status: failCount > 0 ? "FAIL" : "PASS",
          summary: `${totalPairs - failCount}/${totalPairs} scripts have matching counterparts`,
          details,
          duration_ms: durationMs,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error(`script-parity failed: ${String(error)}`);

        const errorResult: ValidationResult = {
          status: "ERROR",
          summary: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
          details: [],
          duration_ms: durationMs,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(errorResult, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );
}
