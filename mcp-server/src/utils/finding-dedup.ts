/**
 * Three-pass finding deduplication engine.
 *
 * Pass 1: Exact key match - group by dedupe_key, keep highest severity, merge found_by[]
 * Pass 2: Proximity match - same file + overlapping category within 5-line range + >80% title similarity -> merge
 * Pass 3: Category rollup - files with >5 findings get grouped under one entry with children[]
 */

import type { AuditFinding } from "../types/findings.js";
import { maxSeverity, generateFindingId } from "../types/findings.js";

// ---- Title similarity (Dice coefficient on bigrams) -------------------------

function bigrams(s: string): Set<string> {
  const lower = s.toLowerCase();
  const result = new Set<string>();
  for (let i = 0; i < lower.length - 1; i++) {
    result.add(lower.slice(i, i + 2));
  }
  return result;
}

/**
 * Compute title similarity using the Dice coefficient on character bigrams.
 * Returns a value between 0.0 (completely different) and 1.0 (identical).
 */
export function titleSimilarity(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.size === 0 && bigramsB.size === 0) return 0.0;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0.0;
  if (a === b) return 1.0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// ---- Pass 1: Exact dedupe_key match ----------------------------------------

/**
 * Group findings by dedupe_key. For duplicates, keep the entry with the
 * highest severity and merge found_by[] arrays plus source fields.
 */
export function dedupeExactKeys(findings: AuditFinding[]): AuditFinding[] {
  const groups = new Map<string, AuditFinding[]>();

  for (const f of findings) {
    const existing = groups.get(f.dedupe_key);
    if (existing) {
      existing.push(f);
    } else {
      groups.set(f.dedupe_key, [f]);
    }
  }

  const result: AuditFinding[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Find the entry with the highest severity
    let winner = group[0];
    for (let i = 1; i < group.length; i++) {
      if (maxSeverity(winner.severity, group[i].severity) === group[i].severity) {
        winner = group[i];
      }
    }

    // Collect all unique sources and found_by entries
    const allSources = new Set<string>();
    for (const f of group) {
      allSources.add(f.source);
      if (f.found_by) {
        for (const fb of f.found_by) {
          allSources.add(fb);
        }
      }
    }

    result.push({
      ...winner,
      found_by: [...allSources],
    });
  }

  return result;
}

// ---- Pass 2: Proximity match -----------------------------------------------

/**
 * Merge findings that are in the same file, same category, within a line range,
 * and have similar titles (>80% Dice coefficient).
 */
export function dedupeProximity(findings: AuditFinding[], lineRange = 5): AuditFinding[] {
  // Track which findings have been merged into another
  const merged = new Set<number>();
  const result: AuditFinding[] = [];

  for (let i = 0; i < findings.length; i++) {
    if (merged.has(i)) continue;

    let current = findings[i];

    for (let j = i + 1; j < findings.length; j++) {
      if (merged.has(j)) continue;

      const other = findings[j];

      // Must have same file (and file must be defined)
      if (!current.file || !other.file || current.file !== other.file) continue;

      // Must have same category
      if (current.category !== other.category) continue;

      // Must be within line range (both lines must be defined)
      if (current.line === undefined || other.line === undefined) continue;
      if (Math.abs(current.line - other.line) > lineRange) continue;

      // Must have similar titles
      if (titleSimilarity(current.title, other.title) <= 0.8) continue;

      // Merge: keep the one with highest severity
      merged.add(j);

      const keepCurrent = maxSeverity(current.severity, other.severity) === current.severity;
      const winner = keepCurrent ? current : other;
      const loser = keepCurrent ? other : current;

      // Merge found_by
      const allSources = new Set<string>();
      allSources.add(winner.source);
      allSources.add(loser.source);
      if (winner.found_by) for (const fb of winner.found_by) allSources.add(fb);
      if (loser.found_by) for (const fb of loser.found_by) allSources.add(fb);

      current = {
        ...winner,
        found_by: [...allSources],
      };
    }

    result.push(current);
  }

  return result;
}

// ---- Pass 3: Category rollup ------------------------------------------------

/**
 * Files with more than `threshold` findings get grouped under a single
 * parent finding with children[].
 */
export function rollupByFile(findings: AuditFinding[], threshold = 5): AuditFinding[] {
  // Group findings by file
  const byFile = new Map<string, AuditFinding[]>();
  const noFile: AuditFinding[] = [];

  for (const f of findings) {
    if (!f.file) {
      noFile.push(f);
      continue;
    }
    const existing = byFile.get(f.file);
    if (existing) {
      existing.push(f);
    } else {
      byFile.set(f.file, [f]);
    }
  }

  const result: AuditFinding[] = [...noFile];

  for (const [file, group] of byFile.entries()) {
    if (group.length <= threshold) {
      result.push(...group);
      continue;
    }

    // Compute parent severity as max of all children
    let parentSeverity = group[0].severity;
    for (let i = 1; i < group.length; i++) {
      parentSeverity = maxSeverity(parentSeverity, group[i].severity);
    }

    // Use the most common category among children, fallback to first
    const categoryCounts = new Map<string, number>();
    for (const f of group) {
      categoryCounts.set(f.category, (categoryCounts.get(f.category) ?? 0) + 1);
    }
    let parentCategory = group[0].category;
    let maxCount = 0;
    for (const [cat, count] of categoryCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        parentCategory = cat as typeof parentCategory;
      }
    }

    const dedupeKey = `rollup:${file}`;
    const parent: AuditFinding = {
      id: generateFindingId(dedupeKey),
      dedupe_key: dedupeKey,
      severity: parentSeverity,
      category: parentCategory,
      source: "dedup-engine",
      check: "file-rollup",
      title: `${group.length} findings in ${file}`,
      file,
      children: group,
    };

    result.push(parent);
  }

  return result;
}

// ---- Main entry point -------------------------------------------------------

/**
 * Run all three deduplication passes on a list of findings.
 */
export function deduplicateFindings(findings: AuditFinding[]): AuditFinding[] {
  let result = dedupeExactKeys(findings);
  result = dedupeProximity(result);
  result = rollupByFile(result);
  return result;
}
