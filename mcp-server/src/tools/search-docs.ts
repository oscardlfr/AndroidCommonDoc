/**
 * MCP tool: search-docs
 *
 * Searches pattern docs by keyword across frontmatter and content.
 * Scores results by relevance: slug match (3x), description (2x),
 * scope+targets (2x), content body (1x). Returns top 20 results.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { scanDirectory } from "../registry/scanner.js";
import { getDocsDir } from "../utils/paths.js";
import type { RegistryEntry } from "../registry/types.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import {
  tokenize,
  scoreEntry,
} from "../utils/doc-scoring.js";

interface ScoredEntry {
  entry: RegistryEntry;
  score: number;
  content: string;
}

/**
 * Extract the category from a doc filepath.
 * Expects paths like .../docs/{category}/file.md
 */
function extractCategory(filepath: string): string | undefined {
  // Normalize to forward slashes for consistent matching
  const normalized = filepath.replace(/\\/g, "/");
  const match = normalized.match(/\/docs\/([^/]+)\//);
  return match ? match[1] : undefined;
}

/**
 * Register the search-docs MCP tool.
 *
 * Provides keyword-based search across pattern docs with relevance scoring.
 * Agents can discover docs by searching across slugs, descriptions,
 * frontmatter fields, and document content.
 */
export function registerSearchDocsTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "search-docs",
    {
      title: "Search Docs",
      description:
        "Search pattern docs by keyword across frontmatter and content. Returns scored results ranked by relevance.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Search query — matched against slug, description, scope, targets, and content",
          ),
        category: z
          .string()
          .optional()
          .describe(
            "Filter to a specific doc category (e.g., 'testing', 'architecture', 'security')",
          ),
      }),
    },
    async ({ query, category }) => {
      const rateLimitResponse = checkRateLimit(limiter, "search-docs");
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
                }),
              },
            ],
          };
        }

        // Scan all L0 docs
        const docsDir = getDocsDir();
        let entries = await scanDirectory(docsDir, "L0");

        // Filter by category if provided
        if (category) {
          const categoryLower = category.toLowerCase();
          entries = entries.filter((e) => {
            // Check metadata category first
            if (e.metadata.category?.toLowerCase() === categoryLower) {
              return true;
            }
            // Fall back to path-based category detection
            const pathCategory = extractCategory(e.filepath);
            return pathCategory?.toLowerCase() === categoryLower;
          });
        }

        // Score each entry
        const scored: ScoredEntry[] = [];
        for (const entry of entries) {
          let content = "";
          try {
            content = await readFile(entry.filepath, "utf-8");
          } catch {
            logger.warn(
              `search-docs: could not read content for ${entry.slug}`,
            );
          }

          const score = scoreEntry(entry, tokens, content);
          if (score > 0) {
            scored.push({ entry, score, content });
          }
        }

        // Sort descending by score, take top 20
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, 20);

        // Format results
        const matches = top.map(({ entry, score }) => ({
          slug: entry.slug,
          title: entry.slug
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          description: entry.metadata.description ?? undefined,
          category: entry.metadata.category ?? extractCategory(entry.filepath) ?? undefined,
          score,
          uri: `docs://androidcommondoc/${entry.slug}`,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                query,
                matches,
                total: matches.length,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error(`search-docs error: ${String(error)}`);
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
