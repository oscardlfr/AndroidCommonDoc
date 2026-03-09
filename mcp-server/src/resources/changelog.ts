/**
 * Changelog resource.
 *
 * Exposes recent toolkit changes as a single resource at
 * changelog://androidcommondoc/latest. Content is assembled
 * from git history and RETROSPECTIVE.md (if available).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getToolkitRoot } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Get the last 20 git log entries from the toolkit root.
 * Falls back to a static message if git is unavailable.
 */
async function getGitHistory(): Promise<string> {
  const root = getToolkitRoot();
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--oneline", "-20"],
      {
        cwd: root,
        timeout: 10000,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    return stdout.trim();
  } catch (err) {
    logger.warn(`Git history unavailable: ${err}`);
    return "(git history unavailable)";
  }
}

/**
 * Read the RETROSPECTIVE.md summary if available.
 */
async function getRetrospective(): Promise<string | null> {
  const root = getToolkitRoot();
  const retroPath = path.join(root, ".planning", "RETROSPECTIVE.md");
  try {
    const content = await readFile(retroPath, "utf-8");
    return content.trim();
  } catch {
    return null;
  }
}

export function registerChangelogResource(server: McpServer): void {
  server.registerResource(
    "changelog",
    "changelog://androidcommondoc/latest",
    {
      title: "Changelog",
      description: "Recent changes and updates to the AndroidCommonDoc toolkit",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const gitHistory = await getGitHistory();
      const retrospective = await getRetrospective();

      let content = "# AndroidCommonDoc Changelog\n\n";
      content += "## Recent Commits\n\n";
      content += "```\n" + gitHistory + "\n```\n";

      if (retrospective) {
        content += "\n## Retrospective\n\n";
        content += retrospective + "\n";
      }

      return {
        contents: [{ uri: uri.href, text: content }],
      };
    },
  );
}
