/**
 * Consumer project auto-discovery.
 *
 * Discovers projects that consume AndroidCommonDoc by scanning sibling
 * directories for settings.gradle.kts files containing includeBuild
 * references to the toolkit. Falls back to ~/.androidcommondoc/projects.yaml
 * when no sibling projects are found.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { getToolkitRoot, getL2Dir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

/** Information about a discovered consumer project. */
export interface ProjectInfo {
  /** Project directory name (e.g., "MyApp") */
  name: string;
  /** Absolute path to project root */
  path: string;
  /** Whether .androidcommondoc/docs/ exists in the project */
  hasL1Docs: boolean;
}

/**
 * Regex to match includeBuild references to AndroidCommonDoc.
 * Handles both single and double quotes, optional whitespace.
 */
const INCLUDE_BUILD_REGEX =
  /includeBuild\s*\(\s*["'].*AndroidCommonDoc["']\s*\)/;

/**
 * Discover consumer projects that reference this toolkit.
 *
 * Strategy:
 * 1. Scan sibling directories of the toolkit root for settings.gradle.kts
 *    files containing an includeBuild reference to AndroidCommonDoc.
 * 2. If no projects found, fall back to ~/.androidcommondoc/projects.yaml.
 *
 * @returns Array of discovered project info objects (empty on errors)
 */
export async function discoverProjects(): Promise<ProjectInfo[]> {
  try {
    const toolkitRoot = getToolkitRoot();
    const toolkitName = path.basename(toolkitRoot);
    const parentDir = path.dirname(toolkitRoot);

    let entries: string[];
    try {
      entries = await readdir(parentDir);
    } catch {
      logger.warn(
        `Project discovery: cannot read parent directory: ${parentDir}`,
      );
      return [];
    }

    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      // Skip the toolkit root itself (avoid circular discovery)
      if (entry === toolkitName) continue;

      const entryPath = path.join(parentDir, entry);

      // Check if it's a directory
      try {
        const entryStat = await stat(entryPath);
        if (!entryStat.isDirectory()) continue;
      } catch {
        continue;
      }

      // Check for settings.gradle.kts
      const settingsPath = path.join(entryPath, "settings.gradle.kts");
      let settingsContent: string;
      try {
        settingsContent = await readFile(settingsPath, "utf-8");
      } catch {
        continue; // No settings.gradle.kts
      }

      // Check if it references AndroidCommonDoc
      if (!INCLUDE_BUILD_REGEX.test(settingsContent)) continue;

      // Check for L1 docs directory
      const hasL1Docs = await directoryExists(
        path.join(entryPath, ".androidcommondoc", "docs"),
      );

      projects.push({
        name: entry,
        path: entryPath,
        hasL1Docs,
      });
    }

    // If no projects found via settings.gradle.kts, try projects.yaml fallback
    if (projects.length === 0) {
      return await discoverFromYaml();
    }

    return projects;
  } catch (error) {
    logger.warn(
      `Project discovery error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

/**
 * Fallback: discover projects from ~/.androidcommondoc/projects.yaml
 */
async function discoverFromYaml(): Promise<ProjectInfo[]> {
  try {
    const yamlPath = path.join(getL2Dir(), "projects.yaml");
    const content = await readFile(yamlPath, "utf-8");
    const parsed = parseYaml(content) as {
      projects?: Array<{ name: string; path: string }>;
    };

    if (!parsed?.projects || !Array.isArray(parsed.projects)) {
      return [];
    }

    const projects: ProjectInfo[] = [];
    for (const entry of parsed.projects) {
      if (typeof entry.name !== "string" || typeof entry.path !== "string") {
        continue;
      }

      const hasL1Docs = await directoryExists(
        path.join(entry.path, ".androidcommondoc", "docs"),
      );

      projects.push({
        name: entry.name,
        path: entry.path,
        hasL1Docs,
      });
    }

    return projects;
  } catch {
    // projects.yaml doesn't exist or is malformed -- that's fine
    return [];
  }
}

/** Check if a directory exists. */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
