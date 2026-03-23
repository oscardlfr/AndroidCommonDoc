/**
 * Change detector for comparing upstream source state against local manifest.
 *
 * Consumes CheckResult objects from source-checker, compares against
 * versions-manifest.json, and produces severity-categorized findings
 * for version drift, breaking changes, and content changes.
 *
 * ## Deprecation/breaking-change detection strategy
 *
 * Old approach (removed): scan full page content for keywords like "deprecated"
 * or "breaking change". This produced constant noise because:
 * - Changelogs contain old breaking changes from every past release
 * - Doc pages have deprecated API docstrings that never change
 *
 * New approach:
 * - github-releases: scan only the `release_body` of the LATEST release, and
 *   only when a version drift is detected (i.e., there IS a new version).
 *   The release body is the diff — it describes only what changed in that release.
 * - doc-page / changelog: compare content_hash against the last known hash in
 *   the manifest (content_hashes section). Report a finding only when the hash
 *   changed — meaning the page was actually modified. No keyword scanning.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  MonitoringFinding,
  FindingSeverity,
  RegistryEntry,
} from "../registry/types.js";
import { checkSource } from "./source-checker.js";
import type { CheckResult } from "./source-checker.js";
import { logger } from "../utils/logger.js";

/** Report produced by the change detection process. */
export interface ChangeReport {
  findings: MonitoringFinding[];
  checked: number;
  errors: number;
  timestamp: string;
}

/** Parsed versions manifest (versions + optional content_hashes). */
interface VersionsManifest {
  versions: Record<string, string>;
  /** SHA-256 hashes of doc-page / changelog content at last-reviewed state. */
  content_hashes?: Record<string, string>;
}

/**
 * Keywords that indicate a breaking change or deprecation in a release body.
 * Only scanned against the release_body of a NEW release (never static content).
 */
const BREAKING_KEYWORDS = [
  "breaking change",
  "breaking:",
  "removed:",
  "removed in",
  "no longer supported",
  "migration required",
  "api removed",
  "behavior change",
];

const DEPRECATION_KEYWORDS = [
  "deprecated:",
  "deprecation:",
  "will be removed",
  "marked deprecated",
];

/**
 * Detect changes across registry entries by checking their monitor_urls.
 */
