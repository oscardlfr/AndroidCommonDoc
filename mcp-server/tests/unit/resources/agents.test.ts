/**
 * Tests for the agents MCP resource.
 *
 * Verifies agent discovery, metadata, content reading, and error handling
 * via agents://androidcommondoc/{name} URI scheme.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("agent resources", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  it("lists at least 15 agents with agents:// URIs", async () => {
    const result = await client.listResources();
    const agentResources = result.resources.filter((r) =>
      r.uri.startsWith("agents://"),
    );
    expect(agentResources.length).toBeGreaterThanOrEqual(15);
    for (const res of agentResources) {
      expect(res.uri).toMatch(/^agents:\/\/androidcommondoc\/.+/);
    }
  });

  it("each agent has name and description in metadata", async () => {
    const result = await client.listResources();
    const agentResources = result.resources.filter((r) =>
      r.uri.startsWith("agents://"),
    );

    for (const res of agentResources) {
      expect(res.name).toBeTruthy();
      expect(res.description).toBeTruthy();
    }
  });

  it("reads a specific agent (debugger) and gets content", async () => {
    const result = await client.readResource({
      uri: "agents://androidcommondoc/debugger",
    });
    expect(result.contents).toHaveLength(1);
    const text = result.contents[0].text as string;
    // The debugger agent should contain relevant debugging content
    expect(text.length).toBeGreaterThan(100);
    expect(text.toLowerCase()).toContain("debug");
  });

  it("returns error for non-existent agent", async () => {
    await expect(
      client.readResource({
        uri: "agents://androidcommondoc/non-existent-agent-xyz",
      }),
    ).rejects.toThrow();
  });
});
