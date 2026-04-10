/**
 * Tests for the doc-readability MCP tool.
 *
 * Mocks node:child_process execFile to avoid requiring Python/textstat.
 * Uses InMemoryTransport to exercise the full MCP tool lifecycle.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock execFile before importing the tool to intercept Python invocation
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Import after mocking
const { registerDocReadabilityTool } = await import(
  "../../../src/tools/doc-readability.js"
);

const OK_STDOUT = JSON.stringify({
  status: "OK",
  file: "/tmp/test.md",
  scores: {
    flesch_ease: 65.5,
    fk_grade: 8.2,
    word_count: 120,
    sentence_count: 10,
    avg_sentence_length: 12.0,
  },
  verdict: "readable",
});

const SKIPPED_STDOUT = JSON.stringify({
  status: "SKIPPED",
  reason: "textstat not installed: pip install textstat",
});

describe("doc-readability tool", () => {
  let client: Client;
  let server: McpServer;
  let tmpDir: string;

  beforeAll(async () => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    registerDocReadabilityTool(server);

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

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `doc-readability-${process.pid}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    mockExecFile.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "doc-readability");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("returns OK with scores for a markdown file", async () => {
    const mdFile = path.join(tmpDir, "test.md");
    await writeFile(
      mdFile,
      "# Test Doc\n\nThis is a simple test document. It has short sentences. Easy to read.",
    );

    // Simulate promisify wrapping: execFile callback is called internally by promisify
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: OK_STDOUT, stderr: "" });
      },
    );

    const result = await client.callTool({
      name: "doc-readability",
      arguments: { path: mdFile },
    });

    expect(result.content).toHaveLength(1);
    const content = result.content[0] as { type: string; text: string };
    expect(content.type).toBe("text");

    const parsed = JSON.parse(content.text) as Record<string, unknown>;
    expect(parsed.status).toBe("OK");
    expect(parsed).toHaveProperty("scores");
    expect(parsed).toHaveProperty("verdict");

    const scores = parsed.scores as Record<string, unknown>;
    expect(scores).toHaveProperty("flesch_ease");
    expect(scores).toHaveProperty("fk_grade");
    expect(scores).toHaveProperty("word_count");
    expect(scores).toHaveProperty("sentence_count");
    expect(scores).toHaveProperty("avg_sentence_length");
  });

  it("returns SKIPPED when textstat is not installed", async () => {
    const mdFile = path.join(tmpDir, "test.md");
    await writeFile(mdFile, "# Doc\n\nSome content.");

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: SKIPPED_STDOUT, stderr: "" });
      },
    );

    const result = await client.callTool({
      name: "doc-readability",
      arguments: { path: mdFile },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;

    expect(parsed.status).toBe("SKIPPED");
    expect(parsed).toHaveProperty("reason");
  });

  it("returns ERROR for a non-existent file", async () => {
    const missingFile = path.join(tmpDir, "does-not-exist.md");

    // Simulate Python raising FileNotFoundError (non-zero exit, stderr contains FileNotFoundError)
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: Error) => void) => {
        const err = new Error(
          "Command failed with exit code 1\nFileNotFoundError: [Errno 2] No such file or directory",
        );
        callback(err);
      },
    );

    const result = await client.callTool({
      name: "doc-readability",
      arguments: { path: missingFile },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;

    expect(parsed.status).toBe("ERROR");
    expect(parsed).toHaveProperty("file");
    expect(parsed).toHaveProperty("reason");
  });

  it("returns SKIPPED when python3 binary is not found", async () => {
    const mdFile = path.join(tmpDir, "test.md");
    await writeFile(mdFile, "# Doc\n\nContent here.");

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: Error) => void) => {
        const err = new Error("spawn python3 ENOENT");
        (err as NodeJS.ErrnoException).code = "ENOENT";
        callback(err);
      },
    );

    const result = await client.callTool({
      name: "doc-readability",
      arguments: { path: mdFile },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;

    expect(parsed.status).toBe("SKIPPED");
    expect(parsed).toHaveProperty("reason");
  });

  it("response has expected structure for OK result", async () => {
    const mdFile = path.join(tmpDir, "structured.md");
    await writeFile(mdFile, "# Structured test\n\nThis validates the response shape.");

    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: OK_STDOUT, stderr: "" });
      },
    );

    const result = await client.callTool({
      name: "doc-readability",
      arguments: { path: mdFile },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty("type", "text");

    const parsed = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    ) as Record<string, unknown>;

    // Required top-level fields
    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("file");
    expect(parsed).toHaveProperty("scores");
    expect(parsed).toHaveProperty("verdict");
    expect(["readable", "complex", "very_complex"]).toContain(parsed.verdict);
  });
});
