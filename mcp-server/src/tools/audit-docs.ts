/**
 * MCP tool: audit-docs
 *
 * Unified documentation audit — structure, coherence, upstream validation.
 * Three waves: (1) structure, (2) coherence, (3) upstream (opt-in).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditDocs, type AuditResult } from "../monitoring/audit-docs.js";
import { logger } from "../utils/logger.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";

/**
 * Register the audit-docs MCP tool.
 */
export function registerAuditDocsTool(server: McpServer, rateLimiter: RateLimiter): void {
  server.tool(
    "audit-docs",
    "Unified documentation audit — validates structure (sizes, frontmatter), coherence (links, refs, hub tables), and upstream content (API assertions, deprecation scan). Waves 1+2 are local ($0). Wave 3 requires --with-upstream.",
    {
      projectRoot: z
        .string()
        .optional()
        .describe("Project root directory (defaults to cwd)"),
      layer: z
        .enum(["L0", "L1", "L2"])
        .optional()
        .default("L0")
        .describe("Project layer"),
      waves: z
        .string()
        .optional()
        .describe("Comma-separated wave numbers to run (default: 1,2)"),
      withUpstream: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include Wave 3 upstream validation (requires network)"),
      cacheTtlHours: z
        .number()
        .optional()
        .describe("Cache TTL for upstream content in hours (default: 24)"),
    },
    async ({ projectRoot, layer, waves, withUpstream, cacheTtlHours }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "audit-docs");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const root = projectRoot ?? process.cwd();

        const waveList = waves
          ? waves.split(",").map((w) => parseInt(w.trim(), 10)).filter((w) => !isNaN(w))
          : undefined;

        const result = await auditDocs({
          projectRoot: root,
          layer,
          waves: waveList,
          withUpstream,
          cacheTtlHours,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.warn(`audit-docs error: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: message,
                timestamp: new Date().toISOString(),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
