/**
 * Pattern documentation resources.
 *
 * Registers all Markdown docs from the docs/ directory as MCP resources
 * using a docs://androidcommondoc/{slug} URI scheme. Documents are
 * discovered dynamically via the registry scanner -- any .md file with
 * valid YAML frontmatter (scope, sources, targets) is automatically
 * registered without code changes.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { scanDirectory } from "../registry/scanner.js";
import { getDocsDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

/**
 * Backward-compatible slug aliases.
 * Maps legacy slugs to their actual filenames (without .md extension).
 * The scanner derives slug from filename, but some published URIs use
 * shorter slugs that differ from the filename.
 */
const SLUG_ALIASES: Record<string, string> = {
  "enterprise-integration": "enterprise-integration-proposal",
};

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Register all pattern docs from the docs/ directory as MCP resources.
 *
 * Scans the docs directory for .md files with valid YAML frontmatter and
 * registers each as a resource with a docs://androidcommondoc/{slug} URI.
 * Also registers backward-compatible alias URIs for legacy slugs.
 */
export async function registerDocResources(
  server: McpServer,
): Promise<void> {
  const docsDir = getDocsDir();
  const entries = await scanDirectory(docsDir, "L0");

  // Track registered slugs to add aliases for backward compatibility
  const registeredSlugs = new Set<string>();

  for (const entry of entries) {
    registeredSlugs.add(entry.slug);

    server.registerResource(
      entry.slug,
      `docs://androidcommondoc/${entry.slug}`,
      {
        title: titleFromSlug(entry.slug),
        description:
          entry.metadata.description ??
          `Pattern documentation: ${titleFromSlug(entry.slug)}`,
        mimeType: "text/markdown",
      },
      async (uri) => {
        try {
          const content = await readFile(entry.filepath, "utf-8");
          return { contents: [{ uri: uri.href, text: content }] };
        } catch {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Document not found: ${entry.slug}`,
          );
        }
      },
    );
  }

  // Register backward-compatible aliases for legacy slugs
  for (const [aliasSlug, targetSlug] of Object.entries(SLUG_ALIASES)) {
    if (registeredSlugs.has(aliasSlug)) continue; // Already registered under this slug
    const targetEntry = entries.find((e) => e.slug === targetSlug);
    if (!targetEntry) continue;

    server.registerResource(
      aliasSlug,
      `docs://androidcommondoc/${aliasSlug}`,
      {
        title: titleFromSlug(aliasSlug),
        description:
          targetEntry.metadata.description ??
          `Pattern documentation: ${titleFromSlug(aliasSlug)}`,
        mimeType: "text/markdown",
      },
      async (uri) => {
        try {
          const content = await readFile(targetEntry.filepath, "utf-8");
          return { contents: [{ uri: uri.href, text: content }] };
        } catch {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Document not found: ${aliasSlug}`,
          );
        }
      },
    );
  }

  logger.info(
    `Registered ${entries.length} doc resources (+${Object.keys(SLUG_ALIASES).length} aliases) from registry scan`,
  );
}
