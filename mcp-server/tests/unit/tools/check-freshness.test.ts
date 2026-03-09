/**
 * Tests for the check-doc-freshness MCP tool (backward-compatible alias).
 *
 * Verifies that the alias tool delegates to monitor-sources logic and
 * returns a structured monitoring report.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckFreshnessTool } from "../../../src/tools/check-freshness.js";

describe("check-doc-freshness tool (alias)", () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerCheckFreshnessTool(server);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("is listed as a tool with alias description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "check-doc-freshness");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain("alias");
  });

  it("returns structured monitoring report JSON", async () => {
    // Mock fetch to avoid real HTTP calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v1.10.2" }),
      text: () => Promise.resolve("mock content"),
    }) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "check-doc-freshness",
        arguments: {},
      });

      expect(result.content).toHaveLength(1);
      const content = result.content[0];
      expect(content).toHaveProperty("type", "text");

      // Parse the JSON response -- should be a monitoring report
      const parsed = JSON.parse(
        (content as { type: "text"; text: string }).text,
      );
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed).toHaveProperty("checked");
      expect(parsed).toHaveProperty("findings");
      expect(parsed.findings).toHaveProperty("total");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 30000);
});
