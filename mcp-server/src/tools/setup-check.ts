/**
 * MCP tool: setup-check
 *
 * Validates project configuration completeness by checking for the
 * presence of required directories, files, and environment variables.
 * Returns structured ValidationResult JSON.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { getToolkitRoot } from "../utils/paths.js";
import type { ValidationResult, ValidationDetail } from "../types/results.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Check if a path exists.
 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory contains files matching a pattern.
 */
async function dirHasFiles(
  dirPath: string,
  extension: string,
): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.some((entry) => entry.endsWith(extension));
  } catch {
    return false;
  }
}

/**
 * Check if skills directory has SKILL.md files in subdirectories.
 */
async function hasSkillFiles(skillsDir: string): Promise<boolean> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
        if (await pathExists(skillMd)) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function registerSetupCheckTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "setup-check",
    {
      title: "Setup Check",
      description:
        "Validate project configuration: env var, docs, scripts, skills, agents",
      inputSchema: z.object({
        projectRoot: z
          .string()
          .optional()
          .describe(
            "Path to AndroidCommonDoc root (defaults to ANDROID_COMMON_DOC env var)",
          ),
      }),
    },
    async ({ projectRoot }) => {
      const rateLimitResponse = checkRateLimit(limiter, "setup-check");
      if (rateLimitResponse) return rateLimitResponse;

      const root = projectRoot ?? getToolkitRoot();
      const startTime = Date.now();

      try {
        const details: ValidationDetail[] = [];
        let failCount = 0;

        // Check 1: ANDROID_COMMON_DOC env var is set
        const envVarSet = Boolean(process.env.ANDROID_COMMON_DOC);
        details.push({
          check: "env-var-android-common-doc",
          status: envVarSet ? "PASS" : "WARN",
          message: envVarSet
            ? "ANDROID_COMMON_DOC environment variable is set"
            : "ANDROID_COMMON_DOC environment variable is not set (using fallback path resolution)",
        });

        // Check 2: docs/ directory exists and has .md files
        const docsDir = path.join(root, "docs");
        const docsExists = await pathExists(docsDir);
        const docsHasMd = docsExists && (await dirHasFiles(docsDir, ".md"));
        details.push({
          check: "docs-directory",
          status: docsHasMd ? "PASS" : "FAIL",
          message: docsHasMd
            ? "docs/ directory exists with .md files"
            : docsExists
              ? "docs/ directory exists but contains no .md files"
              : "docs/ directory not found",
        });
        if (!docsHasMd) failCount++;

        // Check 3: scripts/sh/ directory exists
        const shDir = path.join(root, "scripts", "sh");
        const shExists = await pathExists(shDir);
        details.push({
          check: "scripts-sh-directory",
          status: shExists ? "PASS" : "FAIL",
          message: shExists
            ? "scripts/sh/ directory exists"
            : "scripts/sh/ directory not found",
        });
        if (!shExists) failCount++;

        // Check 4: scripts/ps1/ directory exists (parity)
        const ps1Dir = path.join(root, "scripts", "ps1");
        const ps1Exists = await pathExists(ps1Dir);
        details.push({
          check: "scripts-ps1-directory",
          status: ps1Exists ? "PASS" : "FAIL",
          message: ps1Exists
            ? "scripts/ps1/ directory exists"
            : "scripts/ps1/ directory not found (no cross-platform script parity)",
        });
        if (!ps1Exists) failCount++;

        // Check 5: skills/ directory exists with SKILL.md files
        const skillsDir = path.join(root, "skills");
        const skillsExist = await hasSkillFiles(skillsDir);
        details.push({
          check: "skills-directory",
          status: skillsExist ? "PASS" : "FAIL",
          message: skillsExist
            ? "skills/ directory exists with SKILL.md definitions"
            : "skills/ directory not found or contains no SKILL.md files",
        });
        if (!skillsExist) failCount++;

        // Check 6: .claude/agents/ directory exists
        const agentsDir = path.join(root, ".claude", "agents");
        const agentsExist = await pathExists(agentsDir);
        details.push({
          check: "agents-directory",
          status: agentsExist ? "PASS" : "FAIL",
          message: agentsExist
            ? ".claude/agents/ directory exists"
            : ".claude/agents/ directory not found",
        });
        if (!agentsExist) failCount++;

        const durationMs = Date.now() - startTime;
        const passCount = details.filter((d) => d.status === "PASS").length;

        const result: ValidationResult = {
          status: failCount > 0 ? "FAIL" : "PASS",
          summary: `${passCount}/${details.length} setup checks passed`,
          details,
          duration_ms: durationMs,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error(`setup-check failed: ${String(error)}`);

        const errorResult: ValidationResult = {
          status: "ERROR",
          summary: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
          details: [],
          duration_ms: durationMs,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(errorResult, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );
}
