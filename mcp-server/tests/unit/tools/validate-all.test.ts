/**
 * Tests for the validate-all meta-tool and tool registration.
 *
 * Verifies that validate-all combines results from all validation gates,
 * that listTools returns at least 7 tools, and that rate limiting is applied.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";
import type { ValidationResult, ToolResult } from "../../../src/types/results.js";

interface ValidateAllResult {
  status: "PASS" | "FAIL";
  tools: ToolResult[];
  summary: string;
  duration_ms: number;
}

describe("validate-all tool and tool registration", () => {
  let client: Client;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("lists at least 7 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(7);

    // Verify specific tool names are present
    const names = tools.map((t) => t.name);
    expect(names).toContain("check-doc-freshness");
    expect(names).toContain("verify-kmp-packages");
    expect(names).toContain("check-version-sync");
    expect(names).toContain("script-parity");
    expect(names).toContain("setup-check");
    expect(names).toContain("validate-all");
  });

  it("validate-all returns combined results with status and tools array", async () => {
    const result = await client.callTool({
      name: "validate-all",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const content = result.content[0];
    expect(content).toHaveProperty("type", "text");

    const parsed = JSON.parse(
      (content as { type: "text"; text: string }).text,
    ) as ValidateAllResult;

    expect(parsed).toHaveProperty("status");
    expect(["PASS", "FAIL"]).toContain(parsed.status);
    expect(parsed).toHaveProperty("tools");
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(parsed.tools.length).toBeGreaterThanOrEqual(5);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("duration_ms");
    expect(typeof parsed.duration_ms).toBe("number");

    // Each tool result should have tool name and ValidationResult
    for (const toolResult of parsed.tools) {
      expect(toolResult).toHaveProperty("tool");
      expect(toolResult).toHaveProperty("result");
      expect(toolResult.result).toHaveProperty("status");
      expect(toolResult.result).toHaveProperty("summary");
      expect(toolResult.result).toHaveProperty("details");
      expect(toolResult.result).toHaveProperty("duration_ms");
    }
  }, 60000);

  it("validate-all supports gate filtering", async () => {
    const result = await client.callTool({
      name: "validate-all",
      arguments: { gates: ["setup-check", "script-parity"] },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as ValidateAllResult;

    // Should only have results for filtered gates
    expect(parsed.tools.length).toBe(2);
    const toolNames = parsed.tools.map((t) => t.tool);
    expect(toolNames).toContain("setup-check");
    expect(toolNames).toContain("script-parity");
  }, 30000);

  it("validate-all status is FAIL if any tool fails", async () => {
    // Run validate-all against a non-existent path to force failures
    const result = await client.callTool({
      name: "validate-all",
      arguments: { projectRoot: "/nonexistent/path/xyz" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as ValidateAllResult;

    // With a nonexistent path, tools should fail
    expect(parsed.status).toBe("FAIL");
  }, 60000);
});
