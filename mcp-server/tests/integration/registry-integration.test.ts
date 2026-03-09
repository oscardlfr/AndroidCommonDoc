/**
 * Registry integration tests.
 *
 * End-to-end verification of the complete registry flow: dynamic doc
 * discovery via scanner, find-pattern metadata search, layer resolution,
 * backward-compatible docs:// URIs, and full discovery-to-consumption flow.
 *
 * Uses InMemoryTransport to test the complete MCP server stack without
 * subprocess overhead.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

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
  }>;
  total: number;
  project_filter: string | null;
}

describe("registry integration", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "registry-test-client", version: "1.0.0" });
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

  // ---------------------------------------------------------------
  // 1. Dynamic doc discovery (REG-05 verification)
  // ---------------------------------------------------------------
  describe("dynamic doc discovery", () => {
    it("lists docs:// URIs for all pattern docs with frontmatter", async () => {
      const result = await client.listResources();
      const docResources = result.resources.filter((r) =>
        r.uri.startsWith("docs://"),
      );

      // 23 docs with frontmatter + 1 alias = 24 registered resources
      // At minimum: 10 original docs + 12 sub-docs = 22, plus alias = 23
      expect(docResources.length).toBeGreaterThanOrEqual(23);
    });

    it("discovers sub-docs created by doc splitting (Plan 02)", async () => {
      const result = await client.listResources();
      const slugs = result.resources
        .filter((r) => r.uri.startsWith("docs://"))
        .map((r) => r.uri.replace("docs://androidcommondoc/", ""));

      // Sub-docs from the 4 split parents
      const expectedSubDocs = [
        "testing-patterns-coroutines",
        "testing-patterns-fakes",
        "testing-patterns-coverage",
        "compose-resources-configuration",
        "compose-resources-usage",
        "compose-resources-troubleshooting",
        "offline-first-architecture",
        "offline-first-sync",
        "offline-first-caching",
        "viewmodel-state-management",
        "viewmodel-navigation",
        "viewmodel-events",
      ];

      for (const subDoc of expectedSubDocs) {
        expect(slugs).toContain(subDoc);
      }
    });

    it("counts at least 8 original pattern docs among resources", async () => {
      const result = await client.listResources();
      const slugs = result.resources
        .filter((r) => r.uri.startsWith("docs://"))
        .map((r) => r.uri.replace("docs://androidcommondoc/", ""));

      // enterprise-integration-proposal moved to archive/ (Phase 14.1 Plan 02)
      // and is no longer discoverable by the scanner (archive/ is skipped)
      const originalDocs = [
        "testing-patterns",
        "kmp-architecture",
        "compose-resources-patterns",
        "gradle-patterns",
        "offline-first-patterns",
        "resource-management-patterns",
        "ui-screen-patterns",
        "viewmodel-state-patterns",
      ];

      for (const doc of originalDocs) {
        expect(slugs).toContain(doc);
      }
    });
  });

  // ---------------------------------------------------------------
  // 2. Backward compatibility (REG-05 verification)
  // ---------------------------------------------------------------
  describe("backward compatibility", () => {
    it("reads docs://androidcommondoc/kmp-architecture with KMP content", async () => {
      const result = await client.readResource({
        uri: "docs://androidcommondoc/kmp-architecture",
      });

      expect(result.contents).toHaveLength(1);
      const text = result.contents[0].text as string;
      expect(text.length).toBeGreaterThan(100);
      expect(text).toContain("KMP");
    });

    it("enterprise-integration alias no longer resolves (archived in Phase 14.1)", async () => {
      // enterprise-integration-proposal moved to archive/ and is no longer
      // discoverable by the scanner, so the alias should not exist
      await expect(
        client.readResource({
          uri: "docs://androidcommondoc/enterprise-integration",
        }),
      ).rejects.toThrow();
    });

    it("reads docs://androidcommondoc/testing-patterns and returns content", async () => {
      const result = await client.readResource({
        uri: "docs://androidcommondoc/testing-patterns",
      });

      expect(result.contents).toHaveLength(1);
      const text = result.contents[0].text as string;
      expect(text.length).toBeGreaterThan(50);
      // Hub doc should reference sub-docs or contain testing content
      expect(text.toLowerCase()).toContain("testing");
    });

    it("throws error for non-existent slug", async () => {
      await expect(
        client.readResource({
          uri: "docs://androidcommondoc/does-not-exist-slug",
        }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------
  // 3. find-pattern tool (REG-06 verification)
  // ---------------------------------------------------------------
  describe("find-pattern tool", () => {
    it("returns matches for query 'testing' with testing in scope", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "testing" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);
      // At least one match should have 'testing' in scope
      const hasTestingScope = parsed.matches.some((m) =>
        m.scope.some((s) => s.toLowerCase().includes("testing")),
      );
      expect(hasTestingScope).toBe(true);
    });

    it("returns matches for query 'ktor' with ktor in sources", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "ktor" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);
      const allSources = parsed.matches.flatMap((m) => m.sources);
      expect(allSources.some((s) => s.toLowerCase().includes("ktor"))).toBe(
        true,
      );
    });

    it("returns 0 matches for nonexistent query", async () => {
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

    it("filters results by targets=['android'] -- all results have android", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "architecture", targets: ["android"] },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      for (const match of parsed.matches) {
        expect(
          match.targets.map((t) => t.toLowerCase()),
        ).toContain("android");
      }
    });

    it("includes content when include_content=true", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "kmp-architecture", include_content: true },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      // kmp-architecture matches on scope 'architecture'
      const kmpMatch = parsed.matches.find(
        (m) => m.slug === "kmp-architecture",
      );
      if (kmpMatch) {
        expect(kmpMatch.content).toBeDefined();
        expect(kmpMatch.content!.length).toBeGreaterThan(100);
      }
    });

    it("does NOT include content when include_content=false", async () => {
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

    it("returns correct response structure: slug, description, scope, sources, targets, layer, uri", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "gradle" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);

      for (const match of parsed.matches) {
        expect(match).toHaveProperty("slug");
        expect(typeof match.slug).toBe("string");
        expect(match).toHaveProperty("scope");
        expect(Array.isArray(match.scope)).toBe(true);
        expect(match).toHaveProperty("sources");
        expect(Array.isArray(match.sources)).toBe(true);
        expect(match).toHaveProperty("targets");
        expect(Array.isArray(match.targets)).toBe(true);
        expect(match).toHaveProperty("layer");
        expect(typeof match.layer).toBe("string");
        expect(match).toHaveProperty("uri");
        expect(match.uri).toMatch(/^docs:\/\/androidcommondoc\/.+/);
      }
    });
  });

  // ---------------------------------------------------------------
  // 4. Layer resolution integration (REG-03 verification)
  // ---------------------------------------------------------------
  describe("layer resolution", () => {
    it("find-pattern without project filter returns L0 results only", async () => {
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "testing" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.project_filter).toBeNull();
      // All entries should be L0 when no project filter is used
      for (const match of parsed.matches) {
        expect(match.layer).toBe("L0");
      }
    });

    it("all discovered doc resources are from L0 base layer", async () => {
      // When no project filter is active, find-pattern scans L0 directly
      const result = await client.callTool({
        name: "find-pattern",
        arguments: { query: "architecture" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      for (const match of parsed.matches) {
        expect(match.layer).toBe("L0");
      }
    });
  });

  // ---------------------------------------------------------------
  // 5. Full flow verification: discovery-to-consumption
  // ---------------------------------------------------------------
  describe("full flow: find-pattern -> docs:// read", () => {
    it("discovers a pattern via find-pattern, then reads it via docs:// URI", async () => {
      // Step 1: Find a pattern by metadata
      const searchResult = await client.callTool({
        name: "find-pattern",
        arguments: { query: "gradle" },
      });

      const parsed = JSON.parse(
        (searchResult.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      expect(parsed.matches.length).toBeGreaterThan(0);

      // Step 2: Take the first match's slug and read it via docs:// URI
      const firstMatch = parsed.matches[0];
      const resourceUri = firstMatch.uri;

      const readResult = await client.readResource({ uri: resourceUri });

      expect(readResult.contents).toHaveLength(1);
      const text = readResult.contents[0].text as string;
      expect(text.length).toBeGreaterThan(50);
      // The content should be a valid Markdown document
      expect(text).toContain("---"); // Has frontmatter
    });

    it("full flow for error-handling-patterns: search -> read -> verify content", async () => {
      // Search for error handling
      const searchResult = await client.callTool({
        name: "find-pattern",
        arguments: { query: "error" },
      });

      const parsed = JSON.parse(
        (searchResult.content[0] as { type: "text"; text: string }).text,
      ) as FindPatternResult;

      const errorMatch = parsed.matches.find(
        (m) => m.slug === "error-handling-patterns",
      );
      expect(errorMatch).toBeDefined();

      // Read the document via its URI
      const readResult = await client.readResource({
        uri: errorMatch!.uri,
      });

      const text = readResult.contents[0].text as string;
      expect(text.toLowerCase()).toContain("error");
    });
  });
});
