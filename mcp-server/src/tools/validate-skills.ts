/**
 * MCP tool: validate-skills
 *
 * Validates L0 skill assets for correctness:
 * - Frontmatter completeness (name, description, allowed-tools for skills; tools for agents)
 * - Script dependency existence on disk
 * - Registry sync (registry.json vs filesystem truth)
 * - Project sync (materialized copies match manifest checksums)
 *
 * Returns structured JSON with errors, warnings, and summary counts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../registry/frontmatter.js";
import {
  generateRegistry,
  computeHash,
  type SkillRegistryEntry,
  type SkillRegistry,
} from "../registry/skill-registry.js";
import { getToolkitRoot } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single validation issue. */
export interface ValidationIssue {
  level: "error" | "warning";
  category: string;
  file: string;
  message: string;
}

/** Aggregated validation result. */
export interface ValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Frontmatter validation
// ---------------------------------------------------------------------------

/**
 * Validate frontmatter for all SKILL.md files in the skills directory,
 * and optionally for agent files in the agents directory.
 *
 * Required fields for skills: name, description
 * Warnings: allowed-tools should be array, disable-model-invocation should be boolean
 * Required fields for agents: tools (warning if missing)
 *
 * @param skillsDir - Absolute path to the skills/ directory
 * @param agentsDir - Optional absolute path to the .claude/agents/ directory
 * @returns Array of validation issues
 */
