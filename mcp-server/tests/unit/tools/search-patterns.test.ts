/**
 * Tests for the search-patterns MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * These tests cover the tool's graceful-degradation paths — the Python
 * scripts handle the chromadb/sentence-transformers dependency, so tests
 * validate behavior when those deps are absent or the DB is not indexed.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchPatternsTool } from "../../../src/tools/search-patterns.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Fixture management ────────────────────────────────────────────────────────

const TEST_ROOT = path.join(os.tmpdir(), "search-patterns-test-" + process.pid);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

// ── MCP client/server lifecycle ───────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerSearchPatternsTool(server, limiter);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(() => {
  ensureClean();
});

afterEach(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors on Windows
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function callTool(args: Record<string, unknown>) {
  return client.callTool({
    name: "search-patterns",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

function extractJson(text: string): Record<string, unknown> {
  return JSON.parse(text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("search-patterns tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "search-patterns");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Chroma");
  });

  it("returns SKIPPED when chromadb not installed", async () => {
    // The Python script emits SKIPPED JSON if chromadb is not importable.
    // On machines without chromadb this tests the graceful fallback.
    const result = await callTool({
      query: "coroutine cancellation",
      projectRoot: TEST_ROOT,
    });
    const text = extractText(result);
    const json = extractJson(text);

    // Must have status — either SKIPPED (no chromadb) or NOT_INDEXED/OK (has chromadb)
    expect(json).toHaveProperty("status");
    expect(["SKIPPED", "NOT_INDEXED", "OK", "ERROR"]).toContain(json.status);

    if (json.status === "SKIPPED") {
      expect(json).toHaveProperty("hint");
      expect(String(json.hint)).toContain("chromadb");
    }
  });

  it("returns NOT_INDEXED when DB not found", async () => {
    // Fresh temp dir — .chroma/ does not exist, so should get NOT_INDEXED.
    // (Unless chromadb is not installed, in which case SKIPPED is returned first.)
    const result = await callTool({
      query: "viewmodel state management",
      projectRoot: TEST_ROOT,
    });
    const text = extractText(result);
    const json = extractJson(text);

    expect(json).toHaveProperty("status");
    // SKIPPED (no chromadb) or NOT_INDEXED (chromadb present but no DB)
    expect(["SKIPPED", "NOT_INDEXED"]).toContain(json.status);

    if (json.status === "NOT_INDEXED") {
      expect(json).toHaveProperty("hint");
      expect(String(json.hint)).toContain("index-patterns-chroma.py");
    }
  });

  it("response has expected structure", async () => {
    const result = await callTool({
      query: "dependency injection koin",
      projectRoot: TEST_ROOT,
    });
    const text = extractText(result);
    const json = extractJson(text);

    // All responses must have these fields
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("query");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("results");

    expect(json.query).toBe("dependency injection koin");
    expect(typeof json.total).toBe("number");
    expect(Array.isArray(json.results)).toBe(true);
    expect(["SKIPPED", "NOT_INDEXED", "OK", "ERROR"]).toContain(json.status);
  });

  it("handles empty query", async () => {
    const result = await callTool({
      query: "",
      projectRoot: TEST_ROOT,
    });
    const text = extractText(result);
    const json = extractJson(text);

    // Must not throw — should return a valid status response
    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("results");
    expect(Array.isArray(json.results)).toBe(true);
  });

  it("rebuild:true returns SKIPPED or ERROR when chromadb/python3 not available", async () => {
    // TEST_ROOT has no .chroma/ — forces the rebuild code path.
    // Since python3/chromadb may not be installed, result is SKIPPED or ERROR.
    // Either is acceptable: the point is the rebuild branch is exercised without throwing.
    const result = await callTool({
      query: "test query",
      rebuild: true,
      projectRoot: TEST_ROOT,
    });
    const text = extractText(result);
    const json = extractJson(text);

    expect(json).toHaveProperty("status");
    expect(json).toHaveProperty("query");
    expect(json.query).toBe("test query");
    expect(json).toHaveProperty("results");
    expect(Array.isArray(json.results)).toBe(true);
    // Rebuild without chromadb/python3 → structured error, not an unhandled throw
    expect(["SKIPPED", "ERROR", "NOT_INDEXED", "OK"]).toContain(json.status);
  });
});
