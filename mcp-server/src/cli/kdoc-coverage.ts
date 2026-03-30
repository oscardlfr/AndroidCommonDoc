/**
 * CLI entrypoint for kdoc-coverage.
 *
 * Allows quality-gater and other agents to measure KDoc coverage
 * via Bash without needing MCP tool access.
 *
 * Usage:
 *   node build/cli/kdoc-coverage.js <project_root>
 *   node build/cli/kdoc-coverage.js <project_root> --modules core-domain,core-data
 *   node build/cli/kdoc-coverage.js <project_root> --changed-files src/A.kt,src/B.kt
 *   node build/cli/kdoc-coverage.js <project_root> --format json
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { analyzeFile } from "../tools/kdoc-coverage.js";
import { parseSettingsModules } from "../utils/gradle-parser.js";
import { readKDocState, writeKDocState, createEmptyState, updateCoverage } from "../utils/kdoc-state.js";

// ── Types ───────────────────────────────────────────────────────────────────

interface ModuleCoverage {
  module: string;
  total_public: number;
  documented: number;
  coverage_pct: number;
  undocumented: Array<{ file: string; line: number; type: string; name: string }>;
}

// ── File walker ─────────────────────────────────────────────────────────────

function walkKt(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkKt(full));
      } else if (entry.name.endsWith(".kt")) {
        results.push(full);
      }
    }
  } catch {
    return results;
  }
  return results;
}

function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return (
    segments.some((s) => s === "test" || s === "androidTest" || s === "testFixtures") ||
    normalized.endsWith("Test.kt")
  );
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.error("Usage: node build/cli/kdoc-coverage.js <project_root> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --modules mod1,mod2     Specific modules (default: auto-detect)");
    console.error("  --changed-files a,b     Only check these files");
    console.error("  --format json|markdown  Output format (default: markdown)");
    process.exit(args.length === 0 ? 1 : 0);
  }

  const projectRoot = path.resolve(args[0]);
  let modules: string[] | undefined;
  let changedFiles: string[] | undefined;
  let format = "markdown";

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--modules" && args[i + 1]) {
      modules = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--changed-files" && args[i + 1]) {
      changedFiles = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--format" && args[i + 1]) {
      format = args[i + 1];
      i++;
    }
  }

  // Discover modules
  let moduleList: string[];
  if (modules) {
    moduleList = modules;
  } else {
    const settingsPath = path.join(projectRoot, "settings.gradle.kts");
    try {
      const parsed = await parseSettingsModules(settingsPath);
      moduleList = parsed.map((m) => m.replace(/^:/, "").replace(/:/g, "/"));
    } catch {
      moduleList = ["."];
    }
  }

  const changedSet = changedFiles ? new Set(changedFiles) : undefined;
  const results: ModuleCoverage[] = [];

  for (const mod of moduleList) {
    const moduleDir = mod === "." ? projectRoot : path.join(projectRoot, mod);
    try {
      if (!statSync(moduleDir).isDirectory()) continue;
    } catch {
      continue;
    }

    let ktFiles = walkKt(moduleDir).filter((f) => !isTestPath(f));

    if (changedSet) {
      ktFiles = ktFiles.filter((f) => {
        const normalized = f.replace(/\\/g, "/");
        return Array.from(changedSet).some(
          (cf) => normalized.endsWith(cf) || normalized.includes(cf),
        );
      });
    }

    let totalPublic = 0;
    let totalDocumented = 0;
    const undocumented: ModuleCoverage["undocumented"] = [];

    for (const filePath of ktFiles) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const result = analyzeFile(filePath, content);
        totalPublic += result.total;
        totalDocumented += result.documented;
        undocumented.push(...result.undocumented);
      } catch {
        continue;
      }
    }

    if (totalPublic > 0 || !changedSet) {
      results.push({
        module: mod,
        total_public: totalPublic,
        documented: totalDocumented,
        coverage_pct: totalPublic > 0
          ? Math.round((totalDocumented / totalPublic) * 1000) / 10
          : 100,
        undocumented,
      });
    }
  }

  const totalPub = results.reduce((s, m) => s + m.total_public, 0);
  const totalDoc = results.reduce((s, m) => s + m.documented, 0);
  const overallPct = totalPub > 0 ? Math.round((totalDoc / totalPub) * 1000) / 10 : 100;

  if (format === "json") {
    const output = {
      modules: results,
      overall_coverage: overallPct,
      ...(changedSet ? { changed_files_coverage: overallPct } : {}),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log("## KDoc Coverage");
    console.log("");
    console.log("| Module | Public APIs | Documented | Coverage |");
    console.log("|--------|------------|------------|----------|");
    for (const m of results) {
      console.log(`| ${m.module} | ${m.total_public} | ${m.documented} | ${m.coverage_pct}% |`);
    }
    console.log(`| **Overall** | **${totalPub}** | **${totalDoc}** | **${overallPct}%** |`);

    const allUndoc = results.flatMap((m) => m.undocumented);
    if (allUndoc.length > 0) {
      console.log("");
      console.log("### Undocumented Public APIs");
      console.log("");
      const shown = allUndoc.slice(0, 30);
      for (const u of shown) {
        console.log(`- \`${u.name}\` (${u.type}) — ${u.file}:${u.line}`);
      }
      if (allUndoc.length > 30) {
        console.log(`- ... and ${allUndoc.length - 30} more`);
      }
    }
  }

  // Persist to kdoc-state.json
  if (!changedSet) {
    try {
      const state = readKDocState(projectRoot) ?? createEmptyState();
      updateCoverage(state, results);
      writeKDocState(projectRoot, state);
    } catch {
      // Non-fatal — state persistence is best-effort
    }
  }

  // Exit code: 0 if all changed files documented, 1 if gaps
  if (changedSet) {
    const gaps = results.flatMap((m) => m.undocumented);
    process.exit(gaps.length > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`kdoc-coverage CLI error: ${err}`);
  process.exit(2);
});
