/**
 * Layer-aware multi-source collector for the vault sync pipeline.
 *
 * Collects source files from the L0/L1/L2 documentation hierarchy:
 * - L0: AndroidCommonDoc toolkit (patterns, skills, project knowledge)
 * - L1: Ecosystem libraries (your shared library) with configurable globs
 * - L2: Consumer apps with configurable globs
 *
 * Replaces the old hardcoded collection functions with a configurable
 * glob-based pipeline. Each project declares its own collection scope
 * via ProjectConfig, with smart defaults for common doc locations.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { scanDirectory } from "../registry/scanner.js";
import { discoverProjects } from "../registry/project-discovery.js";
import { getToolkitRoot } from "../utils/paths.js";
import { expandGlobs } from "./glob-expander.js";
import { detectSubProjects } from "./sub-project-detector.js";
import { getDefaultGlobs, getDefaultExcludes } from "./config.js";
import { parseVersionCatalog } from "./version-catalog-parser.js";
import type {
  VaultConfig,
  VaultSource,
  VaultSourceType,
  ProjectConfig,
  SubProjectConfig,
} from "./types.js";
import type { Layer } from "../registry/types.js";

/** Normalize path separators to forward slashes for cross-platform consistency. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Safely read a file, returning null if it doesn't exist.
 */
