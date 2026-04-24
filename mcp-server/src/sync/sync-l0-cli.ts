/* eslint-disable no-console */
/**
 * CLI entry point for L0 sync.
 *
 * Synchronizes skills, agents, and commands from upstream layers to a
 * downstream project based on its l0-manifest.json.
 *
 * Automatically detects topology:
 *   - Flat (1 source): calls syncL0() with the L0 root
 *   - Chain (2+ sources): calls syncMultiSource() which merges all registries
 *
 * If no manifest exists, auto-discovers L0/L1 sources nearby and creates one.
 *
 * Usage:
 *   node build/sync/sync-l0-cli.js [--project-root <path>] [--l0-root <path>] [--prune] [--force] [--dry-run]
 *
 * Options:
 *   --project-root  Path to the downstream project (default: cwd)
 *   --l0-root       Path to AndroidCommonDoc (default: resolved from manifest l0_source)
 *   --prune         Remove orphaned files (default: additive only)
 *   --force         Allow removing >5 files (requires --prune)
 *   --dry-run       Preview changes without writing
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  syncL0,
  syncMultiSource,
  resolveL0Source,
  cloneRemoteSource,
  cleanupClone,
  detectMigrations,
  applyMigrations,
  type SyncOptions,
  type SyncReport,
  type MultiSourceSyncReport,
  type MigrationRegistry,
} from "./sync-engine.js";
import {
  createDefaultManifest,
  getL0Source,
  readManifest,
} from "./manifest-schema.js";
import {
  discoverLayers,
  formatDiscovery,
  suggestTopology,
} from "./layer-discovery.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  projectRoot: string;
  l0Root?: string;
  prune: boolean;
  force: boolean;
  dryRun: boolean;
  autoMigrate: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let projectRoot = process.cwd();
  let l0Root: string | undefined;
  let prune = false;
  let force = false;
  let dryRun = false;
  let autoMigrate = false;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--project-root" && argv[i + 1]) {
      projectRoot = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--l0-root" && argv[i + 1]) {
      l0Root = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--prune") {
      prune = true;
    } else if (argv[i] === "--force") {
      force = true;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--auto-migrate") {
      autoMigrate = true;
    }
  }

  return { projectRoot, l0Root, prune, force, dryRun, autoMigrate };
}

// ---------------------------------------------------------------------------
// Manifest bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensure l0-manifest.json exists. If not, auto-discover sources and create one.
 * Returns the resolved topology info for the caller.
 */
