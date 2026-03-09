import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("doc resources", () => {
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

  it("lists at least 9 pattern doc resources with docs:// URIs", async () => {
    const result = await client.listResources();
    const docResources = result.resources.filter((r) =>
      r.uri.startsWith("docs://"),
    );
    expect(docResources.length).toBeGreaterThanOrEqual(9);
    for (const res of docResources) {
      expect(res.uri).toMatch(/^docs:\/\/androidcommondoc\/.+/);
    }
  });

  it("reads kmp-architecture resource and returns Markdown containing KMP", async () => {
    const result = await client.readResource({
      uri: "docs://androidcommondoc/kmp-architecture",
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].text).toContain("KMP");
    expect(result.contents[0].uri).toBe(
      "docs://androidcommondoc/kmp-architecture",
    );
  });

  it("enterprise-integration resource no longer exists (archived in Phase 14.1)", async () => {
    // enterprise-integration-proposal moved to archive/ during Phase 14.1
    // Plan 02 reorganization. Scanner skips archive/, so this resource
    // should no longer be registered.
    await expect(
      client.readResource({
        uri: "docs://androidcommondoc/enterprise-integration",
      }),
    ).rejects.toThrow();
  });

  it("returns an error for a non-existent resource", async () => {
    await expect(
      client.readResource({
        uri: "docs://androidcommondoc/non-existent-doc",
      }),
    ).rejects.toThrow();
  });

  it("discovers sub-docs dynamically (e.g., testing-patterns-coroutines)", async () => {
    const result = await client.listResources();
    const docResources = result.resources.filter((r) =>
      r.uri.startsWith("docs://"),
    );
    const slugs = docResources.map((r) => r.uri.replace("docs://androidcommondoc/", ""));
    // Sub-docs from Plan 02 should be listed
    expect(slugs).toContain("testing-patterns-coroutines");
    expect(slugs).toContain("viewmodel-events");
  });

  it("uses description from frontmatter metadata when available", async () => {
    const result = await client.listResources();
    const docResources = result.resources.filter((r) =>
      r.uri.startsWith("docs://"),
    );
    // All docs should have a description
    for (const res of docResources) {
      expect(res.description).toBeTruthy();
    }
  });
});
