/**
 * Path resolution utilities for the AndroidCommonDoc toolkit.
 *
 * Resolves the toolkit root via ANDROID_COMMON_DOC environment variable,
 * falling back to resolving relative to this file's location (3 levels up
 * from build/utils/paths.js to the repo root).
 *
 * NOTE: In ES Modules, __dirname is not available. We use import.meta.url
 * with fileURLToPath from node:url. On Windows, fileURLToPath correctly
 * handles file:///C:/... paths.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

export function getToolkitRoot(): string {
  if (process.env.ANDROID_COMMON_DOC) {
    return process.env.ANDROID_COMMON_DOC;
  }
  // Fallback: resolve relative to this file's compiled location (build/utils/paths.js)
  // 3 levels up: build/utils/ -> build/ -> repo root
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..");
}

export function getDocsDir(): string {
  return path.join(getToolkitRoot(), "docs");
}

export function getSkillsDir(): string {
  return path.join(getToolkitRoot(), "skills");
}

export function getScriptsDir(): string {
  return path.join(getToolkitRoot(), "scripts", "sh");
}

/** Returns the L2 (user-level) override directory: ~/.androidcommondoc/ */
export function getL2Dir(): string {
  return path.join(os.homedir(), ".androidcommondoc");
}

/** Returns the L2 (user-level) docs directory: ~/.androidcommondoc/docs/ */
export function getL2DocsDir(): string {
  return path.join(getL2Dir(), "docs");
}

/** Returns the L1 (project-level) docs directory: <projectPath>/.androidcommondoc/docs/ */
export function getL1DocsDir(projectPath: string): string {
  return path.join(projectPath, ".androidcommondoc", "docs");
}
