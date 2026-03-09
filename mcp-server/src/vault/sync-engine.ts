/**
 * Sync engine: orchestrates the full vault sync pipeline.
 *
 * Ties together collector, transformer, MOC generator, and vault writer
 * into a single syncVault() call. Supports four operations:
 * - syncVault: incremental sync (collect -> transform -> MOC -> write)
 * - initVault: first-time setup with migration + .obsidian/ config
 * - cleanOrphans: sync + remove files no longer in source repos
 * - getVaultStatus: lightweight status check with per-layer breakdown
 */

import { mkdir, stat } from "node:fs/promises";
import { logger } from "../utils/logger.js";
import { collectAll } from "./collector.js";
import { loadVaultConfig, saveVaultConfig } from "./config.js";
import { generateAllMOCs } from "./moc-generator.js";
import { transformAll } from "./transformer.js";
import type { VaultConfig, VaultEntry, SyncResult } from "./types.js";
import {
  writeVault,
  migrateToLayerFirst,
  loadManifest,
  detectOrphans,
} from "./vault-writer.js";

/**
 * Detect duplicate vault entries before materialization.
 *
 * Checks for:
 * 1. Case-insensitive vault path collisions (two entries map to the same path)
 * 2. Same source file (vault_source) mapped to multiple vault paths
 *
 * @param entries - Transformed vault entries to check
 * @returns Array of error strings. Empty = no duplicates found.
 */
export function detectDuplicates(entries: VaultEntry[]): string[] {
  const errors: string[] = [];

  // Check 1: Case-insensitive vault path collisions
  const seenPaths = new Map<string, string>(); // normalized path -> slug
  for (const entry of entries) {
    const normalized = entry.vaultPath.toLowerCase();
    const existingSlug = seenPaths.get(normalized);
    if (existingSlug !== undefined) {
      errors.push(
        `Duplicate vault path: "${entry.vaultPath}" (slug: ${entry.slug}) ` +
          `collides with slug: ${existingSlug}`,
      );
    } else {
      seenPaths.set(normalized, entry.slug);
    }
  }

  // Check 2: Same source file mapped to multiple vault paths
  const sourceToVaultPaths = new Map<string, string[]>();
  for (const entry of entries) {
    const source = entry.frontmatter?.vault_source as string | undefined;
    if (!source) continue;
    const existing = sourceToVaultPaths.get(source) ?? [];
    existing.push(entry.vaultPath);
    sourceToVaultPaths.set(source, existing);
  }

  for (const [source, paths] of sourceToVaultPaths) {
    if (paths.length > 1) {
      errors.push(
        `Source file "${source}" mapped to ${paths.length} vault paths: ${paths.join(", ")}`,
      );
    }
  }

  return errors;
}

/**
 * Merge a partial config override with the saved/default config.
 */
async function resolveConfig(
  configOverride?: Partial<VaultConfig>,
): Promise<VaultConfig> {
  const config = await loadVaultConfig();
  if (configOverride) {
    return { ...config, ...configOverride };
  }
  return config;
}

/**
 * Run the core pipeline: collect -> transform -> MOC -> combine.
 *
 * Shared by syncVault, initVault, and cleanOrphans.
 */
async function runPipeline(config: VaultConfig) {
  // 1. Collect all sources
  logger.info(`Collecting sources from ${config.projects.length || "auto-discovered"} projects...`);
  const sources = await collectAll(config);
  logger.info(`Collected ${sources.length} sources`);

  // 2. Transform sources to vault entries
  const entries = transformAll(sources);
  logger.info(`Transformed ${entries.length} entries`);

  // 3. Generate MOC pages
  const mocs = generateAllMOCs(entries);
  logger.info(`Generated ${mocs.length} MOC pages`);

  // 4. Combine entries + MOCs
  const allEntries = [...entries, ...mocs];

  // 5. Pre-materialization dedup gate
  const duplicateErrors = detectDuplicates(allEntries);
  if (duplicateErrors.length > 0) {
    throw new Error(
      `Vault sync aborted: ${duplicateErrors.length} duplicate(s) detected:\n` +
        duplicateErrors.map((e) => `  - ${e}`).join("\n"),
    );
  }

  return allEntries;
}

/**
 * Sync the vault: collect sources, transform, generate MOCs, write.
 *
 * Performs an incremental sync -- only writes files whose content has changed
 * since the last sync (via manifest hash comparison).
 */