async function safeReadFile(filepath: string): Promise<string | null> {
  try {
    return await readFile(filepath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Parse simple YAML-like frontmatter from a markdown file content string.
 * Returns the data as Record or null if no frontmatter found.
 */
function parseSimpleFrontmatter(
  content: string,
): Record<string, unknown> | null {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;

  const closingIndex = normalized.indexOf("\n---\n", 3);
  if (closingIndex === -1) {
    if (normalized.endsWith("\n---")) {
      return {};
    }
    return null;
  }

  // We have frontmatter but for simple metadata extraction we just
  // return an empty object to indicate presence. Full parsing is done
  // by the transformer pipeline.
  return {};
}

/**
 * File classification result for routing files to the correct vault location.
 */
interface FileClassification {
  /** Vault source type for this file. */
  sourceType: VaultSourceType;
  /** Subdivision directory for organizing within a project. */
  subdivision: "ai" | "docs" | "planning" | "project";
}

/**
 * Classify a file by its relative path to determine source type and subdivision.
 *
 * Classification rules (ordered by specificity):
 * - CLAUDE.md -> claude-md / ai
 * - AGENTS.md -> agents / ai
 * - .planning/codebase/** -> architecture / planning
 * - .planning/** -> planning / planning
 * - docs/** -> docs / docs
 * - .androidcommondoc/docs/** -> pattern (L1 override) / docs
 * - Everything else -> docs / docs
 *
 * @param relativePath - Forward-slash normalized path relative to project root
 * @returns Classification with sourceType and subdivision
 */
function classifyFile(relativePath: string): FileClassification {
  const basename = relativePath.split("/").pop() ?? "";

  // AI instruction files
  if (basename === "CLAUDE.md") {
    return { sourceType: "claude-md", subdivision: "ai" };
  }
  if (basename === "AGENTS.md") {
    return { sourceType: "agents", subdivision: "ai" };
  }

  // Architecture docs (must be checked before generic .planning/)
  if (relativePath.startsWith(".planning/codebase/")) {
    return { sourceType: "architecture", subdivision: "planning" };
  }

  // Planning docs
  if (relativePath.startsWith(".planning/")) {
    return { sourceType: "planning", subdivision: "planning" };
  }

  // L1 pattern overrides from .androidcommondoc/docs/
  if (relativePath.startsWith(".androidcommondoc/docs/")) {
    return { sourceType: "pattern", subdivision: "docs" };
  }

  // Root-level README.md (project index) -- route to project root, not docs/
  if (basename === "README.md" && !relativePath.includes("/")) {
    return { sourceType: "docs", subdivision: "project" };
  }

  // General docs and everything else
  return { sourceType: "docs", subdivision: "docs" };
}

/**
 * Get the layer directory name for vault routing.
 *
 * @param layer - The layer classification
 * @returns Directory prefix for the layer
 */
function getLayerDir(layer: Layer): string {
  switch (layer) {
    case "L0":
      return "L0-generic";
    case "L1":
      return "L1-ecosystem";
    case "L2":
      return "L2-apps";
  }
}

/**
 * Collect L0 sources from the AndroidCommonDoc toolkit.
 *
 * Gathers:
 * - Pattern docs from docs/ via scanDirectory (preserves frontmatter handling)
 * - Skills from skills/SKILL.md
 * - Toolkit project knowledge: CLAUDE.md, AGENTS.md, .planning/PROJECT.md,
 *   .planning/STATE.md decisions, .planning/codebase/*.md
 *
 * All sources get `layer: "L0"` with L0-generic/ path routing.
 *
 * @param toolkitRoot - Absolute path to the AndroidCommonDoc root
 * @returns Array of VaultSource entries with layer L0
 */
export async function collectL0Sources(
  toolkitRoot: string,
): Promise<VaultSource[]> {
  const sources: VaultSource[] = [];

  // 1. Pattern docs via scanDirectory (preserves frontmatter validation)
  const docsDir = path.join(toolkitRoot, "docs");
  const entries = await scanDirectory(docsDir, "L0");

  for (const entry of entries) {
    const content = await safeReadFile(entry.filepath);
    if (content === null) continue;

    // Route L0 patterns into category subdirectories
    const category = entry.metadata.category ?? "uncategorized";

    sources.push({
      filepath: entry.filepath,
      content,
      metadata: entry.metadata as unknown as Record<string, unknown>,
      sourceType: "pattern",
      layer: "L0",
      relativePath: normalizePath(`L0-generic/patterns/${category}/${entry.slug}.md`),
    });
  }

  // 2. Skills from skills/*/SKILL.md
  const skillsDir = path.join(toolkitRoot, "skills");
  let skillEntries: string[];
  try {
    skillEntries = await readdir(skillsDir);
  } catch {
    skillEntries = [];
  }

  for (const skillName of skillEntries) {
    const skillPath = path.join(skillsDir, skillName);
    try {
      const skillStat = await stat(skillPath);
      if (!skillStat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillMdPath = path.join(skillPath, "SKILL.md");
    const content = await safeReadFile(skillMdPath);
    if (content === null) continue;

    sources.push({
      filepath: skillMdPath,
      content,
      metadata: null,
      sourceType: "skill",
      layer: "L0",
      relativePath: normalizePath(`L0-generic/skills/${skillName}.md`),
    });
  }

  // 3. Promoted agents from .claude/agents/*.md
  const agentsDir = path.join(toolkitRoot, ".claude", "agents");
  let agentFiles: string[];
  try {
    agentFiles = await readdir(agentsDir);
  } catch {
    agentFiles = [];
  }

  for (const filename of agentFiles) {
    if (!filename.endsWith(".md")) continue;

    const filepath = path.join(agentsDir, filename);
    const content = await safeReadFile(filepath);
    if (content === null) continue;

    const slug = filename.replace(/\.md$/, "");
    sources.push({
      filepath,
      content,
      metadata: parseSimpleFrontmatter(content),
      sourceType: "agents",
      layer: "L0",
      relativePath: normalizePath(`L0-generic/agents/${slug}.md`),
    });
  }

  // 4. Promoted commands from .claude/commands/*.md
  const commandsDir = path.join(toolkitRoot, ".claude", "commands");
  let commandFiles: string[];
  try {
    commandFiles = await readdir(commandsDir);
  } catch {
    commandFiles = [];
  }

  for (const filename of commandFiles) {
    if (!filename.endsWith(".md")) continue;

    const filepath = path.join(commandsDir, filename);
    const content = await safeReadFile(filepath);
    if (content === null) continue;

    const slug = filename.replace(/\.md$/, "");
    sources.push({
      filepath,
      content,
      metadata: parseSimpleFrontmatter(content),
      sourceType: "docs",
      layer: "L0",
      relativePath: normalizePath(`L0-generic/commands/${slug}.md`),
    });
  }

  // 5. Promoted skills from .agents/skills/*/SKILL.md
  const promotedSkillsDir = path.join(toolkitRoot, ".agents", "skills");
  let promotedSkillEntries: string[];
  try {
    promotedSkillEntries = await readdir(promotedSkillsDir);
  } catch {
    promotedSkillEntries = [];
  }

  for (const skillName of promotedSkillEntries) {
    const skillPath = path.join(promotedSkillsDir, skillName);
    try {
      const skillStat = await stat(skillPath);
      if (!skillStat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillMdPath = path.join(skillPath, "SKILL.md");
    const content = await safeReadFile(skillMdPath);
    if (content === null) continue;

    sources.push({
      filepath: skillMdPath,
      content,
      metadata: null,
      sourceType: "skill",
      layer: "L0",
      relativePath: normalizePath(
        `L0-generic/skills/${skillName}.md`,
      ),
    });
  }

  // 6. Toolkit project knowledge
  const toolkitName = path.basename(toolkitRoot);

  // CLAUDE.md
  const claudeMdPath = path.join(toolkitRoot, "CLAUDE.md");
  const claudeContent = await safeReadFile(claudeMdPath);
  if (claudeContent !== null) {
    sources.push({
      filepath: claudeMdPath,
      content: claudeContent,
      metadata: null,
      sourceType: "claude-md",
      layer: "L0",
      relativePath: normalizePath(
        `L0-generic/${toolkitName}/ai/CLAUDE.md`,
      ),
    });
  }

  // AGENTS.md
  const agentsMdPath = path.join(toolkitRoot, "AGENTS.md");
  const agentsContent = await safeReadFile(agentsMdPath);
  if (agentsContent !== null) {
    const lineCount = agentsContent.split("\n").length;
    sources.push({
      filepath: agentsMdPath,
      content: agentsContent,
      metadata: lineCount > 500 ? { largefile: true } : null,
      sourceType: "agents",
      layer: "L0",
      relativePath: normalizePath(
        `L0-generic/${toolkitName}/ai/AGENTS.md`,
      ),
    });
  }

  // .planning/PROJECT.md
  const projectMdPath = path.join(toolkitRoot, ".planning", "PROJECT.md");
  const projectContent = await safeReadFile(projectMdPath);
  if (projectContent !== null) {
    sources.push({
      filepath: projectMdPath,
      content: projectContent,
      metadata: null,
      sourceType: "planning",
      layer: "L0",
      relativePath: normalizePath(
        `L0-generic/${toolkitName}/planning/PROJECT.md`,
      ),
    });
  }

  // .planning/STATE.md decisions section
  const stateMdPath = path.join(toolkitRoot, ".planning", "STATE.md");
  const stateContent = await safeReadFile(stateMdPath);
  if (stateContent !== null) {
    const decisionsMatch = stateContent.match(
      /### Decisions\n([\s\S]*?)(?=\n### |\n## |$)/,
    );
    if (decisionsMatch) {
      sources.push({
        filepath: stateMdPath,
        content: decisionsMatch[0],
        metadata: null,
        sourceType: "planning",
        layer: "L0",
        relativePath: normalizePath(
          `L0-generic/${toolkitName}/planning/decisions.md`,
        ),
      });
    }
  }

  // .planning/codebase/*.md (architecture docs)
  const codebaseDir = path.join(toolkitRoot, ".planning", "codebase");
  let codebaseFiles: string[];
  try {
    codebaseFiles = await readdir(codebaseDir);
  } catch {
    codebaseFiles = [];
  }

  for (const filename of codebaseFiles) {
    if (!filename.endsWith(".md")) continue;

    const filepath = path.join(codebaseDir, filename);
    const content = await safeReadFile(filepath);
    if (content === null) continue;

    sources.push({
      filepath,
      content,
      metadata: null,
      sourceType: "architecture",
      layer: "L0",
      relativePath: normalizePath(
        `L0-generic/${toolkitName}/planning/${filename}`,
      ),
    });
  }

  return sources;
}

/**
 * Collect sources from a configured project using glob-based file discovery.
 *
 * Uses expandGlobs with the project's collectGlobs (or smart defaults)
 * and classifies each file by path for proper vault routing.
 *
 * Also handles:
 * - L1 pattern overrides from .androidcommondoc/docs/
 * - Version catalog generation when features.versionCatalog is true
 *
 * @param project - Project configuration with path, layer, and globs
 * @returns Array of VaultSource entries for this project
 */
export async function collectProjectSources(
  project: ProjectConfig,
): Promise<VaultSource[]> {
  const sources: VaultSource[] = [];
  const layerDir = getLayerDir(project.layer);

  // Expand globs to discover files
  const includeGlobs =
    project.collectGlobs ?? getDefaultGlobs(project.layer);
  const excludeGlobs = project.excludeGlobs ?? getDefaultExcludes();

  const matches = await expandGlobs(project.path, includeGlobs, excludeGlobs);

  for (const match of matches) {
    const content = await safeReadFile(match.absolutePath);
    if (content === null) continue;

    const classification = classifyFile(match.relativePath);
    const filename = match.relativePath.split("/").pop() ?? "";

    // Determine vault-relative output path
    let vaultRelativePath: string;

    if (classification.sourceType === "pattern") {
      // L1 pattern overrides from .androidcommondoc/docs/
      // Route to patterns subdirectory for layer-aware override visibility
      const slug = filename.replace(/\.md$/, "");
      vaultRelativePath = `${layerDir}/${project.name}/patterns/${slug}.md`;
    } else {
      // Preserve source subdirectory structure for docs files
      // e.g., docs/security/crypto.md -> {layer}/{project}/docs/security/crypto.md
      const subdivisionPrefix = classification.subdivision + "/";
      const matchPath = match.relativePath.replace(/\\/g, "/");

      // Find the subdirectory path within the subdivision
      // e.g., for "docs/security/crypto.md" -> "security/crypto.md"
      const subdivisionIdx = matchPath.indexOf(subdivisionPrefix);
      if (subdivisionIdx !== -1) {
        const pathAfterSubdivision = matchPath.slice(subdivisionIdx + subdivisionPrefix.length);
        vaultRelativePath = `${layerDir}/${project.name}/${classification.subdivision}/${pathAfterSubdivision}`;
      } else {
        // No subdivision directory in the path -- preserve full relative path
        // to avoid collisions (e.g., core-common/README.md, core-result/README.md
        // must NOT both map to docs/README.md)
        vaultRelativePath = `${layerDir}/${project.name}/${classification.subdivision}/${matchPath}`;
      }
    }

    // Parse frontmatter for metadata
    const metadata = parseSimpleFrontmatter(content);

    // Handle AGENTS.md largefile flag
    let finalMetadata = metadata;
    if (
      classification.sourceType === "agents" &&
      content.split("\n").length > 500
    ) {
      finalMetadata = { ...metadata, largefile: true };
    }

    sources.push({
      filepath: match.absolutePath,
      content,
      metadata: finalMetadata,
      sourceType: classification.sourceType,
      project: project.name,
      layer: project.layer,
      relativePath: normalizePath(vaultRelativePath),
    });
  }

  // Version catalog support
  if (project.features?.versionCatalog) {
    const tomlPath = path.join(project.path, "gradle", "libs.versions.toml");
    const catalogContent = await parseVersionCatalog(tomlPath);

    if (catalogContent !== null) {
      sources.push({
        filepath: tomlPath,
        content: catalogContent,
        metadata: null,
        sourceType: "docs",
        project: project.name,
        layer: project.layer,
        relativePath: normalizePath(
          `${layerDir}/${project.name}/docs/version-catalog.md`,
        ),
      });
    }
  }

  return sources;
}

/**
 * Collect sources from a sub-project.
 *
 * Resolves the sub-project path (relative to parent or absolute for external
 * sub-projects), then collects using the sub-project's own globs or
 * inherited parent globs.
 *
 * Output paths are nested under the parent project:
 * {layer-dir}/{project.name}/sub-projects/{subProject.name}/{subdivision}/{filename}
 *
 * @param project - Parent project configuration
 * @param subProject - Sub-project configuration
 * @returns Array of VaultSource entries with subProject field set
 */
export async function collectSubProjectSources(
  project: ProjectConfig,
  subProject: SubProjectConfig,
): Promise<VaultSource[]> {
  const sources: VaultSource[] = [];
  const layerDir = getLayerDir(project.layer);

  // Resolve sub-project path
  const subProjectPath = path.isAbsolute(subProject.path)
    ? subProject.path
    : path.join(project.path, subProject.path);

  // Use sub-project's own globs or inherit from parent
  const includeGlobs =
    subProject.collectGlobs ??
    project.collectGlobs ??
    getDefaultGlobs(project.layer);
  const excludeGlobs =
    subProject.excludeGlobs ??
    project.excludeGlobs ??
    getDefaultExcludes();

  const matches = await expandGlobs(
    subProjectPath,
    includeGlobs,
    excludeGlobs,
  );

  for (const match of matches) {
    const content = await safeReadFile(match.absolutePath);
    if (content === null) continue;

    const classification = classifyFile(match.relativePath);
    const filename = match.relativePath.split("/").pop() ?? "";

    const vaultRelativePath = `${layerDir}/${project.name}/sub-projects/${subProject.name}/${classification.subdivision}/${filename}`;

    const metadata = parseSimpleFrontmatter(content);

    let finalMetadata = metadata;
    if (
      classification.sourceType === "agents" &&
      content.split("\n").length > 500
    ) {
      finalMetadata = { ...metadata, largefile: true };
    }

    sources.push({
      filepath: match.absolutePath,
      content,
      metadata: finalMetadata,
      sourceType: classification.sourceType,
      project: project.name,
      layer: project.layer,
      subProject: subProject.name,
      relativePath: normalizePath(vaultRelativePath),
    });
  }

  // Deduplicate by absolute source path (keep first occurrence)
  const seen = new Set<string>();
  const deduplicated: VaultSource[] = [];
  for (const source of sources) {
    const normalizedSourcePath = normalizePath(source.filepath).toLowerCase();
    if (seen.has(normalizedSourcePath)) continue;
    seen.add(normalizedSourcePath);
    deduplicated.push(source);
  }

  return deduplicated;
}

/**
 * Orchestrate full collection from toolkit (L0) + consumer projects (L1/L2).
 *
 * Collection pipeline:
 * 1. Collect L0 from the toolkit root (patterns, skills, project knowledge)
 * 2. Determine projects: use configured projects or auto-discover
 * 3. For each project:
 *    a. collectProjectSources (glob-based file collection)
 *    b. Collect configured sub-projects
 *    c. Auto-detect additional sub-projects if subProjectScanDepth > 0
 * 4. Return combined sources
 *
 * @param config - Vault configuration with project definitions
 * @returns Combined array of all collected VaultSource entries
 */
export async function collectAll(
  config: VaultConfig,
): Promise<VaultSource[]> {
  const toolkitRoot = getToolkitRoot();
  const sources: VaultSource[] = [];

  // 1. Collect L0 from toolkit root
  const l0Sources = await collectL0Sources(toolkitRoot);
  sources.push(...l0Sources);

  // 2. Determine projects to process
  let projects: ProjectConfig[];

  if (config.projects.length === 0) {
    // Auto-discover consumer projects and build default ProjectConfig[]
    const discovered = await discoverProjects();
    projects = discovered.map((info) => ({
      name: info.name,
      path: info.path,
      layer: "L2" as const,
    }));
  } else {
    projects = config.projects;
  }

  // 3. For each project: collect sources + sub-projects
  for (const project of projects) {
    // Main project sources
    const projectSources = await collectProjectSources(project);
    sources.push(...projectSources);

    // Collect configured sub-projects
    const configuredSubProjects = project.subProjects ?? [];
    for (const subProject of configuredSubProjects) {
      const subSources = await collectSubProjectSources(project, subProject);
      sources.push(...subSources);
    }

    // Auto-detect additional sub-projects if scan depth is configured
    const scanDepth = project.features?.subProjectScanDepth ?? 0;
    if (scanDepth > 0) {
      const detectedSubProjects = await detectSubProjects(
        project.path,
        scanDepth,
      );

      // Filter out already-configured sub-projects (by name)
      const configuredNames = new Set(
        configuredSubProjects.map((sp) => sp.name),
      );
      const newSubProjects = detectedSubProjects.filter(
        (sp) => !configuredNames.has(sp.name),
      );

      for (const subProject of newSubProjects) {
        const subSources = await collectSubProjectSources(
          project,
          subProject,
        );
        sources.push(...subSources);
      }
    }
  }

  // Final dedup pass: ensure no source file appears more than once
  // across all collection methods (L0 + project + sub-project)
  const seenPaths = new Set<string>();
  const deduplicatedSources: VaultSource[] = [];
  for (const source of sources) {
    const normalizedPath = normalizePath(source.filepath).toLowerCase();
    if (seenPaths.has(normalizedPath)) continue;
    seenPaths.add(normalizedPath);
    deduplicatedSources.push(source);
  }

  return deduplicatedSources;
}
