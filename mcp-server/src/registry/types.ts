/**
 * Core type definitions for the pattern registry.
 *
 * These types define the structure for pattern metadata extracted from
 * YAML frontmatter in documentation files, and the registry entries
 * that the scanner produces.
 */

/** Layer classification for pattern documents. */
export type Layer = "L0" | "L1" | "L2";

/** Monitoring tier controlling depth and cost of source checking. */
export type MonitoringTier = 1 | 2 | 3;

/** Supported URL types for upstream source monitoring. */
export type MonitorUrlType =
  | "github-releases"
  | "maven-central"
  | "doc-page"
  | "changelog";

/** Configuration for monitoring an upstream source URL. */
export interface MonitorUrl {
  url: string;
  type: MonitorUrlType;
  tier: MonitoringTier;
  /**
   * Explicit key into `versions-manifest.json` `versions` object.
   * When present, version drift is checked against this exact key — no URL heuristic.
   * When absent, falls back to URL-substring matching (legacy behaviour).
   * Example: `manifest_key: kotlin` → compares against `versions.kotlin`
   */
  manifest_key?: string;
}

/** Supported Detekt rule types for code generation. */
export type RuleType =
  | "banned-import"
  | "prefer-construct"
  | "banned-usage"
  | "required-call-arg"
  | "banned-supertype"
  | "naming-convention"
  | "banned-annotation"
  | "required-rethrow";

/** Definition of a Detekt rule extracted from pattern doc frontmatter. */
export interface RuleDefinition {
  id: string;
  type: RuleType;
  message: string;
  detect: Record<string, unknown>;
  hand_written?: boolean;
  source_rule?: string;
}

/** Severity level for monitoring findings. */
export type FindingSeverity = "HIGH" | "MEDIUM" | "LOW" | "INFO";

/** A finding produced by the monitoring engine. */
export interface MonitoringFinding {
  slug: string;
  source_url: string;
  severity: FindingSeverity;
  category: string;
  summary: string;
  details: string;
  finding_hash: string;
}

/** Metadata extracted from a pattern document's YAML frontmatter. */
export interface PatternMetadata {
  scope: string[];
  sources: string[];
  targets: string[];
  version?: number;
  last_updated?: string;
  description?: string;
  slug?: string;
  status?: string;
  excludable_sources?: string[];
  monitor_urls?: MonitorUrl[];
  rules?: RuleDefinition[];
  layer?: Layer;
  parent?: string;
  project?: string;
  category?: string;
  l0_refs?: string[];
  assumes_read?: string;
  token_budget?: number;
  optional_capabilities?: string[];
}

/** A discovered pattern document with its metadata and location. */
export interface RegistryEntry {
  slug: string;
  filepath: string;
  metadata: PatternMetadata;
  layer: Layer;
  project?: string;
}

/** Result of parsing YAML frontmatter from a document. */
export interface FrontmatterResult {
  data: Record<string, unknown>;
  content: string;
}
