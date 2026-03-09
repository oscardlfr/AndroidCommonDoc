/**
 * MCP tool: l0-diff
 *
 * Compares the L0 toolkit's skills/registry.json against a downstream
 * project's .androidcommondoc/l0-manifest.json to identify new, updated,
 * removed, and unchanged entries. Helps agents understand what needs syncing.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { getToolkitRoot } from "../utils/paths.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface RegistryEntry {
  name: string;
  hash: string;
  type: string;
  [key: string]: unknown;
}

interface ManifestEntry {
  name: string;
  hash: string;
  type: string;
}

interface L0Manifest {
  version: number;
  synced: string;
  entries: ManifestEntry[];
}

interface DiffEntry {
  name: string;
  status: "new" | "updated" | "removed" | "unchanged";
  type: string;
  registry_hash?: string;
  manifest_hash?: string;
}

interface DiffResult {
  toolkit_root: string;
  project_root: string;
  registry_count: number;
  manifest_count: number;
  new_count: number;
  updated_count: number;
  removed_count: number;
  unchanged_count: number;
  entries: DiffEntry[];
}

// ── Diff computation ────────────────────────────────────────────────────────

function computeDiff(
  registryEntries: RegistryEntry[],
  manifestEntries: ManifestEntry[],
): DiffEntry[] {
  const manifestMap = new Map<string, ManifestEntry>();
  for (const entry of manifestEntries) {
    manifestMap.set(entry.name, entry);
  }

  const registryMap = new Map<string, RegistryEntry>();
  for (const entry of registryEntries) {
    registryMap.set(entry.name, entry);
  }

  const result: DiffEntry[] = [];

  // Check registry entries against manifest
  for (const reg of registryEntries) {
    const man = manifestMap.get(reg.name);
    if (!man) {
      result.push({
        name: reg.name,
        status: "new",
        type: reg.type,
        registry_hash: reg.hash,
      });
    } else if (reg.hash !== man.hash) {
      result.push({
        name: reg.name,
        status: "updated",
        type: reg.type,
        registry_hash: reg.hash,
        manifest_hash: man.hash,
      });
    } else {
      result.push({
        name: reg.name,
        status: "unchanged",
        type: reg.type,
      });
    }
  }

  // Check for removed entries (in manifest but not in registry)
  for (const man of manifestEntries) {
    if (!registryMap.has(man.name)) {
      result.push({
        name: man.name,
        status: "removed",
        type: man.type,
        manifest_hash: man.hash,
      });
    }
  }

  // Sort: new first, then updated, removed, unchanged
  const statusOrder: Record<string, number> = {
    new: 0,
    updated: 1,
    removed: 2,
    unchanged: 3,
  };
  result.sort(
    (a, b) =>
      (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4) ||
      a.name.localeCompare(b.name),
  );

  return result;
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(diff: DiffResult): string {
  const statusIcon: Record<string, string> = {
    new: "+",
    updated: "~",
    removed: "-",
    unchanged: "=",
  };

  const lines: string[] = [
    "## L0 Diff Report",
    "",
    `**Registry entries:** ${diff.registry_count} | **Manifest entries:** ${diff.manifest_count}`,
    `**New:** ${diff.new_count} | **Updated:** ${diff.updated_count} | **Removed:** ${diff.removed_count} | **Unchanged:** ${diff.unchanged_count}`,
    "",
  ];

  // Only show actionable entries (new, updated, removed) in the table
  const actionable = diff.entries.filter((e) => e.status !== "unchanged");

  if (actionable.length === 0) {
    lines.push("All entries are in sync. No action needed.");
  } else {
    lines.push("| Status | Name | Type | Details |");
    lines.push("|--------|------|------|---------|");
    for (const e of actionable) {
      const icon = statusIcon[e.status] ?? "?";
      let details = "";
      if (e.status === "updated") {
        details = `hash mismatch`;
      } else if (e.status === "new") {
        details = `not in manifest`;
      } else if (e.status === "removed") {
        details = `not in registry`;
      }
      lines.push(`| ${icon} ${e.status} | ${e.name} | ${e.type} | ${details} |`);
    }
  }

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerL0DiffTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "l0-diff",
    "Compare L0 toolkit registry against a downstream project manifest to identify new, updated, and removed entries.",
    {
      project_root: z
        .string()
        .describe(
          "Absolute path to the downstream project root (must have .androidcommondoc/l0-manifest.json)",
        ),
      toolkit_root: z
        .string()
        .optional()
        .describe(
          "Absolute path to the L0 toolkit root. Defaults to ANDROID_COMMON_DOC or auto-detected.",
        ),
      format: z.enum(["json", "markdown", "both"]).default("both"),
    },
    async ({ project_root, toolkit_root, format = "both" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "l0-diff");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const resolvedToolkit = toolkit_root ?? getToolkitRoot();

        // Read registry.json
        const registryPath = path.join(
          resolvedToolkit,
          "skills",
          "registry.json",
        );
        let registryData: { entries: RegistryEntry[] };
        try {
          const raw = await readFile(registryPath, "utf-8");
          registryData = JSON.parse(raw);
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: `Could not read registry.json at ${registryPath}: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Read l0-manifest.json
        const manifestPath = path.join(
          project_root,
          ".androidcommondoc",
          "l0-manifest.json",
        );
        let manifestData: L0Manifest;
        try {
          const raw = await readFile(manifestPath, "utf-8");
          manifestData = JSON.parse(raw);
        } catch (err) {
          // Manifest missing or unreadable — treat all registry entries as "new"
          logger.warn(
            `l0-diff: manifest not found at ${manifestPath}, treating all entries as new`,
          );
          const entries = computeDiff(registryData.entries, []);
          const diff: DiffResult = {
            toolkit_root: resolvedToolkit,
            project_root,
            registry_count: registryData.entries.length,
            manifest_count: 0,
            new_count: entries.filter((e) => e.status === "new").length,
            updated_count: 0,
            removed_count: 0,
            unchanged_count: 0,
            entries,
          };

          const parts: string[] = [];
          if (format === "json" || format === "both") {
            parts.push(JSON.stringify(diff, null, 2));
          }
          if (format === "markdown" || format === "both") {
            parts.push(renderMarkdown(diff));
          }

          return {
            content: [
              { type: "text" as const, text: parts.join("\n\n---\n\n") },
            ],
          };
        }

        // Compute diff
        const entries = computeDiff(
          registryData.entries,
          manifestData.entries,
        );

        const diff: DiffResult = {
          toolkit_root: resolvedToolkit,
          project_root,
          registry_count: registryData.entries.length,
          manifest_count: manifestData.entries.length,
          new_count: entries.filter((e) => e.status === "new").length,
          updated_count: entries.filter((e) => e.status === "updated").length,
          removed_count: entries.filter((e) => e.status === "removed").length,
          unchanged_count: entries.filter((e) => e.status === "unchanged")
            .length,
          entries,
        };

        const parts: string[] = [];
        if (format === "json" || format === "both") {
          parts.push(JSON.stringify(diff, null, 2));
        }
        if (format === "markdown" || format === "both") {
          parts.push(renderMarkdown(diff));
        }

        return {
          content: [
            { type: "text" as const, text: parts.join("\n\n---\n\n") },
          ],
        };
      } catch (error) {
        logger.error(`l0-diff error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `l0-diff failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
