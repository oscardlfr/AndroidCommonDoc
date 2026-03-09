import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("pr-review prompt", () => {
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
    const prReview = result.prompts.find((p) => p.name === "pr-review");
    expect(prReview).toBeDefined();
  });

  it("returns messages with diff argument", async () => {
    const result = await client.getPrompt({
      name: "pr-review",
      arguments: { diff: "diff --git a/Foo.kt b/Foo.kt\n+class Foo" },
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const text =
      result.messages[0].content.type === "text"
        ? result.messages[0].content.text
        : "";
    expect(text).toContain("diff --git");
    expect(text).toContain("pattern");
  });

  it("returns messages with focusAreas argument", async () => {
    const result = await client.getPrompt({
      name: "pr-review",
      arguments: {
        diff: "diff --git a/Foo.kt b/Foo.kt\n+class Foo",
        focusAreas: "viewmodel,testing",
      },
    });
    expect(result.messages).toBeDefined();
    const text =
      result.messages[0].content.type === "text"
        ? result.messages[0].content.text
        : "";
    expect(text).toContain("viewmodel");
  });
});
