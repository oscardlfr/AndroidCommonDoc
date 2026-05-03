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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { parseSettingsModules, parsePlugins, detectPackagingType, type PackagingType } from "../utils/gradle-parser.js";

// ── ProGuard file extraction ────────────────────────────────────────────────

interface ProguardReference {
  filename: string;
  isDefault: boolean; // true if getDefaultProguardFile(...)
  exists: boolean;
  isConsumer?: boolean; // true if from consumerProguardFiles()
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

/**
 * Extract consumer ProGuard references from consumerProguardFiles() calls.
 * Handles the implicit default (consumer-rules.pro) when no argument is provided.
 */
function extractConsumerProguardReferences(
  buildContent: string,
  moduleDir: string,
): ProguardReference[] {
  const refs: ProguardReference[] = [];

  const consumerRegex = /consumerProguardFiles?\s*\(/g;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = consumerRegex.exec(buildContent)) !== null) {
    const parenStart = startMatch.index + startMatch[0].length - 1;
    const args = extractBalancedParens(buildContent, parenStart);
    if (args === null) continue;

    const literalRegex = /"([^"]+)"/g;
    let litMatch: RegExpExecArray | null;
    let foundLiteral = false;
    while ((litMatch = literalRegex.exec(args)) !== null) {
      foundLiteral = true;
      const filename = litMatch[1];
      refs.push({
        filename,
        isDefault: false,
        exists: existsSync(path.join(moduleDir, filename)),
        isConsumer: true,
      });
    }

    if (!foundLiteral) {
      refs.push({
        filename: "consumer-rules.pro",
        isDefault: false,
        exists: existsSync(path.join(moduleDir, "consumer-rules.pro")),
        isConsumer: true,
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

// AGP 9 globally-rejected directives in consumer rules.
// Reference: docs/gradle/agp9-consumer-rules-banned-directives.md + AGP class ConsumerRuleGlobalGuardian
const AGP9_ERROR_DIRECTIVES = ["-dontobfuscate", "-dontoptimize"];
const AGP9_WARN_DIRECTIVES = [
  "-allowaccessmodification",
  "-optimizations",
  "-optimizationpasses",
  "-dontusemixedcaseclassnames",
];

/**
 * Scan consumer ProGuard files for AGP 9 globally-rejected directives.
 * Returns separate error and warning arrays.
 */
function checkAgp9Globals(
  moduleDir: string,
  consumerRefs: ProguardReference[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const ref of consumerRefs) {
    if (!ref.exists) continue;
    let content: string;
    try {
      content = readFileSync(path.join(moduleDir, ref.filename), "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      for (const directive of AGP9_ERROR_DIRECTIVES) {
        if (trimmed === directive || trimmed.startsWith(directive + " ") || trimmed.startsWith(directive + "\t")) {
          errors.push(`${ref.filename}: found '${directive}' — rejected silently by AGP 9 in consumer rules`);
        }
      }
      for (const directive of AGP9_WARN_DIRECTIVES) {
        if (trimmed === directive || trimmed.startsWith(directive + " ") || trimmed.startsWith(directive + "\t")) {
          warnings.push(`${ref.filename}: found '${directive}' — rejected silently by AGP 9 in consumer rules`);
        }
      }
    }
  }

  return { errors, warnings };
}

/**
 * Check whether a module uses consumerProguardFiles in a non-AAR context (silent no-op).
 * Amendment 4-C: takes buildFile path, not buildContent.
 */
async function checkPackagingType(
  moduleDir: string,
  buildFile: string,
): Promise<{ type: PackagingType; violation: string | null }> {
  let pluginResult: { ids: string[]; hasConvention: boolean };
  try {
    pluginResult = await parsePlugins(buildFile);
  } catch {
    return { type: "unknown", violation: null };
  }

  const type = detectPackagingType(pluginResult.ids);

  if (type === "jar" || type === "kmp") {
    let buildContent: string;
    try {
      buildContent = readFileSync(buildFile, "utf-8");
    } catch {
      return { type, violation: null };
    }
    if (/consumerProguardFiles?\s*\(/.test(buildContent)) {
      return {
        type,
        violation: `${moduleDir}: consumerProguardFiles has no effect in non-AAR module (packaging type: ${type})`,
      };
    }
  }

  return { type, violation: null };
}

/**
 * Check that sealed class subtypes have -keep rules in proguard files.
 * Best-effort: uses source file pattern matching, not full Kotlin AST parsing.
 */
async function checkSealedSubtypeKeeps(
  moduleDir: string,
  sealedFqns: string[],
  proguardRefs: ProguardReference[],
): Promise<string[]> {
  const violations: string[] = [];

  // Read all proguard file contents (non-consumer only for keep rules)
  const proguardContents: string[] = [];
  for (const ref of proguardRefs) {
    if (ref.isDefault || !ref.exists || ref.isConsumer) continue;
    try {
      proguardContents.push(readFileSync(path.join(moduleDir, ref.filename), "utf-8"));
    } catch {
      // skip unreadable files
    }
  }

  // Recursively collect .kt files under moduleDir/src/
  const srcDir = path.join(moduleDir, "src");
  const ktFiles: string[] = [];

  function collectKtFiles(dir: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectKtFiles(full);
      } else if (entry.isFile() && entry.name.endsWith(".kt")) {
        ktFiles.push(full);
      }
    }
  }

  collectKtFiles(srcDir);

  for (const fqn of sealedFqns) {
    const simpleName = fqn.split(".").pop() ?? fqn;
    const subtypeNames: string[] = [];

    // Pattern: class SubtypeName : SimpleName or class SubtypeName : SimpleName(
    const subtypePattern = new RegExp(
      `(?:^|\\s)(?:class|object|data class)\\s+(\\w+)\\s*[^:]*:\\s*${simpleName}[\\s(]`,
    );

    for (const ktFile of ktFiles) {
      let src: string;
      try {
        src = readFileSync(ktFile, "utf-8");
      } catch {
        continue;
      }
      for (const line of src.split("\n")) {
        const m = subtypePattern.exec(line);
        if (m?.[1] && !subtypeNames.includes(m[1])) {
          subtypeNames.push(m[1]);
        }
      }
    }

    for (const subtype of subtypeNames) {
      const keepPattern = new RegExp(
        `-keep(?:names|classmembers)?\\s+class\\s+[\\w.*]*${subtype}`,
      );
      const hasKeep = proguardContents.some((c) => keepPattern.test(c));
      if (!hasKeep) {
        violations.push(
          `WARN: ${fqn} subtype '${subtype}' has no -keep rule in any proguard file (best-effort check)`,
        );
      }
    }
  }

  return violations;
}

// ── Report types ────────────────────────────────────────────────────────────

interface ModuleProguardReport {
  module: string;
  has_proguard_config: boolean;
  references: ProguardReference[];
  missing_files: string[];
  library_recommendations: RuleRecommendation[];
  missing_library_rules: string[];
  packaging_type?: PackagingType;
  agp9_global_errors?: string[];
  agp9_global_warnings?: string[];
  packaging_type_violation?: string | null;
  sealed_keep_violations?: string[];
}

interface ProguardReport {
  project_root: string;
  modules_checked: number;
  modules: ModuleProguardReport[];
  summary: {
    total_missing_files: number;
    total_missing_library_rules: number;
    modules_without_proguard: number;
    total_agp9_errors: number;
    total_agp9_warnings: number;
    total_packaging_type_violations: number;
    total_sealed_keep_violations: number;
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
    `**AGP 9 global directive errors:** ${report.summary.total_agp9_errors}`,
    `**AGP 9 global directive warnings:** ${report.summary.total_agp9_warnings}`,
    `**Packaging type violations:** ${report.summary.total_packaging_type_violations}`,
    `**Sealed class keep gaps:** ${report.summary.total_sealed_keep_violations}`,
    "",
  ];

  if (report.modules.length === 0) {
    lines.push("No modules found.");
    return lines.join("\n");
  }

  const modulesWithIssues = report.modules.filter(
    (m) =>
      m.missing_files.length > 0 ||
      m.missing_library_rules.length > 0 ||
      (m.agp9_global_errors?.length ?? 0) > 0 ||
      (m.agp9_global_warnings?.length ?? 0) > 0 ||
      m.packaging_type_violation ||
      (m.sealed_keep_violations?.length ?? 0) > 0,
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

      if ((mod.agp9_global_errors?.length ?? 0) > 0) {
        lines.push("### AGP 9 Global Directive Violations (ERROR)");
        for (const v of mod.agp9_global_errors!) {
          lines.push(`- ${v}`);
        }
      }

      if ((mod.agp9_global_warnings?.length ?? 0) > 0) {
        lines.push("### AGP 9 Global Directive Violations (WARN)");
        for (const v of mod.agp9_global_warnings!) {
          lines.push(`- ${v}`);
        }
      }

      if (mod.packaging_type_violation) {
        lines.push("### Packaging Type Violations");
        lines.push(`- ${mod.packaging_type_violation}`);
      }

      if ((mod.sealed_keep_violations?.length ?? 0) > 0) {
        lines.push("### Sealed Class Keep Coverage Gaps (best-effort WARN)");
        for (const v of mod.sealed_keep_violations!) {
          lines.push(`- ${v}`);
        }
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Core validation logic (exported for CLI use) ────────────────────────────

export interface ValidateProguardArgs {
  project_root: string;
  check_agp9_globals?: boolean;
  check_packaging_type?: boolean;
  sealed_parents?: string[];
}

export interface ValidateProguardResult {
  report: ProguardReport;
  markdown: string;
  hasErrors: boolean;
}

/**
 * Run the full proguard validation pipeline.
 * Called by both the MCP tool handler and the CLI entry point.
 */
export async function validateProguard(
  args: ValidateProguardArgs,
): Promise<ValidateProguardResult> {
  const {
    project_root,
    check_agp9_globals = true,
    check_packaging_type = true,
    sealed_parents = [],
  } = args;

  const settingsPath = path.join(project_root, "settings.gradle.kts");
  const modules = await parseSettingsModules(settingsPath);

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
      continue;
    }

    const refs = extractProguardReferences(buildContent, moduleDir);
    const consumerRefs = extractConsumerProguardReferences(buildContent, moduleDir);
    const hasProguardConfig = refs.length > 0 || consumerRefs.length > 0;
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

    let agp9Errors: string[] = [];
    let agp9Warnings: string[] = [];
    if (check_agp9_globals) {
      const agp9Result = checkAgp9Globals(moduleDir, consumerRefs);
      agp9Errors = agp9Result.errors;
      agp9Warnings = agp9Result.warnings;
    }

    let packagingType: PackagingType | undefined;
    let packagingViolation: string | null = null;
    if (check_packaging_type) {
      const pkgResult = await checkPackagingType(moduleDir, buildFile);
      packagingType = pkgResult.type;
      packagingViolation = pkgResult.violation;
    }

    let sealedViolations: string[] = [];
    if (sealed_parents.length > 0) {
      sealedViolations = await checkSealedSubtypeKeeps(moduleDir, sealed_parents, refs);
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
      packaging_type: packagingType,
      agp9_global_errors: agp9Errors,
      agp9_global_warnings: agp9Warnings,
      packaging_type_violation: packagingViolation,
      sealed_keep_violations: sealedViolations,
    });
  }

  const totalMissingFiles = moduleReports.reduce((sum, m) => sum + m.missing_files.length, 0);
  const totalMissingLibraryRules = moduleReports.reduce((sum, m) => sum + m.missing_library_rules.length, 0);
  const modulesWithoutProguard = moduleReports.filter((m) => !m.has_proguard_config).length;
  const totalAgp9Errors = moduleReports.reduce((sum, m) => sum + (m.agp9_global_errors?.length ?? 0), 0);
  const totalAgp9Warnings = moduleReports.reduce((sum, m) => sum + (m.agp9_global_warnings?.length ?? 0), 0);
  const totalPackagingViolations = moduleReports.filter((m) => m.packaging_type_violation).length;
  const totalSealedKeepViolations = moduleReports.reduce((sum, m) => sum + (m.sealed_keep_violations?.length ?? 0), 0);

  const report: ProguardReport = {
    project_root,
    modules_checked: moduleReports.length,
    modules: moduleReports,
    summary: {
      total_missing_files: totalMissingFiles,
      total_missing_library_rules: totalMissingLibraryRules,
      modules_without_proguard: modulesWithoutProguard,
      total_agp9_errors: totalAgp9Errors,
      total_agp9_warnings: totalAgp9Warnings,
      total_packaging_type_violations: totalPackagingViolations,
      total_sealed_keep_violations: totalSealedKeepViolations,
    },
  };

  const markdown = renderMarkdown(report);
  const hasErrors =
    totalMissingFiles > 0 ||
    totalAgp9Errors > 0 ||
    totalPackagingViolations > 0;

  return { report, markdown, hasErrors };
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
      check_agp9_globals: z
        .boolean()
        .optional()
        .default(true)
        .describe("Check consumer rules for AGP 9 globally-rejected directives"),
      check_packaging_type: z
        .boolean()
        .optional()
        .default(true)
        .describe("Check consumerProguardFiles usage in non-AAR modules"),
      sealed_parents: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Sealed class FQNs to verify subtype keep coverage"),
    },
    async ({ project_root, check_agp9_globals, check_packaging_type, sealed_parents }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "proguard-validator");
      if (rateLimitResponse) return rateLimitResponse;

      // Pre-check settings file to preserve the specific error message callers depend on
      const settingsPath = path.join(project_root, "settings.gradle.kts");
      if (!existsSync(settingsPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Could not read settings.gradle.kts: ENOENT: no such file or directory, open '${settingsPath}'`,
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        const { report, markdown } = await validateProguard({
          project_root,
          check_agp9_globals,
          check_packaging_type,
          sealed_parents,
        });

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
        const msg = error instanceof Error ? error.message : String(error);
        const isSettingsError = msg.includes("settings.gradle.kts") || msg.includes("ENOENT");
        logger.error(`proguard-validator error: ${msg}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: isSettingsError
                  ? `Could not read settings.gradle.kts: ${msg}`
                  : `proguard-validator failed: ${msg}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
