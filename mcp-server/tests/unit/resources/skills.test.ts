import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("skill resources", () => {
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

  it("lists skill resources with skills:// URIs (at least 10)", async () => {
    const result = await client.listResources();
    const skillResources = result.resources.filter((r) =>
      r.uri.startsWith("skills://"),
    );
    expect(skillResources.length).toBeGreaterThanOrEqual(10);
    for (const res of skillResources) {
      expect(res.uri).toMatch(/^skills:\/\/androidcommondoc\/.+/);
    }
  });

  it("reads a known skill (run) and returns SKILL.md content", async () => {
    const result = await client.readResource({
      uri: "skills://androidcommondoc/run",
    });
    expect(result.contents).toHaveLength(1);
    const text = result.contents[0].text as string;
    // The run skill SKILL.md contains usage info
    expect(text).toContain("run");
  });

  it("returns an error for a non-existent skill", async () => {
    await expect(
      client.readResource({
        uri: "skills://androidcommondoc/non-existent-skill",
      }),
    ).rejects.toThrow();
  });
});
