/**
 * Minimal stdio composition for the runtime context-provider.
 *
 * This is not a second search implementation. It exposes the canonical
 * search-docs tool through the same MCP SDK while deliberately avoiding the
 * cold-start cost of importing every unrelated AndroidCommonDoc tool into a
 * short-lived, single-purpose child process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchDocsTool } from "./tools/search-docs.js";
import { RateLimiter } from "./utils/rate-limiter.js";
import { logger } from "./utils/logger.js";

export function createRuntimeSearchServer(): McpServer {
  const server = new McpServer({
    name: "androidcommondoc",
    version: "1.0.0",
  });
  registerSearchDocsTool(server, new RateLimiter(45, 60_000));
  return server;
}

async function main(): Promise<void> {
  const server = createRuntimeSearchServer();
  await server.connect(new StdioServerTransport());
  logger.info("AndroidCommonDoc runtime search MCP server running on stdio");
}

main().catch((error: unknown) => {
  logger.error(
    `Runtime search MCP fatal error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
