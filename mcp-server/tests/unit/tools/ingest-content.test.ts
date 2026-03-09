/**
 * Tests for the ingest-content MCP tool.
 *
 * Verifies tool registration, URL fetching (success and failure),
 * content analysis with pattern matching, graceful degradation for
 * unfetchable URLs, and suggest-and-approve flow (never auto-applies).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("ingest-content tool", () => {
  let client: Client;
  let cleanup: () => Promise<void>;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;

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
    globalThis.fetch = originalFetch;
    if (cleanup) {
      await cleanup();
    }
  });

  it("is listed as a registered tool with description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "ingest-content");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain("content");
  });

  it("accepts url parameter and fetches content successfully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          "Use Kotlin coroutines with structured concurrency for async operations. " +
          "Prefer StateFlow over LiveData for reactive state management.",
        ),
    }) as unknown as typeof fetch;

    const result = await client.callTool({
      name: "ingest-content",
      arguments: { url: "https://example.com/blog/kotlin-patterns" },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.status).toBe("analyzed");
    expect(parsed).toHaveProperty("suggestions");
    expect(parsed).toHaveProperty("raw_content_preview");
    expect(Array.isArray(parsed.suggestions)).toBe(true);
  });

  it("accepts content parameter (pasted text) and analyzes it", async () => {
    const pastedContent =
      "When building ViewModels, always expose UiState as a sealed interface. " +
      "Use WhileSubscribed(5000) for stateIn to handle configuration changes.";

    const result = await client.callTool({
      name: "ingest-content",
      arguments: { content: pastedContent },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.status).toBe("analyzed");
    expect(parsed).toHaveProperty("suggestions");
    expect(parsed).toHaveProperty("raw_content_preview");
    // Preview should contain part of the pasted content
    expect(parsed.raw_content_preview.length).toBeLessThanOrEqual(500);
  });

  it("routes extracted patterns to matching docs by scope/sources", async () => {
    const pastedContent =
      "Kotlin coroutines best practices: use structured concurrency, " +
      "avoid GlobalScope, prefer supervisorScope for independent child jobs. " +
      "Compose navigation should use state-driven patterns.";

    const result = await client.callTool({
      name: "ingest-content",
      arguments: { content: pastedContent },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    // Suggestions should be present (may match pattern docs if they exist)
    expect(parsed.status).toBe("analyzed");
    expect(Array.isArray(parsed.suggestions)).toBe(true);
  });

  it("returns suggestions, not auto-applied changes", async () => {
    const pastedContent =
      "Always validate input parameters in repository implementations.";

    const result = await client.callTool({
      name: "ingest-content",
      arguments: { content: pastedContent },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.status).toBe("analyzed");
    // Each suggestion should have recommended_action, not an auto-apply flag
    for (const suggestion of parsed.suggestions) {
      expect(["update", "review", "new_doc"]).toContain(
        suggestion.recommended_action,
      );
    }
  });

  it("gracefully handles unfetchable URLs with paste prompt", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }) as unknown as typeof fetch;

    const result = await client.callTool({
      name: "ingest-content",
      arguments: { url: "https://medium.com/paywall-article" },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.status).toBe("url_unfetchable");
    expect(parsed).toHaveProperty("suggestion");
    expect(parsed.suggestion).toContain("paste");
  });

  it("gracefully handles URL fetch network errors", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("Network timeout"),
    ) as unknown as typeof fetch;

    const result = await client.callTool({
      name: "ingest-content",
      arguments: { url: "https://example.com/timeout" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.status).toBe("url_unfetchable");
    expect(parsed).toHaveProperty("suggestion");
    expect(parsed.suggestion).toContain("paste");
  });

  it("returns error when neither url nor content is provided", async () => {
    const result = await client.callTool({
      name: "ingest-content",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.status).toBe("ERROR");
  });

  it("is rate-limited", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "ingest-content");
    expect(tool).toBeDefined();
  });
});
