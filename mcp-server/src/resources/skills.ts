/**
 * Skill definition resources.
 *
 * Uses ResourceTemplate to expose skill SKILL.md files dynamically
 * via skills://androidcommondoc/{skillName} URI scheme.
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getSkillsDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

/**
 * Scan the skills directory for subdirectories containing SKILL.md files.
 */
async function discoverSkills(): Promise<string[]> {
  const skillsDir = getSkillsDir();
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    logger.error(`Failed to scan skills directory: ${err}`);
    return [];
  }
}

export function registerSkillResources(server: McpServer): void {
  const skillsDir = getSkillsDir();

  server.registerResource(
    "skill",
    new ResourceTemplate("skills://androidcommondoc/{skillName}", {
      list: async () => {
        const skills = await discoverSkills();
        return {
          resources: skills.map((name) => ({
            uri: `skills://androidcommondoc/${name}`,
            name: name,
            title: name
              .split("-")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "),
            description: `Skill definition: ${name}`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    { description: "Skill definition", mimeType: "text/markdown" },
    async (uri, { skillName }) => {
      const name = String(skillName);
      const filePath = path.join(skillsDir, name, "SKILL.md");
      try {
        const content = await readFile(filePath, "utf-8");
        return {
          contents: [{ uri: uri.href, text: content }],
        };
      } catch {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Skill not found: ${name}`,
        );
      }
    },
  );
}
