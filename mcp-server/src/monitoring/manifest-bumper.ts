/**
 * Manifest version bump utilities for /monitor-docs auto-bump workflow.
 *
 * bumpManifestVersion: updates a single key across versions + profiles in place.
 * resolveCoupledVersions: returns keys that must move together (from coupled_versions).
 */

import { readFile, writeFile } from "node:fs/promises";
import { logger } from "../utils/logger.js";

/** Shape of versions-manifest.json relevant to bumping. */
interface VersionsManifest {
  versions: Record<string, string>;
  profiles?: Record<string, Record<string, string>>;
  coupled_versions?: Record<string, string[]>;
  [key: string]: unknown;
}

/**
 * Bump a version key in versions-manifest.json.
 *
 * Updates:
 * - `versions[key]`
 * - `profiles.*.key` for every profile that contains the key
 * - `updated` timestamp
 *
 * @returns The updated manifest object (also written to disk).
 */
export async function bumpManifestVersion(
  key: string,
  newVersion: string,
  manifestPath: string,
): Promise<{ updated: string[]; manifest: VersionsManifest }> {
  const raw = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as VersionsManifest;
  const updated: string[] = [];

  // Update top-level versions
  if (key in manifest.versions) {
    manifest.versions[key] = newVersion;
    updated.push(`versions.${key}`);
  } else {
    logger.warn(`bumpManifestVersion: key "${key}" not found in versions — adding it`);
    manifest.versions[key] = newVersion;
    updated.push(`versions.${key} (added)`);
  }

  // Update matching profile entries
  if (manifest.profiles) {
    for (const [profileName, profile] of Object.entries(manifest.profiles)) {
      if (key in profile) {
        profile[key] = newVersion;
        updated.push(`profiles.${profileName}.${key}`);
      }
    }
  }

  // Bump updated timestamp
  manifest.updated = new Date().toISOString().slice(0, 10);

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  logger.info(`bumpManifestVersion: ${key} → ${newVersion} (${updated.join(", ")})`);

  return { updated, manifest };
}

/**
 * Returns all keys that must be updated when `key` is bumped.
 *
 * Reads `coupled_versions` from the manifest:
 *   { "ksp": ["kotlin"] }
 * means: when "kotlin" bumps, "ksp" is also coupled and should be reviewed.
 *
 * @returns Array of keys that are coupled to the given key (empty if none).
 */
export function resolveCoupledVersions(
  key: string,
  manifest: VersionsManifest,
): string[] {
  if (!manifest.coupled_versions) return [];
  const coupled: string[] = [];
  for (const [coupledKey, dependencies] of Object.entries(manifest.coupled_versions)) {
    if (dependencies.includes(key)) {
      coupled.push(coupledKey);
    }
  }
  return coupled;
}
