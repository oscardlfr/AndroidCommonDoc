import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("architecture-review prompt", () => {
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

  it("appears in prompt list", async () => {
    const result = await client.listPrompts();
    const archReview = result.prompts.find(
      (p) => p.name === "architecture-review",
    );
    expect(archReview).toBeDefined();
    expect(archReview!.description).toBeTruthy();
  });

  it("returns messages with code argument", async () => {
    const result = await client.getPrompt({
      name: "architecture-review",
      arguments: { code: "class Foo { val bar: String = \"hello\" }" },
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const text =
      result.messages[0].content.type === "text"
        ? result.messages[0].content.text
        : "";
    expect(text).toContain("class Foo");
    expect(text).toContain("pattern");
  });

  it("returns layer-specific content with layer argument", async () => {
    const result = await client.getPrompt({
      name: "architecture-review",
      arguments: { code: "class MyViewModel { }", layer: "viewmodel" },
    });
    expect(result.messages).toBeDefined();
    const text =
      result.messages[0].content.type === "text"
        ? result.messages[0].content.text
        : "";
    // When layer is "viewmodel", the prompt should reference ViewModel patterns
    expect(text).toContain("ViewModel");
  });
});
