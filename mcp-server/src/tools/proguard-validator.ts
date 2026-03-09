/**
 * MCP tool: proguard-validator
 *
 * Validates ProGuard/R8 configuration for Gradle modules. Checks that
 * referenced proguard files exist and recommends keep rules based on
 * detected library dependencies (Ktor, kotlinx.serialization, Room, Compose).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { parseSettingsModules } from "../utils/gradle-parser.js";

// ── ProGuard file extraction ────────────────────────────────────────────────

interface ProguardReference {
  filename: string;
  isDefault: boolean; // true if getDefaultProguardFile(...)
  exists: boolean;
}

/**
 * Extract the balanced parenthesized content after a keyword match.
 * Handles nested parentheses like getDefaultProguardFile("...") inside proguardFiles(...).
 */
function extractBalancedParens(content: string, startIndex: number): string | null {
  if (content[startIndex] !== "(") return null;
  let depth = 1;
  let i = startIndex + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return content.substring(startIndex + 1, i - 1);
}

function extractProguardReferences(
  buildContent: string,
  moduleDir: string,
): ProguardReference[] {
  const refs: ProguardReference[] = [];

  // Find proguardFiles( or proguardFile( then extract balanced content
  const proguardStartRegex = /proguardFiles?\s*\(/g;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = proguardStartRegex.exec(buildContent)) !== null) {
    const parenStart = startMatch.index + startMatch[0].length - 1;
    const args = extractBalancedParens(buildContent, parenStart);
    if (!args) continue;

    // Extract getDefaultProguardFile("...") references
    const defaultRegex = /getDefaultProguardFile\s*\(\s*"([^"]+)"\s*\)/g;
    let defaultMatch: RegExpExecArray | null;
    while ((defaultMatch = defaultRegex.exec(args)) !== null) {
      refs.push({
        filename: defaultMatch[1],
        isDefault: true,
        exists: true, // Default proguard files are provided by the SDK
      });
    }

    // Extract literal string references: "proguard-rules.pro"
    // But skip strings that are inside getDefaultProguardFile(...)
    const literalRegex = /"([^"]+)"/g;
    let litMatch: RegExpExecArray | null;
    while ((litMatch = literalRegex.exec(args)) !== null) {
      const filename = litMatch[1];
      // Skip if it was already captured as a default file argument
      if (filename.startsWith("proguard-android")) continue;
      refs.push({
        filename,
        isDefault: false,
        exists: existsSync(path.join(moduleDir, filename)),
      });
    }
  }

  return refs;
}

// ── Dependency-based rule recommendations ───────────────────────────────────

interface RuleRecommendation {
  library: string;
  reason: string;
  rules: string[];
}

const LIBRARY_RULES: {
  pattern: RegExp;
  library: string;
  reason: string;
  rules: string[];
}[] = [
  {
    pattern: /io\.ktor/,
    library: "Ktor",
    reason: "Ktor uses reflection for HTTP engine and content negotiation",
    rules: [
      "-keep class io.ktor.** { *; }",
      "-keepclassmembers class io.ktor.** { volatile <fields>; }",
      "-dontwarn io.ktor.**",
    ],
  },
  {
    pattern: /kotlinx[.\-]serialization/,
    library: "kotlinx.serialization",
    reason: "Serialization uses generated serializers that must not be obfuscated",
    rules: [
      "-keepattributes *Annotation*, InnerClasses",
      "-dontnote kotlinx.serialization.AnnotationsKt",
      "-keep,includedescriptorclasses class com.yourpackage.**$$serializer { *; }",
      "-keepclassmembers class com.yourpackage.** { *** Companion; }",
    ],
  },
  {
    pattern: /androidx\.room/,
    library: "Room",
    reason: "Room entities and DAOs use annotations processed at compile time",
    rules: [
      "-keep class * extends androidx.room.RoomDatabase",
      "-keep @androidx.room.Entity class *",
      "-dontwarn androidx.room.paging.**",
    ],
  },
  {
    pattern: /androidx\.compose/,
    library: "Compose",
    reason: "Compose compiler generates classes that should not be stripped",
    rules: [
      "-dontwarn androidx.compose.**",
      "-keep class androidx.compose.runtime.** { *; }",
    ],
  },
];

function detectLibraryDependencies(buildContent: string): RuleRecommendation[] {
  const recommendations: RuleRecommendation[] = [];
  for (const lib of LIBRARY_RULES) {
    if (lib.pattern.test(buildContent)) {
      recommendations.push({
        library: lib.library,
        reason: lib.reason,
        rules: lib.rules,
      });
    }
  }
  return recommendations;
}

function checkRulesInProguardFiles(
  moduleDir: string,
  refs: ProguardReference[],
  recommendation: RuleRecommendation,
): boolean {
  // Check if any of the existing proguard files contain relevant rules
  for (const ref of refs) {
    if (ref.isDefault || !ref.exists) continue;
    try {
      const content = readFileSync(path.join(moduleDir, ref.filename), "utf-8");
      // Simple heuristic: check if the library name appears in the rules file
      if (content.toLowerCase().includes(recommendation.library.toLowerCase())) {
        return true;
      }
    } catch {
      // Can't read file - treat as not having rules
    }
  }
  return false;
}

