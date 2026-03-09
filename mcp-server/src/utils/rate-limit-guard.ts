/**
 * Rate limit guard utility.
 *
 * Provides a reusable guard function that tools call before executing.
 * Returns a rate-limit error response if the limit is exceeded, or null
 * if the call is allowed.
 */
import type { RateLimiter } from "./rate-limiter.js";
import { logger } from "./logger.js";

/**
 * Tool response type with index signature for MCP SDK compatibility.
 *
 * The SDK's tool handler return type requires `[x: string]: unknown`
 * index signature, so we use Record<string, unknown> as base.
 */
export type ToolResponse = Record<string, unknown> & {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Check rate limit and return an error response if exceeded.
 * Returns null if the call is allowed.
 */
export function checkRateLimit(
  limiter: RateLimiter | undefined,
  toolName: string,
): ToolResponse | null {
  if (!limiter) return null;

  if (!limiter.tryAcquire()) {
    logger.warn(`Rate limit exceeded for tool: ${toolName}`);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "ERROR",
            summary:
              "Rate limit exceeded. Maximum 30 tool calls per minute. Try again later.",
            details: [],
            duration_ms: 0,
          }),
        },
      ],
      isError: true,
    };
  }

  return null;
}
