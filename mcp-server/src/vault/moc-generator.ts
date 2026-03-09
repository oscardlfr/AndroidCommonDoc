/**
 * Map of Content (MOC) page generator for the Obsidian vault.
 *
 * Generates 5 index pages that group vault entries by different facets
 * (category, project, layer, module, type). MOC pages use static
 * [[wikilinks]] for Obsidian graph connectivity -- no Dataview queries.
 *
 * Category-aware: groups pattern entries by frontmatter.category field
 * instead of flat lists. Reduces visual noise in MOC pages.
 *
 * Ecosystem-aware: understands L0/L1/L2 hierarchy, project groupings,
 * sub-project nesting, and override visibility.
 *
 * Each MOC page is itself a VaultEntry, written to the 00-MOC/ directory.
 */

import { stringify as yamlStringify } from "yaml";
import type { VaultEntry, VaultSourceType } from "./types.js";
import type { Layer } from "../registry/types.js";

/** Known target platform tags for platform grouping. */
const PLATFORM_TAGS = new Set([
  "android",
  "desktop",
  "ios",
  "macos",
  "web",
  "jvm",
]);

/**
 * Get today's date in YYYY-MM-DD format.
 */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Build a MOC VaultEntry with standard frontmatter.
 *
 * MOC pages live at 00-MOC/ and use layer "L0" as a convention
 * since they sit at the vault root (not inside any L0/L1/L2 directory).
 */
function buildMOC(
  title: string,
  vaultPath: string,
  body: string,
): VaultEntry {
  const slug = title.toLowerCase().replace(/\s+/g, "-");
  const tags = ["moc", "index"];
  const frontmatter: Record<string, unknown> = {
    tags,
    aliases: [slug],
    vault_type: "moc",
    vault_synced: todayISO(),
  };

  // Build full content with YAML frontmatter so vault-writer writes it correctly
  // and Obsidian resolves [[slug]] wikilinks to this MOC via the aliases field.
  const frontmatterYaml = yamlStringify(frontmatter).trimEnd();
  const content = `---\n${frontmatterYaml}\n---\n${body}`;

  return {
    slug,
    vaultPath,
    content,
    frontmatter,
    sourceType: "pattern" as VaultSourceType,
    layer: "L0" as Layer,
    tags,
  };
}

/**
 * Build a set of L0 base slugs for override detection.
 *
 * An L1/L2 entry "overrides" L0 if its base slug (without project prefix)
 * matches an L0 entry's slug.
 */
function buildL0SlugSet(entries: VaultEntry[]): Set<string> {
  return new Set(
    entries
      .filter((e) => e.layer === "L0")
      .map((e) => e.slug),
  );
}

/**
 * Get the base slug from a project-prefixed slug.
 *
 * L1/L2 slugs are prefixed: "project-name-base-slug" -> "base-slug"
 * L0 slugs are bare: "base-slug" -> "base-slug"
 */
function getBaseSlug(entry: VaultEntry): string {
  if (entry.layer === "L0" || !entry.project) {
    return entry.slug;
  }
  const prefix = `${entry.project}-`;
  if (entry.slug.startsWith(prefix)) {
    return entry.slug.slice(prefix.length);
  }
  return entry.slug;
}

/**
 * Format a wikilink for an entry, using display text for project-prefixed slugs.
 *
 * Project-prefixed slugs (containing uppercase or underscores) get display text
 * for readability: [[project-SLUG|SLUG]]
 */
function formatWikilink(entry: VaultEntry): string {
  const baseSlug = getBaseSlug(entry);
  if (entry.slug !== baseSlug) {
    return `[[${entry.slug}|${baseSlug}]]`;
  }
  return `[[${entry.slug}]]`;
}

/**
 * Get an override annotation if this entry overrides an L0 entry.
 */
function getOverrideAnnotation(
  entry: VaultEntry,
  l0Slugs: Set<string>,
): string {
  if (entry.layer === "L0") return "";
  const baseSlug = getBaseSlug(entry);
  if (l0Slugs.has(baseSlug)) {
    return " (overrides L0)";
  }
  return "";
}

