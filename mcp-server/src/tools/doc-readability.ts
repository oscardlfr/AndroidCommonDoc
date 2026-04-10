/**
 * MCP tool: doc-readability
 *
 * Invokes Python textstat to compute readability metrics for a documentation
 * file. Returns Flesch reading ease, Flesch-Kincaid grade level, word count,
 * sentence count, and a verdict (readable / complex / very_complex).
 *
 * Gracefully skips if python3 is not available or textstat is not installed.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

const PYTHON_SCRIPT = `
import sys, json
try:
    import textstat
except ImportError:
    print(json.dumps({"status":"SKIPPED","reason":"textstat not installed: pip install textstat"}))
    sys.exit(0)
text = open(sys.argv[1]).read()
ease = textstat.flesch_reading_ease(text)
grade = textstat.flesch_kincaid_grade(text)
words = textstat.lexicon_count(text)
sentences = textstat.sentence_count(text)
avg = round(words / max(sentences, 1), 1)
verdict = "readable" if ease >= 60 else ("complex" if ease >= 30 else "very_complex")
print(json.dumps({"status":"OK","file":sys.argv[1],"scores":{"flesch_ease":ease,"fk_grade":grade,"word_count":words,"sentence_count":sentences,"avg_sentence_length":avg},"verdict":verdict}))
`.trim();

export function registerDocReadabilityTool(
  server: McpServer,
  rateLimiter?: RateLimiter,
): void {
  server.registerTool(
    "doc-readability",
    {
      title: "Doc Readability",
      description:
        "Compute readability metrics for a documentation file using Python textstat. " +
        "Returns Flesch reading ease, Flesch-Kincaid grade level, word count, sentence count, " +
        "and a verdict (readable / complex / very_complex). " +
        "Skipped gracefully if textstat is not installed (pip install textstat).",
      inputSchema: z.object({
        path: z.string().describe("Path to the documentation file to analyze"),
        projectRoot: z
          .string()
          .optional()
          .describe(
            "Project root for resolving relative paths (defaults to cwd)",
          ),
      }),
    },
    async ({ path: filePath, projectRoot }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "doc-readability");
      if (rateLimitResponse) return rateLimitResponse;

      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(projectRoot ?? process.cwd(), filePath);

      try {
        const { stdout } = await execFileAsync(
          "python3",
          ["-c", PYTHON_SCRIPT, resolvedPath],
          { timeout: 15000 },
        );

        const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        // python3 not found or file doesn't exist
        const message =
          error instanceof Error ? error.message : String(error);

        // ENOENT on execFile means python3 binary not found
        const isNoPython =
          message.includes("ENOENT") ||
          message.includes("python3") ||
          message.includes("not found") ||
          message.includes("cannot find");

        if (isNoPython) {
          logger.warn(`doc-readability: python3 not found — skipping`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "SKIPPED",
                  reason: "python3 not found. Install Python 3 and run: pip install textstat",
                }),
              },
            ],
          };
        }

        // File not found or other error from the Python script
        const isFileError =
          message.includes("FileNotFoundError") ||
          message.includes("No such file") ||
          message.includes("non-zero exit");

        if (isFileError) {
          logger.warn(`doc-readability: file not found — ${resolvedPath}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "ERROR",
                  file: resolvedPath,
                  reason: `File not found: ${resolvedPath}`,
                }),
              },
            ],
            isError: true,
          };
        }

        logger.error(`doc-readability failed: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "ERROR",
                file: resolvedPath,
                reason: message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
