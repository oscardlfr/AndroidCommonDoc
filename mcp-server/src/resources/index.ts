/**
 * Resource registration aggregator.
 *
 * Imports and calls all resource registration functions to wire up
 * pattern docs, skills, and changelog resources on the MCP server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocResources } from "./docs.js";
import { registerSkillResources } from "./skills.js";
import { registerChangelogResource } from "./changelog.js";
import { registerGsdResources } from "./gsd.js";
import { registerAgentResources } from "./agents.js";

export async function registerResources(server: McpServer): Promise<void> {
  await registerDocResources(server);
  registerSkillResources(server);
  registerChangelogResource(server);
  await registerGsdResources(server);
  registerAgentResources(server);
}