/**
 * Derive category for an entry using multiple fallback strategies:
 * 1. frontmatter.category (explicit, set by doc author)
 * 2. Infer from vault path subdirectory (e.g., "L2-apps/MyApp/docs/architecture/..." → "architecture")
 * 3. sourceType as semantic fallback (skill → "skills", agents → "agents", etc.)
 * 4. "Uncategorized" as last resort
 */
function deriveCategory(entry: VaultEntry): string {
  // 1. Explicit frontmatter category
  const fmCategory = entry.frontmatter?.category as string | undefined;
  if (fmCategory) return fmCategory;

  // 2. Infer from vault path: look for known subdivision then take next segment
  const vp = entry.vaultPath.replace(/\\/g, "/");
  const docsIdx = vp.indexOf("/docs/");
  if (docsIdx !== -1) {
    const afterDocs = vp.slice(docsIdx + 6); // after "/docs/"
    const firstSlash = afterDocs.indexOf("/");
    if (firstSlash !== -1) {
      const subdir = afterDocs.slice(0, firstSlash);
      // Skip if subdir looks like a filename (no further nesting)
      if (!subdir.endsWith(".md")) return subdir;
    }
  }

  // 3. sourceType-based fallback
  const typeMap: Record<string, string> = {
    skill: "skills",
    agents: "agents",
    "claude-md": "ai",
    planning: "planning",
    architecture: "architecture",
    docs: "docs",
  };
  return typeMap[entry.sourceType] ?? "Uncategorized";
}

/**
 * Group entries by their derived category.
 *
 * Uses frontmatter.category → path inference → sourceType fallback.
 * Categories are sorted alphabetically with "Uncategorized" last.
 */
function groupByCategory(entries: VaultEntry[]): Map<string, VaultEntry[]> {
  const byCategory = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    const category = deriveCategory(entry);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(entry);
  }
  // Sort categories alphabetically, but "Uncategorized" last
  return new Map(
    [...byCategory.entries()].sort((a, b) => {
      if (a[0] === "Uncategorized") return 1;
      if (b[0] === "Uncategorized") return -1;
      return a[0].localeCompare(b[0]);
    }),
  );
}

/**
 * Generate the "Home" MOC page -- the root entry point for the vault.
 *
 * Contains category-based navigation tree with pattern domain links,
 * layer counts, navigation links to all other MOC pages, and the last sync date.
 */
export function generateHomeMOC(entries: VaultEntry[]): VaultEntry {
  // Count entries per layer (excluding MOC pages themselves)
  const nonMocEntries = entries.filter(
    (e) => !e.tags.includes("moc"),
  );
  const l0Count = nonMocEntries.filter((e) => e.layer === "L0").length;
  const l1Count = nonMocEntries.filter((e) => e.layer === "L1").length;
  const l2Count = nonMocEntries.filter((e) => e.layer === "L2").length;

  // Count unique projects for L2
  const l2Projects = new Set(
    nonMocEntries
      .filter((e) => e.layer === "L2" && e.project)
      .map((e) => e.project!),
  );

  // Build category navigation from pattern entries
  const patterns = nonMocEntries.filter((e) => e.sourceType === "pattern");
  const categoryGroups = groupByCategory(patterns);

  let categoryNav = "";
  for (const [category, catEntries] of categoryGroups) {
    const count = catEntries.length;
    categoryNav += `- **${category}** (${count}) -- [[All Patterns#${category}]]\n`;
  }

  const content = `# KMP Knowledge Vault

> Ecosystem documentation hub for Android/KMP development.
> Source repos are truth -- this vault is a read-only enriched view.

## Overview

| Layer | Count | Description |
|-------|-------|-------------|
| L0 Generic | ${l0Count} | Cross-project patterns and skills |
| L1 Ecosystem | ${l1Count} | Shared library conventions |
| L2 Apps | ${l2Count} | App-specific docs across ${l2Projects.size} projects |

## Patterns by Domain

${categoryNav}
### Quick Links

- [[All Patterns]] | [[All Modules]] | [[All Skills]] | [[All Decisions]]

*Last sync: ${todayISO()}*
`;

  return buildMOC("Home", "00-MOC/Home.md", content);
}

/**
 * Generate the "All Patterns" MOC page.
 *
 * Filters entries by sourceType "pattern", groups by category with
 * category headers. Within each category, lists entries alphabetically
 * with wikilinks and layer annotation.
 */
