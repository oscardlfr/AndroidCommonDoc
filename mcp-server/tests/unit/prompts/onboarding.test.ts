import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("onboarding prompt", () => {
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
    const onboarding = result.prompts.find((p) => p.name === "onboarding");
    expect(onboarding).toBeDefined();
  });

  it("returns welcoming content", async () => {
    const result = await client.getPrompt({
      name: "onboarding",
      arguments: {},
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const text =
      result.messages[0].content.type === "text"
        ? result.messages[0].content.text
        : "";
    // Onboarding content should mention AndroidCommonDoc and patterns
    expect(text).toContain("AndroidCommonDoc");
  });

  it("returns project-type-specific content", async () => {
    const result = await client.getPrompt({
      name: "onboarding",
      arguments: { projectType: "kmp" },
    });
    expect(result.messages).toBeDefined();
    const text =
      result.messages[0].content.type === "text"
        ? result.messages[0].content.text
        : "";
    expect(text).toContain("KMP");
  });
});
