/**
 * Tests for the setup-check MCP tool.
 *
 * Runs against the actual AndroidCommonDoc repo, so setup-check should
 * report PASS for most checks (docs/, scripts/, etc. exist).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSetupCheckTool } from "../../../src/tools/setup-check.js";
import type { ValidationResult } from "../../../src/types/results.js";

describe("setup-check tool", () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerSetupCheckTool(server);

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

  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "setup-check");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("returns structured ValidationResult JSON", async () => {
    const result = await client.callTool({
      name: "setup-check",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const content = result.content[0];
    expect(content).toHaveProperty("type", "text");

    const parsed = JSON.parse(
      (content as { type: "text"; text: string }).text,
    ) as ValidationResult;
    expect(parsed).toHaveProperty("status");
    expect(["PASS", "FAIL", "ERROR"]).toContain(parsed.status);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("details");
    expect(parsed).toHaveProperty("duration_ms");
    expect(Array.isArray(parsed.details)).toBe(true);
  });

  it("validates project configuration with correct checks", async () => {
    const result = await client.callTool({
      name: "setup-check",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as ValidationResult;

    // Verify expected checks are present
    const checkNames = parsed.details.map((d) => d.check);
    expect(checkNames).toContain("docs-directory");
    expect(checkNames).toContain("scripts-sh-directory");
    expect(checkNames).toContain("scripts-ps1-directory");

    // docs/ and scripts/ exist in the AndroidCommonDoc repo, so these should PASS
    const docsCheck = parsed.details.find((d) => d.check === "docs-directory");
    expect(docsCheck?.status).toBe("PASS");

    const shCheck = parsed.details.find(
      (d) => d.check === "scripts-sh-directory",
    );
    expect(shCheck?.status).toBe("PASS");
  });
});