export function generateAllPatternsMOC(entries: VaultEntry[]): VaultEntry {
  const patterns = entries.filter((e) => e.sourceType === "pattern");
  const l0Slugs = buildL0SlugSet(entries);

  // Group by category instead of scope
  const categoryGroups = groupByCategory(patterns);

  let content = "# All Patterns\n\nIndex of all pattern documents, grouped by category.\n\n## By Category\n";
  for (const [category, catEntries] of categoryGroups) {
    content += `\n### ${category}\n`;
    // Sort entries alphabetically within category
    const sorted = [...catEntries].sort((a, b) => a.slug.localeCompare(b.slug));
    for (const entry of sorted) {
      const override = getOverrideAnnotation(entry, l0Slugs);
      const layerLabel = entry.layer;
      const projectLabel = entry.project ? `, ${entry.project}` : "";
      content += `- ${formatWikilink(entry)} (${layerLabel}${projectLabel}${override ? " override" : ""})\n`;
    }
  }

  return buildMOC("All Patterns", "00-MOC/All Patterns.md", content);
}

/**
 * Generate the "By Project" MOC page.
 *
 * Groups all entries by project name with layer annotation.
 * Shows category summary (category name + count) per project.
 * Sub-projects get their own sub-section under their parent project.
 * AndroidCommonDoc entries grouped under "AndroidCommonDoc (L0)".
 */
export function generateByProjectMOC(entries: VaultEntry[]): VaultEntry {
  // Group by project, tracking sub-projects separately
  const byProject = new Map<
    string,
    { layer: Layer; mainEntries: VaultEntry[]; subProjects: Map<string, VaultEntry[]> }
  >();

  for (const entry of entries) {
    const project = entry.project ?? "AndroidCommonDoc";
    if (!byProject.has(project)) {
      byProject.set(project, {
        layer: entry.layer,
        mainEntries: [],
        subProjects: new Map(),
      });
    }

    const projectGroup = byProject.get(project)!;

    if (entry.subProject) {
      if (!projectGroup.subProjects.has(entry.subProject)) {
        projectGroup.subProjects.set(entry.subProject, []);
      }
      projectGroup.subProjects.get(entry.subProject)!.push(entry);
    } else {
      projectGroup.mainEntries.push(entry);
    }
  }

  const sortedProjects = [...byProject.keys()].sort();
  let content = "# By Project\n\nAll documents grouped by their source project.\n";
  for (const project of sortedProjects) {
    const group = byProject.get(project)!;
    const layerLabel = project === "AndroidCommonDoc" ? "L0" : group.layer;
    content += `\n## ${project} (${layerLabel})\n`;

    // Show category summary with counts
    const categoryGroups = groupByCategory(group.mainEntries);
    for (const [category, catEntries] of categoryGroups) {
      const count = catEntries.length;
      content += `- **${category}** (${count} ${count === 1 ? "doc" : "docs"})\n`;
      for (const entry of catEntries) {
        content += `  - ${formatWikilink(entry)} (${entry.sourceType})\n`;
      }
    }

    // Sub-projects section
    if (group.subProjects.size > 0) {
      content += `\n### Sub-Projects\n`;
      const sortedSubProjects = [...group.subProjects.keys()].sort();
      for (const subProject of sortedSubProjects) {
        content += `\n#### ${subProject}\n`;
        for (const entry of group.subProjects.get(subProject)!) {
          content += `- ${formatWikilink(entry)} (${entry.sourceType})\n`;
        }
      }
    }
  }

  return buildMOC("By Project", "00-MOC/By Project.md", content);
}

/**
 * Generate the "By Layer" MOC page.
 *
 * Groups ALL vault entries by layer (not just patterns) with descriptive
 * sublabels per CONTEXT.md. Within each layer, entries are grouped by
 * category. L2 entries are further grouped by project with sub-headers.
 * Sub-projects listed under parent with indented sub-headers.
 * Override visibility: annotates L1/L2 entries that share a base slug with L0.
 */
