/**
 * Tests for the find-pattern MCP tool.
 *
 * Verifies metadata-based pattern search across the registry, including
 * query matching, target filtering, content inclusion, and rate limiting.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

interface FindPatternResult {
  query: string;
  matches: Array<{
    slug: string;
    description?: string;
    scope: string[];
    sources: string[];
    targets: string[];
    layer: string;
    uri: string;
    content?: string;
    category?: string;
  }>;
  total: number;
  project_filter: string | null;
}

describe("find-pattern tool", () => {
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
    const tool = tools.find((t) => t.name === "find-pattern");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("returns matches for query 'testing'", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing" },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.query).toBe("testing");
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.total).toBeGreaterThan(0);
    expect(parsed.project_filter).toBeNull();

    // At least testing-patterns should match
    const slugs = parsed.matches.map((m) => m.slug);
    expect(slugs).toContain("testing-patterns");
  });

  it("returns matches for query 'ktor' (source-based search)", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "ktor" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches.length).toBeGreaterThan(0);
    // ktor should match entries with ktor-client in sources
    const allSources = parsed.matches.flatMap((m) => m.sources);
    expect(allSources.some((s) => s.includes("ktor"))).toBe(true);
  });

  it("returns empty matches for nonexistent query", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "xyznonexistent123" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches).toHaveLength(0);
    expect(parsed.total).toBe(0);
  });

  it("filters results by targets", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "enterprise", targets: ["android"] },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    // enterprise-integration-proposal targets android
    for (const match of parsed.matches) {
      expect(match.targets).toContain("android");
    }
  });

  it("returns correct response structure with uri field", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    for (const match of parsed.matches) {
      expect(match).toHaveProperty("slug");
      expect(match).toHaveProperty("scope");
      expect(match).toHaveProperty("sources");
      expect(match).toHaveProperty("targets");
      expect(match).toHaveProperty("layer");
      expect(match).toHaveProperty("uri");
      expect(match.uri).toMatch(/^docs:\/\/androidcommondoc\/.+/);
      // By default, content should NOT be included
      expect(match.content).toBeUndefined();
    }
  });

  it("includes content when include_content is true", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "kmp-architecture", include_content: true },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    // kmp-architecture should match (scope contains "architecture")
    const kmpMatch = parsed.matches.find((m) => m.slug === "kmp-architecture");
    if (kmpMatch) {
      expect(kmpMatch.content).toBeDefined();
      expect(kmpMatch.content!.length).toBeGreaterThan(100);
      expect(kmpMatch.content).toContain("KMP");
    }
  });

  it("does not include content when include_content is false", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing", include_content: false },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    for (const match of parsed.matches) {
      expect(match.content).toBeUndefined();
    }
  });

  it("returns L0-only patterns when no project specified", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.project_filter).toBeNull();
    // All entries should be L0 when no project is specified
    for (const match of parsed.matches) {
      expect(match.layer).toBe("L0");
    }
  });

  it("deduplicates by slug:layer (one per slug per layer)", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    // Check that no slug+layer combination appears more than once
    const seen = new Set<string>();
    for (const match of parsed.matches) {
      const key = `${match.slug}:${match.layer}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("returns empty for empty/whitespace-only query", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "   " },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches).toHaveLength(0);
    expect(parsed.total).toBe(0);
  });

  it("token matching is substring-based on scope/sources/targets", async () => {
    // "test" should match entries with "testing" in scope (substring match)
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "test" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches.length).toBeGreaterThan(0);
    // At least one match should have a field containing "test" as substring
    const allFields = parsed.matches.flatMap((m) => [
      ...m.scope,
      ...m.sources,
      ...m.targets,
    ]);
    expect(
      allFields.some((f) => f.toLowerCase().includes("test")),
    ).toBe(true);
  });

  it("graceful fallback when unknown project specified", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing", project: "nonexistent-project-xyz" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    // Should still return L0 results as fallback
    expect(parsed.project_filter).toBe("nonexistent-project-xyz");
    // Should not error — graceful fallback to L0
    expect((parsed as Record<string, unknown>).status).toBeUndefined();
  });

  // --- Category filter tests (Phase 14.1) ---

  it("filters results by category='testing' returning only matching entries", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing", category: "testing" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches.length).toBeGreaterThan(0);
    // All results must have category "testing"
    for (const match of parsed.matches) {
      expect(match.category).toBe("testing");
    }
    // testing-patterns should be in the results
    const slugs = parsed.matches.map((m) => m.slug);
    expect(slugs).toContain("testing-patterns");
  });

  it("combines category filter with query (AND logic)", async () => {
    // Query "architecture" with category "testing" should return no matches
    // because architecture docs have category "architecture", not "testing"
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "architecture", category: "testing" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    // No doc has both "architecture" in its metadata AND category "testing"
    expect(parsed.matches).toHaveLength(0);
  });

  it("returns all matching entries without category filter (backward compatible)", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    // Should still return results without category filter
    expect(parsed.matches.length).toBeGreaterThan(0);
  });

  it("category filter is case-insensitive", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing", category: "TESTING" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches.length).toBeGreaterThan(0);
    const slugs = parsed.matches.map((m) => m.slug);
    expect(slugs).toContain("testing-patterns");
  });

  it("formatMatch output includes category field when present", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "kmp-architecture" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    const kmpMatch = parsed.matches.find((m) => m.slug === "kmp-architecture");
    if (kmpMatch) {
      expect(kmpMatch.category).toBe("architecture");
    }
  });

  it("returns no results for nonexistent category", async () => {
    const result = await client.callTool({
      name: "find-pattern",
      arguments: { query: "testing", category: "nonexistent-category-xyz" },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as FindPatternResult;

    expect(parsed.matches).toHaveLength(0);
  });
});
