/**
 * MCP tool: find-pattern
 *
 * Searches the pattern registry by metadata (scope, sources, targets)
 * and returns matching entries. Supports ecosystem-aware project resolution:
 * - Omit project: L0 patterns only
 * - Specific project: L0 + project-specific entries with layer annotations
 * - "all": Cross-project search with per-project variants
 *
 * Also supports target platform filtering and optional content inclusion.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { scanDirectory } from "../registry/scanner.js";
import { resolveAllPatterns } from "../registry/resolver.js";
import { discoverProjects } from "../registry/project-discovery.js";
import { getDocsDir } from "../utils/paths.js";
import type { RegistryEntry } from "../registry/types.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Tokenize a query string into individual search tokens.
 * Splits on spaces and commas, lowercases all tokens, removes empty strings.
 */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
}

/**
 * Check if a registry entry matches any of the given search tokens.
 * A token matches if it is a case-insensitive substring of any value
 * in the entry's scope, sources, or targets arrays.
 */
function entryMatchesTokens(
  entry: RegistryEntry,
  tokens: string[],
): boolean {
  const fields = [
    ...entry.metadata.scope,
    ...entry.metadata.sources,
    ...entry.metadata.targets,
  ].map((v) => v.toLowerCase());

  return tokens.some((token) =>
    fields.some((field) => field.includes(token)),
  );
}

/**
 * Check if a registry entry's targets intersect with the provided filter.
 */
function entryMatchesTargets(
  entry: RegistryEntry,
  targets: string[],
): boolean {
  const entryTargets = new Set(
    entry.metadata.targets.map((t) => t.toLowerCase()),
  );
  return targets.some((t) => entryTargets.has(t.toLowerCase()));
}

/**
 * Format a registry entry for the response.
 * Optionally includes full document content if include_content is true.
 */
async function formatMatch(
  entry: RegistryEntry,
  includeContent: boolean,
): Promise<Record<string, unknown>> {
  const match: Record<string, unknown> = {
    slug: entry.slug,
    description: entry.metadata.description ?? undefined,
    scope: entry.metadata.scope,
    sources: entry.metadata.sources,
    targets: entry.metadata.targets,
    layer: entry.layer,
    category: entry.metadata.category ?? undefined,
    uri: `docs://androidcommondoc/${entry.slug}`,
  };

  if (includeContent) {
    try {
      const content = await readFile(entry.filepath, "utf-8");
      match.content = content;
    } catch {
      logger.warn(`find-pattern: could not read content for ${entry.slug}`);
    }
  }

  return match;
}

/**
 * Register the find-pattern MCP tool.
 *
 * Provides metadata-based search across the pattern registry. Agents can
 * discover relevant patterns without knowing exact document names by
 * searching scope, sources, and targets fields.
 */
export function registerFindPatternTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "find-pattern",
    {
      title: "Find Pattern",
      description:
        "Search pattern registry by metadata (scope, sources, targets). Returns matching patterns with URIs for token-efficient discovery.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Search term matching scope, sources, or targets metadata fields",
          ),
        project: z
          .string()
          .optional()
          .describe(
            'Project name for ecosystem-aware resolution (returns L0 + L1 for ecosystem lib, or L0 + L2 for app). Use "all" for cross-project search. Omit for L0 only.',
          ),
        targets: z
          .array(z.string())
          .optional()
          .describe(
            "Filter results to specific target platforms (e.g., ['android', 'desktop'])",
          ),
        category: z
          .string()
          .optional()
          .describe(
            "Filter results by category (e.g., 'testing', 'architecture', 'security')",
          ),
        include_content: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Include full document content in results (default: false for token efficiency)",
          ),
      }),
    },
    async ({ query, project, targets, category, include_content }) => {
      const rateLimitResponse = checkRateLimit(limiter, "find-pattern");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const tokens = tokenize(query);
        if (tokens.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  query,
                  matches: [],
                  total: 0,
                  project_filter: project ?? null,
                }),
              },
            ],
          };
        }

        let entries: RegistryEntry[];

        if (!project) {
          // L0-only search: scan docs directory directly
          const docsDir = getDocsDir();
          entries = await scanDirectory(docsDir, "L0");
        } else if (project === "all") {
          // Cross-project search: discover all projects, merge results
          const projects = await discoverProjects();
          const allEntries = new Map<string, RegistryEntry>();

          // Start with L0
          const l0Entries = await resolveAllPatterns();
          for (const entry of l0Entries) {
            allEntries.set(entry.slug, entry);
          }

          // Add project-resolved entries (L1 overrides per project)
          for (const proj of projects) {
            const projEntries = await resolveAllPatterns(proj.path);
            for (const entry of projEntries) {
              // Use project-qualified key to keep per-project variants
              const key = `${proj.name}:${entry.slug}`;
              allEntries.set(key, entry);
            }
          }

          entries = Array.from(allEntries.values());
        } else {
          // Specific project: ecosystem-aware resolution
          // Returns L0 entries + project-specific overrides (both visible)
          const projects = await discoverProjects();
          const proj = projects.find(
            (p) => p.name.toLowerCase() === project.toLowerCase(),
          );

          // Get L0 base entries
          const l0Entries = await resolveAllPatterns();

          if (proj) {
            // Get project-resolved entries (L1 > L2 > L0 chain)
            const projEntries = await resolveAllPatterns(proj.path);

            // Combine: keep all L0 entries, add project overrides that differ
            const l0Slugs = new Set(l0Entries.map((e) => e.slug));
            const combined = [...l0Entries];

            for (const entry of projEntries) {
              // Add project-layer entries that override L0 (different layer)
              if (entry.layer !== "L0" || !l0Slugs.has(entry.slug)) {
                combined.push(entry);
              }
            }

            entries = combined;
          } else {
            // Unknown project: fall back to L0 only
            entries = l0Entries;
          }
        }

        // Filter by query tokens
        let matches = entries.filter((e) => entryMatchesTokens(e, tokens));

        // Apply target filter if provided
        if (targets && targets.length > 0) {
          matches = matches.filter((e) => entryMatchesTargets(e, targets));
        }

        // Apply category filter if provided (case-insensitive)
        if (category) {
          matches = matches.filter(
            (e) =>
              e.metadata.category?.toLowerCase() === category.toLowerCase(),
          );
        }

        // Deduplicate by slug+layer (keep first occurrence per layer)
        const seen = new Set<string>();
        matches = matches.filter((e) => {
          const key = `${e.slug}:${e.layer}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Format response
        const formattedMatches = await Promise.all(
          matches.map((e) => formatMatch(e, include_content ?? false)),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query,
                matches: formattedMatches,
                total: formattedMatches.length,
                project_filter: project ?? null,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error(`find-pattern error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
