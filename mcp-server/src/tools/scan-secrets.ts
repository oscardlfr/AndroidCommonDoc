/**
 * MCP tool: scan-secrets
 *
 * Wraps the scan-secrets.sh script to run TruffleHog on a project directory.
 * Returns structured findings with PASS/FAIL/SKIPPED status based on severity.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runScript } from "../utils/script-runner.js";
import { getToolkitRoot } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface SecretFinding {
  detector?: string;
  severity?: string;
  raw?: string;
  source_metadata?: unknown;
  [key: string]: unknown;
}

interface ScanResult {
  status: "PASS" | "FAIL" | "SKIPPED";
  findings: SecretFinding[];
  summary: string;
}

// ── Output parser ─────────────────────────────────────────────────────────────

function parseOutput(stdout: string): ScanResult {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      status: "PASS",
      findings: [],
      summary: "No secrets detected.",
    };
  }

  // Check first line for SKIPPED sentinel
  let firstParsed: unknown;
  try {
    firstParsed = JSON.parse(lines[0]);
  } catch {
    // not JSON — treat as no output
    return {
      status: "PASS",
      findings: [],
      summary: "No secrets detected.",
    };
  }

  const firstObj = firstParsed as Record<string, unknown>;
  if (firstObj.status === "SKIPPED") {
    return {
      status: "SKIPPED",
      findings: [],
      summary: String(firstObj.reason ?? "trufflehog not installed"),
    };
  }

  // Parse all JSONL lines as findings
  const findings: SecretFinding[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as SecretFinding;
      findings.push(obj);
    } catch {
      // skip malformed lines
    }
  }

  // Determine status: any CRITICAL or HIGH severity → FAIL
  const hasCriticalOrHigh = findings.some((f) => {
    const sev = String(f.severity ?? "").toUpperCase();
    return sev.includes("CRITICAL") || sev.includes("HIGH");
  });

  const status: "PASS" | "FAIL" = hasCriticalOrHigh ? "FAIL" : "PASS";
  const summary =
    findings.length === 0
      ? "No secrets detected."
      : `${findings.length} finding(s) detected${hasCriticalOrHigh ? " — CRITICAL or HIGH severity present" : " — no CRITICAL or HIGH severity"}.`;

  return { status, findings, summary };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerScanSecretsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "scan-secrets",
    "Run TruffleHog on the project root to detect committed secrets. CRITICAL/HIGH findings are blockers. Falls back gracefully if trufflehog is not installed (returns SKIPPED status).",
    {
      projectRoot: z
        .string()
        .optional()
        .describe("Absolute path to the project root (defaults to cwd)"),
    },
    async ({ projectRoot }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "scan-secrets");
      if (rateLimitResponse) return rateLimitResponse;

      const rootDir = getToolkitRoot();
      const scanTarget = projectRoot ?? process.cwd();

      try {
        const result = await runScript(
          "scan-secrets",
          [scanTarget],
          rootDir,
          60000,
        );

        const parsed = parseOutput(result.stdout);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(parsed, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`scan-secrets failed: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                findings: [],
                summary: `scan-secrets failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
