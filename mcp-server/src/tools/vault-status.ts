/**
 * MCP tool: vault-status
 *
 * Read-only health check for the Obsidian knowledge vault.
 * Returns configuration state, file counts, orphan detection,
 * project list, and per-layer file breakdown without modifying the vault.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getVaultStatus } from "../vault/sync-engine.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Register the vault-status MCP tool.
 *
 * Provides a read-only vault health check that returns configuration,
 * file counts, orphan count, project list, and per-layer breakdown (L0/L1/L2).
 */
export function registerVaultStatusTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "vault-status",
    {
      title: "Vault Status",
      description:
        "Check the health and configuration of the Obsidian knowledge vault. Returns per-layer breakdown (L0/L1/L2), file counts, and orphan detection. Read-only, does not modify the vault.",
      inputSchema: z.object({}),
    },
    async () => {
      const rateLimitResponse = checkRateLimit(limiter, "vault-status");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const status = await getVaultStatus();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "OK",
                configured: status.configured,
                vault_path: status.vaultPath,
                last_sync: status.lastSync,
                file_count: status.fileCount,
                orphan_count: status.orphanCount,
                projects: status.projects,
                layers: status.layers,
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`vault-status failed: ${errorMessage}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: errorMessage }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
