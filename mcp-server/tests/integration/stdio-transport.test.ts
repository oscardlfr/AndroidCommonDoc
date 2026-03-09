import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "../../src/server.js";
import path from "node:path";

describe("stdio transport integration", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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

  it("completes initialize handshake", () => {
    // If we got here, the handshake succeeded during connect()
    expect(client).toBeDefined();
  });

  it("server reports correct name and version", () => {
    const info = client.getServerVersion();
    expect(info).toBeDefined();
    expect(info?.name).toBe("androidcommondoc");
    expect(info?.version).toBe("1.0.0");
  });

  // --- Resources ---

  it("lists at least 9 doc resources plus skills", async () => {
    const result = await client.listResources();
    // 9 static doc resources + dynamic skill resources
    expect(result.resources.length).toBeGreaterThanOrEqual(9);
  });

  it("reads a known doc resource and returns Markdown", async () => {
    const result = await client.readResource({
      uri: "docs://androidcommondoc/kmp-architecture",
    });
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].text).toBeDefined();
    // kmp-architecture.md must contain KMP-related content
    const text = result.contents[0].text as string;
    expect(text.length).toBeGreaterThan(100);
    expect(text.toLowerCase()).toContain("kmp");
  });

  // --- Tools ---

  it("lists at least 7 tools", async () => {
    const result = await client.listTools();
    // 5 individual + validate-all + rate-limit-status = 7
    expect(result.tools.length).toBeGreaterThanOrEqual(7);
  });

  it("invokes setup-check and returns JSON with status field", async () => {
    const result = await client.callTool({
      name: "setup-check",
      arguments: {},
    });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    const textContent = result.content[0];
    expect(textContent).toHaveProperty("text");

    const parsed = JSON.parse((textContent as { text: string }).text);
    expect(parsed).toHaveProperty("status");
    expect(["PASS", "FAIL", "ERROR"]).toContain(parsed.status);
  });

  // --- Prompts ---

  it("lists at least 3 prompts", async () => {
    const result = await client.listPrompts();
    // architecture-review, pr-review, onboarding
    expect(result.prompts.length).toBeGreaterThanOrEqual(3);
  });

  it("retrieves architecture-review prompt with code argument", async () => {
    const result = await client.getPrompt({
      name: "architecture-review",
      arguments: { code: "class Foo : ViewModel()" },
    });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0].role).toBe("user");

    const content = result.messages[0].content;
    if (typeof content === "string") {
      expect(content).toContain("class Foo");
    } else {
      expect((content as { text: string }).text).toContain("class Foo");
    }
  });
});

describe("stdio cleanliness (subprocess)", () => {
  it("connects via real subprocess stdio and responds correctly", async () => {
    // Use StdioClientTransport to spawn the server as a real subprocess,
    // verifying no stdout corruption (the CRITICAL MCP-05 Windows test).
    // If console.log() were present, the JSON-RPC framing would break
    // and the client connection would fail with "Connection closed".
    const serverScript = path.resolve(
      import.meta.dirname ?? ".",
      "../../build/index.js",
    );

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverScript],
      env: {
        ...process.env,
        ANDROID_COMMON_DOC: path.resolve(import.meta.dirname ?? ".", "../../../"),
      },
    });

    const stdioClient = new Client({ name: "stdio-test-client", version: "1.0.0" });
    await stdioClient.connect(transport);

    // Verify handshake succeeded (would fail on stdout corruption)
    const info = stdioClient.getServerVersion();
    expect(info?.name).toBe("androidcommondoc");

    // Verify tool listing works over real stdio
    const tools = await stdioClient.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(7);

    // Verify resource listing works over real stdio
    const resources = await stdioClient.listResources();
    expect(resources.resources.length).toBeGreaterThanOrEqual(9);

    // Verify prompt listing works over real stdio
    const prompts = await stdioClient.listPrompts();
    expect(prompts.prompts.length).toBeGreaterThanOrEqual(3);

    await stdioClient.close();
  }, 15000); // 15s timeout for subprocess test
});
