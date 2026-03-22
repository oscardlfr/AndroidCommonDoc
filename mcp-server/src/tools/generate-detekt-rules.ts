/**
 * MCP tool: generate-detekt-rules
 *
 * Triggers the Detekt rule generation pipeline from pattern doc frontmatter
 * rule definitions. Reads `rules:` YAML from pattern docs and emits Kotlin
 * source files for AST-only Detekt rules with companion tests.
 *
 * Defaults to dry-run mode for safety -- preview changes without writing files.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { writeGeneratedRules } from "../generation/writer.js";
import { getToolkitRoot, getDocsDir } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

/**
 * Register the generate-detekt-rules MCP tool.
 *
 * Provides on-demand Detekt rule generation from pattern doc frontmatter.
 * The tool reads rule definitions from pattern docs, emits Kotlin source
 * and test files, and returns a structured result with next-step instructions.
 */
export function registerGenerateDetektRulesTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "generate-detekt-rules",
    {
      title: "Generate Detekt Rules",
      description:
        "Generate Detekt custom rules from pattern doc frontmatter rule definitions. Reads rules: YAML from pattern docs and emits Kotlin source files for AST-only Detekt rules with companion tests.",
      inputSchema: z.object({
        dry_run: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Preview changes without writing files (default: true for safety)",
          ),
        projectRoot: z
          .string()
          .optional()
          .describe("Path to toolkit root"),
        consumer_project: z
          .string()
          .optional()
          .describe("Path to consumer project for L1/L2 rule generation"),
        docs_dir: z
          .string()
          .optional()
          .describe("Docs directory to scan for pattern docs with rules: frontmatter (default: docs/ in project root)"),
        rules_dir: z
          .string()
          .optional()
          .describe("Module directory containing detekt rules (default: detekt-rules/)"),
        generated_package: z
          .string()
          .optional()
          .describe("Kotlin package for generated rules (default: com.androidcommondoc.detekt.rules.generated)"),
      }),
    },
    async ({ dry_run, projectRoot, consumer_project, docs_dir, rules_dir, generated_package }) => {
      const rateLimitResponse = checkRateLimit(limiter, "generate-detekt-rules");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Resolve project root
        const root = consumer_project ?? projectRoot ?? getToolkitRoot();

        // Resolve package → directory path
        const pkg = generated_package ?? "com.androidcommondoc.detekt.rules.generated";
        const pkgPath = pkg.replace(/\./g, path.sep);

        // Resolve rules module directory
        const rulesModule = rules_dir ?? "detekt-rules";

        // Resolve docs directory
        const resolvedDocsDir = docs_dir
          ? path.resolve(root, docs_dir)
          : consumer_project
            ? path.join(root, "docs")
            : (projectRoot ? path.join(root, "docs") : getDocsDir());

        // Output directories derive from package path
        const rulesOutputDir = path.join(root, rulesModule, "src", "main", "kotlin", pkgPath);
        const testsOutputDir = path.join(root, rulesModule, "src", "test", "kotlin", pkgPath);

        // Run the generation pipeline
        const result = await writeGeneratedRules({
          docsDir: resolvedDocsDir,
          rulesOutputDir,
          testsOutputDir,
          dryRun: dry_run,
          generatedPackage: pkg,
        });

        // Build next-steps instructions
        const gradleTask = `:${rulesModule.replace(/\//g, ":")}:test`;
        const nextSteps = dry_run
          ? `This was a dry-run. Re-run with dry_run=false to write files. Then compile with ./gradlew ${gradleTask}`
          : `Files written. Compile and test with ./gradlew ${gradleTask}. If new rules were added, update your RuleSetProvider with the providerUpdateBlock above.`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "OK",
                  result,
                  next_steps: nextSteps,
                  summary: `Generated: ${result.generated.length}, Skipped: ${result.skipped.length}, Removed: ${result.removed.length}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error(`generate-detekt-rules failed: ${String(error)}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                summary: `Rule generation failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
