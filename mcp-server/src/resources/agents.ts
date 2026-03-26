/**
 * Agent definition resources.
 *
 * Uses ResourceTemplate to expose agent .md files dynamically
 * via agents://androidcommondoc/{name} URI scheme.
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getAgentsDir } from "../utils/paths.js";
import { parseFrontmatter } from "../registry/frontmatter.js";
import { logger } from "../utils/logger.js";

interface AgentInfo {
  name: string;
  description: string;
  filename: string;
}

/**
 * Scan the agents directory for .md files and parse their frontmatter.
 */
async function discoverAgents(): Promise<AgentInfo[]> {
  const agentsDir = getAgentsDir();
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    const agents: AgentInfo[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const filePath = path.join(agentsDir, entry.name);
      try {
        const raw = await readFile(filePath, "utf-8");
        const parsed = parseFrontmatter(raw);
        const name =
          (parsed?.data?.name as string) ??
          entry.name.replace(/\.md$/, "");
        const description =
          (parsed?.data?.description as string) ??
          `Agent definition: ${name}`;

        agents.push({ name, description, filename: entry.name });
      } catch (err) {
        logger.warn(`Failed to parse agent file ${entry.name}: ${err}`);
      }
    }

    return agents;
  } catch (err) {
    logger.error(`Failed to scan agents directory: ${err}`);
    return [];
  }
}

export function registerAgentResources(server: McpServer): void {
  const agentsDir = getAgentsDir();

  server.registerResource(
    "agent",
    new ResourceTemplate("agents://androidcommondoc/{name}", {
      list: async () => {
        const agents = await discoverAgents();
        return {
          resources: agents.map((agent) => ({
            uri: `agents://androidcommondoc/${agent.name}`,
            name: agent.name,
            title: agent.name
              .split("-")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "),
            description: agent.description,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    { description: "Agent definition", mimeType: "text/markdown" },
    async (uri, { name }) => {
      const agentName = String(name);
      const filePath = path.join(agentsDir, `${agentName}.md`);
      try {
        const content = await readFile(filePath, "utf-8");
        return {
          contents: [{ uri: uri.href, text: content }],
        };
      } catch {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Agent not found: ${agentName}`,
        );
      }
    },
  );
}
