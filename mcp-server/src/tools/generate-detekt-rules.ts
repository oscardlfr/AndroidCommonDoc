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
          .describe("Path to consumer project for L1 rule generation"),
      }),
    },
    async ({ dry_run, projectRoot, consumer_project }) => {
      const rateLimitResponse = checkRateLimit(limiter, "generate-detekt-rules");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        // Resolve toolkit root
        const root = projectRoot ?? getToolkitRoot();

        // Determine directories based on context
        let docsDir: string;
        let rulesOutputDir: string;
        let testsOutputDir: string;

        if (consumer_project) {
          // Consumer project: scan L1 docs
          docsDir = path.join(consumer_project, ".androidcommondoc", "docs");
          rulesOutputDir = path.join(
            consumer_project,
            "detekt-rules",
            "src",
            "main",
            "kotlin",
            "com",
            "androidcommondoc",
            "detekt",
            "rules",
            "generated",
          );
          testsOutputDir = path.join(
            consumer_project,
            "detekt-rules",
            "src",
            "test",
            "kotlin",
            "com",
            "androidcommondoc",
            "detekt",
            "rules",
            "generated",
          );
        } else {
          // Toolkit: use standard paths
          docsDir = projectRoot
            ? path.join(root, "docs")
            : getDocsDir();
          rulesOutputDir = path.join(
            root,
            "detekt-rules",
            "src",
            "main",
            "kotlin",
            "com",
            "androidcommondoc",
            "detekt",
            "rules",
            "generated",
          );
          testsOutputDir = path.join(
            root,
            "detekt-rules",
            "src",
            "test",
            "kotlin",
            "com",
            "androidcommondoc",
            "detekt",
            "rules",
            "generated",
          );
        }

        // Run the generation pipeline
        const result = await writeGeneratedRules({
          docsDir,
          rulesOutputDir,
          testsOutputDir,
          dryRun: dry_run,
        });

        // Build next-steps instructions
        const nextSteps = dry_run
          ? "This was a dry-run. Re-run with dry_run=false to write files. Then compile with ./gradlew :detekt-rules:test"
          : "Files written. Compile and test with ./gradlew :detekt-rules:test. If new rules were added, update AndroidCommonDocRuleSetProvider with the providerUpdateBlock above.";

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
