import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("changelog resource", () => {
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

  it("reads changelog resource and returns non-empty Markdown", async () => {
    const result = await client.readResource({
      uri: "changelog://androidcommondoc/latest",
    });
    expect(result.contents).toHaveLength(1);
    const text = result.contents[0].text as string;
    expect(text.length).toBeGreaterThan(0);
    // Should contain some Markdown structure
    expect(text).toContain("#");
  });

  it("changelog resource appears in resource list", async () => {
    const result = await client.listResources();
    const changelog = result.resources.find((r) =>
      r.uri.startsWith("changelog://"),
    );
    expect(changelog).toBeDefined();
    expect(changelog!.uri).toBe("changelog://androidcommondoc/latest");
  });
});