export function generateByLayerMOC(entries: VaultEntry[]): VaultEntry {
  const l0Slugs = buildL0SlugSet(entries);

  // Group by layer
  const l0Entries: VaultEntry[] = [];
  const l1Entries: VaultEntry[] = [];
  // L2: grouped by project -> { main entries, sub-project entries }
  const l2ByProject = new Map<
    string,
    { mainEntries: VaultEntry[]; subProjects: Map<string, VaultEntry[]> }
  >();

  for (const entry of entries) {
    switch (entry.layer) {
      case "L0":
        l0Entries.push(entry);
        break;
      case "L1":
        l1Entries.push(entry);
        break;
      case "L2": {
        const project = entry.project ?? "Unknown";
        if (!l2ByProject.has(project)) {
          l2ByProject.set(project, { mainEntries: [], subProjects: new Map() });
        }
        const group = l2ByProject.get(project)!;
        if (entry.subProject) {
          if (!group.subProjects.has(entry.subProject)) {
            group.subProjects.set(entry.subProject, []);
          }
          group.subProjects.get(entry.subProject)!.push(entry);
        } else {
          group.mainEntries.push(entry);
        }
        break;
      }
    }
  }

  let content = "# By Layer\n\nAll documents organized by documentation layer.\n";

  // L0 section -- grouped by category
  content += `\n## L0 -- Generic Patterns\n\nCross-project patterns and skills from AndroidCommonDoc.\n`;
  const l0Categories = groupByCategory(l0Entries);
  for (const [category, catEntries] of l0Categories) {
    content += `\n### ${category} (${catEntries.length} docs)\n`;
    for (const entry of catEntries) {
      content += `- ${formatWikilink(entry)}\n`;
    }
  }

  // L1 section -- grouped by category
  content += `\n## L1 -- Ecosystem\n\nShared ecosystem conventions and documentation.\n`;
  const l1Categories = groupByCategory(l1Entries);
  for (const [category, catEntries] of l1Categories) {
    content += `\n### ${category} (${catEntries.length} docs)\n`;
    for (const entry of catEntries) {
      const override = getOverrideAnnotation(entry, l0Slugs);
      content += `- ${formatWikilink(entry)}${override}\n`;
    }
  }

  // L2 section
  content += `\n## L2 -- App-Specific\n\nDomain-specific docs per application.\n`;
  const sortedL2Projects = [...l2ByProject.keys()].sort();
  for (const project of sortedL2Projects) {
    const group = l2ByProject.get(project)!;
    content += `\n### ${project}\n`;
    for (const entry of group.mainEntries) {
      const override = getOverrideAnnotation(entry, l0Slugs);
      content += `- ${formatWikilink(entry)}${override}\n`;
    }

    // Sub-projects under parent
    if (group.subProjects.size > 0) {
      const sortedSubProjects = [...group.subProjects.keys()].sort();
      for (const subProject of sortedSubProjects) {
        content += `\n#### ${subProject}\n`;
        for (const entry of group.subProjects.get(subProject)!) {
          const override = getOverrideAnnotation(entry, l0Slugs);
          content += `- ${formatWikilink(entry)}${override}\n`;
        }
      }
    }
  }

  return buildMOC("By Layer", "00-MOC/By Layer.md", content);
}

/**
 * Generate the "By Target Platform" MOC page.
 *
 * Groups entries by target platform tags (android, desktop, ios, macos, web, jvm).
 */
export function generateByPlatformMOC(entries: VaultEntry[]): VaultEntry {
  const byPlatform = new Map<string, VaultEntry[]>();

  for (const entry of entries) {
    for (const tag of entry.tags) {
      if (PLATFORM_TAGS.has(tag.toLowerCase())) {
        const platform = tag.toLowerCase();
        if (!byPlatform.has(platform)) byPlatform.set(platform, []);
        byPlatform.get(platform)!.push(entry);
      }
    }
  }

  const sortedPlatforms = [...byPlatform.keys()].sort();
  let content = "# By Target Platform\n\nDocuments grouped by target platform.\n";
  for (const platform of sortedPlatforms) {
    content += `\n## ${platform}\n`;
    for (const entry of byPlatform.get(platform)!) {
      content += `- ${formatWikilink(entry)}\n`;
    }
  }

  return buildMOC(
    "By Target Platform",
    "00-MOC/By Target Platform.md",
    content,
  );
}

/**
 * Generate the "All Skills" MOC page.
 *
 * Lists all entries with sourceType "skill".
 */
