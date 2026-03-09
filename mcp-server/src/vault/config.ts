/**
 * Vault configuration management.
 *
 * Loads and saves vault config from ~/.androidcommondoc/vault-config.json.
 * Provides sensible defaults so the vault sync is runnable from any
 * project directory without manual configuration.
 *
 * Supports the ProjectConfig schema (v1) with per-project layer assignment,
 * collection globs, and sub-project definitions.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getL2Dir } from "../utils/paths.js";
import type { VaultConfig, ProjectConfig } from "./types.js";

/**
 * Returns the default vault configuration.
 *
 * Default vault path is ~/AndroidStudioProjects/kmp-knowledge-vault.
 * Empty projects array signals auto-discovery via discoverProjects().
 */
export function getDefaultConfig(): VaultConfig {
  return {
    version: 1,
    vaultPath: path.join(
      os.homedir(),
      "AndroidStudioProjects",
      "kmp-knowledge-vault",
    ),
    projects: [],
    autoClean: false,
  };
}

/**
 * Returns the path to the vault config file.
 *
 * Located at ~/.androidcommondoc/vault-config.json.
 */
export function getConfigPath(): string {
  return path.join(getL2Dir(), "vault-config.json");
}

/**
 * Checks whether a loaded config uses the old string[] projects format.
 *
 * Old format indicators:
 * - Missing `version` field
 * - `projects` is an array of strings (not ProjectConfig objects)
 */
function isOldFormat(saved: Record<string, unknown>): boolean {
  // No version field = old format
  if (!("version" in saved)) {
    return true;
  }

  // projects is string[] = old format
  const projects = saved.projects;
  if (
    Array.isArray(projects) &&
    projects.length > 0 &&
    typeof projects[0] === "string"
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that a ProjectConfig entry has the required fields.
 */
function isValidProjectConfig(entry: unknown): entry is ProjectConfig {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const obj = entry as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.path === "string" &&
    (obj.layer === "L1" || obj.layer === "L2")
  );
}

/**
 * Load vault configuration from disk.
 *
 * Returns defaults if the config file does not exist.
 * Detects old string[] projects format and returns defaults with a warning
 * (clean break, no backward compatibility per CONTEXT.md).
 * Validates that loaded projects entries have required name, path, layer fields.
 */
export async function loadVaultConfig(): Promise<VaultConfig> {
  const defaults = getDefaultConfig();
  const configPath = getConfigPath();

  try {
    const raw = await readFile(configPath, "utf-8");
    const saved = JSON.parse(raw) as Record<string, unknown>;

    // Detect old format -- clean break, return defaults
    if (isOldFormat(saved)) {
      process.stderr.write(
        "[vault-config] Warning: old config format detected (projects: string[]). " +
          "Using defaults. Re-save config to migrate to v1 schema.\n",
      );
      return defaults;
    }

    // Validate projects entries if present
    const projects = saved.projects;
    if (Array.isArray(projects)) {
      const validProjects = projects.filter(isValidProjectConfig);
      if (validProjects.length !== projects.length) {
        process.stderr.write(
          `[vault-config] Warning: ${projects.length - validProjects.length} invalid project entries skipped ` +
            "(missing name, path, or layer).\n",
        );
      }
      saved.projects = validProjects;
    }

    return { ...defaults, ...(saved as Partial<VaultConfig>) };
  } catch {
    // File doesn't exist or is malformed -- return defaults
    return defaults;
  }
}

/**
 * Save vault configuration to disk.
 *
 * Creates the ~/.androidcommondoc/ directory if it doesn't exist.
 * Always writes version: 1 in the output.
 */
export async function saveVaultConfig(config: VaultConfig): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  await mkdir(dir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({ ...config, version: 1 }, null, 2),
    "utf-8",
  );
}

/**
 * Returns smart default collection globs for a given layer.
 *
 * These globs define which files to collect from a project when no
 * custom collectGlobs are configured. Covers common documentation
 * locations for KMP ecosystem projects.
 *
 * @param _layer - The layer assignment (L1 or L2). Reserved for future
 *   layer-specific defaults; currently returns the same globs for both.
 */
export function getDefaultGlobs(_layer: "L1" | "L2"): string[] {
  return [
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
    "docs/**/*.md",
    ".planning/PROJECT.md",
    ".planning/STATE.md",
  ];
}

/**
 * Returns standard exclusion globs for file collection.
 *
 * These patterns exclude build artifacts, dependency caches, and
 * overly granular planning files from vault collection.
 *
 * Note: `.planning/phases/**` is excluded (too granular for vault),
 * but `.planning/codebase/**` and `.planning/PROJECT.md` are included
 * via the default collection globs.
 */
export function getDefaultExcludes(): string[] {
  return [
    "**/build/**",
    "**/node_modules/**",
    "**/.gradle/**",
    "**/dist/**",
    "**/archive/**",
    "**/.androidcommondoc/**",
    "**/coverage-*.md",
    "**/.planning/phases/**",
    "**/.planning/research/**",
    "**/.planning/codebase/**",
  ];
}
