/**
 * PR review prompt.
 *
 * Reviews a git diff against AndroidCommonDoc patterns. Accepts a diff
 * argument and optional focusAreas to filter which pattern docs are loaded.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocsDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

/**
 * Map focus area keywords to their relevant pattern doc filenames.
 */
const AREA_DOCS: Record<string, string[]> = {
  viewmodel: ["viewmodel-state-patterns.md"],
  testing: ["testing-patterns.md"],
  ui: ["ui-screen-patterns.md", "compose-resources-patterns.md"],
  compose: ["compose-resources-patterns.md"],
  architecture: ["kmp-architecture.md"],
  kmp: ["kmp-architecture.md"],
  data: ["offline-first-patterns.md"],
  "offline-first": ["offline-first-patterns.md"],
  gradle: ["gradle-patterns.md"],
  resources: ["resource-management-patterns.md"],
};

/** Default essential docs when no focus areas specified */
const DEFAULT_DOCS = [
  "kmp-architecture.md",
  "viewmodel-state-patterns.md",
  "testing-patterns.md",
];

async function loadPatternDocs(docFiles: string[]): Promise<string> {
  const docsDir = getDocsDir();
  const uniqueFiles = [...new Set(docFiles)];
  const sections: string[] = [];

  for (const file of uniqueFiles) {
    try {
      const content = await readFile(path.join(docsDir, file), "utf-8");
      sections.push(`--- ${file} ---\n${content}`);
    } catch {
      logger.warn(`Pattern doc not found: ${file}`);
    }
  }

  return sections.join("\n\n");
}

export function registerPrReviewPrompt(server: McpServer): void {
  server.registerPrompt(
    "pr-review",
    {
      title: "PR Review",
      description:
        "Review a pull request diff against AndroidCommonDoc patterns. " +
        "Checks architecture layer compliance, naming conventions, ViewModel state patterns, " +
        "error handling with Result<T>, and testing patterns.",
      argsSchema: {
        diff: z.string().describe("Git diff output to review"),
        focusAreas: z
          .string()
          .optional()
          .describe(
            "Comma-separated areas to focus on (e.g., 'viewmodel,testing')",
          ),
      },
    },
    async ({ diff, focusAreas }) => {
      let docFiles: string[];

      if (focusAreas) {
        const areas = focusAreas.split(",").map((a: string) => a.trim().toLowerCase());
        docFiles = areas.flatMap((area: string) => AREA_DOCS[area] ?? []);
        if (docFiles.length === 0) {
          docFiles = DEFAULT_DOCS;
        }
      } else {
        docFiles = DEFAULT_DOCS;
      }

      const patterns = await loadPatternDocs(docFiles);

      const focusContext = focusAreas
        ? `Focus areas: **${focusAreas}**`
        : "Review all areas: architecture layer compliance, naming conventions, ViewModel state patterns, error handling with Result<T>, testing patterns.";

      const promptText = [
        "Review this PR diff against AndroidCommonDoc patterns.",
        "For each changed Kotlin file, check: architecture layer compliance, naming conventions,",
        "ViewModel state patterns, error handling with Result<T>, testing patterns.",
        "Report violations with file paths and line references.",
        "",
        focusContext,
        "",
        "## Reference Patterns",
        "",
        patterns,
        "",
        "---",
        "",
        "## PR Diff",
        "",
        "```diff",
        diff,
        "```",
      ].join("\n");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: promptText,
            },
          },
        ],
      };
    },
  );
}
