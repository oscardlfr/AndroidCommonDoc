/**
 * Prompt registration aggregator.
 *
 * Imports and calls all prompt registration functions to wire up
 * architecture review, PR review, and onboarding prompts on the MCP server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerArchitectureReviewPrompt } from "./architecture-review.js";
import { registerPrReviewPrompt } from "./pr-review.js";
import { registerOnboardingPrompt } from "./onboarding.js";

export function registerPrompts(server: McpServer): void {
  registerArchitectureReviewPrompt(server);
  registerPrReviewPrompt(server);
  registerOnboardingPrompt(server);
}
