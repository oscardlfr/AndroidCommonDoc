/**
 * Three-layer pattern resolver with full replacement semantics.
 *
 * Layer priority: L1 (project) > L2 (user) > L0 (base toolkit).
 * When a higher-priority layer has a document with the same slug,
 * it completely replaces the lower layer version (no merging).
 */

import { scanDirectory } from "./scanner.js";
import { getDocsDir, getL1DocsDir, getL2DocsDir } from "../utils/paths.js";
import type { RegistryEntry } from "./types.js";

/**
 * Resolve a single pattern by slug through the L1 > L2 > L0 priority chain.
 *
 * @param slug - Pattern slug (filename without .md extension)
 * @param project - Optional absolute path to a consumer project for L1 lookup
 * @returns The highest-priority registry entry, or null if not found
 */
export async function resolvePattern(
  slug: string,
  project?: string,
): Promise<RegistryEntry | null> {
  // L1: Project-level override (highest priority)
  if (project) {
    const l1Dir = getL1DocsDir(project);
    const l1Entries = await scanDirectory(l1Dir, "L1", project);
    const l1Match = l1Entries.find((e) => e.slug === slug);
    if (l1Match) return l1Match;
  }

  // L2: User-level override
  const l2Dir = getL2DocsDir();
  const l2Entries = await scanDirectory(l2Dir, "L2");
  const l2Match = l2Entries.find((e) => e.slug === slug);
  if (l2Match) return l2Match;

  // L0: Base toolkit (lowest priority)
  const l0Dir = getDocsDir();
  const l0Entries = await scanDirectory(l0Dir, "L0");
  const l0Match = l0Entries.find((e) => e.slug === slug);
  if (l0Match) return l0Match;

  return null;
}

/**
 * Resolve all patterns through the L1 > L2 > L0 priority chain.
 * For each unique slug, the highest-priority entry wins (full replacement).
 *
 * @param project - Optional absolute path to a consumer project for L1 lookup
 * @returns Array of resolved registry entries (one per unique slug)
 */
export async function resolveAllPatterns(
  project?: string,
): Promise<RegistryEntry[]> {
  const resolved = new Map<string, RegistryEntry>();

  // Start with L0 (lowest priority) -- everything gets added
  const l0Dir = getDocsDir();
  const l0Entries = await scanDirectory(l0Dir, "L0");
  for (const entry of l0Entries) {
    resolved.set(entry.slug, entry);
  }

  // Apply L2 overrides (user-level)
  const l2Dir = getL2DocsDir();
  const l2Entries = await scanDirectory(l2Dir, "L2");
  for (const entry of l2Entries) {
    resolved.set(entry.slug, entry);
  }

  // Apply L1 overrides (project-level, highest priority)
  if (project) {
    const l1Dir = getL1DocsDir(project);
    const l1Entries = await scanDirectory(l1Dir, "L1", project);
    for (const entry of l1Entries) {
      resolved.set(entry.slug, entry);
    }
  }

  return Array.from(resolved.values());
}

/**
 * Resolve all patterns with source-based excludes.
 * After resolution, filters out entries whose `sources` array
 * intersects with the provided excludes.sources list.
 *
 * @param project - Optional absolute path to a consumer project for L1 lookup
 * @param excludes - Optional exclusion filters
 * @returns Filtered array of resolved registry entries
 */
export async function resolveAllPatternsWithExcludes(
  project?: string,
  excludes?: { sources?: string[] },
): Promise<RegistryEntry[]> {
  const all = await resolveAllPatterns(project);

  if (!excludes?.sources || excludes.sources.length === 0) {
    return all;
  }

  const excludedSources = new Set(excludes.sources);
  return all.filter((entry) => {
    return !entry.metadata.sources.some((s) => excludedSources.has(s));
  });
}
