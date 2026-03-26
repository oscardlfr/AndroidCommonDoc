/**
 * MCP tool: suggest-docs
 *
 * Given a list of file paths being modified, suggests relevant pattern docs
 * by matching against frontmatter `targets` fields.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scanDirectory } from "../registry/scanner.js";
import { getDocsDir } from "../utils/paths.js";
import { matchFileAgainstDocs, type DocEntry } from "../utils/target-matcher.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

export function registerSuggestDocsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "suggest-docs",
    "Suggest relevant pattern docs for files being modified",
    {
      files: z
        .array(z.string())
        .min(1)
        .describe("File paths being modified"),
    },
    async ({ files }) => {
      checkRateLimit(rateLimiter, "suggest-docs");

      const docsDir = getDocsDir();
      const entries = await scanDirectory(docsDir, "L0");

      // Convert registry entries to DocEntry format
      const docs: DocEntry[] = entries.map((e) => ({
        slug: e.slug,
        filepath: e.filepath,
        metadata: {
          description: e.metadata.description,
          scope: Array.isArray(e.metadata.scope)
            ? e.metadata.scope.join(", ")
            : String(e.metadata.scope ?? ""),
          targets: Array.isArray(e.metadata.targets)
            ? e.metadata.targets
            : [],
          category: e.metadata.category
            ? String(e.metadata.category)
            : undefined,
        },
      }));

      // Match each file against docs
      const allMatches = new Map<string, { match: ReturnType<typeof matchFileAgainstDocs>[0]; files: string[] }>();

      for (const file of files) {
        const matches = matchFileAgainstDocs(file, docs);
        for (const match of matches) {
          const existing = allMatches.get(match.slug);
          if (existing) {
            existing.files.push(file);
          } else {
            allMatches.set(match.slug, { match, files: [file] });
          }
        }
      }

      // Format results
      const results = Array.from(allMatches.values()).map(({ match, files: matchedFiles }) => ({
        slug: match.slug,
        title: match.title,
        description: match.description,
        category: match.category,
        matchReason: match.matchReason,
        matchedFiles: matchedFiles,
        uri: `docs://androidcommondoc/${match.slug}`,
      }));

      logger.debug(`suggest-docs: ${results.length} suggestions for ${files.length} files`);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No relevant pattern docs found for the given files.",
            },
          ],
        };
      }

      const text = results
        .map(
          (r) =>
            `- **${r.title}** (${r.category}): ${r.description}\n  Match: ${r.matchReason}\n  Files: ${r.matchedFiles.join(", ")}\n  URI: ${r.uri}`,
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `## Suggested Docs (${results.length})\n\n${text}`,
          },
        ],
      };
    },
  );
}