export async function detectChanges(
  entries: RegistryEntry[],
  manifestPath?: string,
): Promise<ChangeReport> {
  const findings: MonitoringFinding[] = [];
  let checked = 0;
  let errors = 0;

  const manifest = await loadManifest(manifestPath);

  // URL result cache — avoid checking the same URL multiple times
  const urlCache = new Map<string, CheckResult>();

  for (const entry of entries) {
    const monitorUrls = entry.metadata.monitor_urls;
    if (!monitorUrls || monitorUrls.length === 0) continue;

    for (const monitorUrl of monitorUrls) {
      checked++;

      // Deduplicate: reuse cached result for the same URL
      const cacheKey = monitorUrl.url;
      let result: CheckResult;
      if (urlCache.has(cacheKey)) {
        result = urlCache.get(cacheKey)!;
      } else {
        result = await checkSource(monitorUrl);
        urlCache.set(cacheKey, result);
      }

      if (result.status === "error" || result.status === "unreachable") {
        errors++;
        continue;
      }

      if (monitorUrl.type === "github-releases") {
        // Version drift check — compare against versions manifest
        if (result.latest_version && manifest?.versions) {
          const driftFindings = checkVersionDrift(entry.slug, result, manifest.versions, monitorUrl.manifest_key);
          findings.push(...driftFindings);

          // Only scan release_body for breaking changes if there IS a new version
          const hasDrift = driftFindings.length > 0;
          if (hasDrift && result.release_body) {
            const breakingFindings = checkReleaseBodyForBreakingChanges(
              entry.slug,
              result,
            );
            findings.push(...breakingFindings);
          }
        }
      } else if (
        monitorUrl.type === "doc-page" ||
        monitorUrl.type === "changelog"
      ) {
        // Content change check — compare hash against last known hash
        if (result.content_hash && manifest?.content_hashes) {
          const contentFindings = checkContentChange(
            entry.slug,
            result,
            manifest.content_hashes,
          );
          findings.push(...contentFindings);
        }
      }
      // maven-central: version drift only (already handled above via same pattern)
      else if (monitorUrl.type === "maven-central") {
        if (result.latest_version && manifest?.versions) {
          const driftFindings = checkVersionDrift(entry.slug, result, manifest.versions, monitorUrl.manifest_key);
          findings.push(...driftFindings);
        }
      }
    }
  }

  return {
    findings,
    checked,
    errors,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Load the versions manifest from disk.
 * Returns null if file doesn't exist or is invalid.
 */
async function loadManifest(
  manifestPath?: string,
): Promise<VersionsManifest | null> {
  if (!manifestPath) return null;

  try {
    const raw = await readFile(manifestPath, "utf-8");
    const data = JSON.parse(raw) as {
      versions?: Record<string, string>;
      content_hashes?: Record<string, string>;
    };
    if (!data.versions) return null;
    return {
      versions: data.versions,
      content_hashes: data.content_hashes,
    };
  } catch {
    logger.warn(`Could not load versions manifest: ${manifestPath}`);
    return null;
  }
}

/**
 * Check for version drift between upstream and manifest.
 *
 * Resolution order:
 * 1. `manifestKey` (explicit) — checks only that single key, no ambiguity
 * 2. URL-heuristic (legacy fallback) — iterates all keys and matches by URL substring
 *
 * The heuristic is kept for backward compat with the ~64 docs that don't yet have
 * `manifest_key`. New docs should always use `manifest_key`.
 */
function checkVersionDrift(
  slug: string,
  result: CheckResult,
  versions: Record<string, string>,
  manifestKey?: string,
): MonitoringFinding[] {
  const cleanUpstream = result.latest_version!;

  // --- Path 1: explicit manifest_key ---
  if (manifestKey) {
    const manifestVersion = versions[manifestKey];
    if (!manifestVersion) {
      logger.warn(`manifest_key "${manifestKey}" not found in versions manifest — skipping drift check for ${result.url}`);
      return [];
    }
    const cleanManifest = manifestVersion.replace(/\.x$/, "");
    if (cleanUpstream === cleanManifest || cleanUpstream === manifestVersion) {
      return [];
    }
    const summary = `Version drift: ${manifestKey} ${manifestVersion} → ${cleanUpstream}`;
    return [{
      slug,
      source_url: result.url,
      severity: "MEDIUM" as FindingSeverity,
      category: "version-drift",
      summary,
      details: `Upstream has ${cleanUpstream}, manifest has ${manifestVersion} for ${manifestKey}. Review pattern docs for API changes.`,
      finding_hash: generateFindingHash(slug, result.url, "version-drift", summary),
    }];
  }

  // --- Path 2: URL-heuristic fallback (legacy) ---
  const findings: MonitoringFinding[] = [];
  for (const [key, manifestVersion] of Object.entries(versions)) {
    const urlLower = result.url.toLowerCase();
    const keyNormalized = key.toLowerCase().replace(/[-_.]/g, "");
    const urlNormalized = urlLower.replace(/[-_.]/g, "");
    const keyWithDashes = key.toLowerCase();

    if (
      !urlLower.includes(keyWithDashes) &&
      !urlNormalized.includes(keyNormalized)
    ) {
      continue;
    }

    const cleanManifest = manifestVersion.replace(/\.x$/, "");
    if (cleanUpstream !== cleanManifest && cleanUpstream !== manifestVersion) {
      const summary = `Version drift: ${key} ${manifestVersion} → ${cleanUpstream}`;
      findings.push({
        slug,
        source_url: result.url,
        severity: "MEDIUM" as FindingSeverity,
        category: "version-drift",
        summary,
        details: `Upstream has ${cleanUpstream}, manifest has ${manifestVersion} for ${key}. Review pattern docs for API changes.`,
        finding_hash: generateFindingHash(slug, result.url, "version-drift", summary),
      });
    }
  }
  return findings;
}

/**
 * Scan the release_body of the LATEST release for breaking changes and deprecations.
 *
 * Only called when version drift is detected — meaning this IS a new release body,
 * not historical content. False positive rate is much lower than scanning full changelogs.
 */
function checkReleaseBodyForBreakingChanges(
  slug: string,
  result: CheckResult,
): MonitoringFinding[] {
  const findings: MonitoringFinding[] = [];
  const bodyLower = result.release_body!.toLowerCase();

  for (const keyword of BREAKING_KEYWORDS) {
    if (bodyLower.includes(keyword)) {
      const summary = `Breaking change in ${result.latest_version}: "${keyword}" in release notes`;
      findings.push({
        slug,
        source_url: result.url,
        severity: "HIGH" as FindingSeverity,
        category: "breaking-change",
        summary,
        details: `Release ${result.latest_version} release notes contain "${keyword}". Review pattern docs for impact.`,
        finding_hash: generateFindingHash(slug, result.url, "breaking-change", summary),
      });
      // One finding per URL — first keyword match is enough signal
      return findings;
    }
  }

  for (const keyword of DEPRECATION_KEYWORDS) {
    if (bodyLower.includes(keyword)) {
      const summary = `Deprecation in ${result.latest_version}: "${keyword}" in release notes`;
      findings.push({
        slug,
        source_url: result.url,
        severity: "MEDIUM" as FindingSeverity,
        category: "deprecation-in-release",
        summary,
        details: `Release ${result.latest_version} release notes contain "${keyword}". Check if any patterns reference the deprecated API.`,
        finding_hash: generateFindingHash(slug, result.url, "deprecation-in-release", summary),
      });
      return findings;
    }
  }

  return findings;
}

/**
 * Check if a doc-page or changelog has changed since the last known hash.
 *
 * Only fires when the content_hashes section of the manifest has an entry
 * for this URL — meaning the page was previously reviewed and its hash recorded.
 * No keyword scanning — a hash change is the only signal.
 */
function checkContentChange(
  slug: string,
  result: CheckResult,
  contentHashes: Record<string, string>,
): MonitoringFinding[] {
  const knownHash = contentHashes[result.url];
  if (!knownHash) {
    // No baseline hash recorded yet — not a finding, just untracked
    logger.info(`No baseline hash for ${result.url} — skipping content change check`);
    return [];
  }

  if (result.content_hash === knownHash) {
    // Content unchanged
    return [];
  }

  const summary = `Doc page changed: ${result.url}`;
  return [
    {
      slug,
      source_url: result.url,
      severity: "LOW" as FindingSeverity,
      category: "doc-content-changed",
      summary,
      details: `Content hash changed from ${knownHash.slice(0, 12)}... to ${result.content_hash?.slice(0, 12)}... Review the page for relevant API or behavior changes, then update content_hashes in versions-manifest.json.`,
      finding_hash: generateFindingHash(slug, result.url, "doc-content-changed", summary),
    },
  ];
}

/**
 * Generate a deterministic hash for a finding.
 */
function generateFindingHash(
  slug: string,
  url: string,
  category: string,
  summary: string,
): string {
  const input = `${slug}|${url}|${category}|${summary}`;
  return createHash("sha256").update(input).digest("hex");
}
