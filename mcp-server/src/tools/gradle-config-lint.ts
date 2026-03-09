/**
 * MCP tool: gradle-config-lint
 *
 * Lints Gradle build configuration files for convention plugin usage,
 * hardcoded versions, and deprecated buildscript blocks. Reports findings
 * with severity levels and optional strict mode.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import {
  parseSettingsModules,
  parsePlugins,
  findHardcodedVersions,
} from "../utils/gradle-parser.js";

// ── Finding types ───────────────────────────────────────────────────────────

interface LintFinding {
  module: string;
  file: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
  line?: string;
}

interface LintReport {
  project_root: string;
  strict: boolean;
  modules_checked: number;
  findings: LintFinding[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
}

// ── Hardcoded SDK detection (strict mode) ───────────────────────────────────

function findHardcodedSdk(content: string): string[] {
  const results: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || !trimmed) {
      continue;
    }
    // Match compileSdk = 34, targetSdk = 34, minSdk = 24 (literal numbers)
    if (/(?:compileSdk|targetSdk|minSdk)\s*=\s*\d+/.test(trimmed)) {
      // Skip if it uses a variable reference (libs.*, project.*, ext.)
      if (!trimmed.includes("libs.") && !trimmed.includes("ext.") && !trimmed.includes("project.")) {
        results.push(trimmed);
      }
    }
  }
  return results;
}

// ── Buildscript block detection ─────────────────────────────────────────────

function hasBuildscriptBlock(content: string): boolean {
  // Detect top-level buildscript { ... } block
  return /^buildscript\s*\{/m.test(content);
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: LintReport): string {
  const lines: string[] = [
    "## Gradle Config Lint Report",
    "",
    `**Project:** ${report.project_root}`,
    `**Strict mode:** ${report.strict ? "ON" : "OFF"}`,
    `**Modules checked:** ${report.modules_checked}`,
    `**Findings:** ${report.summary.total} (${report.summary.high} HIGH, ${report.summary.medium} MEDIUM, ${report.summary.low} LOW)`,
    "",
  ];

  if (report.findings.length === 0) {
    lines.push("No issues found.");
  } else {
    lines.push("| # | Severity | Module | Message |");
    lines.push("|---|----------|--------|---------|");
    for (let i = 0; i < report.findings.length; i++) {
      const f = report.findings[i];
      lines.push(`| ${i + 1} | ${f.severity} | ${f.module} | ${f.message} |`);
    }
  }

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerGradleConfigLintTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "gradle-config-lint",
    "Lint Gradle build configuration for convention plugin usage, hardcoded versions, and deprecated buildscript blocks.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the Gradle project root"),
      strict: z
        .boolean()
        .default(false)
        .describe("Enable strict mode: also flag hardcoded compileSdk/targetSdk/minSdk"),
    },
    async ({ project_root, strict = false }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "gradle-config-lint");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const settingsPath = path.join(project_root, "settings.gradle.kts");
        let modules: string[];
        try {
          modules = await parseSettingsModules(settingsPath);
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  summary: `Could not read settings.gradle.kts: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const findings: LintFinding[] = [];

        // Check root build.gradle.kts for buildscript block
        const rootBuildPath = path.join(project_root, "build.gradle.kts");
        try {
          const rootContent = readFileSync(rootBuildPath, "utf-8");
          if (hasBuildscriptBlock(rootContent)) {
            findings.push({
              module: "root",
              file: rootBuildPath,
              severity: "MEDIUM",
              message: "Root build.gradle.kts uses deprecated buildscript {} block; migrate to plugins {}",
            });
          }
        } catch {
          // Root build file missing or unreadable - skip
        }

        // Check each module
        for (const mod of modules) {
          const moduleDir = mod.replace(/^:/, "").replace(/:/g, "/");
          const buildFile = path.join(project_root, moduleDir, "build.gradle.kts");

          let content: string;
          try {
            content = readFileSync(buildFile, "utf-8");
          } catch {
            // Build file missing or unreadable - skip module
            continue;
          }

          // Check convention plugin usage
          const pluginResult = await parsePlugins(buildFile);
          if (!pluginResult.hasConvention) {
            findings.push({
              module: mod,
              file: buildFile,
              severity: strict ? "MEDIUM" : "LOW",
              message: "No convention plugin detected; consider using build-logic convention plugins",
            });
          }

          // Check hardcoded versions
          const hardcodedVersions = await findHardcodedVersions(buildFile);
          for (const line of hardcodedVersions) {
            findings.push({
              module: mod,
              file: buildFile,
              severity: "LOW",
              message: `Hardcoded version: ${line}`,
              line,
            });
          }

          // Strict mode: check for hardcoded SDK values
          if (strict) {
            const sdkLines = findHardcodedSdk(content);
            for (const line of sdkLines) {
              findings.push({
                module: mod,
                file: buildFile,
                severity: "MEDIUM",
                message: `Hardcoded SDK value: ${line}`,
                line,
              });
            }
          }
        }

        const summary = {
          total: findings.length,
          high: findings.filter((f) => f.severity === "HIGH").length,
          medium: findings.filter((f) => f.severity === "MEDIUM").length,
          low: findings.filter((f) => f.severity === "LOW").length,
        };

        const report: LintReport = {
          project_root,
          strict,
          modules_checked: modules.length,
          findings,
          summary,
        };

        const markdown = renderMarkdown(report);
        const json = JSON.stringify(report, null, 2);

        return {
          content: [
            {
              type: "text" as const,
              text: `${markdown}\n\n---\n\n\`\`\`json\n${json}\n\`\`\``,
            },
          ],
        };
      } catch (error) {
        logger.error(`gradle-config-lint error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `gradle-config-lint failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
