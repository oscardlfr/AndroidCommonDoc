/**
 * Wikilink injector for Obsidian vault documents.
 *
 * Replaces standalone slug occurrences in document body with [[wikilinks]],
 * while preserving content inside existing wikilinks, inline code spans,
 * and fenced code blocks.
 */

/**
 * Inject Obsidian wikilinks into document content.
 *
 * For each slug in allSlugs (except ownSlug), replaces standalone
 * occurrences with [[slug]] links. Protected zones (existing wikilinks,
 * inline code, fenced code blocks) are never modified.
 *
 * @param content - Document body text (after frontmatter)
 * @param allSlugs - Set of all known vault slugs for cross-linking
 * @param ownSlug - This document's slug (excluded to prevent self-links)
 * @returns Modified content with wikilinks injected
 */
export function injectWikilinks(
  content: string,
  allSlugs: Set<string>,
  ownSlug?: string,
): string {
  // Normalize any Windows backslashes in content
  let text = content.replace(/\\/g, "/");

  // Build list of slugs to link (exclude own slug)
  const slugsToLink = [...allSlugs].filter((s) => s !== ownSlug);
  if (slugsToLink.length === 0) {
    return text;
  }

  // Split by fenced code blocks first.
  // A fenced code block starts with a line beginning with ``` and ends the same way.
  const fencedBlockRegex = /(^```[^\n]*\n[\s\S]*?\n```$)/gm;
  const parts = text.split(fencedBlockRegex);

  const processed = parts.map((part) => {
    // If this part is a fenced code block, leave it untouched
    if (/^```/.test(part)) {
      return part;
    }
    // Process this non-code-block section
    return injectInNonCodeBlock(part, slugsToLink);
  });

  return processed.join("");
}

/**
 * Inject wikilinks in a text section that is NOT inside a fenced code block.
 * Still need to protect inline code spans and existing wikilinks.
 */
function injectInNonCodeBlock(text: string, slugs: string[]): string {
  // Split by protected zones: existing [[wikilinks]], `inline code`, and [markdown](links)
  // We use a regex that captures these protected zones as separate tokens.
  const protectedRegex = /(\[\[[^\]]*\]\]|`[^`]*`|\[[^\]]*\]\([^)]*\))/g;
  const tokens = text.split(protectedRegex);

  const processed = tokens.map((token) => {
    // If token is a protected zone (wikilink, inline code, or markdown link), skip it
    if (/^\[\[.*\]\]$/.test(token) || /^`.*`$/.test(token) || /^\[.*\]\(.*\)$/.test(token)) {
      return token;
    }
    // Replace slugs in this safe zone
    return replaceSlugsSafe(token, slugs);
  });

  return processed.join("");
}

/**
 * Detect if a slug has a project prefix and extract the display name.
 *
 * Project-prefixed slugs follow the pattern "ProjectName-rest-of-slug"
 * where the first segment before the first hyphen is a project name
 * (starts with uppercase). Returns null if no prefix detected.
 */
function extractDisplayName(slug: string): string | null {
  const firstHyphen = slug.indexOf("-");
  if (firstHyphen === -1) {
    return null;
  }
  const prefix = slug.substring(0, firstHyphen);
  // Project prefixes start with an uppercase letter (e.g., "MyApp", "shared")
  // and the remainder is the display name
  if (/^[A-Za-z]/.test(prefix) && prefix.length > 1) {
    const rest = slug.substring(firstHyphen + 1);
    // Only treat as project-prefixed if the rest doesn't look like
    // a regular hyphenated slug (i.e., it has uppercase or underscores
    // typical of project file names like CLAUDE, TESTING_STRATEGY)
    if (/[A-Z_]/.test(rest)) {
      return rest;
    }
  }
  return null;
}

/**
 * Replace all slug occurrences as standalone words in a safe text zone.
 *
 * For project-prefixed slugs (e.g., "MyApp-CLAUDE"), uses display-text
 * format [[MyApp-CLAUDE|CLAUDE]] for readability. Bare slugs use
 * plain [[slug]] format.
 */
function replaceSlugsSafe(text: string, slugs: string[]): string {
  // Sort slugs longest-first so "gradle-patterns-dependencies" is matched
  // before "gradle-patterns" (prevents partial matches creating nested brackets)
  const sorted = [...slugs].sort((a, b) => b.length - a.length);

  let result = text;
  for (const slug of sorted) {
    // Escape special regex characters in slug
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word boundary match for standalone slug occurrences.
    // Slugs contain hyphens, so we include hyphen in the boundary check
    // to prevent "gradle-patterns" from matching inside "gradle-patterns-dependencies".
    const regex = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g");

    // Use display-text format for project-prefixed slugs
    const displayName = extractDisplayName(slug);
    const replacement = displayName
      ? `[[${slug}|${displayName}]]`
      : `[[${slug}]]`;

    result = result.replace(regex, replacement);
  }
  return result;
}
