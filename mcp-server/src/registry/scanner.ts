/**
 * Directory scanner for discovering pattern documents with valid frontmatter.
 *
 * Scans a directory for .md files, parses their YAML frontmatter, and
 * returns registry entries for files with valid metadata (scope, sources,
 * targets arrays present).
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type {
  Layer,
  MonitorUrl,
  PatternMetadata,
  RegistryEntry,
  RuleDefinition,
} from "./types.js";
import { logger } from "../utils/logger.js";

/** Directories to skip during recursive scanning. */
const SKIP_DIRS = new Set(["archive"]);

/**
 * Recursively discover all .md files under a directory.
 * Skips directories listed in SKIP_DIRS (e.g., archive/).
 *
 * @param dirPath - Absolute path to the directory to scan
 * @returns Array of absolute file paths for discovered .md files
 */
async function findMdFiles(dirPath: string): Promise<string[]> {
  let dirEntries;
  try {
    dirEntries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];

  for (const entry of dirEntries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        const nested = await findMdFiles(fullPath);
        results.push(...nested);
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Scan a directory for .md files with valid YAML frontmatter.
 * Recursively discovers files in subdirectories, skipping archive/.
 *
 * @param dirPath - Absolute path to the directory to scan
 * @param layer - Layer classification (L0, L1, L2) for discovered entries
 * @param project - Optional project name for L1/L2 entries
 * @returns Array of registry entries for files with valid frontmatter
 */
export async function scanDirectory(
  dirPath: string,
  layer: Layer,
  project?: string,
): Promise<RegistryEntry[]> {
  const mdFilePaths = await findMdFiles(dirPath);
  if (mdFilePaths.length === 0) {
    if (!(await readdir(dirPath).catch(() => null))) {
      logger.warn(`Scanner: directory not found or not readable: ${dirPath}`);
    }
    return [];
  }

  const entries: RegistryEntry[] = [];

  for (const filepath of mdFilePaths) {
    const filename = path.basename(filepath);
    let raw: string;
    try {
      raw = await readFile(filepath, "utf-8");
    } catch {
      logger.warn(`Scanner: could not read file: ${filepath}`);
      continue;
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      continue;
    }

    const data = parsed.data;

    // Validate required metadata fields
    if (
      !Array.isArray(data.scope) ||
      !Array.isArray(data.sources) ||
      !Array.isArray(data.targets)
    ) {
      continue;
    }

    const slug = filename.replace(/\.md$/, "");

    const metadata: PatternMetadata = {
      scope: data.scope as string[],
      sources: data.sources as string[],
      targets: data.targets as string[],
      version: typeof data.version === "number" ? data.version : undefined,
      last_updated:
        typeof data.last_updated === "string" ? data.last_updated : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
      slug: typeof data.slug === "string" ? data.slug : undefined,
      status: typeof data.status === "string" ? data.status : undefined,
      excludable_sources: Array.isArray(data.excludable_sources)
        ? (data.excludable_sources as string[])
        : undefined,
      monitor_urls: Array.isArray(data.monitor_urls)
        ? (data.monitor_urls as MonitorUrl[])
        : undefined,
      rules: Array.isArray(data.rules)
        ? (data.rules as RuleDefinition[])
        : undefined,
      layer:
        typeof data.layer === "string"
          ? (data.layer as Layer)
          : undefined,
      parent:
        typeof data.parent === "string" ? data.parent : undefined,
      project:
        typeof data.project === "string" ? data.project : undefined,
      category:
        typeof data.category === "string" ? data.category : undefined,
      l0_refs: Array.isArray(data.l0_refs)
        ? (data.l0_refs as string[])
        : undefined,
    };

    const entry: RegistryEntry = {
      slug,
      filepath: path.resolve(filepath),
      metadata,
      layer,
    };

    if (project !== undefined) {
      entry.project = project;
    }

    entries.push(entry);
  }

  return entries;
}
