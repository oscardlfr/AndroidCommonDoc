/* eslint-disable no-console */
/**
 * CLI entry point for L0 sync.
 *
 * Synchronizes L0 skills, agents, and commands from the AndroidCommonDoc
 * registry to a downstream project based on its l0-manifest.json.
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
import { syncL0, resolveL0Source, type SyncOptions } from "./sync-engine.js";
import { createDefaultManifest } from "./manifest-schema.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  projectRoot: string;
  l0Root?: string;
  prune: boolean;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let projectRoot = process.cwd();
  let l0Root: string | undefined;
  let prune = false;
  let force = false;
  let dryRun = false;

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
    }
  }

  return { projectRoot, l0Root, prune, force, dryRun };
}

// ---------------------------------------------------------------------------
// Manifest bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensure l0-manifest.json exists. If not, create a default one.
 * Returns the l0Root resolved robustly (git toplevel + env fallback).
 */
async function ensureManifest(
  projectRoot: string,
  l0RootOverride?: string,
): Promise<string> {
  const manifestPath = path.join(projectRoot, "l0-manifest.json");

  try {
    await readFile(manifestPath, "utf-8");
  } catch {
    // Manifest doesn't exist - create default
    const l0Source =
      l0RootOverride ??
      path.resolve(import.meta.dirname, "..", "..", "..");

    const relativePath = path.relative(projectRoot, l0Source);
    const manifest = createDefaultManifest(relativePath);

    await writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8",
    );

    console.log(`Created default l0-manifest.json (l0_source: ${relativePath})`);
  }

  // If l0Root was provided explicitly, use it directly
  if (l0RootOverride) {
    return l0RootOverride;
  }

  // Read the manifest to get l0_source and resolve it robustly
  const content = await readFile(manifestPath, "utf-8");
  const data = JSON.parse(content);
  const l0Source: string = data.l0_source;

  // Fix #2: Use resolveL0Source (git toplevel + env fallback + registry validation)
  return resolveL0Source(l0Source, projectRoot);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { projectRoot, l0Root: l0RootArg, prune, force, dryRun } = parseArgs(process.argv);

  console.log(`Sync L0 -> ${projectRoot}`);
  if (dryRun) console.log("  (dry-run mode — no files will be modified)");

  const l0Root = await ensureManifest(projectRoot, l0RootArg);

  console.log(`L0 source: ${l0Root}`);
  console.log(`Mode: ${prune ? "prune (with removes)" : "additive (no removes)"}`);
  console.log("");

  const options: SyncOptions = { prune, force, dryRun };
  const report = await syncL0(projectRoot, l0Root, options);

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
}

main().catch((err) => {
  console.error("Sync failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
