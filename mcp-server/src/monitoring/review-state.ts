/**
 * Review state persistence for monitoring findings.
 *
 * Tracks which findings have been accepted, rejected, or deferred by the user.
 * Enables review-aware filtering so that subsequent monitoring runs only surface
 * new findings. Deferred findings re-surface after a configurable TTL.
 *
 * Uses atomic writes (write-to-temp, rename) to prevent corruption.
 */

import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import type { MonitoringFinding } from "../registry/types.js";
import { logger } from "../utils/logger.js";

/** Status a user can assign to a reviewed finding. */
export type ReviewStatus = "accepted" | "rejected" | "deferred";

/** A single reviewed finding entry in the persistent state. */
export interface ReviewEntry {
  status: ReviewStatus;
  reviewed_at: string;
  finding_hash: string;
  reason?: string;
  action?: string;
  deferred_until?: string;
}

/** Persistent review state with schema versioning. */
export interface ReviewState {
  schema_version: 1;
  last_run: string;
  findings: Record<string, ReviewEntry>;
}

/** Default TTL in days for deferred findings before they re-surface. */
const DEFAULT_TTL_DAYS = 90;

/**
 * Load review state from a JSON file.
 *
 * Returns an empty default state if the file does not exist or has an
 * incompatible schema version.
 *
 * @param statePath - Absolute path to the state JSON file
 */
export async function loadReviewState(
  statePath: string,
): Promise<ReviewState> {
  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed.schema_version !== 1) {
      logger.warn(
        `Review state schema version mismatch: expected 1, got ${String(parsed.schema_version)}. Returning empty state.`,
      );
      return createEmptyState();
    }

    return parsed as unknown as ReviewState;
  } catch {
    // File doesn't exist or is unreadable — return default empty state
    return createEmptyState();
  }
}

/**
 * Save review state to a JSON file using atomic write.
 *
 * Writes to a temporary file first, then renames to the target path.
 * This prevents corruption from partial writes or crashes.
 *
 * @param statePath - Absolute path to the state JSON file
 * @param state - The review state to persist
 */
export async function saveReviewState(
  statePath: string,
  state: ReviewState,
): Promise<void> {
  const tmpPath = `${statePath}.tmp`;
  const json = JSON.stringify(state, null, 2);

  await writeFile(tmpPath, json, "utf-8");

  try {
    await rename(tmpPath, statePath);
  } catch {
    // On Windows, rename may fail if target exists. Remove target and retry.
    try {
      await unlink(statePath);
    } catch {
      // Target may not exist — ignore
    }
    await rename(tmpPath, statePath);
  }
}

/**
 * Filter findings to only include new or re-surfaced ones.
 *
 * Removes findings that have been previously accepted or rejected.
 * Deferred findings are filtered out while within their TTL, but
 * re-surface once the TTL expires.
 *
 * @param findings - All findings from the current monitoring run
 * @param state - The persisted review state
 * @param ttlDays - TTL in days for deferred findings (default: 90)
 * @returns Object with filtered findings and list of stale deferral hashes
 */
export function filterNewFindings(
  findings: MonitoringFinding[],
  state: ReviewState,
  ttlDays: number = DEFAULT_TTL_DAYS,
): MonitoringFinding[] {
  const now = Date.now();

  return findings.filter((finding) => {
    const entry = state.findings[finding.finding_hash];

    // No review entry — it's a new finding
    if (!entry) return true;

    // Accepted or rejected — filter out permanently
    if (entry.status === "accepted" || entry.status === "rejected") {
      return false;
    }

    // Deferred — check if TTL has expired
    if (entry.status === "deferred") {
      return isDeferralExpired(entry, now, ttlDays);
    }

    // Unknown status — treat as new
    return true;
  });
}

/**
 * Extract stale deferral hashes from findings and review state.
 *
 * Returns finding hashes that were deferred but have expired their TTL,
 * indicating they should be re-reviewed.
 */
export function getStaleDeferrals(
  findings: MonitoringFinding[],
  state: ReviewState,
  ttlDays: number = DEFAULT_TTL_DAYS,
): string[] {
  const now = Date.now();
  const stale: string[] = [];

  for (const finding of findings) {
    const entry = state.findings[finding.finding_hash];
    if (entry?.status === "deferred" && isDeferralExpired(entry, now, ttlDays)) {
      stale.push(finding.finding_hash);
    }
  }

  return stale;
}

/**
 * Check if a deferred finding's TTL has expired.
 *
 * Uses deferred_until if set, otherwise falls back to reviewed_at + ttlDays.
 */
function isDeferralExpired(
  entry: ReviewEntry,
  now: number,
  ttlDays: number,
): boolean {
  if (entry.deferred_until) {
    // Explicit deferral expiry date
    return now >= new Date(entry.deferred_until).getTime();
  }

  // Fall back to reviewed_at + TTL
  const reviewedAt = new Date(entry.reviewed_at).getTime();
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return now >= reviewedAt + ttlMs;
}

/** Create an empty default review state. */
function createEmptyState(): ReviewState {
  return {
    schema_version: 1,
    last_run: new Date().toISOString(),
    findings: {},
  };
}
