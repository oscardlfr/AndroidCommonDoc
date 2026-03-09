/**
 * VaultSource to VaultEntry transformer.
 *
 * Converts raw collected source files into Obsidian-flavored Markdown
 * with enriched frontmatter (tags, aliases, vault metadata) and
 * injected wikilinks for graph connectivity.
 *
 * Supports the L0/L1/L2 documentation hierarchy:
 * - L0: bare slugs (canonical names, e.g., "testing-patterns")
 * - L1/L2: project-prefixed slugs (e.g., "my-shared-libs-TESTING_STRATEGY")
 */

import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { parseFrontmatter } from "../registry/frontmatter.js";
import { generateTags } from "./tag-generator.js";
import { injectWikilinks } from "./wikilink-generator.js";
import { logger } from "../utils/logger.js";
import type { VaultSource, VaultEntry, VaultSourceType } from "./types.js";

/**
 * Strip relative file links from markdown body text.
 *
 * Obsidian follows relative markdown links like [text](../APPLE_SETUP.md) and
 * creates empty ghost nodes in the graph for files that don't exist in the vault.
 * This function replaces such links with plain text (keeping the label) so
 * the prose still reads correctly but no phantom graph nodes are created.
 *
 * Only strips links where the href looks like a relative file path (no http/https,
 * no absolute paths starting with /). Wikilinks [[...]] are untouched.
 *
 * Examples:
 *   "[Apple Setup](APPLE_SETUP.md)" → "Apple Setup"
 *   "[Install](../INSTALL.md)" → "Install"
 *   "[Docs](https://example.com)" → unchanged (external URL kept)
 */
