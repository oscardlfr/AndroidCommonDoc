/* eslint-disable no-console */
/**
 * CLI entry point for L0 sync.
 *
 * Synchronizes L0 skills, agents, and commands from the AndroidCommonDoc
 * registry to a downstream project based on its l0-manifest.json.
 *
 * Usage:
 *   npx tsx src/sync/sync-l0-cli.ts [--project-root <path>] [--l0-root <path>]
 *
 * Options:
 *   --project-root  Path to the downstream project (default: cwd)
 *   --l0-root       Path to AndroidCommonDoc (default: resolved from manifest l0_source)
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { syncL0 } from "./sync-engine.js";
import { createDefaultManifest } from "./manifest-schema.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { projectRoot: string; l0Root?: string } {
  let projectRoot = process.cwd();
  let l0Root: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--project-root" && argv[i + 1]) {
      projectRoot = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i] === "--l0-root" && argv[i + 1]) {
      l0Root = path.resolve(argv[i + 1]);
      i++;
    }
  }

  return { projectRoot, l0Root };
}

// ---------------------------------------------------------------------------
// Manifest bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensure l0-manifest.json exists. If not, create a default one.
 * Returns the l0Root resolved from the manifest or the provided override.
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

  // If l0Root was provided, use it; otherwise resolve from manifest
  if (l0RootOverride) {
    return l0RootOverride;
  }

  // Read the manifest to get l0_source
  const content = await readFile(manifestPath, "utf-8");
  const data = JSON.parse(content);
  const l0Source: string = data.l0_source;

  return path.resolve(projectRoot, l0Source);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { projectRoot, l0Root: l0RootArg } = parseArgs(process.argv);

  console.log(`Sync L0 -> ${projectRoot}`);

  const l0Root = await ensureManifest(projectRoot, l0RootArg);

  console.log(`L0 source: ${l0Root}`);
  console.log("");

  const report = await syncL0(projectRoot, l0Root);

  // Print summary
  console.log(`  Added:     ${report.added}`);
  console.log(`  Updated:   ${report.updated}`);
  console.log(`  Removed:   ${report.removed}`);
  console.log(`  Unchanged: ${report.unchanged}`);
  console.log("");

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
  console.error("Sync failed:", err);
  process.exit(1);
});
