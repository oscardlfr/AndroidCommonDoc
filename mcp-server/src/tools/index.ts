/**
 * Tool registration aggregator.
 *
 * Registers all MCP tools with rate limiting applied. Each tool
 * invocation goes through the shared rate limiter to prevent
 * runaway agent loops.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RateLimiter } from "../utils/rate-limiter.js";
import { registerCheckFreshnessTool } from "./check-freshness.js";
import { registerVerifyKmpTool } from "./verify-kmp.js";
import { registerCheckVersionSyncTool } from "./check-version-sync.js";
import { registerScriptParityTool } from "./script-parity.js";
import { registerSetupCheckTool } from "./setup-check.js";
import { registerValidateAllTool } from "./validate-all.js";
import { registerFindPatternTool } from "./find-pattern.js";
import { registerGenerateDetektRulesTool } from "./generate-detekt-rules.js";
import { registerIngestContentTool } from "./ingest-content.js";
import { registerMonitorSourcesTool } from "./monitor-sources.js";
import { registerSyncVaultTool } from "./sync-vault.js";
import { registerVaultStatusTool } from "./vault-status.js";
import { registerValidateDocStructureTool } from "./validate-doc-structure.js";
import { registerValidateSkillsTool } from "./validate-skills.js";
import { registerValidateClaudeMdTool } from "./validate-claude-md.js";
import { registerValidateVaultTool } from "./validate-vault.js";
import { registerValidateAgentsTool } from "./validate-agents.js";
import { registerAuditReport } from "./audit-report.js";
import { registerModuleHealthTool } from "./module-health.js";
import { registerDependencyGraphTool } from "./dependency-graph.js";
import { registerL0DiffTool } from "./l0-diff.js";
import { registerPatternCoverageTool } from "./pattern-coverage.js";
import { registerUnusedResourcesTool } from "./unused-resources.js";
import { registerApiSurfaceDiffTool } from "./api-surface-diff.js";
import { registerMigrationValidatorTool } from "./migration-validator.js";
import { registerCodeMetricsTool } from "./code-metrics.js";
import { registerSkillUsageAnalyticsTool } from "./skill-usage-analytics.js";
import { registerGradleConfigLintTool } from "./gradle-config-lint.js";
import { registerStringCompletenessTool } from "./string-completeness.js";
import { registerComposePreviewAuditTool } from "./compose-preview-audit.js";
import { registerProguardValidatorTool } from "./proguard-validator.js";
import { registerAuditDocsTool } from "./audit-docs.js";
import { registerFindingsReport } from "./findings-report.js";
import { registerSearchDocsTool } from "./search-docs.js";
import { registerSuggestDocsTool } from "./suggest-docs.js";
import { registerKdocCoverageTool } from "./kdoc-coverage.js";
import { registerValidateDocUpdateTool } from "./validate-doc-update.js";
import { registerCheckDocPatternsTool } from "./check-doc-patterns.js";
import { registerCheckOutdatedTool } from "./check-outdated.js";
import { logger } from "../utils/logger.js";

/**
 * Shared rate limiter instance: 30 calls per 60 seconds.
 *
 * Generous enough for normal use (agent running a few validation
 * checks), but catches runaway loops that would hammer the server.
 */
const rateLimiter = new RateLimiter(45, 60000);

/**
 * Register all MCP validation tools with rate limiting.
 */
export function registerTools(server: McpServer): void {
  // Register individual validation tools
  registerCheckFreshnessTool(server, rateLimiter);
  registerVerifyKmpTool(server, rateLimiter);
  registerCheckVersionSyncTool(server, rateLimiter);
  registerScriptParityTool(server, rateLimiter);
  registerSetupCheckTool(server, rateLimiter);
  registerValidateAllTool(server, rateLimiter);
  registerFindPatternTool(server, rateLimiter);
  registerGenerateDetektRulesTool(server, rateLimiter);
  registerIngestContentTool(server, rateLimiter);
  registerMonitorSourcesTool(server, rateLimiter);
  registerSyncVaultTool(server, rateLimiter);
  registerVaultStatusTool(server, rateLimiter);
  registerValidateDocStructureTool(server, rateLimiter);
  registerValidateSkillsTool(server, rateLimiter);
  registerValidateClaudeMdTool(server, rateLimiter);
  registerValidateVaultTool(server, rateLimiter);
  registerValidateAgentsTool(server, rateLimiter);
  registerAuditReport(server, rateLimiter);
  registerModuleHealthTool(server, rateLimiter);
  registerDependencyGraphTool(server, rateLimiter);
  registerL0DiffTool(server, rateLimiter);
  registerPatternCoverageTool(server, rateLimiter);
  registerUnusedResourcesTool(server, rateLimiter);
  registerApiSurfaceDiffTool(server, rateLimiter);
  registerMigrationValidatorTool(server, rateLimiter);
  registerCodeMetricsTool(server, rateLimiter);
  registerSkillUsageAnalyticsTool(server, rateLimiter);
  registerGradleConfigLintTool(server, rateLimiter);
  registerStringCompletenessTool(server, rateLimiter);
  registerComposePreviewAuditTool(server, rateLimiter);
  registerProguardValidatorTool(server, rateLimiter);
  registerAuditDocsTool(server, rateLimiter);
  registerFindingsReport(server, rateLimiter);
  registerSearchDocsTool(server, rateLimiter);
  registerSuggestDocsTool(server, rateLimiter);
  registerKdocCoverageTool(server, rateLimiter);
  registerValidateDocUpdateTool(server, rateLimiter);
  registerCheckDocPatternsTool(server, rateLimiter);
  registerCheckOutdatedTool(server, rateLimiter);

  // Register a rate-limit-status utility tool
  server.registerTool(
    "rate-limit-status",
    {
      title: "Rate Limit Status",
      description: "Check the current rate limit status (45 calls per minute)",
      inputSchema: z.object({}),
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              maxCalls: 45,
              windowMs: 60000,
              message: "Rate limiter allows 45 tool calls per 60 seconds",
            }),
          },
        ],
      };
    },
  );

  logger.info("Registered 39 tools with rate limiting (45/min) [check-doc-freshness is alias for monitor-sources]");
}
