/**
 * Tests for the doc-readability MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * No mocking — real execFile invocation. Tests assert structured
 * responses whether python3/textstat is installed or not.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocReadabilityTool } from "../../../src/tools/doc-readability.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "doc-readability-test-" + process.pid,
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

function writeMarkdown(filename: string, content: string): string {
  const filePath = path.join(TEST_ROOT, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerDocReadabilityTool(server, limiter);

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
    // ignore cleanup errors
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function callTool(args: Record<string, unknown>) {
  return client.callTool({
    name: "doc-readability",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("doc-readability tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "doc-readability");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("returns OK with scores or SKIPPED for a readable markdown file", async () => {
    const mdPath = writeMarkdown(
      "simple.md",
      [
        "# Getting Started",
        "",
        "This guide helps you set up the project. Follow the steps below. Each step is clear.",
        "First, install the dependencies. Then, run the build script. Finally, start the server.",
        "The process is simple. Most users finish in five minutes. No special tools are required.",
      ].join("\n"),
    );

    const result = await callTool({ path: mdPath });
    const text = extractText(result);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Tool must return a structured response — either OK (python3+textstat available)
    // or SKIPPED (dependency absent). Never throws or returns undefined.
    expect(["OK", "SKIPPED"]).toContain(parsed.status);

    if (parsed.status === "OK") {
      expect(parsed).toHaveProperty("file");
      expect(parsed).toHaveProperty("scores");
      expect(parsed).toHaveProperty("verdict");

      const scores = parsed.scores as Record<string, unknown>;
      expect(scores).toHaveProperty("flesch_ease");
      expect(scores).toHaveProperty("fk_grade");
      expect(scores).toHaveProperty("word_count");
      expect(scores).toHaveProperty("sentence_count");
      expect(scores).toHaveProperty("avg_sentence_length");
      expect(["readable", "complex", "very_complex"]).toContain(parsed.verdict);
    } else {
      // SKIPPED — dependency not installed
      expect(parsed).toHaveProperty("reason");
    }
  });

  it("returns ERROR for a non-existent file path", async () => {
    const missingPath = path.join(TEST_ROOT, "does-not-exist.md");

    const result = await callTool({ path: missingPath });
    const text = extractText(result);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    expect(parsed.status).toBe("ERROR");
    expect(parsed).toHaveProperty("file");
    expect(parsed).toHaveProperty("reason");
  });

  it("gracefully skips when python3 or textstat is unavailable (SKIPPED not ERROR)", async () => {
    // Write a valid markdown file — if python3/textstat is absent the tool
    // must return SKIPPED with a reason string, not an unhandled exception.
    const mdPath = writeMarkdown(
      "graceful.md",
      "# Graceful degradation\n\nThis file exists and is valid markdown.",
    );

    const result = await callTool({ path: mdPath });
    const text = extractText(result);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Must be a structured JSON response — either OK or SKIPPED, never throws
    expect(["OK", "SKIPPED"]).toContain(parsed.status);
    if (parsed.status === "SKIPPED") {
      expect(typeof parsed.reason).toBe("string");
      expect((parsed.reason as string).length).toBeGreaterThan(0);
    }
  });

  it("response has expected top-level structure for any result", async () => {
    const mdPath = writeMarkdown(
      "structure.md",
      [
        "# Architecture Overview",
        "",
        "This document describes the system architecture.",
        "The system uses a layered approach. Each layer has a clear responsibility.",
        "Data flows from the UI layer to the domain layer. Then to the data layer.",
      ].join("\n"),
    );

    const result = await callTool({ path: mdPath });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty("type", "text");

    const text = extractText(result);
    // Response must be valid JSON with a status field
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toHaveProperty("status");
    expect(typeof parsed.status).toBe("string");
  });

  it("resolves relative path when projectRoot is provided", async () => {
    writeMarkdown(
      "relative.md",
      "# Relative Path Test\n\nShort doc. Tests relative path resolution. Works correctly.",
    );

    const result = await callTool({
      path: "relative.md",
      projectRoot: TEST_ROOT,
    });

    const text = extractText(result);
    const parsed = JSON.parse(text) as Record<string, unknown>;

    // Must resolve correctly — OK or SKIPPED, not ERROR (file exists)
    expect(["OK", "SKIPPED"]).toContain(parsed.status);
  });
});
