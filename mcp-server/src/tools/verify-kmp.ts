/**
 * MCP tool: verify-kmp-packages
 *
 * Wraps the verify-kmp-packages.sh script to validate KMP package
 * organization and detect forbidden imports in commonMain. Returns
 * structured ValidationResult JSON.
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
 * Parse verify-kmp-packages.sh output into a ValidationResult.
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

      const fileMatch = message.match(/(\S+\.\w+)/);
      details.push({
        check: "kmp-packages",
        status,
        message,
        ...(fileMatch ? { file: fileMatch[1] } : {}),
      });
    }
  }

  if (details.length === 0 && stdout.trim().length > 0) {
    details.push({
      check: "kmp-packages",
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

export function registerVerifyKmpTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "verify-kmp-packages",
    {
      title: "Verify KMP Packages",
      description:
        "Validate KMP package organization and detect forbidden imports in commonMain",
      inputSchema: z.object({
        projectRoot: z
          .string()
          .describe("Path to the target KMP project root"),
        modulePath: z
          .string()
          .optional()
          .describe("Specific module path to check (e.g., 'core/data')"),
        strict: z
          .boolean()
          .optional()
          .default(false)
          .describe("Fail on warnings in addition to errors"),
      }),
    },
    async ({ projectRoot, modulePath, strict }) => {
      const rateLimitResponse = checkRateLimit(limiter, "verify-kmp-packages");
      if (rateLimitResponse) return rateLimitResponse;

      const toolkitRoot = getToolkitRoot();
      const startTime = Date.now();

      const args = ["--project-root", projectRoot];
      if (modulePath) args.push("--module-path", modulePath);
      if (strict) args.push("--strict");

      try {
        const result = await runScript(
          "verify-kmp-packages",
          args,
          toolkitRoot,
        );
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
        logger.error(`verify-kmp-packages failed: ${String(error)}`);

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
