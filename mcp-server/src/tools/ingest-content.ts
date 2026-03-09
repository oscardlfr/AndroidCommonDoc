/**
 * MCP tool: ingest-content
 *
 * Analyzes content from any source (URL, pasted text) and extracts relevant
 * patterns for routing to pattern docs. Supports Medium posts, LinkedIn
 * articles, blog posts, conference talks.
 *
 * When a URL is unfetchable (paywall, auth-wall), prompts for pasted content.
 * NEVER auto-applies changes -- all suggestions require user review.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanDirectory } from "../registry/scanner.js";
import { getDocsDir } from "../utils/paths.js";
import type { RegistryEntry } from "../registry/types.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/** Suggestion for updating or reviewing a pattern doc based on ingested content. */
interface ContentSuggestion {
  target_doc: string;
  slug: string;
  relevance: string;
  extracted_patterns: string[];
  recommended_action: "update" | "review" | "new_doc";
}

/**
 * Try to fetch content from a URL with a timeout.
 * Returns the text content on success, or null on failure.
 */
async function fetchUrl(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AndroidCommonDoc-MCP/1.0",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        reason: `HTTP ${response.status} ${response.statusText ?? ""}`.trim(),
      };
    }

    const text = await response.text();
    return { ok: true, text };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}

/**
 * Extract keyword tokens from content text for matching against
 * pattern doc metadata.
 */
function extractKeywords(content: string): string[] {
  // Normalize and tokenize the content
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Count word frequency and return significant words
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  // Return words that appear more than once (significant terms)
  return Array.from(freq.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word]) => word);
}

/**
 * Match content keywords against registry entry metadata to find
 * relevant pattern docs.
 */
function matchPatternsToContent(
  entries: RegistryEntry[],
  keywords: string[],
): ContentSuggestion[] {
  const suggestions: ContentSuggestion[] = [];

  for (const entry of entries) {
    const fields = [
      ...entry.metadata.scope,
      ...entry.metadata.sources,
      ...entry.metadata.targets,
    ].map((v) => v.toLowerCase());

    // Find matching keywords
    const matchingKeywords = keywords.filter((kw) =>
      fields.some((field) => field.includes(kw) || kw.includes(field)),
    );

    if (matchingKeywords.length > 0) {
      // Calculate relevance based on match count
      const relevance =
        matchingKeywords.length >= 3
          ? "high"
          : matchingKeywords.length >= 2
            ? "medium"
            : "low";

      suggestions.push({
        target_doc: entry.filepath,
        slug: entry.slug,
        relevance,
        extracted_patterns: matchingKeywords.slice(0, 10),
        recommended_action:
          matchingKeywords.length >= 3 ? "update" : "review",
      });
    }
  }

  // Sort by relevance (high first)
  const relevanceOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort(
    (a, b) =>
      relevanceOrder[a.relevance as keyof typeof relevanceOrder] -
      relevanceOrder[b.relevance as keyof typeof relevanceOrder],
  );

  return suggestions;
}

/**
 * Register the ingest-content MCP tool.
 *
 * Provides content ingestion from URLs or pasted text. Extracts patterns
 * and routes them to matching pattern docs as suggestions. Never auto-applies
 * changes -- all suggestions require user review.
 */
export function registerIngestContentTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "ingest-content",
    {
      title: "Ingest Content",
      description:
        "Analyze content from any source (URL, pasted text) and extract relevant patterns for routing to pattern docs. Supports Medium posts, LinkedIn articles, blog posts, conference talks. When a URL is unfetchable (paywall, auth-wall), prompts for pasted content.",
      inputSchema: z.object({
        url: z
          .string()
          .optional()
          .describe(
            "URL to fetch content from (optional if content is provided)",
          ),
        content: z
          .string()
          .optional()
          .describe(
            "Pasted text content (for unfetchable URLs or direct input)",
          ),
        projectRoot: z
          .string()
          .optional()
          .describe("Path to toolkit root"),
      }),
    },
    async ({ url, content, projectRoot }) => {
      const rateLimitResponse = checkRateLimit(limiter, "ingest-content");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Validate input: at least one of url or content must be provided
        if (!url && !content) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary:
                    "Either 'url' or 'content' parameter must be provided.",
                }),
              },
            ],
            isError: true,
          };
        }

        let analyzedContent: string | null = null;

        // If URL provided, try to fetch it
        if (url && !content) {
          const fetchResult = await fetchUrl(url);

          if (!fetchResult.ok) {
            logger.info(
              `ingest-content: URL unfetchable (${fetchResult.reason}): ${url}`,
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      status: "url_unfetchable",
                      url,
                      reason: fetchResult.reason,
                      suggestion:
                        "The URL could not be fetched (possible paywall or auth-wall). Please paste the content directly using the 'content' parameter.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          analyzedContent = fetchResult.text;
        } else if (content) {
          analyzedContent = content;
        }

        if (!analyzedContent) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: "No content available to analyze.",
                }),
              },
            ],
            isError: true,
          };
        }

        // Scan docs directory for registry entries
        const docsDir = projectRoot
          ? `${projectRoot}/docs`
          : getDocsDir();
        const entries = await scanDirectory(docsDir, "L0");

        // Extract keywords from content
        const keywords = extractKeywords(analyzedContent);

        // Match against pattern docs
        const suggestions = matchPatternsToContent(entries, keywords);

        // Build content preview (first 500 chars)
        const rawContentPreview = analyzedContent.slice(0, 500);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "analyzed",
                  source: url ?? "pasted_content",
                  suggestions,
                  raw_content_preview: rawContentPreview,
                  keywords_extracted: keywords.length,
                  note: "All suggestions require user review. No changes have been auto-applied.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error(`ingest-content failed: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Content ingestion failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
