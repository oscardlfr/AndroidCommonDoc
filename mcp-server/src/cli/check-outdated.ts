/* eslint-disable no-console */
/**
 * CLI entrypoint for check-outdated.
 *
 * Allows quality-gater, /pre-pr, and CI to check dependency freshness
 * via Bash without needing MCP tool access.
 *
 * Usage:
 *   node build/cli/check-outdated.js <project_root>
 *   node build/cli/check-outdated.js <project_root> --format json
 *   node build/cli/check-outdated.js <project_root> --format summary
 *   node build/cli/check-outdated.js <project_root> --max-age 24
 *
 * Exit codes:
 *   0 = all up to date
 *   1 = outdated dependencies found
 *   2 = error (missing TOML, network failure, etc.)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseVersions,
  parseLibraries,
  queryAllLibraries,
  buildResult,
  formatSummary,
  type CheckOutdatedResult,
} from "../tools/check-outdated.js";
import {
  readKDocState,
  createEmptyState,
  writeKDocState,
  updateDependencies,
} from "../utils/kdoc-state.js";

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.error("Usage: node build/cli/check-outdated.js <project_root> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --format json|summary  Output format (default: summary)");
    console.error("  --max-age HOURS        Cache TTL in hours (default: 24, 0 = force refresh)");
    console.error("");
    console.error("Exit codes:");
    console.error("  0 = all up to date");
    console.error("  1 = outdated dependencies found");
    console.error("  2 = error");
    process.exit(args.length === 0 ? 2 : 0);
  }

  const projectRoot = path.resolve(args[0]);
  let format = "summary";
  let maxAge = 24;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--format" && args[i + 1]) {
      format = args[i + 1];
      i++;
    } else if (args[i] === "--max-age" && args[i + 1]) {
      maxAge = Number(args[i + 1]);
      i++;
    }
  }

  // Check cache first
  if (maxAge > 0) {
    const state = readKDocState(projectRoot);
    if (state?.dependencies) {
      const cacheAgeHours =
        (Date.now() - new Date(state.dependencies.last_checked).getTime()) /
        (1000 * 60 * 60);
      if (cacheAgeHours < maxAge) {
        const cached: CheckOutdatedResult = {
          status:
            state.dependencies.outdated_count > 0 ? "OUTDATED" : "UP_TO_DATE",
          checked_at: state.dependencies.last_checked,
          total_libraries: state.dependencies.total_libraries,
          outdated_count: state.dependencies.outdated_count,
          outdated: state.dependencies.outdated,
          up_to_date_count:
            state.dependencies.total_libraries -
            state.dependencies.outdated_count,
          errors: [],
          from_cache: true,
        };

        const text =
          format === "json"
            ? JSON.stringify(cached, null, 2)
            : formatSummary(cached);
        console.log(text);
        process.exit(cached.outdated_count > 0 ? 1 : 0);
      }
    }
  }

  // Read TOML
  const tomlPath = path.join(projectRoot, "gradle", "libs.versions.toml");
  let tomlContent: string;
  try {
    tomlContent = readFileSync(tomlPath, "utf-8");
  } catch {
    console.error(`ERROR: Cannot read ${tomlPath}`);
    process.exit(2);
  }

  // Parse
  const versions = parseVersions(tomlContent);
  const libraries = parseLibraries(tomlContent, versions);

  if (libraries.length === 0) {
    console.error("ERROR: No libraries found in TOML");
    process.exit(2);
  }

  // Query Maven Central
  const mavenResults = await queryAllLibraries(libraries);
  const result = buildResult(mavenResults, false);

  // Cache results in kdoc-state.json
  try {
    const state = readKDocState(projectRoot) ?? createEmptyState();
    updateDependencies(state, {
      last_checked: result.checked_at,
      cache_ttl_hours: maxAge,
      total_libraries: result.total_libraries,
      outdated_count: result.outdated_count,
      outdated: result.outdated,
    });
    writeKDocState(projectRoot, state);
  } catch {
    // Non-fatal — state persistence is best-effort
  }

  // Output
  const text =
    format === "json"
      ? JSON.stringify(result, null, 2)
      : formatSummary(result);
  console.log(text);

  // Exit code: 0 = up to date, 1 = outdated found
  process.exit(result.outdated_count > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`check-outdated CLI error: ${err}`);
  process.exit(2);
});
