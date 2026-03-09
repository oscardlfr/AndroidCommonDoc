/**
 * Auto-generates Obsidian tags from pattern/document metadata.
 *
 * Tags are derived from frontmatter scope, targets, layer, sourceType,
 * and project name. All tags are lowercase, deduplicated, and sorted
 * for deterministic output.
 */

import type { VaultSourceType } from "./types.js";

export interface TagGeneratorParams {
  scope?: string[];
  targets?: string[];
  layer?: string;
  sourceType: VaultSourceType;
  project?: string;
  subProject?: string;
  category?: string;
}

/**
 * Generate Obsidian tags from document metadata.
 *
 * Collects tags from scope values, target platforms, layer classification,
 * source type, and project name. Returns a sorted, deduplicated array
 * of lowercase strings.
 */
export function generateTags(params: TagGeneratorParams): string[] {
  const tagSet = new Set<string>();

  // Scope values (e.g., "viewmodel", "compose", "state")
  if (params.scope) {
    for (const s of params.scope) {
      tagSet.add(s.toLowerCase());
    }
  }

  // Target platforms (e.g., "android", "ios", "desktop")
  if (params.targets) {
    for (const t of params.targets) {
      tagSet.add(t.toLowerCase());
    }
  }

  // Layer classification (e.g., "L0" -> "l0")
  if (params.layer) {
    tagSet.add(params.layer.toLowerCase());
  }

  // Source type (e.g., "pattern", "skill")
  tagSet.add(params.sourceType.toLowerCase());

  // Architecture tag for architecture sourceType
  if (params.sourceType === "architecture") {
    tagSet.add("architecture");
  }

  // Layer-semantic tags
  if (params.layer === "L1") {
    tagSet.add("ecosystem");
  } else if (params.layer === "L2") {
    tagSet.add("app");
  }

  // Project name (e.g., "MyApp" -> "myapp")
  if (params.project) {
    tagSet.add(params.project.toLowerCase());
  }

  // Sub-project name (e.g., "SessionRecorder-VST3" -> "sessionrecorder-vst3")
  if (params.subProject) {
    tagSet.add(params.subProject.toLowerCase());
  }

  // Category tag (e.g., "testing" -> "category/testing")
  if (params.category) {
    tagSet.add(`category/${params.category.toLowerCase()}`);
  }

  return [...tagSet].sort();
}