export async function syncVault(
  configOverride?: Partial<VaultConfig>,
): Promise<SyncResult> {
  const config = await resolveConfig(configOverride);

  try {
    const allEntries = await runPipeline(config);

    // Write to vault (incremental)
    const result = await writeVault(config.vaultPath, allEntries, {
      init: false,
    });

    // Only persist config when not using an override (avoid test corruption)
    if (!configOverride) {
      config.lastSync = new Date().toISOString();
      await saveVaultConfig(config);
    }

    logger.info(
      `Sync complete: ${result.written} written, ${result.unchanged} unchanged, ${result.removed} removed`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Sync failed: ${message}`);
    return {
      written: 0,
      unchanged: 0,
      removed: 0,
      errors: [message],
      duration: 0,
    };
  }
}

/**
 * Initialize a new vault: creates directory, migrates old structure, and syncs.
 *
 * Like syncVault but with init: true to set up the vault structure.
 * Triggers clean-slate migration before first sync to detect and
 * remove old flat structure (patterns/, skills/, projects/).
 */
export async function initVault(
  configOverride?: Partial<VaultConfig>,
): Promise<SyncResult> {
  const config = await resolveConfig(configOverride);

  try {
    // Create vault directory if it doesn't exist
    await mkdir(config.vaultPath, { recursive: true });

    // Migrate from old flat structure to layer-first if needed
    const migrated = await migrateToLayerFirst(config.vaultPath);
    if (migrated) {
      logger.info("Migrated from flat to layer-first structure");
    } else {
      logger.info("No migration needed -- fresh vault");
    }

    const allEntries = await runPipeline(config);

    // Write to vault with init mode (creates .obsidian/ + _vault-meta/)
    // Also clean orphans to remove stale files from previous structure
    const result = await writeVault(config.vaultPath, allEntries, {
      init: true,
      clean: true,
    });

    // Only persist config when not using an override (avoid test corruption)
    if (!configOverride) {
      config.lastSync = new Date().toISOString();
      await saveVaultConfig(config);
    }

    logger.info(
      `Init complete: ${result.written} written, vault at ${config.vaultPath}`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Init failed: ${message}`);
    return {
      written: 0,
      unchanged: 0,
      removed: 0,
      errors: [message],
      duration: 0,
    };
  }
}

/**
 * Sync and clean orphaned files from the vault.
 *
 * Like syncVault but also removes files in the manifest that are
 * no longer produced by the current source set.
 */
export async function cleanOrphans(
  configOverride?: Partial<VaultConfig>,
): Promise<SyncResult> {
  const config = await resolveConfig(configOverride);

  try {
    const allEntries = await runPipeline(config);

    // Write to vault with clean mode
    const result = await writeVault(config.vaultPath, allEntries, {
      init: false,
      clean: true,
    });

    // Only persist config when not using an override (avoid test corruption)
    if (!configOverride) {
      config.lastSync = new Date().toISOString();
      await saveVaultConfig(config);
    }

    logger.info(
      `Clean complete: ${result.written} written, ${result.removed} removed`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Clean failed: ${message}`);
    return {
      written: 0,
      unchanged: 0,
      removed: 0,
      errors: [message],
      duration: 0,
    };
  }
}

/**
 * Get vault status without performing a sync.
 *
 * Returns configuration state, file counts, orphan detection,
 * and per-layer file breakdown without writing any files to disk.
 */
export async function getVaultStatus(
  configOverride?: Partial<VaultConfig>,
): Promise<{
  configured: boolean;
  vaultPath: string;
  lastSync: string | null;
  fileCount: number;
  orphanCount: number;
  projects: string[];
  layers: {
    L0: number;
    L1: number;
    L2: number;
  };
}> {
  const config = await resolveConfig(configOverride);

  // Extract project names from ProjectConfig[]
  const projectNames =
    config.projects.length > 0
      ? config.projects.map((p) => p.name)
      : ["auto-discover"];

  // Check if vault directory exists
  let vaultExists = false;
  try {
    const vaultStat = await stat(config.vaultPath);
    vaultExists = vaultStat.isDirectory();
  } catch {
    // Directory doesn't exist
  }

  if (!vaultExists) {
    return {
      configured: false,
      vaultPath: config.vaultPath,
      lastSync: null,
      fileCount: 0,
      orphanCount: 0,
      projects: projectNames,
      layers: { L0: 0, L1: 0, L2: 0 },
    };
  }

  // Load manifest to get file count and per-layer breakdown
  const manifest = await loadManifest(config.vaultPath);
  const fileCount = Object.keys(manifest.files).length;

  // Compute per-layer counts from manifest
  const layers = { L0: 0, L1: 0, L2: 0 };
  for (const fileInfo of Object.values(manifest.files)) {
    if (fileInfo.layer === "L0") layers.L0++;
    else if (fileInfo.layer === "L1") layers.L1++;
    else if (fileInfo.layer === "L2") layers.L2++;
  }

  // Collect current sources to detect orphans
  let orphanCount = 0;
  try {
    const sources = await collectAll(config);
    const entries = transformAll(sources);
    const mocs = generateAllMOCs(entries);
    const allEntries = [...entries, ...mocs];
    const currentPaths = new Set(allEntries.map((e) => e.vaultPath));
    const orphans = detectOrphans(manifest, currentPaths);
    orphanCount = orphans.length;
  } catch (err) {
    logger.warn(
      `Could not compute orphans: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    configured: true,
    vaultPath: config.vaultPath,
    lastSync: config.lastSync ?? null,
    fileCount,
    orphanCount,
    projects: projectNames,
    layers,
  };
}
