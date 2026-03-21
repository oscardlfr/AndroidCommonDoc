/**
 * Layer Discovery — auto-detect L0/L1 source repos near a project.
 *
 * Scans parent and grandparent directories for sibling repos that contain
 * layer markers (skills/registry.json, mcp-server/, l0-manifest.json).
 *
 * Classification:
 *   - L0: has skills/registry.json + mcp-server/ (no l0-manifest.json)
 *   - L1: has skills/registry.json + l0-manifest.json (has own registry + consumes L0)
 *   - L2: has l0-manifest.json only (consumer, no own registry)
 *   - unknown: none of the above
 *
 * Resolution priority:
 *   1. ANDROID_COMMON_DOC env var (always wins for L0)
 *   2. Existing l0-manifest.json sources[] (pre-fill from previous config)
 *   3. Filesystem scan of ../ and ../../ (discovery)
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LayerRole = "L0" | "L1" | "L2" | "unknown";

export interface DiscoveredLayer {
  /** Absolute path to the discovered repo */
  absolutePath: string;
  /** Relative path from the project root */
  relativePath: string;
  /** Detected role */
  role: LayerRole;
  /** Repo directory name */
  name: string;
  /** How it was discovered */
  source: "env" | "manifest" | "scan";
  /** Whether the path actually exists and is accessible */
  valid: boolean;
}

export interface DiscoveryResult {
  /** All discovered layers, sorted L0 first, then L1, then L2 */
  layers: DiscoveredLayer[];
  /** The project's own role (L0, L1, L2, or unknown) */
  projectRole: LayerRole;
  /** Warnings during discovery */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyRepo(repoPath: string): LayerRole {
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    return "unknown";
  }

  const hasRegistry = existsSync(join(repoPath, "skills", "registry.json"));
  const hasMcpServer = existsSync(join(repoPath, "mcp-server"));
  const hasManifest = existsSync(join(repoPath, "l0-manifest.json"));

  // L0: canonical source — has registry + mcp-server, no manifest
  if (hasRegistry && hasMcpServer && !hasManifest) return "L0";

  // L1: intermediate — has own registry AND consumes upstream
  if (hasRegistry && hasManifest) return "L1";

  // L2: consumer only — has manifest but no own registry
  if (hasManifest && !hasRegistry) return "L2";

  return "unknown";
}

// ---------------------------------------------------------------------------
// Filesystem scan
// ---------------------------------------------------------------------------

function scanDir(parentDir: string, projectRoot: string): DiscoveredLayer[] {
  if (!existsSync(parentDir)) return [];

  const results: DiscoveredLayer[] = [];

  try {
    const entries = readdirSync(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const candidate = resolve(parentDir, entry.name);
      // Don't discover ourselves
      if (resolve(candidate) === resolve(projectRoot)) continue;

      const role = classifyRepo(candidate);
      if (role === "unknown") continue;

      results.push({
        absolutePath: candidate,
        relativePath: relative(projectRoot, candidate),
        role,
        name: entry.name,
        source: "scan",
        valid: true,
      });
    }
  } catch {
    // Permission error, skip
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main discovery
// ---------------------------------------------------------------------------

export function discoverLayers(projectRoot: string): DiscoveryResult {
  const projectAbsolute = resolve(projectRoot);
  const warnings: string[] = [];
  const seen = new Set<string>();
  const layers: DiscoveredLayer[] = [];

  function addIfNew(layer: DiscoveredLayer): void {
    const key = resolve(layer.absolutePath);
    if (seen.has(key)) return;
    seen.add(key);
    layers.push(layer);
  }

  // 1. ANDROID_COMMON_DOC env var → always L0
  const envL0 = process.env.ANDROID_COMMON_DOC;
  if (envL0) {
    const absPath = resolve(envL0);
    const role = classifyRepo(absPath);
    addIfNew({
      absolutePath: absPath,
      relativePath: relative(projectAbsolute, absPath),
      role: role === "unknown" ? "L0" : role, // trust env var
      name: basename(absPath),
      source: "env",
      valid: existsSync(absPath),
    });
    if (!existsSync(absPath)) {
      warnings.push(`ANDROID_COMMON_DOC points to ${absPath} which does not exist`);
    }
  }

  // 2. Existing manifest → extract source paths
  const manifestPath = join(projectAbsolute, "l0-manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const sources = manifest.sources ?? [];
      if (sources.length === 0 && manifest.l0_source) {
        sources.push({ layer: "L0", path: manifest.l0_source, role: "tooling" });
      }
      for (const src of sources) {
        const absPath = resolve(projectAbsolute, src.path);
        addIfNew({
          absolutePath: absPath,
          relativePath: src.path,
          role: classifyRepo(absPath) || src.layer,
          name: basename(absPath),
          source: "manifest",
          valid: existsSync(absPath),
        });
        if (!existsSync(absPath)) {
          warnings.push(`Manifest source ${src.layer} (${src.path}) not found at ${absPath}`);
        }
      }
    } catch (err) {
      warnings.push(`Failed to read l0-manifest.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Scan parent and grandparent directories
  const parentDir = resolve(projectAbsolute, "..");
  const grandparentDir = resolve(projectAbsolute, "../..");

  for (const layer of scanDir(parentDir, projectAbsolute)) {
    addIfNew(layer);
  }
  // Only scan grandparent if it's different from parent
  if (resolve(grandparentDir) !== resolve(parentDir)) {
    for (const layer of scanDir(grandparentDir, projectAbsolute)) {
      addIfNew(layer);
    }
  }

  // Sort: L0 first, L1 second, L2 third
  const roleOrder: Record<LayerRole, number> = { L0: 0, L1: 1, L2: 2, unknown: 3 };
  layers.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

  // Classify the project itself
  const projectRole = classifyRepo(projectAbsolute);

  return { layers, projectRole, warnings };
}

// ---------------------------------------------------------------------------
// Helpers for wizard integration
// ---------------------------------------------------------------------------

/** Format discovery results as a human-readable string */
export function formatDiscovery(result: DiscoveryResult): string {
  if (result.layers.length === 0) {
    return "No L0/L1 sources found nearby. You'll need to provide paths manually.";
  }

  const lines: string[] = ["Discovered sources:"];
  for (const layer of result.layers) {
    const status = layer.valid ? "✅" : "❌";
    const via = layer.source === "env" ? "(from $ANDROID_COMMON_DOC)"
      : layer.source === "manifest" ? "(from l0-manifest.json)"
      : "(found nearby)";
    lines.push(`  ${status} ${layer.role}: ${layer.name} → ${layer.relativePath} ${via}`);
  }
  return lines.join("\n");
}

/** Suggest topology based on discovered layers */
export function suggestTopology(
  result: DiscoveryResult,
): { topology: "flat" | "chain"; reason: string } {
  const l0Count = result.layers.filter(l => l.role === "L0").length;
  const l1Count = result.layers.filter(l => l.role === "L1").length;

  if (l1Count > 0 && result.projectRole !== "L1") {
    return {
      topology: "chain",
      reason: `Found L1 (${result.layers.find(l => l.role === "L1")?.name}) — chain topology lets you inherit its conventions`,
    };
  }

  return {
    topology: "flat",
    reason: l0Count > 0
      ? `Only L0 found — flat topology (direct consumption)`
      : "No sources detected — defaulting to flat",
  };
}
