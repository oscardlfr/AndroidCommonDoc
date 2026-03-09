/**
 * Glob pattern expansion for file discovery.
 *
 * Expands glob patterns against a root directory and returns matching
 * file paths. Uses recursive directory walking with pattern matching --
 * no external dependencies required.
 *
 * Supported glob syntax:
 * - `**` matches any directory depth
 * - `*` matches any characters within a single path segment
 * - Literal filenames (e.g., "CLAUDE.md") match exact name at root
 *
 * All paths are normalized to forward slashes for cross-platform consistency.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Result of expanding a glob pattern against a directory.
 */
export interface GlobResult {
  /** Absolute path to the matched file. */
  absolutePath: string;
  /** Path relative to the root directory (forward slashes). */
  relativePath: string;
}

/**
 * Directories to skip during recursive walking for performance.
 * These are build artifacts, dependency caches, and IDE metadata
 * that never contain collectible documentation.
 */
const SKIP_DIRS = new Set([
  "build",
  "node_modules",
  ".gradle",
  "dist",
  ".git",
  ".idea",
  ".vscode",
  "out",
  "__pycache__",
  ".next",
  ".nuxt",
]);

/**
 * Convert a glob pattern to a RegExp for matching against relative paths.
 *
 * Handles:
 * - `**` -> matches any characters including `/` (any directory depth)
 * - `*` -> matches any characters except `/` (single path segment)
 * - Literal characters are regex-escaped
 *
 * @param glob - Glob pattern (forward-slash separated)
 * @returns RegExp that matches the full relative path
 */
function globToRegex(glob: string): RegExp {
  // Normalize to forward slashes
  const normalized = glob.replace(/\\/g, "/");

  let regexStr = "^";
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];

    if (char === "*") {
      if (i + 1 < normalized.length && normalized[i + 1] === "*") {
        // `**` - match any path depth
        // Handle `**/`, `/**`, or standalone `**`
        if (i + 2 < normalized.length && normalized[i + 2] === "/") {
          // `**/` at start or middle: match any prefix including empty
          regexStr += "(?:.+/)?";
          i += 3;
        } else {
          // `**` at end or standalone: match anything
          regexStr += ".*";
          i += 2;
        }
      } else {
        // Single `*` - match anything except path separator
        regexStr += "[^/]*";
        i += 1;
      }
    } else if (".+?^${}()|[]\\".includes(char)) {
      // Escape special regex characters (except * handled above)
      regexStr += "\\" + char;
      i += 1;
    } else {
      regexStr += char;
      i += 1;
    }
  }

  regexStr += "$";
  return new RegExp(regexStr);
}

/**
 * Test whether a relative path matches a glob pattern.
 *
 * @param relativePath - Forward-slash normalized path relative to root
 * @param glob - Glob pattern to test against
 * @returns true if the path matches the pattern
 */
function matchGlob(relativePath: string, glob: string): boolean {
  const regex = globToRegex(glob);
  return regex.test(relativePath);
}

/**
 * Recursively walk a directory tree, yielding relative paths of all files.
 *
 * @param rootDir - Absolute path to the root directory
 * @param currentDir - Current directory being scanned (starts at rootDir)
 * @param results - Accumulator for discovered file paths
 */
async function walkDirectory(
  rootDir: string,
  currentDir: string,
  results: GlobResult[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or isn't readable
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      // Skip known non-documentation directories
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDirectory(rootDir, absolutePath, results);
    } else if (entry.isFile()) {
      // Compute forward-slash relative path
      const relativePath = path
        .relative(rootDir, absolutePath)
        .replace(/\\/g, "/");

      results.push({ absolutePath, relativePath });
    }
  }
}

/**
 * Expand multiple glob patterns against a root directory.
 *
 * Returns deduplicated matching files, excluding files matching excludeGlobs.
 * All paths are normalized to forward slashes for cross-platform consistency.
 *
 * @param rootDir - Absolute path to the directory to scan
 * @param includeGlobs - Glob patterns for files to include
 * @param excludeGlobs - Glob patterns for files to exclude
 * @returns Array of matching files with absolute and relative paths
 */
export async function expandGlobs(
  rootDir: string,
  includeGlobs: string[],
  excludeGlobs: string[],
): Promise<GlobResult[]> {
  if (includeGlobs.length === 0) {
    return [];
  }

  // Walk the entire directory tree once
  const allFiles: GlobResult[] = [];
  await walkDirectory(rootDir, rootDir, allFiles);

  // Match files against include patterns
  const matched = new Map<string, GlobResult>();

  for (const file of allFiles) {
    for (const glob of includeGlobs) {
      if (matchGlob(file.relativePath, glob)) {
        // Deduplicate by absolute path
        matched.set(file.absolutePath, file);
        break; // No need to check other include globs for this file
      }
    }
  }

  // Filter out files matching exclude patterns
  const results: GlobResult[] = [];
  for (const file of matched.values()) {
    const excluded = excludeGlobs.some((glob) =>
      matchGlob(file.relativePath, glob),
    );
    if (!excluded) {
      results.push(file);
    }
  }

  return results;
}
