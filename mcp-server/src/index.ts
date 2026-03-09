/**
 * MCP Server entry point.
 *
 * Connects the server to stdio transport for use as a Claude Code subprocess.
 * All logging goes to stderr to avoid corrupting the JSON-RPC stream on stdout.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("AndroidCommonDoc MCP Server running on stdio");
}

main().catch((error: unknown) => {
  logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
