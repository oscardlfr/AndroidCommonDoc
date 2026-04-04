/**
 * Shared document scoring utilities.
 *
 * Extracted from search-docs.ts for reuse by validate-doc-update.ts.
 * Provides tokenization, relevance scoring, and Jaccard similarity.
 */
import type { RegistryEntry } from "../registry/types.js";

/**
 * Tokenize a query string into individual search tokens.
 * Splits on spaces, commas, and common separators. Lowercases all.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:.!?()[\]{}]+/)
    .filter((t) => t.length > 1); // skip single chars
}

/**
 * Score a registry entry against query tokens.
 * Weights: slug (3x), description (2x), scope+targets (2x), content body (1x).
 */
export function scoreEntry(
  entry: RegistryEntry,
  tokens: string[],
  content: string,
): number {
  let score = 0;
  const slugLower = entry.slug.toLowerCase();
  const descLower = (entry.metadata.description ?? "").toLowerCase();
  const scopeTargets = [
    ...entry.metadata.scope,
    ...entry.metadata.targets,
  ].map((v) => v.toLowerCase());
  const contentLower = content.toLowerCase();

  for (const token of tokens) {
    if (slugLower.includes(token)) score += 3;
    if (descLower.includes(token)) score += 2;
    if (scopeTargets.some((field) => field.includes(token))) score += 2;
    if (contentLower.includes(token)) score += 1;
  }

  return score;
}

/**
 * Compute Jaccard similarity between two sets of tokens.
 * Returns a value between 0 (disjoint) and 1 (identical).
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Normalize text for comparison: lowercase, remove markdown syntax,
 * remove frontmatter, strip code blocks, and tokenize.
 */
export function normalizeForComparison(text: string): string[] {
  let cleaned = text;

  // Remove YAML frontmatter
  cleaned = cleaned.replace(/^---[\s\S]*?---\n?/, "");

  // Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");

  // Remove markdown links, keeping text
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Remove markdown formatting
  cleaned = cleaned.replace(/[#*_`~>|]/g, " ");

  return tokenize(cleaned);
}
