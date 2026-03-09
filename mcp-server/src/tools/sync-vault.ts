/**
 * MCP tool: sync-vault
 *
 * Exposes vault sync operations to AI agents. Supports three modes:
 * - init: Create vault with .obsidian config and initial sync
 * - sync: Incremental sync of documentation to the vault
 * - clean: Sync and remove orphaned files no longer in source repos
 *
 * Supports optional project and layer filtering for scoped operations.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  syncVault,
  initVault,
  cleanOrphans,
  getVaultStatus,
} from "../vault/sync-engine.js";
import type { SyncResult, VaultConfig } from "../vault/types.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Register the sync-vault MCP tool.
 *
 * Provides vault sync operations with init/sync/clean modes.
 * Accepts optional project_filter and layer_filter for scoped syncs.
 * Returns structured JSON with the SyncResult, layer breakdown, and a human-readable message.
 */
export function registerSyncVaultTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "sync-vault",
    {
      title: "Sync Obsidian Vault",
      description:
        "Sync KMP ecosystem documentation to a unified Obsidian vault. Modes: init (create vault with .obsidian config), sync (update existing vault), clean (remove orphaned files). Supports project and layer filtering.",
      inputSchema: z.object({
        mode: z
          .enum(["init", "sync", "clean"])
          .default("sync")
          .describe(
            "Operation mode: init (first-time setup), sync (incremental update), clean (remove orphans)",
          ),
        vault_path: z
          .string()
          .optional()
          .describe("Override vault path from config"),
        project_filter: z
          .string()
          .optional()
          .describe("Only sync a specific project by name"),
        layer_filter: z
          .enum(["L0", "L1", "L2"])
          .optional()
          .describe("Only sync a specific layer"),
      }),
    },
    async ({ mode, vault_path, project_filter, layer_filter }) => {
      const rateLimitResponse = checkRateLimit(limiter, "sync-vault");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Build configOverride from optional parameters
        const configOverride: Partial<VaultConfig> | undefined = vault_path
          ? { vaultPath: vault_path }
          : undefined;

        // Dispatch to the appropriate sync engine function
        let result: SyncResult;
        switch (mode) {
          case "init":
            result = await initVault(configOverride);
            break;
          case "clean":
            result = await cleanOrphans(configOverride);
            break;
          case "sync":
          default:
            result = await syncVault(configOverride);
            break;
        }

        // Collect per-layer breakdown from vault status
        const status = await getVaultStatus(configOverride);

        const message = `Vault ${mode} complete: ${result.written} written, ${result.unchanged} unchanged, ${result.removed} removed`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                mode,
                result,
                layers: status.layers,
                project_filter: project_filter ?? null,
                layer_filter: layer_filter ?? null,
                message,
              }),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`sync-vault failed: ${errorMessage}`);
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
