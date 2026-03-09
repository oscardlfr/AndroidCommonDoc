/**
 * Reusable Gradle file parsing utilities.
 *
 * Used by dependency-graph, module-health, gradle-config-lint, and
 * proguard-validator tools. Pure TypeScript with regex — no external deps.
 */
import { readFile } from "node:fs/promises";

/**
 * Extract module include declarations from settings.gradle.kts.
 * Handles: include(":mod"), include(":mod:sub"), multiple includes per line.
 */
export async function parseSettingsModules(
  settingsPath: string,
): Promise<string[]> {
  const content = await readFile(settingsPath, "utf-8");
  const modules: string[] = [];
  // Match include(":module") or include(":module:sub")
  // Also handles multi-include: include(":a", ":b")
  const includeRegex = /include\s*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = includeRegex.exec(content)) !== null) {
    const args = match[1];
    // Extract each quoted module path
    const moduleRegex = /"([^"]+)"/g;
    let modMatch: RegExpExecArray | null;
    while ((modMatch = moduleRegex.exec(args)) !== null) {
      modules.push(modMatch[1]);
    }
  }
  return modules;
}

/**
 * Parse project dependencies from a build.gradle.kts file.
 * Returns api and implementation project dependencies.
 */
export async function parseModuleDependencies(
  buildGradlePath: string,
): Promise<{ api: string[]; implementation: string[] }> {
  const content = await readFile(buildGradlePath, "utf-8");
  const api: string[] = [];
  const implementation: string[] = [];

  // Match: api(project(":module")) or implementation(project(":module"))
  const depRegex =
    /(api|implementation)\s*\(\s*project\s*\(\s*"([^"]+)"\s*\)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = depRegex.exec(content)) !== null) {
    const type = match[1];
    const module = match[2];
    if (type === "api") {
      api.push(module);
    } else {
      implementation.push(module);
    }
  }

  return { api, implementation };
}

/**
 * Extract plugin IDs from the plugins {} block in build.gradle.kts.
 * Also detects whether convention plugins are used.
 */
export async function parsePlugins(
  buildGradlePath: string,
): Promise<{ ids: string[]; hasConvention: boolean }> {
  const content = await readFile(buildGradlePath, "utf-8");
  const ids: string[] = [];

  // Extract plugins block
  const pluginsBlockRegex = /plugins\s*\{([^}]*)\}/s;
  const blockMatch = pluginsBlockRegex.exec(content);
  if (!blockMatch) {
    return { ids: [], hasConvention: false };
  }

  const block = blockMatch[1];

  // Match: id("plugin.id"), alias(libs.plugins.foo), kotlin("jvm")
  const idRegex = /id\s*\(\s*"([^"]+)"\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(block)) !== null) {
    ids.push(match[1]);
  }

  const aliasRegex = /alias\s*\(\s*([^)]+)\s*\)/g;
  while ((match = aliasRegex.exec(block)) !== null) {
    ids.push(match[1].trim());
  }

  const kotlinRegex = /kotlin\s*\(\s*"([^"]+)"\s*\)/g;
  while ((match = kotlinRegex.exec(block)) !== null) {
    ids.push(`org.jetbrains.kotlin.${match[1]}`);
  }

  // Convention plugins typically come from build-logic or convention plugin IDs
  const hasConvention =
    ids.some(
      (id) =>
        id.includes("convention") ||
        id.includes("build-logic") ||
        id.startsWith("libs.plugins."),
    ) || /alias\s*\(/.test(block);

  return { ids, hasConvention };
}

/**
 * Detect hardcoded version strings not from the version catalog.
 * Returns lines containing hardcoded versions.
 */
export async function findHardcodedVersions(
  buildGradlePath: string,
): Promise<string[]> {
  const content = await readFile(buildGradlePath, "utf-8");
  const hardcoded: string[] = [];

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and blank lines
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || !trimmed) {
      continue;
    }
    // Skip version catalog refs (libs.*)
    if (trimmed.includes("libs.")) {
      continue;
    }
    // Skip plugin version application
    if (/^\s*version\s*=/.test(line) && !trimmed.includes('"')) {
      continue;
    }
    // Detect version patterns: "group:artifact:1.2.3" or version "1.2.3"
    const versionInDep = /"\S+:\S+:\d+[\d.]*[^"]*"/;
    const versionAssign = /version\s*[=(]\s*"[\d.]+/;
    if (versionInDep.test(trimmed) || versionAssign.test(trimmed)) {
      hardcoded.push(trimmed);
    }
  }

  return hardcoded;
}