export async function validateSkillFrontmatter(
  skillsDir: string,
  agentsDir?: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Validate skills
  let dirs: Dirent[];
  try {
    dirs = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    dirs = [] as Dirent[];
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const skillMdPath = path.join(skillsDir, dir.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMdPath, "utf-8");
    } catch {
      continue; // Skip directories without SKILL.md
    }

    const fm = parseFrontmatter(content);
    const fmData: Record<string, unknown> = fm?.data ?? {};
    const relPath = `skills/${dir.name}/SKILL.md`;

    // Required: name
    if (!fmData.name || typeof fmData.name !== "string") {
      issues.push({
        level: "error",
        category: "frontmatter",
        file: relPath,
        message: `Missing required frontmatter field: name`,
      });
    }

    // Required: description
    if (!fmData.description || typeof fmData.description !== "string") {
      issues.push({
        level: "error",
        category: "frontmatter",
        file: relPath,
        message: `Missing required frontmatter field: description`,
      });
    }

    // Warning: allowed-tools should be an array
    if (
      fmData["allowed-tools"] !== undefined &&
      !Array.isArray(fmData["allowed-tools"])
    ) {
      issues.push({
        level: "warning",
        category: "frontmatter",
        file: relPath,
        message: `allowed-tools should be an array, got ${typeof fmData["allowed-tools"]}`,
      });
    }

    // Warning: disable-model-invocation should be boolean if present
    if (
      fmData["disable-model-invocation"] !== undefined &&
      typeof fmData["disable-model-invocation"] !== "boolean"
    ) {
      issues.push({
        level: "warning",
        category: "frontmatter",
        file: relPath,
        message: `disable-model-invocation should be boolean, got ${typeof fmData["disable-model-invocation"]}`,
      });
    }
  }

  // Validate agents (optional)
  if (agentsDir) {
    let agentFiles;
    try {
      agentFiles = await readdir(agentsDir, { withFileTypes: true });
    } catch {
      return issues;
    }

    for (const file of agentFiles) {
      if (!file.isFile() || !file.name.endsWith(".md")) continue;

      const filePath = path.join(agentsDir, file.name);
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const fm = parseFrontmatter(content);
      const fmData: Record<string, unknown> = fm?.data ?? {};
      const relPath = `.claude/agents/${file.name}`;

      // Warning: agents should have tools field
      if (!fmData.tools && !Array.isArray(fmData.tools)) {
        issues.push({
          level: "warning",
          category: "frontmatter",
          file: relPath,
          message: `Agent missing recommended frontmatter field: tools`,
        });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Dependency validation
// ---------------------------------------------------------------------------

/**
 * Validate that script dependencies referenced by registry entries
 * actually exist on disk.
 *
 * @param rootDir - L0 root directory
 * @param entries - Registry entries to check
 * @returns Array of validation issues
 */
export async function validateDependencies(
  rootDir: string,
  entries: SkillRegistryEntry[],
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const entry of entries) {
    if (!entry.dependencies || entry.dependencies.length === 0) continue;

    for (const dep of entry.dependencies) {
      const depPath = path.join(rootDir, dep);
      try {
        await stat(depPath);
      } catch {
        issues.push({
          level: "warning",
          category: "dependency",
          file: entry.path,
          message: `Referenced script dependency not found on disk: ${dep}`,
        });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Registry sync validation
// ---------------------------------------------------------------------------

/**
 * Validate that registry.json is in sync with the filesystem.
 *
 * Generates a fresh registry from the filesystem and compares against
 * the existing registry.json. Reports:
 * - Entries in registry.json but not on disk
 * - Entries on disk but not in registry.json
 * - Hash mismatches between registry.json and actual file content
 *
 * @param rootDir - L0 root directory
 * @returns Array of validation issues
 */
export async function validateRegistrySync(
  rootDir: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Read existing registry.json
  const registryPath = path.join(rootDir, "skills", "registry.json");
  let existingRegistry: SkillRegistry;
  try {
    const raw = await readFile(registryPath, "utf-8");
    existingRegistry = JSON.parse(raw);
  } catch {
    issues.push({
      level: "error",
      category: "registry-sync",
      file: "skills/registry.json",
      message: "Cannot read or parse skills/registry.json",
    });
    return issues;
  }

  // Generate fresh registry from filesystem
  const freshRegistry = await generateRegistry(rootDir);

  // Build lookup maps by path
  const existingByPath = new Map<string, SkillRegistryEntry>();
  for (const entry of existingRegistry.entries) {
    existingByPath.set(entry.path, entry);
  }

  const freshByPath = new Map<string, SkillRegistryEntry>();
  for (const entry of freshRegistry.entries) {
    freshByPath.set(entry.path, entry);
  }

  // Check for entries in registry but not on filesystem
  for (const [entryPath, entry] of existingByPath) {
    if (!freshByPath.has(entryPath)) {
      issues.push({
        level: "error",
        category: "registry-sync",
        file: entryPath,
        message: `Registry entry "${entry.name}" not on disk (path: ${entryPath})`,
      });
    }
  }

  // Check for entries on filesystem but not in registry
  for (const [entryPath, entry] of freshByPath) {
    if (!existingByPath.has(entryPath)) {
      issues.push({
        level: "error",
        category: "registry-sync",
        file: entryPath,
        message: `Filesystem entry "${entry.name}" not in registry (path: ${entryPath})`,
      });
    }
  }

  // Check hash mismatches for entries present in both
  for (const [entryPath, existingEntry] of existingByPath) {
    const freshEntry = freshByPath.get(entryPath);
    if (freshEntry && existingEntry.hash !== freshEntry.hash) {
      issues.push({
        level: "error",
        category: "registry-sync",
        file: entryPath,
        message: `hash mismatch for "${existingEntry.name}": registry=${existingEntry.hash.slice(0, 20)}... actual=${freshEntry.hash.slice(0, 20)}...`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Project sync validation
// ---------------------------------------------------------------------------

/**
 * Validate that a downstream project's materialized copies match
 * its l0-manifest.json checksums.
 *
 * @param projectRoot - Absolute path to the downstream project
 * @returns Array of validation issues
 */
export async function validateProjectSync(
  projectRoot: string,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Read l0-manifest.json
  const manifestPath = path.join(projectRoot, "l0-manifest.json");
  let manifest: {
    checksums: Record<string, string>;
    [key: string]: unknown;
  };
  try {
    const raw = await readFile(manifestPath, "utf-8");
    manifest = JSON.parse(raw);
  } catch {
    issues.push({
      level: "error",
      category: "project-sync",
      file: "l0-manifest.json",
      message: "Cannot read or parse l0-manifest.json",
    });
    return issues;
  }

  if (!manifest.checksums || typeof manifest.checksums !== "object") {
    issues.push({
      level: "warning",
      category: "project-sync",
      file: "l0-manifest.json",
      message: "No checksums field in l0-manifest.json",
    });
    return issues;
  }

  // Verify each checksum entry
  for (const [relPath, expectedHash] of Object.entries(manifest.checksums)) {
    const filePath = path.join(projectRoot, relPath);
    try {
      const actualHash = await computeHash(filePath);
      if (actualHash !== expectedHash) {
        issues.push({
          level: "error",
          category: "project-sync",
          file: relPath,
          message: `checksum mismatch: manifest=${expectedHash.slice(0, 20)}... actual=${actualHash.slice(0, 20)}...`,
        });
      }
    } catch {
      issues.push({
        level: "error",
        category: "project-sync",
        file: relPath,
        message: `File in manifest checksums not found on disk: ${relPath}`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all skill validations and return a structured result.
 *
 * @param rootDir - L0 root directory
 * @param projectRoot - Optional downstream project path for cross-project validation
 * @returns Aggregated validation result with errors, warnings, issues, and summary
 */
export async function validateSkills(
  rootDir: string,
  projectRoot?: string,
): Promise<ValidationResult> {
  const allIssues: ValidationIssue[] = [];

  // 1. Frontmatter validation
  const skillsDir = path.join(rootDir, "skills");
  const agentsDir = path.join(rootDir, ".claude", "agents");
  const frontmatterIssues = await validateSkillFrontmatter(
    skillsDir,
    agentsDir,
  );
  allIssues.push(...frontmatterIssues);

  // 2. Registry sync validation
  const registrySyncIssues = await validateRegistrySync(rootDir);
  allIssues.push(...registrySyncIssues);

  // 3. Dependency validation (uses fresh registry entries)
  try {
    const freshRegistry = await generateRegistry(rootDir);
    const dependencyIssues = await validateDependencies(
      rootDir,
      freshRegistry.entries,
    );
    allIssues.push(...dependencyIssues);
  } catch {
    allIssues.push({
      level: "error",
      category: "dependency",
      file: "skills/",
      message: "Failed to generate registry for dependency validation",
    });
  }

  // 4. Project sync validation (optional)
  if (projectRoot) {
    const projectSyncIssues = await validateProjectSync(projectRoot);
    allIssues.push(...projectSyncIssues);
  }

  const errors = allIssues.filter((i) => i.level === "error").length;
  const warnings = allIssues.filter((i) => i.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings,
    issues: allIssues,
    summary: `Validation complete: ${errors} error(s), ${warnings} warning(s)`,
  };
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

/**
 * Register the validate-skills MCP tool.
 *
 * @param server - MCP server instance
 * @param limiter - Optional rate limiter
 */
export function registerValidateSkillsTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-skills",
    {
      title: "Validate Skills",
      description:
        "Validates L0 skill assets: frontmatter completeness, script dependencies, registry sync, and optional project sync. Returns structured JSON with errors, warnings, and summary.",
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe(
            "Optional downstream project root path for cross-project validation",
          ),
      }),
    },
    async ({ project }) => {
      const rateLimitResponse = checkRateLimit(limiter, "validate-skills");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const rootDir = getToolkitRoot();
        const result = await validateSkills(rootDir, project);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error(`validate-skills error: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );
}
