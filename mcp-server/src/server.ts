/**
 * MCP Server factory.
 *
 * Creates a configured McpServer instance with all resource, tool, and
 * prompt handlers registered. Separated from transport connection to
 * enable testing via InMemoryTransport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources/index.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/index.js";

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "androidcommondoc",
    version: "1.0.0",
  });

  await registerResources(server);
  registerTools(server);
  registerPrompts(server);

  return server;
}
