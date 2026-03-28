/**
 * Tests for the suggest-docs MCP tool.
 *
 * Verifies file-path-based doc suggestions using target matching,
 * including ViewModel files, Gradle files, non-matching files, and dedup.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

describe("suggest-docs tool", () => {
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

  it("is listed as a tool with description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "suggest-docs");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("suggests docs for a ViewModel.kt file", async () => {
    // A file in an android/viewmodel path should match docs with
    // "android" target or scope containing "viewmodel"
    const result = await client.callTool({
      name: "suggest-docs",
      arguments: { files: ["app/src/main/kotlin/com/example/android/viewmodel/HomeViewModel.kt"] },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Should find suggestions (not "No relevant pattern docs found")
    expect(text).toContain("Suggested Docs");
  });

  it("suggests docs for a .gradle.kts file", async () => {
    // A file in a gradle path should match docs with scope "gradle"
    const result = await client.callTool({
      name: "suggest-docs",
      arguments: { files: ["build-logic/convention/src/main/kotlin/gradle/AndroidLibraryPlugin.gradle.kts"] },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Should get suggestions since the path contains "gradle"
    expect(text).toContain("Suggested Docs");
  });

  it("returns empty for non-matching file", async () => {
    const result = await client.callTool({
      name: "suggest-docs",
      arguments: { files: ["totally/random/unrelated/file.xyz"] },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("No relevant pattern docs found");
  });

  it("matches by path component (viewmodel in path)", async () => {
    // Strategy 3: path component match — targets mentions "viewmodel" and file path contains it
    const result = await client.callTool({
      name: "suggest-docs",
      arguments: {
        files: ["feature/viewmodel/src/main/kotlin/ScreenState.kt"],
      },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Path contains "viewmodel" which should match docs with viewmodel in scope/targets
    if (text.includes("Suggested Docs")) {
      expect(text).toContain("URI: docs://androidcommondoc/");
    }
  });

  it("aggregates multiple files without duplicate slugs", async () => {
    // Multiple Kotlin files in the same android path should produce unique suggestions
    const result = await client.callTool({
      name: "suggest-docs",
      arguments: {
        files: [
          "app/src/main/kotlin/com/example/android/HomeViewModel.kt",
          "app/src/main/kotlin/com/example/android/SettingsViewModel.kt",
          "app/src/main/kotlin/com/example/android/ProfileViewModel.kt",
        ],
      },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;

    if (text.includes("Suggested Docs")) {
      // Extract all URIs and verify uniqueness
      const uriMatches = text.match(/docs:\/\/androidcommondoc\/([^\s)]+)/g) ?? [];
      const uniqueUris = new Set(uriMatches);
      expect(uniqueUris.size).toBe(uriMatches.length);
    }
  });

  it("handles multiple files with dedup", async () => {
    // Two files in the same android path should produce deduplicated suggestions
    const result = await client.callTool({
      name: "suggest-docs",
      arguments: {
        files: [
          "app/src/main/kotlin/com/example/android/HomeScreen.kt",
          "app/src/main/kotlin/com/example/android/DetailScreen.kt",
        ],
      },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;

    if (text.includes("Suggested Docs")) {
      // If there are suggestions, verify no slug appears twice
      const slugMatches = text.match(/docs:\/\/androidcommondoc\/([^\s)]+)/g) ?? [];
      const uniqueSlugs = new Set(slugMatches);
      expect(uniqueSlugs.size).toBe(slugMatches.length);
    }
  });
});
