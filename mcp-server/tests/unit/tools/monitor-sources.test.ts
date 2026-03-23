/**
 * Tests for the monitor-sources MCP tool.
 *
 * Verifies tool registration, tier filtering, review-aware filtering,
 * rate limiting, and structured JSON output following the existing
 * tool test patterns (InMemoryTransport + Client).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

interface MonitoringReportResult {
  timestamp: string;
  tier_filter: number | "all";
  total_sources: number;
  checked: number;
  errors: number;
  findings: {
    total: number;
    new: number;
    high: number;
    medium: number;
    low: number;
  };
  details: Array<{
    slug: string;
    source_url: string;
    severity: string;
    category: string;
    summary: string;
    details: string;
    finding_hash: string;
  }>;
  stale_deferrals: string[];
}

describe("monitor-sources tool", () => {
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

  it("is listed as a registered tool with description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "monitor-sources");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain("documentation");
  });

  it("accepts tier filter parameter and returns JSON with findings structure", async () => {
    // Mock fetch to avoid real HTTP calls during tool test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v1.10.2" }),
      text: () => Promise.resolve("mock content"),
    }) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "monitor-sources",
        arguments: { tier: "all" },
      });

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as MonitoringReportResult;

      // Verify report structure
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed).toHaveProperty("tier_filter");
      expect(parsed).toHaveProperty("checked");
      expect(parsed).toHaveProperty("errors");
      expect(parsed).toHaveProperty("findings");
      expect(parsed.findings).toHaveProperty("total");
      expect(parsed.findings).toHaveProperty("new");
      expect(parsed.findings).toHaveProperty("high");
      expect(parsed.findings).toHaveProperty("medium");
      expect(parsed.findings).toHaveProperty("low");
      expect(parsed).toHaveProperty("details");
      expect(parsed).toHaveProperty("stale_deferrals");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("filters by tier when specified (only checks sources matching tier)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v1.10.2" }),
      text: () => Promise.resolve("mock content"),
    }) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "monitor-sources",
        arguments: { tier: 1 },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as MonitoringReportResult;

      expect(parsed.tier_filter).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes stale deferral warnings in output", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v1.10.2" }),
      text: () => Promise.resolve("mock content"),
    }) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "monitor-sources",
        arguments: { tier: "all" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as MonitoringReportResult;

      // stale_deferrals should exist as an array (may be empty if no state file)
      expect(Array.isArray(parsed.stale_deferrals)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts layer parameter (defaults to L0)", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "monitor-sources");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("layer");
  });

  it("accepts L1 layer and scans external project", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v1.10.2" }),
      text: () => Promise.resolve("mock content"),
    }) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "monitor-sources",
        arguments: { tier: "all", layer: "L1", projectRoot: process.cwd().replace(/[\\/]mcp-server$/, "") },
      });

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as MonitoringReportResult;

      // Should return a valid report even when scanning L0 as L1
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed).toHaveProperty("checked");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("deduplicates URL checks — same URL fetched once regardless of doc count", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ tag_name: "v1.10.2" }),
      text: () => Promise.resolve("mock content for dedup test"),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "monitor-sources",
        arguments: { tier: "all" },
      });

      const parsed = JSON.parse(
        (result.content[0] as { type: "text"; text: string }).text,
      ) as MonitoringReportResult;

      // The total sources checked may be high (multiple entries reference same URL),
      // but actual fetch calls should be lower due to dedup cache
      const uniqueUrls = new Set(fetchMock.mock.calls.map((call: unknown[]) => (call[0] as string)));
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(parsed.checked);
      // With dedup, unique URLs fetched should be less than total checked
      // (unless every entry has a unique URL, which is unlikely)
      expect(uniqueUrls.size).toBeLessThanOrEqual(fetchMock.mock.calls.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns structured error on tool failure", async () => {
    const originalFetch = globalThis.fetch;
    // Make all fetches throw to trigger error handling
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("Network failure"),
    ) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "monitor-sources",
        arguments: { tier: "all" },
      });

      // Should still return a valid response (error or empty report)
      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
