import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("gsd:// resources", () => {
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
    if (cleanup) await cleanup();
  });

  it("lists gsd:// static resources (state, requirements, decisions)", async () => {
    const result = await client.listResources();
    const gsdResources = result.resources.filter((r) =>
      r.uri.startsWith("gsd://"),
    );
    expect(gsdResources.length).toBeGreaterThanOrEqual(3);

    const uris = gsdResources.map((r) => r.uri);
    expect(uris).toContain("gsd://state");
    expect(uris).toContain("gsd://requirements");
    expect(uris).toContain("gsd://decisions");
  });

  it("lists gsd://milestone/{id} resources for discovered milestones", async () => {
    const result = await client.listResources();
    const milestoneResources = result.resources.filter((r) =>
      r.uri.startsWith("gsd://milestone/"),
    );
    // At minimum M005 roadmap should be discoverable (active milestone)
    expect(milestoneResources.length).toBeGreaterThanOrEqual(1);
    for (const res of milestoneResources) {
      expect(res.uri).toMatch(/^gsd:\/\/milestone\/M\d{3}/);
    }
  });

  it("reads gsd://state and returns Markdown with milestone status", async () => {
    try {
      const result = await client.readResource({ uri: "gsd://state" });
      expect(result.contents).toHaveLength(1);
      const text = result.contents[0].text as string;
      expect(text).toBeTruthy();
      // STATE.md always contains a heading
      expect(text).toContain("#");
      expect(result.contents[0].uri).toBe("gsd://state");
    } catch (err: unknown) {
      // .gsd/STATE.md does not exist in CI — skip gracefully
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        console.log("Skipping: .gsd/STATE.md not found (CI environment)");
        return;
      }
      throw err;
    }
  });

  it("reads gsd://requirements and returns Markdown content", async () => {
    const result = await client.readResource({ uri: "gsd://requirements" });
    expect(result.contents).toHaveLength(1);
    const text = result.contents[0].text as string;
    expect(text).toBeTruthy();
    expect(text).toContain("#");
  });

  it("reads gsd://decisions and returns Markdown content", async () => {
    const result = await client.readResource({ uri: "gsd://decisions" });
    expect(result.contents).toHaveLength(1);
    const text = result.contents[0].text as string;
    expect(text).toBeTruthy();
  });

  it("reads gsd://milestone/M005 roadmap content", async () => {
    const result = await client.readResource({ uri: "gsd://milestone/M005" });
    expect(result.contents).toHaveLength(1);
    const text = result.contents[0].text as string;
    expect(text).toBeTruthy();
    expect(text).toContain("M005");
    expect(result.contents[0].uri).toBe("gsd://milestone/M005");
  });

  it("returns error for non-existent milestone", async () => {
    await expect(
      client.readResource({ uri: "gsd://milestone/M999" }),
    ).rejects.toThrow();
  });

  it("all gsd:// resources have non-empty descriptions", async () => {
    const result = await client.listResources();
    const gsdResources = result.resources.filter((r) =>
      r.uri.startsWith("gsd://"),
    );
    for (const res of gsdResources) {
      expect(res.description).toBeTruthy();
    }
  });
});
