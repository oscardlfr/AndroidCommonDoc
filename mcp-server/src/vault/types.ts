/**
 * Core type definitions for the Obsidian vault sync pipeline.
 *
 * These types define the contract for collecting source files from the KMP
 * ecosystem, transforming them into Obsidian-flavored Markdown, and tracking
 * sync state. All downstream vault modules depend on these types.
 *
 * The type system supports the L0/L1/L2 documentation hierarchy:
 * - L0: Generic patterns (AndroidCommonDoc)
 * - L1: Ecosystem conventions (your shared library project)
 * - L2: App-specific docs (your consumer apps)
 */

import type { Layer } from "../registry/types.js";

/**
 * Classification of a source file for the vault sync pipeline.
 *
 * Each type maps to a vault_type in the enriched frontmatter:
 * - pattern/skill/planning: keep name
 * - claude-md/agents/docs/rule-index: mapped to "reference"
 * - architecture: for .planning/codebase/ docs
 */
export type VaultSourceType =
  | "pattern"
  | "skill"
  | "planning"
  | "claude-md"
  | "agents"
  | "docs"
  | "rule-index"
  | "architecture";

/**
 * Configuration for a sub-project within a parent project.
 *
 * Sub-projects allow independent collection configuration for nested
 * components (e.g., MyApp/SubComponent, or external sibling
 * directories like MyAppWeb).
 */
export interface SubProjectConfig {
  /** Display name (e.g., "SessionRecorder-VST3"). */
  name: string;
  /** Relative path from parent project root, or absolute for external sub-projects. */
  path: string;
  /** Override collection globs (inherits parent if not set). */
  collectGlobs?: string[];
  /** Override exclusion globs (inherits parent if not set). */
  excludeGlobs?: string[];
}

/**
 * Rich per-project configuration for the vault collector.
 *
 * Each project declares its layer, collection scope, and optional
 * sub-project definitions. Replaces the old `projects: string[]` schema.
 */
export interface ProjectConfig {
  /** Display name (e.g., "MyProject"). */
  name: string;
  /** Absolute path to project root. */
  path: string;
  /** Layer assignment: L1 for ecosystem libs, L2 for consumer apps. */
  layer: "L1" | "L2";
  /** Glob patterns for files to collect (relative to project root). */
  collectGlobs?: string[];
  /** Glob patterns to exclude from collection. */
  excludeGlobs?: string[];
  /** Optional sub-project definitions for nested components. */
  subProjects?: SubProjectConfig[];
  /** Feature flags for project-specific collection behavior. */
  features?: {
    /** Whether to parse and generate a version catalog reference page. */
    versionCatalog?: boolean;
    /** How deep to scan for nested sub-projects (default: 2). */
    subProjectScanDepth?: number;
  };
}

/**
 * A collected source file ready for transformation.
 *
 * Produced by the collector, consumed by the transformer.
 * Every source must declare its layer for hierarchy-aware processing.
 */
export interface VaultSource {
  /** Absolute path to the source file on disk. */
  filepath: string;
  /** Raw file content. */
  content: string;
  /** Parsed frontmatter metadata, or null if the file has no frontmatter. */
  metadata: Record<string, unknown> | null;
  /** Classification of this source file. */
  sourceType: VaultSourceType;
  /** Project name (e.g., "MyProject") if from a consumer project. */
  project?: string;
  /** Registry layer (L0, L1, L2). Required for hierarchy-aware processing. */
  layer: Layer;
  /** Sub-project name if from a nested component (e.g., "SessionRecorder-VST3"). */
  subProject?: string;
  /** Intended vault-relative output path (forward slashes, e.g., "L0/patterns/testing.md"). */
  relativePath: string;
}

/**
 * A transformed document ready for vault output.
 *
 * Produced by the transformer, consumed by the vault writer.
 * Carries layer and optional sub-project for hierarchy-aware vault structure.
 */
export interface VaultEntry {
  /** URL-safe identifier derived from the source. */
  slug: string;
  /** Absolute path where this file will be written in the vault. */
  vaultPath: string;
  /** Transformed Markdown content (with wikilinks, enriched frontmatter). */
  content: string;
  /** Obsidian-flavored frontmatter (tags, aliases, vault_source, etc.). */
  frontmatter: Record<string, unknown>;
  /** Classification of this source file. */
  sourceType: VaultSourceType;
  /** Project name if from a consumer project. */
  project?: string;
  /** Registry layer (L0, L1, L2) for hierarchy-aware vault structure. */
  layer: Layer;
  /** Sub-project name if from a nested component. */
  subProject?: string;
  /** Auto-generated Obsidian tags. */
  tags: string[];
}

/**
 * Result of a sync operation.
 *
 * Returned by the sync engine after writing to the vault.
 */
export interface SyncResult {
  /** Number of files written (new or updated). */
  written: number;
  /** Number of files skipped (content unchanged). */
  unchanged: number;
  /** Number of orphaned files removed. */
  removed: number;
  /** Error messages for files that failed to sync. */
  errors: string[];
  /** Total sync duration in milliseconds. */
  duration: number;
}

/**
 * Manifest tracking synced files for incremental sync.
 *
 * Persisted in the vault directory to detect changes and orphans.
 * Each file entry includes its layer for hierarchy-aware tracking.
 */
export interface SyncManifest {
  /** ISO 8601 timestamp of the last successful sync. */
  lastSync: string;
  /** Map of vault-relative path to file tracking info. */
  files: Record<
    string,
    {
      /** Content hash (for change detection). */
      hash: string;
      /** Classification of the source file. */
      sourceType: VaultSourceType;
      /** Original source file path. */
      sourcePath: string;
      /** Registry layer of the source file. */
      layer: Layer;
    }
  >;
}

/**
 * Vault configuration.
 *
 * Stored at ~/.androidcommondoc/vault-config.json. Enables running
 * the vault sync from any project directory. Projects are now rich
 * objects with layer, collection globs, and sub-project support.
 */
export interface VaultConfig {
  /** Schema version for future migrations. */
  version: 1;
  /** Absolute path to the Obsidian vault directory. */
  vaultPath: string;
  /** Per-project configuration. Empty array = auto-discover via discoverProjects(). */
  projects: ProjectConfig[];
  /** Whether to remove vault files no longer present in source repos. */
  autoClean: boolean;
  /** ISO 8601 timestamp of the last sync (set after successful sync). */
  lastSync?: string;
}
