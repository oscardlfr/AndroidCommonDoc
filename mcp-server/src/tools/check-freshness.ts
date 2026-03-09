/**
 * MCP tool: check-doc-freshness (backward-compatible alias)
 *
 * This tool is a backward-compatible alias for monitor-sources with tier="all".
 * It exists to support existing agent prompts and documentation that reference
 * the "check-doc-freshness" tool name.
 *
 * Previously: Full implementation wrapping the check-doc-freshness.sh script.
 * Now: Thin wrapper delegating to the monitor-sources monitoring engine.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { scanDirectory } from "../registry/scanner.js";
import { detectChanges } from "../monitoring/change-detector.js";
import {
  loadReviewState,
  filterNewFindings,
  getStaleDeferrals,
} from "../monitoring/review-state.js";
import { generateReport } from "../monitoring/report-generator.js";
import { getToolkitRoot, getDocsDir } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Register the check-doc-freshness tool as a backward-compatible alias
 * for monitor-sources with tier="all".
 *
 * This ensures existing agent prompts referencing "check-doc-freshness"
 * continue to work, while the actual monitoring logic lives in the
 * monitor-sources engine.
 */
export function registerCheckFreshnessTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "check-doc-freshness",
    {
      title: "Check Doc Freshness (Alias)",
      description:
        "Backward-compatible alias for monitor-sources. Checks upstream documentation sources for version changes, deprecations, and content updates. Delegates to monitor-sources with tier=all.",
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
      const rateLimitResponse = checkRateLimit(limiter, "check-doc-freshness");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Resolve toolkit root
        const root = projectRoot ?? getToolkitRoot();
        const docsDir = projectRoot
          ? path.join(root, "docs")
          : getDocsDir();

        // Scan docs directory for registry entries
        const allEntries = await scanDirectory(docsDir, "L0");

        // Filter to entries with monitor_urls
        const monitorableEntries = allEntries.filter(
          (e) => e.metadata.monitor_urls && e.metadata.monitor_urls.length > 0,
        );

        // Run change detection (tier=all, no filtering)
        const manifestPath = path.join(root, "versions-manifest.json");
        const changeReport = await detectChanges(monitorableEntries, manifestPath);

        // Load review state
        const reviewStatePath = path.join(
          root,
          ".androidcommondoc",
          "monitoring-state.json",
        );
        const reviewState = await loadReviewState(reviewStatePath);

        // Filter findings based on review state
        const staleDeferrals = getStaleDeferrals(
          changeReport.findings,
          reviewState,
        );
        const newFindings = filterNewFindings(changeReport.findings, reviewState);

        // Generate structured report (same as monitor-sources)
        const report = generateReport(
          changeReport,
          newFindings,
          "all",
          staleDeferrals,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`check-doc-freshness failed: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
