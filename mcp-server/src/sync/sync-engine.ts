/**
 * L0 Sync Engine
 *
 * Reads a project's l0-manifest.json, resolves desired assets against the L0
 * registry, computes a diff (new/updated/removed/unchanged), materializes
 * full copies with version headers, and updates checksums.
 *
 * This is the core distribution mechanism replacing install-claude-skills.sh
 * and the delegate pattern. It makes skill distribution declarative,
 * reproducible, and auditable.
 *
 * Safety invariants:
 * - Empty registry (0 entries) always aborts — never treats as "all orphan"
 * - Removes are skipped by default — only applied when prune=true
 * - Removes >5 files require force=true or user confirmation (in CLI)
 * - l0_source is resolved via git toplevel, not CWD
 * - Registry existence is validated before any sync operations
 */

import { readFile, writeFile, mkdir, unlink, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import {
  generateRegistry,
  type SkillRegistry,
  type SkillRegistryEntry,
} from "../registry/skill-registry.js";
import {
  readManifest,
  writeManifest,
  getOrderedSources,
  type Manifest,
  type LayerSource,
} from "./manifest-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Possible sync actions for a single entry */
export type SyncAction = "add" | "update" | "remove" | "unchanged";

/** A single entry in the computed sync plan */
export interface SyncPlanEntry {
  registryEntry: SkillRegistryEntry;
  action: SyncAction;
  currentHash?: string;
}

/** Summary report returned by syncL0 */
export interface SyncReport {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  skippedRemoves: number;
  errors: string[];
  warnings: string[];
  /** Files that should exist on disk after sync but don't — indicates a sync failure */
  missing: string[];
  actions: SyncPlanEntry[];
  /** Git commit hash of L0 at sync time */
  l0Commit?: string;
  /** Files that were removed (paths) */
  removedPaths: string[];
}

/** Options for sync behavior */
export interface SyncOptions {
  /** If true, orphaned files are removed. Default: false (additive only) */
  prune?: boolean;
  /** If true, allows removing >5 files in a single sync. Default: false */
  force?: boolean;
  /** If true, no filesystem changes — only compute the plan */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which registry entries should be synced based on the manifest
 * selection configuration.
 *
 * - "include-all" mode: starts with all entries, filters out excluded names
 *   by type and excluded categories.
 * - "explicit" mode: only includes entries whose paths already appear in
 *   manifest.checksums (opt-in).
 *
 * In both modes, entries whose names appear in l2_specific are excluded
 * (they are project-owned).
 */
export function resolveSyncPlan(
  registry: SkillRegistry,
  manifest: Manifest,
): SkillRegistryEntry[] {
  const { selection, l2_specific } = manifest;

  // Build sets of l2-specific names by type for fast lookup
  const l2Commands = new Set(l2_specific.commands);
  const l2Agents = new Set(l2_specific.agents);
  const l2Skills = new Set(l2_specific.skills);

  // Build exclude sets per type
  const excludeSkills = new Set(selection.exclude_skills);
  const excludeAgents = new Set(selection.exclude_agents);
  const excludeCommands = new Set(selection.exclude_commands);
  const excludeCategories = new Set(selection.exclude_categories);

  if (selection.mode === "explicit") {
    // Explicit mode: only include entries whose paths are already in checksums
    const checksumPaths = new Set(Object.keys(manifest.checksums));
    return registry.entries.filter((entry) => {
      if (isL2Specific(entry, l2Commands, l2Agents, l2Skills)) return false;
      return checksumPaths.has(entry.path);
    });
  }

  // Include-all mode: start with everything, then filter
  return registry.entries.filter((entry) => {
    // Exclude l2-specific entries
    if (isL2Specific(entry, l2Commands, l2Agents, l2Skills)) return false;

    // Exclude by name per type
    if (entry.type === "skill" && excludeSkills.has(entry.name)) return false;
    if (entry.type === "agent" && excludeAgents.has(entry.name)) return false;
    if (entry.type === "command" && excludeCommands.has(entry.name)) return false;

    // Exclude by category
    if (excludeCategories.has(entry.category)) return false;

    return true;
  });
}

/**
 * Check if an entry matches an l2_specific name for its type.
 */
function isL2Specific(
  entry: SkillRegistryEntry,
  l2Commands: Set<string>,
  l2Agents: Set<string>,
  l2Skills: Set<string>,
): boolean {
  if (entry.type === "command" && l2Commands.has(entry.name)) return true;
  if (entry.type === "agent" && l2Agents.has(entry.name)) return true;
  if (entry.type === "skill" && l2Skills.has(entry.name)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/**
 * Compute sync actions by comparing resolved entries against manifest checksums.
 *
 * For each resolved entry:
 * - No checksum in manifest = "add" (new file)
 * - Matching checksum = "unchanged" (up to date)
 * - Different checksum = "update" (file changed at L0)
 *
 * Entries in manifest.checksums but NOT in resolved = "remove" (orphaned)
 */
export function computeSyncActions(
  resolved: SkillRegistryEntry[],
  manifest: Manifest,
): SyncPlanEntry[] {
  const actions: SyncPlanEntry[] = [];

  // Use dest paths as the canonical key — checksums are keyed by dest path
  // (e.g. .claude/skills/test/SKILL.md, not skills/test/SKILL.md)
  const resolvedDestPaths = new Set(resolved.map((e) => destPath(e.path)));

  // Process resolved entries
  for (const entry of resolved) {
    const dest = destPath(entry.path);
    const currentHash = manifest.checksums[dest];

    if (!currentHash) {
      // No existing checksum - new file
      actions.push({ registryEntry: entry, action: "add" });
    } else if (currentHash === entry.hash) {
      // Hash matches - unchanged
      actions.push({ registryEntry: entry, action: "unchanged", currentHash });
    } else {
      // Hash differs - update needed
      actions.push({ registryEntry: entry, action: "update", currentHash });
    }
  }

  // Detect orphaned entries (in checksums but not in resolved dest paths)
  for (const [checksumPath, hash] of Object.entries(manifest.checksums)) {
    if (!resolvedDestPaths.has(checksumPath)) {
      // Create a synthetic entry for the orphaned file
      // checksumPath is the dest path (e.g. .claude/skills/test/SKILL.md)
      const name = extractNameFromPath(checksumPath);
      const type = detectTypeFromPath(checksumPath);
      actions.push({
        registryEntry: {
          name,
          type,
          path: checksumPath,
          description: "",
          category: "unknown",
          tier: "extended",
          hash,
          dependencies: [],
          frontmatter: {},
        },
        action: "remove",
        currentHash: hash,
      });
    }
  }

  return actions;
}

/**
 * Extract the asset name from a relative path.
 */
function extractNameFromPath(filePath: string): string {
  const basename = path.basename(filePath, ".md");
  if (basename === "SKILL") {
    // skills/name/SKILL.md -> name is the parent directory
    const parts = filePath.split("/");
    return parts.length >= 2 ? parts[parts.length - 2] : basename;
  }
  return basename;
}

/**
 * Detect asset type from a relative path.
 */
function detectTypeFromPath(
  filePath: string,
): "skill" | "agent" | "command" {
  if (filePath.startsWith("skills/") || filePath.startsWith(".claude/skills/")) return "skill";
  if (filePath.includes("/agents/")) return "agent";
  return "command";
}

/**
 * Translate a registry source path to the destination path inside the project.
 *
 * Skills live in `skills/<name>/SKILL.md` in L0 but must be materialized
 * under `.claude/skills/<name>/SKILL.md` in consumer projects so that
 * Claude Code's skill loader finds them at `.claude/skills/`.
 *
 * Agents and commands already carry `.claude/` prefixes in the registry.
 */
export function destPath(sourcePath: string): string {
  if (sourcePath.startsWith("skills/")) {
    return `.claude/${sourcePath}`;
  }
  return sourcePath;
}

// ---------------------------------------------------------------------------
// L0 source resolution (Fix #2)
// ---------------------------------------------------------------------------

/**
 * Resolve l0_source path robustly. Handles:
 * - Absolute paths (returned as-is)
 * - Relative paths resolved against git toplevel (not CWD) for worktree safety
 * - Falls back to ANDROID_COMMON_DOC env var when relative path doesn't resolve
 * - Validates that the resolved path contains skills/registry.json
 *
 * @throws Error if the resolved path doesn't contain a valid registry
 */
export async function resolveL0Source(
  l0Source: string,
  projectRoot: string,
): Promise<string> {
  // 1. If absolute, use directly
  if (path.isAbsolute(l0Source)) {
    await validateL0Path(l0Source);
    return l0Source;
  }

  // 2. Resolve relative to git toplevel (worktree-safe)
  let gitToplevel: string | undefined;
  try {
    gitToplevel = execSync("git rev-parse --show-toplevel", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    // Not a git repo — fall through to CWD-based resolution
  }

  const bases = [
    ...(gitToplevel ? [gitToplevel] : []),
    projectRoot,
  ];

  for (const base of bases) {
    const resolved = path.resolve(base, l0Source);
    try {
      await access(path.join(resolved, "skills", "registry.json"));
      return resolved;
    } catch {
      // Not found at this base, try next
    }
  }

  // 3. Fallback: ANDROID_COMMON_DOC env var
  const envPath = process.env.ANDROID_COMMON_DOC;
  if (envPath) {
    const resolved = path.resolve(envPath);
    try {
      await access(path.join(resolved, "skills", "registry.json"));
      return resolved;
    } catch {
      // env var set but doesn't contain registry
    }
  }

  // 4. Nothing worked — error with helpful message
  const tried = [
    ...bases.map((b) => path.resolve(b, l0Source)),
    ...(envPath ? [path.resolve(envPath)] : []),
  ];
  throw new Error(
    `L0 source "${l0Source}" does not contain skills/registry.json.\n` +
    `  Tried: ${tried.join(", ")}\n` +
    `  ${envPath ? "" : "Set ANDROID_COMMON_DOC env var as fallback.\n"}` +
    `  If running from a worktree, l0_source must be relative to the git toplevel.`,
  );
}

/**
 * Validate that an L0 root path contains a valid registry.
 * @throws Error with clear message if registry is missing
 */
async function validateL0Path(l0Path: string): Promise<void> {
  const registryPath = path.join(l0Path, "skills", "registry.json");
  try {
    await access(registryPath);
  } catch {
    throw new Error(
      `L0 source at "${l0Path}" does not contain skills/registry.json. ` +
      `Is this the correct AndroidCommonDoc path?`,
    );
  }
}

/**
 * Clone a remote git repository to a temporary directory.
 * Returns the temp dir path. Caller is responsible for cleanup.
 */
export function cloneRemoteSource(remoteUrl: string): string {
  const tmpDir = path.join(
    require("os").tmpdir(),
    `l0-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    execSync(`git clone --depth=1 "${remoteUrl}" "${tmpDir}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return tmpDir;
  } catch (err) {
    throw new Error(
      `Failed to clone remote source ${remoteUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Remove a temporary clone directory.
 */
export function cleanupClone(dirPath: string): void {
  try {
    require("fs").rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

/**
 * Get the current git commit hash at a path, or undefined if not a git repo.
 */
export function getGitCommit(dirPath: string): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: dirPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

/**
 * Transform source content by injecting version tracking metadata.
 *
 * - Skills (type "skill"): inject l0_source, l0_hash, l0_synced into YAML
 *   frontmatter before closing ---
 * - Agents (type "agent"): same as skills (YAML frontmatter injection)
 * - Commands (type "command"): prepend HTML comment header with source, hash,
 *   synced date. Removes old GENERATED comments.
 */
export function materializeFile(
  content: string,
  entry: SkillRegistryEntry,
  l0Root: string,
): string {
  const syncedDate = new Date().toISOString();

  if (entry.type === "skill" || entry.type === "agent") {
    return injectFrontmatterFields(content, l0Root, entry.hash, syncedDate);
  }

  // Command type: HTML comment header
  return injectCommandHeader(content, l0Root, entry.hash, syncedDate);
}

/**
 * Inject l0_source, l0_hash, l0_synced into YAML frontmatter.
 *
 * Finds the closing --- delimiter and inserts the fields before it.
 * Removes any existing l0_source/l0_hash/l0_synced lines first.
 */
function injectFrontmatterFields(
  content: string,
  l0Source: string,
  l0Hash: string,
  l0Synced: string,
): string {
  // Normalize line endings
  let text = content.replace(/\r\n/g, "\n");

  if (!text.startsWith("---\n")) {
    // No frontmatter - add one
    return `---\nl0_source: ${l0Source}\nl0_hash: ${l0Hash}\nl0_synced: ${l0Synced}\n---\n${text}`;
  }

  // Find closing ---
  const closingIndex = text.indexOf("\n---\n", 3);
  const closingAtEnd = text.indexOf("\n---", 3);

  let yamlBlock: string;
  let rest: string;

  if (closingIndex !== -1) {
    yamlBlock = text.slice(4, closingIndex);
    rest = text.slice(closingIndex + 5); // skip \n---\n
  } else if (closingAtEnd !== -1 && closingAtEnd + 4 >= text.length) {
    yamlBlock = text.slice(4, closingAtEnd);
    rest = "";
  } else {
    // Can't find frontmatter end, prepend
    return `---\nl0_source: ${l0Source}\nl0_hash: ${l0Hash}\nl0_synced: ${l0Synced}\n---\n${text}`;
  }

  // Remove existing l0_ fields
  const lines = yamlBlock
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("l0_source:") &&
        !line.startsWith("l0_hash:") &&
        !line.startsWith("l0_synced:"),
    );

  // Add the new fields
  lines.push(`l0_source: ${l0Source}`);
  lines.push(`l0_hash: ${l0Hash}`);
  lines.push(`l0_synced: ${l0Synced}`);

  return `---\n${lines.join("\n")}\n---\n${rest}`;
}

/**
 * Prepend an HTML comment header for command files with version tracking.
 * Removes any existing GENERATED or L0-SYNC comments.
 */
function injectCommandHeader(
  content: string,
  l0Source: string,
  l0Hash: string,
  l0Synced: string,
): string {
  let text = content.replace(/\r\n/g, "\n");

  // Remove existing GENERATED comments (from adapter)
  text = text.replace(
    /<!--\s*GENERATED\s+from\s+[^\n]*?-->\s*\n?/g,
    "",
  );

  // Remove existing L0-SYNC comments
  text = text.replace(
    /<!--\s*L0-SYNC[\s\S]*?-->\s*\n?/g,
    "",
  );

  // Prepend new header
  const header = [
    "<!-- L0-SYNC",
    `  l0_source: ${l0Source}`,
    `  l0_hash: ${l0Hash}`,
    `  l0_synced: ${l0Synced}`,
    "-->",
  ].join("\n");

  return `${header}\n${text}`;
}

// ---------------------------------------------------------------------------
// Safe removal check
// ---------------------------------------------------------------------------

/**
 * Check if a file has an L0 version header, indicating it was synced from L0
 * and is safe to remove during orphan cleanup.
 */
function hasL0Header(content: string): boolean {
  return (
    content.includes("l0_source:") &&
    content.includes("l0_hash:")
  );
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Multi-source registry merge (M003/S01)
// ---------------------------------------------------------------------------

/**
 * A tagged registry entry — carries the layer it came from.
 */
export interface LayeredRegistryEntry extends SkillRegistryEntry {
  /** Which layer source provided this entry */
  sourceLayer: string;
}

/**
 * Merge multiple registries into one, respecting layer priority.
 *
 * Resolution: last source wins per entry name+type. If L0 and L1 both
 * define a skill named "test", L1's version is used.
 *
 * Sources must be ordered by priority (L0 first, L1 second, etc.).
 * Each entry is tagged with its `sourceLayer` for traceability.
 *
 * @param registries - Array of [layerName, registry] tuples, ordered L0 → L1 → L2
 * @returns Merged registry with layer annotations
 */
export function mergeRegistries(
  registries: Array<[string, SkillRegistry]>,
): LayeredRegistryEntry[] {
  // Use name+type as the unique key (a skill "test" and agent "test" can coexist)
  const merged = new Map<string, LayeredRegistryEntry>();

  for (const [layer, registry] of registries) {
    for (const entry of registry.entries) {
      const key = `${entry.type}:${entry.name}`;
      merged.set(key, { ...entry, sourceLayer: layer });
    }
  }

  return Array.from(merged.values());
}

/**
 * Extended sync report for multi-source operations.
 */
export interface MultiSourceSyncReport extends SyncReport {
  /** Number of sources processed */
  sourceCount: number;
  /** Per-source entry counts */
  sourceCounts: Record<string, number>;
  /** Entries overridden by higher-priority layers */
  overrides: Array<{ name: string; type: string; overriddenBy: string; overrides: string }>;
}

/**
 * Execute a multi-source sync using manifest sources[].
 *
 * For each source in manifest.sources (ordered L0 → L1 → ...):
 * 1. Resolve the absolute path
 * 2. Generate registry from that source
 * 3. Merge all registries (last wins per name+type)
 * 4. Run the standard sync plan against the merged set
 *
 * Falls back to single-source syncL0() for flat topology with 1 source.
 *
 * @param projectRoot - Root of the downstream project
 * @param options - Sync behavior options (prune, force, dryRun)
 * @returns Extended sync report with multi-source metadata
 */
export async function syncMultiSource(
  projectRoot: string,
  options: SyncOptions = {},
): Promise<MultiSourceSyncReport> {
  const { prune = false, force = false, dryRun = false } = options;

  const manifestPath = path.join(projectRoot, "l0-manifest.json");
  const manifest = await readManifest(manifestPath);
  const orderedSources = getOrderedSources(manifest);

  // Collect registries from all sources
  const registryTuples: Array<[string, SkillRegistry]> = [];
  const sourceCounts: Record<string, number> = {};
  const resolvedPaths: Record<string, string> = {};

  for (const source of orderedSources) {
    const resolvedPath = await resolveL0Source(source.path, projectRoot);
    resolvedPaths[source.layer] = resolvedPath;

    const registry = await generateRegistry(resolvedPath);
    if (registry.entries.length === 0) {
      throw new Error(
        `Source ${source.layer} (${resolvedPath}) has 0 registry entries — aborting sync. ` +
        `Verify the path contains skills/registry.json with valid entries.`,
      );
    }

    registryTuples.push([source.layer, registry]);
    sourceCounts[source.layer] = registry.entries.length;
  }

  // Merge registries — last wins per name+type
  const merged = mergeRegistries(registryTuples);

  // Detect overrides (entries from earlier layers replaced by later ones)
  const overrides: MultiSourceSyncReport["overrides"] = [];
  const seenByKey = new Map<string, string>(); // key → first layer
  for (const [layer, registry] of registryTuples) {
    for (const entry of registry.entries) {
      const key = `${entry.type}:${entry.name}`;
      const prev = seenByKey.get(key);
      if (prev && prev !== layer) {
        overrides.push({
          name: entry.name,
          type: entry.type,
          overriddenBy: layer,
          overrides: prev,
        });
      }
      seenByKey.set(key, layer);
    }
  }

  // Build a synthetic merged registry for resolveSyncPlan
  const mergedRegistry: SkillRegistry = {
    version: 1,
    generated: new Date().toISOString(),
    l0_root: resolvedPaths[orderedSources[0].layer] ?? "",
    entries: merged,
  };

  // Use existing sync plan + action computation
  const resolved = resolveSyncPlan(mergedRegistry, manifest);
  const actions = computeSyncActions(resolved, manifest);

  const report: MultiSourceSyncReport = {
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    skippedRemoves: 0,
    errors: [],
    warnings: [],
    missing: [],
    actions,
    l0Commit: getGitCommit(resolvedPaths[orderedSources[0].layer] ?? ""),
    removedPaths: [],
    sourceCount: orderedSources.length,
    sourceCounts,
    overrides,
  };

  // Log overrides as warnings for visibility
  for (const ov of overrides) {
    report.warnings.push(
      `${ov.type} "${ov.name}" from ${ov.overrides} overridden by ${ov.overriddenBy}`,
    );
  }

  // Remove handling (same logic as syncL0)
  const removeActions = actions.filter((a) => a.action === "remove");
  const removeCount = removeActions.length;

  let allowRemoves = false;
  if (removeCount > 0 && !prune) {
    report.skippedRemoves = removeCount;
    report.warnings.push(
      `${removeCount} orphaned file(s) found but not removed (additive mode). ` +
      `Use --prune to remove orphans.`,
    );
  } else if (removeCount > 5 && prune && !force) {
    report.skippedRemoves = removeCount;
    report.warnings.push(
      `${removeCount} files would be removed — exceeds safety threshold (5). ` +
      `Use --prune --force to confirm, or review with --dry-run --prune first.`,
    );
  } else if (prune) {
    allowRemoves = true;
  }

  // Detekt baseline warning
  const detektUpdate = actions.find(
    (a) =>
      (a.action === "add" || a.action === "update") &&
      a.registryEntry.path.includes("detekt-l0-base"),
  );
  if (detektUpdate) {
    report.warnings.push(
      "⚠ detekt-l0-base.yml was updated — rebuild L0 rules JAR: " +
      "cd $ANDROID_COMMON_DOC/detekt-rules && ./gradlew assemble",
    );
  }

  // Process actions — resolve source path per entry using layered info
  for (const planEntry of actions) {
    const { registryEntry, action } = planEntry;

    switch (action) {
      case "add":
      case "update": {
        if (dryRun) {
          if (action === "add") report.added++;
          else report.updated++;
          break;
        }
        try {
          // Find the source root for this entry's layer
          const layered = registryEntry as LayeredRegistryEntry;
          const sourceRoot = layered.sourceLayer
            ? (resolvedPaths[layered.sourceLayer] ?? resolvedPaths[orderedSources[0].layer])
            : resolvedPaths[orderedSources[0].layer];

          const sourcePath = path.join(sourceRoot, registryEntry.path);
          const sourceContent = await readFile(sourcePath, "utf-8");
          const materialized = materializeFile(sourceContent, registryEntry, sourceRoot);
          const dest = destPath(registryEntry.path);
          const destFilePath = path.join(projectRoot, dest);
          await mkdir(path.dirname(destFilePath), { recursive: true });
          await writeFile(destFilePath, materialized, "utf-8");
          if (action === "add") report.added++;
          else report.updated++;
        } catch (err) {
          report.errors.push(
            `Failed to ${action} ${registryEntry.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }

      case "remove": {
        if (!allowRemoves) break;
        if (dryRun) {
          report.removed++;
          report.removedPaths.push(registryEntry.path);
          break;
        }
        try {
          const destFilePath = path.join(projectRoot, registryEntry.path);
          let content: string;
          try {
            content = await readFile(destFilePath, "utf-8");
          } catch {
            report.removed++;
            break;
          }
          if (content.includes("l0_source:") && content.includes("l0_hash:")) {
            await unlink(destFilePath);
            report.removedPaths.push(registryEntry.path);
          }
          report.removed++;
        } catch (err) {
          report.errors.push(
            `Failed to remove ${registryEntry.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }

      case "unchanged":
        report.unchanged++;
        break;
    }
  }

  if (!dryRun) {
    const newChecksums: Record<string, string> = {};
    for (const entry of resolved) {
      newChecksums[destPath(entry.path)] = entry.hash;
    }

    manifest.checksums = newChecksums;
    manifest.last_synced = new Date().toISOString();
    await writeManifest(manifestPath, manifest);

    // Post-sync verification
    for (const planEntry of actions) {
      if (planEntry.action === "add" || planEntry.action === "update") {
        const dest = destPath(planEntry.registryEntry.path);
        const destFilePath = path.join(projectRoot, dest);
        try {
          await readFile(destFilePath);
        } catch {
          report.missing.push(dest);
          report.errors.push(
            `Post-sync verification failed: ${dest} was not written to disk`,
          );
        }
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Knowledge cascade (M003/S02)
// ---------------------------------------------------------------------------

/**
 * Generate a KNOWLEDGE-RESOLVED.md by concatenating knowledge files from
 * all layers in order. Each layer's content is tagged with a heading.
 *
 * @param layerKnowledge - Array of [layerName, content] tuples, ordered L0 → L1 → L2
 * @returns Merged markdown with layer-tagged sections
 */
export function generateKnowledgeCascade(
  layerKnowledge: Array<[string, string]>,
): string {
  const sections: string[] = [
    "# Knowledge — Resolved (auto-generated)",
    "",
    "<!-- Generated by sync-l0 --resolve. Do not edit manually. -->",
    "<!-- Each section is tagged with its source layer. -->",
    "",
  ];

  for (const [layer, content] of layerKnowledge) {
    if (!content.trim()) continue;

    sections.push(`## [${layer}]`);
    sections.push("");

    // Strip the top-level heading from the content if it exists
    // (avoid duplicate "# Knowledge" headings)
    const stripped = content
      .replace(/^#\s+.*\n+/, "")
      .replace(/^<!--[\s\S]*?-->\s*\n*/, "")
      .trim();

    if (stripped) {
      sections.push(stripped);
      sections.push("");
    }
  }

  return sections.join("\n");
}

/**
 * Resolve agent template placeholders with layer knowledge.
 *
 * Supported placeholders:
 * - {{LAYER_KNOWLEDGE}} → full knowledge cascade content
 * - {{LAYER_CONVENTIONS}} → conventions section (extracted from knowledge)
 *
 * @param template - Agent markdown template with placeholders
 * @param knowledgeCascade - Resolved knowledge content
 * @returns Agent content with placeholders resolved
 */
export function resolveAgentTemplate(
  template: string,
  knowledgeCascade: string,
): string {
  let resolved = template;
  resolved = resolved.replace(/\{\{LAYER_KNOWLEDGE\}\}/g, knowledgeCascade);

  // Extract conventions: any section titled "Conventions" or "Key Conventions"
  const conventionsMatch = knowledgeCascade.match(
    /^##\s+.*[Cc]onventions.*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/m,
  );
  const conventions = conventionsMatch?.[1]?.trim() ?? "";
  resolved = resolved.replace(/\{\{LAYER_CONVENTIONS\}\}/g, conventions);

  return resolved;
}

/**
 * Read KNOWLEDGE.md files from all layer sources + project local,
 * generate KNOWLEDGE-RESOLVED.md, and optionally resolve agent templates.
 *
 * @param projectRoot - Root of the downstream project
 * @param sourcePaths - Map of layer → absolute path (from manifest resolution)
 * @returns Object with resolvedKnowledge content and list of agents resolved
 */
export async function resolveKnowledgeCascade(
  projectRoot: string,
  sourcePaths: Record<string, string>,
): Promise<{ resolvedKnowledge: string; layerCount: number }> {
  const layerKnowledge: Array<[string, string]> = [];

  // Read from each source layer
  const orderedLayers = Object.keys(sourcePaths).sort();
  for (const layer of orderedLayers) {
    const knowledgePath = path.join(sourcePaths[layer], ".gsd", "KNOWLEDGE.md");
    try {
      const content = await readFile(knowledgePath, "utf-8");
      layerKnowledge.push([layer, content]);
    } catch {
      // Layer doesn't have KNOWLEDGE.md — skip
    }
  }

  // Read local project's KNOWLEDGE.md
  const localLayer = `L${orderedLayers.length}`;
  const localKnowledgePath = path.join(projectRoot, ".gsd", "KNOWLEDGE.md");
  try {
    const content = await readFile(localKnowledgePath, "utf-8");
    layerKnowledge.push([localLayer, content]);
  } catch {
    // No local KNOWLEDGE.md
  }

  const resolvedKnowledge = generateKnowledgeCascade(layerKnowledge);

  return { resolvedKnowledge, layerCount: layerKnowledge.length };
}

// ---------------------------------------------------------------------------
// Main sync function (single-source, original)
// ---------------------------------------------------------------------------

/**
 * Execute a full L0 sync for a downstream project.
 *
 * 1. Reads manifest from projectRoot/l0-manifest.json
 * 2. Generates (or loads) registry from l0Root
 * 3. Resolves sync plan + computes actions
 * 4. For each add/update: reads source, materializes, writes to destination
 * 5. For each remove: deletes orphaned file (only if it has L0 header)
 * 6. Updates manifest checksums and last_synced, writes back
 *
 * @param projectRoot - Root of the downstream project
 * @param l0Root - Root of the L0 source (AndroidCommonDoc)
 * @param options - Sync behavior options (prune, force, dryRun)
 * @returns Sync report with counts and actions
 */
export async function syncL0(
  projectRoot: string,
  l0Root: string,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const { prune = false, force = false, dryRun = false } = options;

  const manifestPath = path.join(projectRoot, "l0-manifest.json");
  const manifest = await readManifest(manifestPath);

  // Generate registry from L0 root
  const registry = await generateRegistry(l0Root);

  // ── Fix #1: Empty registry guardrail ──────────────────────────────────
  if (registry.entries.length === 0) {
    throw new Error(
      "L0 registry has 0 entries — aborting sync. " +
      "This usually means l0_source points to an empty or invalid directory. " +
      `L0 root: ${l0Root}`,
    );
  }

  // Resolve what to sync and compute actions
  const resolved = resolveSyncPlan(registry, manifest);
  const actions = computeSyncActions(resolved, manifest);

  const report: SyncReport = {
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    skippedRemoves: 0,
    errors: [],
    warnings: [],
    missing: [],
    actions,
    l0Commit: getGitCommit(l0Root),
    removedPaths: [],
  };

  // ── Fix #1 + #5: Count removes and apply threshold ────────────────────
  const removeActions = actions.filter((a) => a.action === "remove");
  const removeCount = removeActions.length;

  let allowRemoves = false;
  if (removeCount > 0 && !prune) {
    // Additive mode (default): skip all removes, warn user
    report.skippedRemoves = removeCount;
    report.warnings.push(
      `${removeCount} orphaned file(s) found but not removed (additive mode). ` +
      `Use --prune to remove orphans.`,
    );
  } else if (removeCount > 5 && prune && !force) {
    // Destructive threshold: too many removes without --force
    report.skippedRemoves = removeCount;
    report.warnings.push(
      `${removeCount} files would be removed — exceeds safety threshold (5). ` +
      `Use --prune --force to confirm, or review with --dry-run --prune first.`,
    );
  } else if (prune) {
    allowRemoves = true;
  }

  // ── Fix #4: Detect detekt baseline changes ────────────────────────────
  const detektUpdate = actions.find(
    (a) =>
      (a.action === "add" || a.action === "update") &&
      a.registryEntry.path.includes("detekt-l0-base"),
  );
  if (detektUpdate) {
    report.warnings.push(
      "⚠ detekt-l0-base.yml was updated — rebuild L0 rules JAR: " +
      "cd $ANDROID_COMMON_DOC/detekt-rules && ./gradlew assemble",
    );
  }

  // Process each action
  for (const planEntry of actions) {
    const { registryEntry, action } = planEntry;

    switch (action) {
      case "add":
      case "update": {
        if (dryRun) {
          if (action === "add") report.added++;
          else report.updated++;
          break;
        }
        try {
          const sourcePath = path.join(l0Root, registryEntry.path);
          const sourceContent = await readFile(sourcePath, "utf-8");
          const materialized = materializeFile(sourceContent, registryEntry, l0Root);
          const dest = destPath(registryEntry.path);
          const destFilePath = path.join(projectRoot, dest);
          await mkdir(path.dirname(destFilePath), { recursive: true });
          await writeFile(destFilePath, materialized, "utf-8");
          if (action === "add") report.added++;
          else report.updated++;
        } catch (err) {
          report.errors.push(
            `Failed to ${action} ${registryEntry.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }

      case "remove": {
        if (!allowRemoves) {
          // Skip — already counted in skippedRemoves
          break;
        }
        if (dryRun) {
          report.removed++;
          report.removedPaths.push(registryEntry.path);
          break;
        }
        try {
          const destFilePath = path.join(projectRoot, registryEntry.path);
          let content: string;
          try {
            content = await readFile(destFilePath, "utf-8");
          } catch {
            report.removed++;
            break;
          }
          if (hasL0Header(content)) {
            await unlink(destFilePath);
            report.removedPaths.push(registryEntry.path);
          }
          report.removed++;
        } catch (err) {
          report.errors.push(
            `Failed to remove ${registryEntry.path}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      }

      case "unchanged":
        report.unchanged++;
        break;
    }
  }

  if (!dryRun) {
    // Update manifest checksums keyed by dest path
    const newChecksums: Record<string, string> = {};
    for (const entry of resolved) {
      newChecksums[destPath(entry.path)] = entry.hash;
    }

    manifest.checksums = newChecksums;
    manifest.last_synced = new Date().toISOString();
    await writeManifest(manifestPath, manifest);

    // Post-sync verification
    for (const planEntry of actions) {
      if (planEntry.action === "add" || planEntry.action === "update") {
        const dest = destPath(planEntry.registryEntry.path);
        const destFilePath = path.join(projectRoot, dest);
        try {
          await readFile(destFilePath);
        } catch {
          report.missing.push(dest);
          report.errors.push(
            `Post-sync verification failed: ${dest} was not written to disk`,
          );
        }
      }
    }
  }

  return report;
}
