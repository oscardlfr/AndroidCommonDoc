/**
 * L0 Skill Registry Generator.
 *
 * Scans skills/, .claude/agents/, and .claude/commands/ directories,
 * extracts metadata from frontmatter, computes SHA-256 content hashes,
 * and outputs `skills/registry.json` as the single source of truth
 * for downstream discovery and materialization.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile as fsWriteFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single entry in the skill registry. */
export interface SkillRegistryEntry {
  name: string;
  type: "skill" | "agent" | "command";
  path: string;
  description: string;
  category: string;
  tier: "core" | "extended" | "web";
  hash: string;
  dependencies: string[];
  generated_from?: string;
  frontmatter: Record<string, unknown>;
}

/** The full skill registry structure written to registry.json. */
export interface SkillRegistry {
  version: 1;
  generated: string;
  l0_root: string;
  entries: SkillRegistryEntry[];
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

/** Map skill/agent/command names to unified categories. */
const CATEGORY_MAP: Record<string, string> = {
  // testing
  test: "testing",
  "test-full": "testing",
  "test-full-parallel": "testing",
  "test-changed": "testing",
  "android-test": "testing",
  coverage: "testing",
  "coverage-full": "testing",
  "auto-cover": "testing",
  "unlock-tests": "testing",
  "test-specialist": "testing",

  // build
  run: "build",
  "verify-kmp": "build",
  "verify-migrations": "build",
  package: "build",

  // guides (docs, workflow, monitoring, sync)
  "validate-patterns": "guides",
  "doc-reorganize": "guides",
  "doc-check": "guides",
  "doc-update": "guides",
  "monitor-docs": "guides",
  "ingest-content": "guides",
  "sync-vault": "guides",
  "sync-versions": "guides",
  "sync-tech-versions": "guides",
  "generate-rules": "guides",
  changelog: "guides",
  "feature-audit": "guides",
  metrics: "guides",
  "doc-alignment-agent": "guides",
  "doc-alignment": "guides",
  "doc-code-drift-detector": "guides",

  // security
  sbom: "security",
  "sbom-scan": "security",
  "sbom-analyze": "security",

  // domain
  "extract-errors": "domain",
  brainstorm: "domain",
  prioritize: "domain",
  "bump-version": "domain",
  "pre-release": "domain",
  "merge-track": "domain",
  "start-track": "domain",
  "sync-roadmap": "domain",

  // ui (web-specific skills)
  accessibility: "ui",
  "web-quality-audit": "ui",
  "core-web-vitals": "ui",
  performance: "ui",
  seo: "ui",
  "best-practices": "ui",
  "ui-specialist": "ui",

  // architecture
  "quality-gate-orchestrator": "architecture",
  "beta-readiness-agent": "architecture",
  "beta-readiness": "architecture",
  "cross-platform-validator": "architecture",
  "release-guardian-agent": "architecture",
  "release-guardian": "architecture",
  "script-parity-validator": "architecture",
  "skill-script-alignment": "architecture",
  "template-sync-validator": "architecture",
};

/** Well-known web-specific skill names for tier assignment. */
const WEB_SKILLS = new Set([
  "accessibility",
  "web-quality-audit",
  "core-web-vitals",
  "performance",
  "seo",
  "best-practices",
]);

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of a file's content.
 *
 * @param filePath - Absolute path to the file
 * @returns Hash string prefixed with "sha256:"
 */
export async function computeHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

// ---------------------------------------------------------------------------
// Dependency extraction
// ---------------------------------------------------------------------------

/**
 * Extract script dependencies referenced in SKILL.md content.
 *
 * Finds references like `scripts/sh/gradle-run.sh` or
 * `scripts/ps1/gradle-run.ps1` in backtick-delimited strings.
 *
 * @param content - Raw SKILL.md content
 * @returns Unique list of script paths
 */
export function extractDependencies(content: string): string[] {
  const scriptPattern = /scripts\/(?:sh|ps1)\/[a-zA-Z0-9_-]+\.(?:sh|ps1)/g;
  const matches = content.match(scriptPattern);
  if (!matches) return [];
  return [...new Set(matches)];
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

/**
 * Assign a category to a skill/agent/command.
 *
 * Uses frontmatter category if provided, otherwise maps by name
 * using the unified 9-category vocabulary: architecture, testing,
 * data, security, build, guides, domain, product, ui.
 *
 * @param name - Asset name
 * @param frontmatter - Optional frontmatter data
 * @returns Category string
 */
export function categorize(
  name: string,
  frontmatter?: Record<string, unknown>,
): string {
  // Prefer explicit frontmatter category
  if (frontmatter?.category && typeof frontmatter.category === "string") {
    return frontmatter.category;
  }

  // Look up in the name map
  if (CATEGORY_MAP[name]) {
    return CATEGORY_MAP[name];
  }

  // Fallback heuristics
  if (
    name.includes("test") ||
    name.includes("coverage") ||
    name.includes("cover")
  ) {
    return "testing";
  }
  if (name.includes("doc") || name.includes("sync") || name.includes("vault")) {
    return "guides";
  }
  if (name.includes("sbom") || name.includes("security")) {
    return "security";
  }
  if (
    name.includes("web") ||
    name.includes("seo") ||
    name.includes("accessibility")
  ) {
    return "ui";
  }

  return "domain";
}

// ---------------------------------------------------------------------------
// Tier assignment
// ---------------------------------------------------------------------------

/**
 * Assign a tier to a skill/agent/command.
 *
 * - core: testing, build, security (always needed)
 * - extended: guides, domain, architecture, data (project-dependent)
 * - web: web-specific UI skills
 *
 * @param name - Asset name
 * @param category - Assigned category
 * @returns Tier: "core" | "extended" | "web"
 */
export function tierize(
  name: string,
  category: string,
): "core" | "extended" | "web" {
  // Web-specific skills
  if (WEB_SKILLS.has(name)) {
    return "web";
  }

  // Core categories
  if (["testing", "build", "security"].includes(category)) {
    return "core";
  }

  // Everything else is extended
  return "extended";
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

/**
 * Scan skills/ directory for SKILL.md files.
 *
 * @param rootDir - L0 root directory (AndroidCommonDoc)
 * @returns Array of skill registry entries
 */
export async function scanSkills(
  rootDir: string,
): Promise<SkillRegistryEntry[]> {
  const skillsDir = path.join(rootDir, "skills");
  let dirs: Dirent[];
  try {
    dirs = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: SkillRegistryEntry[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const skillMd = path.join(skillsDir, dir.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMd, "utf-8");
    } catch {
      continue; // Skip directories without SKILL.md
    }

    const fm = parseFrontmatter(content);
    const fmData: Record<string, unknown> = fm?.data ?? {};
    const description =
      typeof fmData.description === "string" ? fmData.description : "";
    const category = categorize(dir.name, fmData);

    entries.push({
      name: dir.name,
      type: "skill",
      path: `skills/${dir.name}/SKILL.md`,
      description,
      category,
      tier: tierize(dir.name, category),
      hash: await computeHash(skillMd),
      dependencies: extractDependencies(content),
      frontmatter: fmData,
    });
  }

  return entries;
}

/**
 * Scan .claude/agents/ directory for agent markdown files.
 *
 * @param rootDir - L0 root directory
 * @returns Array of agent registry entries
 */
export async function scanAgents(
  rootDir: string,
): Promise<SkillRegistryEntry[]> {
  const agentsDir = path.join(rootDir, ".claude", "agents");
  let files;
  try {
    files = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: SkillRegistryEntry[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".md")) continue;

    const filePath = path.join(agentsDir, file.name);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const name = file.name.replace(/\.md$/, "");
    const fm = parseFrontmatter(content);
    const fmData: Record<string, unknown> = fm?.data ?? {};
    const description =
      typeof fmData.description === "string" ? fmData.description : "";
    const category = categorize(name, fmData);

    entries.push({
      name,
      type: "agent",
      path: `.claude/agents/${file.name}`,
      description,
      category,
      tier: tierize(name, category),
      hash: await computeHash(filePath),
      dependencies: [],
      frontmatter: fmData,
    });
  }

  return entries;
}

/**
 * Scan .claude/commands/ directory for command markdown files.
 *
 * Detects adapter-generated commands by the comment pattern
 * `<!-- GENERATED from skills/...` and records the source path.
 *
 * @param rootDir - L0 root directory
 * @returns Array of command registry entries
 */
export async function scanCommands(
  rootDir: string,
): Promise<SkillRegistryEntry[]> {
  const commandsDir = path.join(rootDir, ".claude", "commands");
  let files;
  try {
    files = await readdir(commandsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: SkillRegistryEntry[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".md")) continue;

    const filePath = path.join(commandsDir, file.name);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const name = file.name.replace(/\.md$/, "");

    // Detect adapter-generated commands
    const generatedMatch = content.match(
      /<!--\s*GENERATED\s+from\s+(skills\/[^\s]+)/,
    );
    const generated_from = generatedMatch ? generatedMatch[1] : undefined;

    // Commands often lack frontmatter; parse what's available
    const fm = parseFrontmatter(content);
    const fmData: Record<string, unknown> = fm?.data ?? {};

    // Extract description from first heading or first line of content
    let description =
      typeof fmData.description === "string" ? fmData.description : "";
    if (!description) {
      const headingMatch = content.match(
        /^#\s+\/\w[\w-]*\s*-\s*(.+)$/m,
      );
      if (headingMatch) {
        description = headingMatch[1].trim();
      }
    }

    const category = categorize(name, fmData);

    const entry: SkillRegistryEntry = {
      name,
      type: "command",
      path: `.claude/commands/${file.name}`,
      description,
      category,
      tier: tierize(name, category),
      hash: await computeHash(filePath),
      dependencies: extractDependencies(content),
      frontmatter: fmData,
    };

    if (generated_from) {
      entry.generated_from = generated_from;
    }

    entries.push(entry);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Registry generation
// ---------------------------------------------------------------------------

/**
 * Generate the full skill registry by scanning all L0 asset directories.
 *
 * @param rootDir - L0 root directory (AndroidCommonDoc)
 * @returns Complete SkillRegistry object
 */
export async function generateRegistry(
  rootDir: string,
): Promise<SkillRegistry> {
  const [skills, agents, commands] = await Promise.all([
    scanSkills(rootDir),
    scanAgents(rootDir),
    scanCommands(rootDir),
  ]);

  return {
    version: 1,
    generated: new Date().toISOString(),
    l0_root: rootDir,
    entries: [...skills, ...agents, ...commands],
  };
}

/**
 * Generate the registry and write it to skills/registry.json.
 *
 * @param rootDir - L0 root directory (AndroidCommonDoc)
 */
export async function writeRegistry(rootDir: string): Promise<void> {
  const registry = await generateRegistry(rootDir);
  const outPath = path.join(rootDir, "skills", "registry.json");
  await fsWriteFile(outPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}