function stripRelativeFileLinks(body: string): string {
  // Match [label](href) where href is not an http(s) URL and not an anchor-only (#...)
  return body.replace(
    /\[([^\]]*)\]\((?!https?:\/\/)(?!#)([^)]+)\)/g,
    (_match, label) => label,
  );
}

/**
 * Normalize a filename to lowercase-kebab-case.
 * Replaces underscores with hyphens and lowercases the result.
 * Preserves the .md extension.
 *
 * Examples:
 *   "ARCHITECTURE.md" -> "architecture.md"
 *   "TESTING_STRATEGY.md" -> "testing-strategy.md"
 *   "already-kebab.md" -> "already-kebab.md"
 */
function normalizeFilename(filename: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  const normalized = stem.toLowerCase().replace(/_/g, "-");
  return `${normalized}${ext.toLowerCase()}`;
}

/**
 * Normalize the filename portion of a vault-relative path to lowercase-kebab-case.
 * Preserves directory structure.
 */
function normalizeVaultPath(vaultPath: string, useParentAsName = false): string {
  const parts = vaultPath.replace(/\\/g, "/").split("/");
  if (parts.length === 0) return vaultPath;
  const filename = parts[parts.length - 1];
  const stem = path.basename(filename, path.extname(filename)).toLowerCase();
  // When the file is named "readme" or "changelog", use the parent directory
  // name instead so Obsidian shows a meaningful node label (e.g. "core-error"
  // instead of "readme") and disambiguates 62 otherwise-identical node names.
  if ((stem === "readme" || stem === "changelog") && parts.length >= 2) {
    const parentDir = parts[parts.length - 2].toLowerCase().replace(/_/g, "-");
    parts[parts.length - 1] = `${parentDir}.md`;
  } else {
    parts[parts.length - 1] = normalizeFilename(filename);
  }
  return parts.join("/");
}

/**
 * Map sourceType to a human-readable vault_type for Obsidian frontmatter.
 */
const VAULT_TYPE_MAP: Record<VaultSourceType, string> = {
  pattern: "pattern",
  skill: "skill",
  planning: "planning",
  "claude-md": "reference",
  agents: "reference",
  docs: "reference",
  "rule-index": "reference",
  architecture: "architecture",
};

/**
 * Get today's date in YYYY-MM-DD format.
 */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Derive a disambiguated slug from a VaultSource.
 *
 * Slug disambiguation strategy:
 * - L0 pattern docs: bare slug (e.g., "testing-patterns") -- canonical names
 * - L1/L2 files: project-prefixed slug (e.g., "my-shared-libs-TESTING_STRATEGY")
 *   to prevent collisions across layers
 * - Sub-project files: sub-project-prefixed slug (e.g., "MyAppWeb-project")
 *   to prevent collisions between parent project and sub-project files with
 *   the same filename (e.g., MyApp/.planning/PROJECT.md vs
 *   MyAppWeb/.planning/PROJECT.md both becoming "MyApp-project")
 */
export function deriveSlug(source: VaultSource): string {
  const baseSlug = path.basename(source.relativePath, ".md");

  // Sub-project files use the sub-project name as prefix to avoid collisions
  // with parent project files that share the same basename (e.g., PROJECT.md).
  // This must be checked before the generic L1/L2 branch below.
  if (source.subProject) {
    const normalizedBase = baseSlug.toLowerCase().replace(/_/g, "-");
    // For generic filenames like "README", disambiguate with parent dir
    if (normalizedBase === "readme" || normalizedBase === "changelog") {
      const parts = source.relativePath.replace(/\\/g, "/").split("/");
      const parentDir = parts.length >= 2 ? parts[parts.length - 2] : normalizedBase;
      return `${source.subProject}-${parentDir}`.toLowerCase().replace(/_/g, "-");
    }
    return `${source.subProject}-${normalizedBase}`;
  }

  // For generic filenames like "README", include the parent directory
  // to disambiguate (e.g., core-common/README.md -> "core-common" slug).
  // This prevents 52 module READMEs from all getting the same slug.
  if (baseSlug === "README" || baseSlug === "CHANGELOG") {
    const parts = source.relativePath.replace(/\\/g, "/").split("/");
    // parts: ["L1-ecosystem", "my-shared-libs", "docs", "core-common", "README.md"]
    // parent directory is parts[parts.length - 2]
    const parentDir = parts.length >= 2 ? parts[parts.length - 2] : baseSlug;
    if (source.layer === "L0") {
      return parentDir;
    }
    return `${source.project ?? "unknown"}-${parentDir}`;
  }

  if (source.layer === "L0") {
    return baseSlug;
  }
  return `${source.project ?? "unknown"}-${baseSlug}`;
}

/**
 * Transform a single VaultSource into a VaultEntry with enriched frontmatter
 * and injected wikilinks.
 *
 * @param source - Collected source file
 * @param allSlugs - Set of all known slugs for cross-linking
 * @returns Transformed VaultEntry ready for vault output
 */
export function transformSource(
  source: VaultSource,
  allSlugs: Set<string>,
): VaultEntry {
  // 0. Check naming convention (warn on non-lowercase-kebab-case)
  const basename = path.basename(source.relativePath, ".md");
  const isArchive = source.relativePath.includes("archive");
  const isDiagram = source.relativePath.includes("diagrams");
  const isExempt =
    basename === "README" ||
    basename === "LEGEND" ||
    basename === "SKILL" ||
    isArchive;
  if (!isExempt && !isDiagram) {
    if (!/^[a-z0-9-]+$/.test(basename)) {
      logger.warn(
        `Naming convention warning: "${source.relativePath}" is not lowercase-kebab-case`,
      );
    }
  }

  // 1. Parse existing frontmatter from source content
  const parsed = parseFrontmatter(source.content);
  const originalFrontmatter: Record<string, unknown> = parsed?.data ?? {};
  const body = parsed?.content ?? source.content;

  // 2. Determine slug with layer disambiguation
  const slug = deriveSlug(source);

  // 3. Generate tags from metadata
  const metadata = source.metadata as Record<string, unknown> | null;
  let categoryRaw = originalFrontmatter["category"] ?? metadata?.["category"];
  // Infer category from vault path if not in frontmatter (e.g., ".../docs/architecture/..." → "architecture")
  if (!categoryRaw) {
    const vp = source.relativePath.replace(/\\/g, "/");
    const docsIdx = vp.indexOf("/docs/");
    if (docsIdx !== -1) {
      const afterDocs = vp.slice(docsIdx + 6);
      const firstSlash = afterDocs.indexOf("/");
      if (firstSlash !== -1) {
        const subdir = afterDocs.slice(0, firstSlash);
        if (!subdir.endsWith(".md")) categoryRaw = subdir;
      }
    }
  }
  const category = typeof categoryRaw === "string" ? categoryRaw : undefined;
  const tags = generateTags({
    scope: asStringArray(metadata?.["scope"]),
    targets: asStringArray(metadata?.["targets"]),
    layer: source.layer,
    sourceType: source.sourceType,
    project: source.project,
    subProject: source.subProject,
    category,
  });

  // 4. Normalize vault_source path (Windows backslashes -> forward slashes)
  const vaultSourcePath = source.filepath.replace(/\\/g, "/");

  // 5. Build enriched frontmatter
  const enrichedFrontmatter: Record<string, unknown> = {
    ...originalFrontmatter,
    tags,
    aliases: [slug],
    vault_source: vaultSourcePath,
    vault_source_path: vaultSourcePath,
    vault_synced: todayISO(),
    vault_type: VAULT_TYPE_MAP[source.sourceType] ?? "reference",
  };

  // 6. Skip body wikilink injection.
  //
  // Automatic injection of [[wikilinks]] into document bodies creates two problems:
  // 1. Obsidian resolves body wikilinks by filename first, then alias — so
  //    [[shared-libs-core-storage-secure]] in a body creates a new empty note
  //    instead of resolving to the existing readme.md with that alias.
  // 2. Text-match injection is semantically noisy: any slug that appears as a word
  //    in running prose gets linked, producing thousands of spurious graph edges
  //    that make the graph view an unreadable hairball.
  //
  // Graph connectivity comes exclusively from MOC pages (00-MOC/) which use
  // explicit, curated wikilinks. This produces a clean, meaningful graph.
  //
  // Additionally, strip relative markdown links like [text](APPLE_SETUP.md) that
  // reference files not present in the vault. Obsidian follows these links and
  // creates empty ghost nodes for them, polluting the graph. We keep the link
  // label as plain text so the prose still reads correctly.
  const enrichedBody = stripRelativeFileLinks(body);

  // 7. Rebuild content with enriched frontmatter YAML + body
  const frontmatterYaml = yamlStringify(enrichedFrontmatter).trimEnd();
  const content = `---\n${frontmatterYaml}\n---\n${enrichedBody}`;

  return {
    slug,
    vaultPath: normalizeVaultPath(source.relativePath),
    content,
    frontmatter: enrichedFrontmatter,
    sourceType: source.sourceType,
    project: source.project,
    layer: source.layer,
    subProject: source.subProject,
    tags,
  };
}

/**
 * Transform an array of VaultSources into VaultEntries.
 *
 * Collects all slugs first (with layer disambiguation) for cross-linking,
 * then transforms each source.
 *
 * @param sources - Array of collected source files
 * @returns Array of transformed VaultEntries with cross-linked wikilinks
 */
export function transformAll(sources: VaultSource[]): VaultEntry[] {
  // Collect all slugs for cross-linking using the same disambiguation logic
  const allSlugs = new Set(sources.map((s) => deriveSlug(s)));

  // Transform each source with knowledge of all slugs
  return sources.map((source) => transformSource(source, allSlugs));
}

/**
 * Safely convert an unknown value to string[] (or undefined).
 */
function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return undefined;
}
