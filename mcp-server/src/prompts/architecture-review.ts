/**
 * Architecture review prompt.
 *
 * Reviews Kotlin code against AndroidCommonDoc architecture patterns.
 * Accepts a code argument and optional layer filter to load relevant
 * pattern docs from disk.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocsDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

/**
 * Map architecture layers to their relevant pattern doc filenames.
 */
const LAYER_DOCS: Record<string, string[]> = {
  ui: ["ui-screen-patterns.md", "compose-resources-patterns.md"],
  viewmodel: ["viewmodel-state-patterns.md"],
  domain: ["kmp-architecture.md"],
  data: ["offline-first-patterns.md", "kmp-architecture.md"],
  model: ["kmp-architecture.md"],
};

const DEFAULT_DOCS = ["kmp-architecture.md"];

async function loadPatternDocs(docFiles: string[]): Promise<string> {
  const docsDir = getDocsDir();
  const sections: string[] = [];

  for (const file of docFiles) {
    try {
      const content = await readFile(path.join(docsDir, file), "utf-8");
      sections.push(`--- ${file} ---\n${content}`);
    } catch {
      logger.warn(`Pattern doc not found: ${file}`);
    }
  }

  return sections.join("\n\n");
}

export function registerArchitectureReviewPrompt(server: McpServer): void {
  server.registerPrompt(
    "architecture-review",
    {
      title: "Architecture Review",
      description:
        "Review Kotlin code against AndroidCommonDoc architecture patterns. " +
        "Identifies violations, suggests improvements, and cites specific pattern rules.",
      argsSchema: {
        code: z.string().describe("Kotlin code to review"),
        layer: z
          .enum(["ui", "viewmodel", "domain", "data", "model"])
          .optional()
          .describe("Specific architecture layer to focus on"),
      },
    },
    async ({ code, layer }) => {
      const docFiles = layer ? (LAYER_DOCS[layer] ?? DEFAULT_DOCS) : DEFAULT_DOCS;
      const patterns = await loadPatternDocs(docFiles);

      const layerContext = layer
        ? `Focus specifically on the **${layer}** layer patterns.`
        : "Review against general architecture patterns.";

      const promptText = [
        "Review the following Kotlin code against AndroidCommonDoc architecture patterns.",
        "Identify violations, suggest improvements, cite specific pattern rules.",
        "",
        layerContext,
        "",
        "## Reference Patterns",
        "",
        patterns,
        "",
        "---",
        "",
        "## Code to Review",
        "",
        "```kotlin",
        code,
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
