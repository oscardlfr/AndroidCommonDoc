/**
 * KDoc state persistence.
 *
 * Reads and writes .androidcommondoc/kdoc-state.json — a structured
 * snapshot of KDoc coverage, docs/api generation state, and pattern
 * alignment. Consumed by context-provider at session start for instant
 * project state without re-scanning.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ModuleCoverageState {
  pct: number;
  total_public: number;
  documented: number;
  last_checked: string;
}

export interface DocsApiState {
  generated_at: string;
  modules_generated: string[];
}

export interface PatternAlignmentState {
  drifts: number;
  last_checked: string;
}

export interface KDocState {
  schema_version: number;
  last_audit: string;
  coverage: {
    overall_pct: number;
    total_public: number;
    total_documented: number;
    per_module: Record<string, ModuleCoverageState>;
  };
  docs_api: DocsApiState;
  pattern_alignment: PatternAlignmentState;
}

// ── Paths ───────────────────────────────────────────────────────────────────

function statePath(projectRoot: string): string {
  return path.join(projectRoot, ".androidcommondoc", "kdoc-state.json");
}

// ── Read ────────────────────────────────────────────────────────────────────

export function readKDocState(projectRoot: string): KDocState | null {
  const fp = statePath(projectRoot);
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as KDocState;
  } catch {
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

export function writeKDocState(projectRoot: string, state: KDocState): void {
  const dir = path.join(projectRoot, ".androidcommondoc");
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(projectRoot), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

// ── Update helpers ──────────────────────────────────────────────────────────

/** Update coverage section from kdoc-coverage results. */
export function updateCoverage(
  state: KDocState,
  modules: Array<{ module: string; total_public: number; documented: number; coverage_pct: number }>,
): void {
  const now = new Date().toISOString();
  state.last_audit = now;

  for (const m of modules) {
    state.coverage.per_module[m.module] = {
      pct: m.coverage_pct,
      total_public: m.total_public,
      documented: m.documented,
      last_checked: now,
    };
  }

  // Recalculate totals from all modules
  const allModules = Object.values(state.coverage.per_module);
  state.coverage.total_public = allModules.reduce((s, m) => s + m.total_public, 0);
  state.coverage.total_documented = allModules.reduce((s, m) => s + m.documented, 0);
  state.coverage.overall_pct = state.coverage.total_public > 0
    ? Math.round((state.coverage.total_documented / state.coverage.total_public) * 1000) / 10
    : 100;
}

/** Update docs_api section after generate-api-docs. */
export function updateDocsApi(
  state: KDocState,
  modulesGenerated: string[],
): void {
  state.docs_api.generated_at = new Date().toISOString();
  // Merge with existing, don't replace
  const existing = new Set(state.docs_api.modules_generated);
  for (const m of modulesGenerated) existing.add(m);
  state.docs_api.modules_generated = Array.from(existing).sort();
}

/** Update pattern alignment section. */
export function updatePatternAlignment(
  state: KDocState,
  drifts: number,
): void {
  state.pattern_alignment.drifts = drifts;
  state.pattern_alignment.last_checked = new Date().toISOString();
}

/** Create empty initial state. */
export function createEmptyState(): KDocState {
  return {
    schema_version: 1,
    last_audit: new Date().toISOString(),
    coverage: {
      overall_pct: 0,
      total_public: 0,
      total_documented: 0,
      per_module: {},
    },
    docs_api: {
      generated_at: "",
      modules_generated: [],
    },
    pattern_alignment: {
      drifts: 0,
      last_checked: "",
    },
  };
}
