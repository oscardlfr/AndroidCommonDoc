/**
 * MCP tool: monitor-sources
 *
 * Checks upstream documentation sources for version changes, deprecations,
 * and content updates. Supports tiered monitoring (1=critical, 2=important,
 * 3=informational) with review-aware filtering to suppress previously
 * reviewed findings.
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
import type { RegistryEntry, MonitoringTier } from "../registry/types.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Register the monitor-sources MCP tool.
 *
 * Provides on-demand source monitoring with tiered filtering and
 * review-aware output. Returns a structured JSON report with findings,
 * severity counts, and stale deferral warnings.
 */
export function registerMonitorSourcesTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "monitor-sources",
    {
      title: "Monitor Documentation Sources",
      description:
        "Check upstream documentation sources for version changes, deprecations, and content updates. Supports tiered monitoring (1=critical, 2=important, 3=informational).",
      inputSchema: z.object({
        tier: z
          .union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal("all"),
          ])
          .optional()
          .default("all")
          .describe("Monitoring tier filter (1=critical, 2=important, 3=informational, all=everything)"),
        include_reviewed: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include previously reviewed findings in output"),
        projectRoot: z
          .string()
          .optional()
          .describe("Path to project root (defaults to AndroidCommonDoc toolkit root)"),
        layer: z
          .enum(["L0", "L1", "L2"])
          .optional()
          .default("L0")
          .describe("Project layer (L0=toolkit, L1=shared libs, L2=app)"),
      }),
    },
    async ({ tier, include_reviewed, projectRoot, layer }) => {
      const rateLimitResponse = checkRateLimit(limiter, "monitor-sources");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Resolve toolkit root
        const root = projectRoot ?? getToolkitRoot();
        const docsDir = projectRoot
          ? path.join(root, "docs")
          : getDocsDir();

        // Scan docs directory for registry entries
        const allEntries = await scanDirectory(docsDir, layer);

        // Filter to entries with monitor_urls
        let monitorableEntries = allEntries.filter(
          (e) => e.metadata.monitor_urls && e.metadata.monitor_urls.length > 0,
        );

        // Apply tier filter if not "all"
        if (tier !== "all") {
          monitorableEntries = filterByTier(monitorableEntries, tier as MonitoringTier);
        }

        // Run change detection
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
        let newFindings = changeReport.findings;
        let staleDeferrals: string[] = [];

        if (!include_reviewed) {
          staleDeferrals = getStaleDeferrals(
            changeReport.findings,
            reviewState,
          );
          newFindings = filterNewFindings(changeReport.findings, reviewState);
        }

        // Generate structured report
        const report = generateReport(
          changeReport,
          newFindings,
          tier as MonitoringTier | "all",
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
        logger.error(`monitor-sources failed: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Monitoring failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * Filter registry entries to only include sources matching the given tier.
 *
 * Creates new entries with monitor_urls filtered to the specified tier,
 * excluding entries that have no matching URLs after filtering.
 */
function filterByTier(
  entries: RegistryEntry[],
  tier: MonitoringTier,
): RegistryEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      metadata: {
        ...entry.metadata,
        monitor_urls: entry.metadata.monitor_urls!.filter(
          (mu) => mu.tier === tier,
        ),
      },
    }))
    .filter((entry) => entry.metadata.monitor_urls!.length > 0);
}