async function ensureManifest(
  projectRoot: string,
  l0RootOverride?: string,
): Promise<{ l0Root: string; isMultiSource: boolean; clonedDirs: string[] }> {
  const manifestPath = path.join(projectRoot, "l0-manifest.json");

  if (!existsSync(manifestPath)) {
    // No manifest — try auto-discovery
    console.log("No l0-manifest.json found — discovering sources...");

    const discovery = discoverLayers(projectRoot);
    if (discovery.layers.length > 0) {
      console.log(formatDiscovery(discovery));
      const suggestion = suggestTopology(discovery);
      console.log(`Suggested topology: ${suggestion.topology} — ${suggestion.reason}`);
    }

    // Use override, env discovery, or first discovered L0
    const l0Source =
      l0RootOverride ??
      discovery.layers.find(l => l.role === "L0")?.absolutePath ??
      path.resolve(import.meta.dirname, "..", "..", "..");

    const relativePath = path.relative(projectRoot, l0Source);

    // Check if chain is appropriate (L1 found nearby)
    const l1 = discovery.layers.find(l => l.role === "L1");
    let manifest;
    if (l1 && !l0RootOverride) {
      // Auto-create chain manifest
      const { createChainManifest } = await import("./manifest-schema.js");
      manifest = createChainManifest([
        { layer: "L0", path: relativePath, role: "tooling" },
        { layer: "L1", path: l1.relativePath, role: "ecosystem" },
      ]);
      console.log(`Created chain manifest: L0=${relativePath}, L1=${l1.relativePath}`);
    } else {
      manifest = createDefaultManifest(relativePath);
      console.log(`Created flat manifest: L0=${relativePath}`);
    }

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  // Read manifest to determine topology
  const manifest = await readManifest(manifestPath);
  const isMultiSource = manifest.sources.length > 1;
  const clonedDirs: string[] = [];

  // Resolve L0 root — try local path first, then remote clone
  if (l0RootOverride) {
    return { l0Root: l0RootOverride, isMultiSource, clonedDirs };
  }

  const l0Source = getL0Source(manifest);
  const l0SourceEntry = manifest.sources.find(s => s.layer === "L0") ?? manifest.sources[0];
  const localPath = path.resolve(projectRoot, l0Source);

  if (existsSync(localPath)) {
    const l0Root = await resolveL0Source(l0Source, projectRoot);
    return { l0Root, isMultiSource, clonedDirs };
  }

  // Local path doesn't exist — try remote clone
  if (l0SourceEntry.remote) {
    console.log(`Local path not found: ${l0Source}`);
    console.log(`Cloning from remote: ${l0SourceEntry.remote}`);
    const clonedDir = cloneRemoteSource(l0SourceEntry.remote);
    clonedDirs.push(clonedDir);
    console.log(`Cloned to: ${clonedDir}`);
    return { l0Root: clonedDir, isMultiSource, clonedDirs };
  }

  // Neither local nor remote — try resolveL0Source (env var fallback)
  const l0Root = await resolveL0Source(l0Source, projectRoot);
  return { l0Root, isMultiSource, clonedDirs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { projectRoot, l0Root: l0RootArg, prune, force, dryRun, autoMigrate } = parseArgs(process.argv);

  console.log(`Sync → ${projectRoot}`);
  if (dryRun) console.log("  (dry-run mode — no files will be modified)");

  const { l0Root, isMultiSource, clonedDirs } = await ensureManifest(projectRoot, l0RootArg);

  try {

  // Auto-migrate: detect and apply pending migrations before sync
  if (autoMigrate) {
    const migrationsPath = path.join(l0Root, 'skills', 'sync-l0', 'migrations.json');
    const manifestPath = path.join(projectRoot, 'l0-manifest.json');
    try {
      const { readManifest: rm } = await import('./manifest-schema.js');
      const migrationsContent = await readFile(migrationsPath, 'utf-8');
      const registry = JSON.parse(migrationsContent) as MigrationRegistry;
      const manifest = await rm(manifestPath);
      const pending = await detectMigrations(projectRoot, registry, manifest);
      if (pending.length > 0) {
        console.log(`Auto-migrate: applying ${pending.length} pending migration(s)...`);
        for (const m of pending) console.log(`  ${m.id}: ${m.description}`);
        await applyMigrations(projectRoot, pending, manifest, manifestPath);
        console.log('Auto-migrate: complete.');
      }
    } catch (err) {
      console.warn(`Auto-migrate: skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  const options: SyncOptions = { prune, force, dryRun };
  let report: SyncReport;

  if (isMultiSource) {
    // Chain topology: merge registries from all sources
    console.log(`Topology: chain (multi-source)`);
    console.log(`Mode: ${prune ? "prune (with removes)" : "additive (no removes)"}`);
    console.log("");

    const multiReport = await syncMultiSource(projectRoot, options);
    report = multiReport;

    // Print per-source breakdown
    console.log("Sources:");
    for (const [layer, count] of Object.entries(multiReport.sourceCounts)) {
      console.log(`  ${layer}: ${count} entries`);
    }
    if (multiReport.overrides.length > 0) {
      console.log("Overrides (higher layer wins):");
      for (const ov of multiReport.overrides) {
        console.log(`  ${ov.name} (${ov.type}): ${ov.overrides} → ${ov.overriddenBy}`);
      }
    }
    console.log("");
  } else {
    // Flat topology: single L0 source
    console.log(`Topology: flat`);
    console.log(`L0 source: ${l0Root}`);
    console.log(`Mode: ${prune ? "prune (with removes)" : "additive (no removes)"}`);
    console.log("");

    report = await syncL0(projectRoot, l0Root, options);
  }

  // Print summary
  console.log(`  Added:     ${report.added}`);
  console.log(`  Updated:   ${report.updated}`);
  if (prune) {
    console.log(`  Removed:   ${report.removed}`);
  }
  if (report.skippedRemoves > 0) {
    console.log(`  Skipped removes: ${report.skippedRemoves}`);
  }
  console.log(`  Unchanged: ${report.unchanged}`);
  if (report.l0Commit) {
    console.log(`  L0 commit: ${report.l0Commit}`);
  }
  console.log("");

  // List newly added files (helps discover what's new from L0)
  if (report.added > 0) {
    const addedEntries = report.actions
      .filter((a) => a.action === "add")
      .map((a) => a.registryEntry);
    console.log("New from L0:");
    for (const entry of addedEntries) {
      console.log(`  + [${entry.type}] ${entry.name}`);
    }
    console.log("");
  }

  // List removed files (Fix #7: verbose remove listing)
  if (report.removedPaths.length > 0) {
    console.log("Removed files:");
    for (const p of report.removedPaths) {
      console.log(`  ✗ ${p}`);
    }
    console.log("");
  }

  // Print warnings
  for (const w of report.warnings) {
    console.warn(`⚠ ${w}`);
  }
  if (report.warnings.length > 0) console.log("");

  if (report.missing.length > 0) {
    console.error(`Post-sync verification FAILED — ${report.missing.length} file(s) missing from disk:`);
    for (const f of report.missing) {
      console.error(`  ✗ ${f}`);
    }
    console.error("");
    console.error("This indicates a sync bug. Re-run /sync-l0 or check ANDROID_COMMON_DOC path.");
    console.log("");
  }

  if (report.errors.length > 0) {
    console.error("Errors:");
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
    console.log("");
  }

  const total =
    report.added + report.updated + report.removed + report.unchanged;
  console.log(
    `Sync complete: ${report.added} added, ${report.updated} updated, ${report.removed} removed, ${report.unchanged} unchanged (${total} total)`,
  );
  console.log(`Manifest updated: l0-manifest.json`);

  if (report.errors.length > 0) {
    process.exit(1);
  }
  } finally {
    // Cleanup temporary clones
    for (const dir of clonedDirs) {
      console.log(`Cleaning up temporary clone: ${dir}`);
      cleanupClone(dir);
    }
  }
}

main().catch((err) => {
  console.error("Sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