export function generateAllSkillsMOC(entries: VaultEntry[]): VaultEntry {
  const skills = entries.filter((e) => e.sourceType === "skill");

  let content = "# All Skills\n\nIndex of all Claude Code skill definitions.\n\n";
  for (const entry of skills) {
    content += `- ${formatWikilink(entry)}\n`;
  }

  return buildMOC("All Skills", "00-MOC/All Skills.md", content);
}

/**
 * Generate the "All Decisions" MOC page.
 *
 * Lists all entries with sourceType "planning" AND "architecture",
 * grouped by project name. Sub-project entries are listed under their
 * own sub-section to avoid mixing them with the parent project's entries.
 *
 * Deduplicates by slug to prevent duplicate links when the same source
 * appears via multiple collection paths.
 */
export function generateAllDecisionsMOC(entries: VaultEntry[]): VaultEntry {
  const decisions = entries.filter(
    (e) => e.sourceType === "planning" || e.sourceType === "architecture",
  );

  // Deduplicate by slug (keep first occurrence)
  const seenSlugs = new Set<string>();
  const uniqueDecisions = decisions.filter((e) => {
    if (seenSlugs.has(e.slug)) return false;
    seenSlugs.add(e.slug);
    return true;
  });

  // Group by effective project label: use subProject name when present
  // to separate sub-project entries from their parent project entries.
  const byProject = new Map<string, VaultEntry[]>();
  for (const entry of uniqueDecisions) {
    const label = entry.subProject ?? entry.project ?? "AndroidCommonDoc";
    if (!byProject.has(label)) byProject.set(label, []);
    byProject.get(label)!.push(entry);
  }

  const sortedProjects = [...byProject.keys()].sort();
  let content = "# All Decisions\n\nIndex of all project decisions, planning, and architecture documents.\n";
  for (const project of sortedProjects) {
    content += `\n## ${project}\n`;
    for (const entry of byProject.get(project)!) {
      content += `- ${formatWikilink(entry)} (${entry.sourceType})\n`;
    }
  }

  return buildMOC("All Decisions", "00-MOC/All Decisions.md", content);
}

/**
 * Generate the "All Modules" MOC page.
 *
 * Lists L1 module entries (docs from the shared library whose slug contains
 * a module name like "core-*"). Groups by frontmatter category with
 * module name, description, and platform icons.
 */
export function generateAllModulesMOC(entries: VaultEntry[]): VaultEntry {
  // Module entries are L1 docs whose slug matches the core-* module naming pattern
  const moduleEntries = entries.filter(
    (e) =>
      e.layer === "L1" &&
      e.sourceType === "docs" &&
      /core-[a-z]/.test(e.slug),
  );

  const categoryGroups = groupByCategory(moduleEntries);

  let content =
    "# All Modules\n\nIndex of all shared library module documentation, grouped by category.\n";
  content += `\n**Total modules:** ${moduleEntries.length}\n`;

  for (const [category, catEntries] of categoryGroups) {
    content += `\n## ${category}\n`;
    const sorted = [...catEntries].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    for (const entry of sorted) {
      const description = entry.frontmatter?.description
        ? ` -- ${entry.frontmatter.description}`
        : "";
      content += `- ${formatWikilink(entry)}${description}\n`;
    }
  }

  return buildMOC("All Modules", "00-MOC/All Modules.md", content);
}

/**
 * Generate all MOC index pages.
 *
 * Returns an array of VaultEntry objects for:
 * - Home (category-based navigation tree with domain links)
 * - All Patterns (grouped by category with headers)
 * - All Modules (L1 module docs grouped by category)
 * - All Skills (list of skill entries)
 * - All Decisions (planning + architecture entries by project)
 * - By Layer (ALL entries organized by L0/L1/L2 — ensures every node has at least one backlink)
 * - By Project (ALL entries organized by source project)
 *
 * By Layer and By Project are essential for graph connectivity: they index
 * entry types not covered by the other MOCs (agents, claude-md, docs, etc.)
 * so no vault node appears as a disconnected floating dot.
 */
export function generateAllMOCs(entries: VaultEntry[]): VaultEntry[] {
  return [
    generateHomeMOC(entries),
    generateAllPatternsMOC(entries),
    generateAllModulesMOC(entries),
    generateAllSkillsMOC(entries),
    generateAllDecisionsMOC(entries),
    generateByLayerMOC(entries),
    generateByProjectMOC(entries),
  ];
}
