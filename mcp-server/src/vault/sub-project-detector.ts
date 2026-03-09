/**
 * Auto-detection of nested sub-projects within a project directory.
 *
 * Identifies directories that represent independent sub-projects by
 * looking for cross-technology build system signals (e.g., CMakeLists.txt
 * in a Gradle project) or independent repository markers (.git).
 *
 * Key insight from research Pitfall 7: Gradle sub-modules (core/, feature/)
 * are NOT sub-projects. Only directories with a DIFFERENT build system or
 * their own .git repo qualify as sub-projects.
 */

import { readdir, stat, access } from "node:fs/promises";
import path from "node:path";
import type { SubProjectConfig } from "./types.js";

/**
 * Build system signals that indicate a directory uses a specific technology.
 * Used to detect the parent project's build system and identify cross-tech
 * sub-projects.
 */
const BUILD_SYSTEM_FILES: Record<string, string> = {
  "build.gradle.kts": "gradle",
  "build.gradle": "gradle",
  "settings.gradle.kts": "gradle",
  "settings.gradle": "gradle",
  "package.json": "node",
  "Cargo.toml": "rust",
  "CMakeLists.txt": "cmake",
  "pyproject.toml": "python",
  "go.mod": "go",
};

/**
 * Signals that indicate a directory is an independent sub-project
 * using a different technology than the parent.
 */
const CROSS_TECH_SIGNALS = [
  "CMakeLists.txt",
  "package.json",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
];

/**
 * Signals that indicate an independent sub-project regardless of tech.
 */
const INDEPENDENT_SIGNALS = [".git"];

/**
 * Directories that should never be treated as sub-project candidates.
 * These are build artifacts, caches, IDE metadata, and standard source
 * directories that are part of the parent project structure.
 */
const SKIP_DIRS = new Set([
  "build",
  ".gradle",
  ".git",
  "node_modules",
  "src",
  "out",
  "dist",
  ".idea",
  ".vscode",
  "__pycache__",
  ".next",
  ".nuxt",
  "target",
  "bin",
  "obj",
  ".androidcommondoc",
  ".planning",
]);

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the build system of a project by checking for known build files.
 *
 * @param projectPath - Absolute path to the project root
 * @returns Build system identifier (e.g., "gradle", "node") or undefined
 */
async function detectBuildSystem(
  projectPath: string,
): Promise<string | undefined> {
  for (const [filename, system] of Object.entries(BUILD_SYSTEM_FILES)) {
    if (await fileExists(path.join(projectPath, filename))) {
      return system;
    }
  }
  return undefined;
}

/**
 * Check if a candidate directory qualifies as a sub-project.
 *
 * A directory is a sub-project if:
 * 1. It has a build system signal from a DIFFERENT technology than the parent, OR
 * 2. It has an independent signal (.git) indicating a separate repository
 *
 * A directory is NOT a sub-project if it uses the SAME build system as the
 * parent (e.g., build.gradle.kts in a Gradle project = Gradle sub-module).
 *
 * @param dirPath - Absolute path to the candidate directory
 * @param parentBuildSystem - The parent project's detected build system
 * @returns true if the directory qualifies as a sub-project
 */
async function isSubProject(
  dirPath: string,
  parentBuildSystem: string | undefined,
): Promise<boolean> {
  // Check independent signals first
  for (const signal of INDEPENDENT_SIGNALS) {
    if (await fileExists(path.join(dirPath, signal))) {
      return true;
    }
  }

  // Check cross-tech signals
  for (const signal of CROSS_TECH_SIGNALS) {
    if (await fileExists(path.join(dirPath, signal))) {
      // Only count as sub-project if it's a DIFFERENT build system
      const signalSystem = BUILD_SYSTEM_FILES[signal];
      if (signalSystem !== parentBuildSystem) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Auto-detect nested sub-projects within a project directory.
 *
 * Scans the project directory for directories that have independent
 * build system signals (different from the parent) or their own .git
 * repository. Does NOT treat Gradle sub-modules as sub-projects.
 *
 * @param projectPath - Absolute path to the project root
 * @param maxDepth - How deep to scan for sub-projects (default: 2)
 * @param buildSystem - Parent's build system override. Auto-detected if not provided.
 * @returns Array of detected sub-project configurations
 */
export async function detectSubProjects(
  projectPath: string,
  maxDepth: number = 2,
  buildSystem?: string,
): Promise<SubProjectConfig[]> {
  // Detect parent build system if not provided
  const parentBuildSystem = buildSystem ?? (await detectBuildSystem(projectPath));

  const subProjects: SubProjectConfig[] = [];

  await scanForSubProjects(
    projectPath,
    projectPath,
    parentBuildSystem,
    maxDepth,
    1,
    subProjects,
  );

  return subProjects;
}

/**
 * Recursively scan directories for sub-project candidates.
 *
 * @param rootPath - The project root (for computing relative paths)
 * @param currentDir - Current directory being scanned
 * @param parentBuildSystem - Parent project's build system
 * @param maxDepth - Maximum scan depth
 * @param currentDepth - Current scan depth
 * @param results - Accumulator for discovered sub-projects
 */
async function scanForSubProjects(
  rootPath: string,
  currentDir: string,
  parentBuildSystem: string | undefined,
  maxDepth: number,
  currentDepth: number,
  results: SubProjectConfig[],
): Promise<void> {
  if (currentDepth > maxDepth) return;

  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const dirPath = path.join(currentDir, entry.name);

    if (await isSubProject(dirPath, parentBuildSystem)) {
      const relativePath = path
        .relative(rootPath, dirPath)
        .replace(/\\/g, "/");

      results.push({
        name: entry.name,
        path: relativePath,
      });
    } else if (currentDepth < maxDepth) {
      // Continue scanning deeper if not a sub-project itself
      await scanForSubProjects(
        rootPath,
        dirPath,
        parentBuildSystem,
        maxDepth,
        currentDepth + 1,
        results,
      );
    }
  }
}