// ── Report types ────────────────────────────────────────────────────────────

interface ModuleProguardReport {
  module: string;
  has_proguard_config: boolean;
  references: ProguardReference[];
  missing_files: string[];
  library_recommendations: RuleRecommendation[];
  missing_library_rules: string[];
}

interface ProguardReport {
  project_root: string;
  modules_checked: number;
  modules: ModuleProguardReport[];
  summary: {
    total_missing_files: number;
    total_missing_library_rules: number;
    modules_without_proguard: number;
  };
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(report: ProguardReport): string {
  const lines: string[] = [
    "## ProGuard Validator Report",
    "",
    `**Project:** ${report.project_root}`,
    `**Modules checked:** ${report.modules_checked}`,
    `**Missing proguard files:** ${report.summary.total_missing_files}`,
    `**Missing library rules:** ${report.summary.total_missing_library_rules}`,
    `**Modules without proguard config:** ${report.summary.modules_without_proguard}`,
    "",
  ];

  if (report.modules.length === 0) {
    lines.push("No modules found.");
    return lines.join("\n");
  }

  // Modules with issues
  const modulesWithIssues = report.modules.filter(
    (m) => m.missing_files.length > 0 || m.missing_library_rules.length > 0,
  );

  if (modulesWithIssues.length === 0) {
    lines.push("All modules have valid ProGuard configuration.");
  } else {
    lines.push("### Issues Found");
    lines.push("");

    for (const mod of modulesWithIssues) {
      lines.push(`#### ${mod.module}`);

      if (mod.missing_files.length > 0) {
        lines.push("**Missing ProGuard files:**");
        for (const f of mod.missing_files) {
          lines.push(`- \`${f}\``);
        }
      }

      if (mod.missing_library_rules.length > 0) {
        lines.push("**Missing library rules:**");
        for (const lib of mod.missing_library_rules) {
          lines.push(`- ${lib}`);
        }
      }

      if (mod.library_recommendations.length > 0) {
        lines.push("**Recommended rules:**");
        for (const rec of mod.library_recommendations) {
          lines.push(`\n*${rec.library}* - ${rec.reason}:`);
          lines.push("```");
          for (const rule of rec.rules) {
            lines.push(rule);
          }
          lines.push("```");
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerProguardValidatorTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "proguard-validator",
    "Validate ProGuard/R8 configuration: check referenced files exist and recommend keep rules based on library dependencies.",
    {
      project_root: z
        .string()
        .describe("Absolute path to the Gradle project root"),
    },
    async ({ project_root }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "proguard-validator");
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

        const moduleReports: ModuleProguardReport[] = [];

        for (const mod of modules) {
          const moduleDir = path.join(
            project_root,
            mod.replace(/^:/, "").replace(/:/g, "/"),
          );
          const buildFile = path.join(moduleDir, "build.gradle.kts");

          let buildContent: string;
          try {
            buildContent = readFileSync(buildFile, "utf-8");
          } catch {
            // Build file missing - skip module
            continue;
          }

          const refs = extractProguardReferences(buildContent, moduleDir);
          const hasProguardConfig = refs.length > 0;
          const missingFiles = refs
            .filter((r) => !r.isDefault && !r.exists)
            .map((r) => r.filename);

          const libraryRecs = detectLibraryDependencies(buildContent);
          const missingLibraryRules: string[] = [];

          for (const rec of libraryRecs) {
            const hasRules = checkRulesInProguardFiles(moduleDir, refs, rec);
            if (!hasRules) {
              missingLibraryRules.push(rec.library);
            }
          }

          moduleReports.push({
            module: mod,
            has_proguard_config: hasProguardConfig,
            references: refs,
            missing_files: missingFiles,
            library_recommendations: libraryRecs.filter((r) =>
              missingLibraryRules.includes(r.library),
            ),
            missing_library_rules: missingLibraryRules,
          });
        }

        const totalMissingFiles = moduleReports.reduce(
          (sum, m) => sum + m.missing_files.length,
          0,
        );
        const totalMissingLibraryRules = moduleReports.reduce(
          (sum, m) => sum + m.missing_library_rules.length,
          0,
        );
        const modulesWithoutProguard = moduleReports.filter(
          (m) => !m.has_proguard_config,
        ).length;

        const report: ProguardReport = {
          project_root,
          modules_checked: moduleReports.length,
          modules: moduleReports,
          summary: {
            total_missing_files: totalMissingFiles,
            total_missing_library_rules: totalMissingLibraryRules,
            modules_without_proguard: modulesWithoutProguard,
          },
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
        logger.error(`proguard-validator error: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `proguard-validator failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
