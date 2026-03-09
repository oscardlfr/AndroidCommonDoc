/**
 * MCP tool: check-version-sync
 *
 * Wraps the check-version-sync.sh script to check version synchronization
 * across the version catalog and consumer projects. Returns structured
 * ValidationResult JSON.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runScript } from "../utils/script-runner.js";
import { getToolkitRoot } from "../utils/paths.js";
import type { ValidationResult, ValidationDetail } from "../types/results.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Parse check-version-sync.sh output into a ValidationResult.
 */
function parseOutput(
  stdout: string,
  _stderr: string,
  exitCode: number,
  durationMs: number,
): ValidationResult {
  if (exitCode === 124) {
    return {
      status: "TIMEOUT",
      summary: "Script execution timed out",
      details: [],
      duration_ms: durationMs,
    };
  }

  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const details: ValidationDetail[] = [];
  let passCount = 0;
  let failCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(PASS|FAIL|WARN|OK|ERROR):\s*(.+)/i);
    if (match) {
      const rawStatus = match[1].toUpperCase();
      const message = match[2];
      const status =
        rawStatus === "OK"
          ? "PASS"
          : rawStatus === "ERROR"
            ? "FAIL"
            : (rawStatus as "PASS" | "FAIL" | "WARN");

      if (status === "PASS") passCount++;
      if (status === "FAIL") failCount++;

      details.push({
        check: "version-sync",
        status,
        message,
      });
    }
  }

  if (details.length === 0 && stdout.trim().length > 0) {
    details.push({
      check: "version-sync",
      status: exitCode === 0 ? "PASS" : "FAIL",
      message: stdout.trim().substring(0, 500),
    });
    if (exitCode === 0) passCount++;
    else failCount++;
  }

  return {
    status: exitCode !== 0 || failCount > 0 ? "FAIL" : "PASS",
    summary: `${passCount} passed, ${failCount} failed out of ${details.length} checks`,
    details,
    duration_ms: durationMs,
  };
}

export function registerCheckVersionSyncTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "check-version-sync",
    {
      title: "Check Version Sync",
      description:
        "Check version synchronization across the version catalog and consumer projects",
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
      const rateLimitResponse = checkRateLimit(limiter, "check-version-sync");
      if (rateLimitResponse) return rateLimitResponse;

      const root = projectRoot ?? getToolkitRoot();
      const startTime = Date.now();

      try {
        const result = await runScript("check-version-sync", [], root);
        const durationMs = Date.now() - startTime;
        const parsed = parseOutput(
          result.stdout,
          result.stderr,
          result.exitCode,
          durationMs,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }],
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error(`check-version-sync failed: ${String(error)}`);

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
