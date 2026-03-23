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
  /**
   * Per-platform enforcement configuration. Optional — when absent, the rule
   * is assumed Kotlin-only with enforcement via `hand_written`/`source_rule`.
   *
   * When present, each key is a platform identifier and the value describes
   * which tool enforces the rule and how.
   *
   * @example
   * platforms:
   *   kotlin: { tool: "detekt", source_rule: "SealedUiStateRule.kt", hand_written: true }
   *   swift:  { tool: "swiftlint", strategy: "custom_rule", equivalent: "enum with associated values" }
   *
   * @see D001 in .gsd/DECISIONS.md for rationale and RuleType→Swift mapping.
   */
  platforms?: Record<string, PlatformRuleConfig>;
}

/** Supported platform identifiers for rule enforcement. */
export type RulePlatform = "kotlin" | "swift";

/** Tool used to enforce a rule on a specific platform. */
export type RuleEnforcementTool = "detekt" | "konsist" | "swiftlint" | "swift-format" | "validator-cli";

/**
 * Enforcement strategy when tool alone isn't sufficient.
 * - custom_rule: tool's custom rule mechanism (SwiftLint custom_rules, Detekt Rule class)
 * - builtin: tool's built-in rule (SwiftLint identifier_name, Detekt naming)
 * - validator_cli: separate CLI validator for complex checks (required-rethrow, banned-supertype)
 * - manual: no automated enforcement — documented convention only
 */
export type RuleEnforcementStrategy = "custom_rule" | "builtin" | "validator_cli" | "manual";

/** Per-platform enforcement configuration for a rule. */
export interface PlatformRuleConfig {
  /** Which tool enforces this rule on this platform. */
  tool: RuleEnforcementTool;
  /** Enforcement strategy when tool needs qualification. */
  strategy?: RuleEnforcementStrategy;
  /** For hand-written rules: source file name (e.g. "SealedUiStateRule.kt"). */
  source_rule?: string;
  /** Whether this is a hand-written (not generated) rule. */
  hand_written?: boolean;
  /** Human-readable Swift/platform equivalent of the Kotlin concept. */
  equivalent?: string;
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
  /** Upstream content validation assertions. */
  validate_upstream?: import("../monitoring/assertion-engine.js").UpstreamValidation[];
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
