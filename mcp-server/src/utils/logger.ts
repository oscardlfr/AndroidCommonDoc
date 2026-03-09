/**
 * stderr-only logger for the MCP server.
 *
 * CRITICAL: Never use console.log() anywhere in the MCP server codebase.
 * stdout is reserved exclusively for JSON-RPC messages. Any non-protocol
 * bytes on stdout corrupt the MCP transport and cause "Connection closed"
 * errors in Claude Code.
 */
export const logger = {
  info: (msg: string): void => {
    console.error(`[INFO] ${msg}`);
  },
  warn: (msg: string): void => {
    console.error(`[WARN] ${msg}`);
  },
  error: (msg: string): void => {
    console.error(`[ERROR] ${msg}`);
  },
  debug: (msg: string): void => {
    if (process.env.MCP_DEBUG) {
      console.error(`[DEBUG] ${msg}`);
    }
  },
};
