/**
 * Tests for the l0-diff MCP tool.
 *
 * Uses temp directories with mock registry.json and l0-manifest.json
 * to verify diff computation between L0 toolkit and downstream projects.
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
import { registerL0DiffTool } from "../../../src/tools/l0-diff.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Fixture management ──────────────────────────────────────────────────────

const TEST_ROOT = path.join(os.tmpdir(), "l0-diff-test-" + process.pid);
const TOOLKIT_ROOT = path.join(TEST_ROOT, "toolkit");
const PROJECT_ROOT = path.join(TEST_ROOT, "project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function createRegistry(entries: Array<{ name: string; hash: string; type: string }>): void {
  const registryDir = path.join(TOOLKIT_ROOT, "skills");
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    path.join(registryDir, "registry.json"),
    JSON.stringify({
      version: 1,
      generated: "2026-03-19T10:00:00Z",
      entries,
    }),
  );
}

function createManifest(
  entries: Array<{ name: string; hash: string; type: string }>,
  synced?: string,
): void {
  const manifestDir = path.join(PROJECT_ROOT, ".androidcommondoc");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "l0-manifest.json"),
    JSON.stringify({
      version: 1,
      synced: synced ?? "2026-03-19T09:00:00Z",
      entries,
    }),
  );
}

// ── MCP client/server lifecycle ─────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerL0DiffTool(server, limiter);

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
  mkdirSync(PROJECT_ROOT, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function callTool(args: Record<string, unknown>) {
  return client.callTool({
    name: "l0-diff",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("l0-diff tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "l0-diff");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("detects new entries not in manifest", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
      { name: "skill-b", hash: "sha256:bbb", type: "skill" },
    ]);
    createManifest([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.new_count).toBe(1);
    expect(parsed.unchanged_count).toBe(1);
    expect(parsed.updated_count).toBe(0);
    expect(parsed.removed_count).toBe(0);

    const newEntry = parsed.entries.find(
      (e: { name: string; status: string }) =>
        e.name === "skill-b" && e.status === "new",
    );
    expect(newEntry).toBeDefined();
  });

  it("detects hash mismatch as updated", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa-new", type: "skill" },
    ]);
    createManifest([
      { name: "skill-a", hash: "sha256:aaa-old", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.updated_count).toBe(1);
    expect(parsed.new_count).toBe(0);

    const updatedEntry = parsed.entries.find(
      (e: { name: string; status: string }) =>
        e.name === "skill-a" && e.status === "updated",
    );
    expect(updatedEntry).toBeDefined();
    expect(updatedEntry.registry_hash).toBe("sha256:aaa-new");
    expect(updatedEntry.manifest_hash).toBe("sha256:aaa-old");
  });

  it("detects removed entries (in manifest but not registry)", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
    ]);
    createManifest([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
      { name: "skill-removed", hash: "sha256:rrr", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.removed_count).toBe(1);
    expect(parsed.unchanged_count).toBe(1);

    const removed = parsed.entries.find(
      (e: { name: string; status: string }) =>
        e.name === "skill-removed" && e.status === "removed",
    );
    expect(removed).toBeDefined();
  });

  it("reports all unchanged when hashes match", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
      { name: "skill-b", hash: "sha256:bbb", type: "skill" },
    ]);
    createManifest([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
      { name: "skill-b", hash: "sha256:bbb", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.unchanged_count).toBe(2);
    expect(parsed.new_count).toBe(0);
    expect(parsed.updated_count).toBe(0);
    expect(parsed.removed_count).toBe(0);
  });

  it("handles missing manifest gracefully (all entries are new)", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
      { name: "skill-b", hash: "sha256:bbb", type: "skill" },
    ]);
    // No manifest created

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.new_count).toBe(2);
    expect(parsed.manifest_count).toBe(0);
    expect(parsed.unchanged_count).toBe(0);
  });

  it("returns markdown with actionable entries table", async () => {
    createRegistry([
      { name: "skill-new", hash: "sha256:nnn", type: "skill" },
      { name: "skill-same", hash: "sha256:sss", type: "skill" },
    ]);
    createManifest([
      { name: "skill-same", hash: "sha256:sss", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("L0 Diff Report");
    expect(text).toContain("skill-new");
    expect(text).toContain("not in manifest");
    // Unchanged entries should NOT appear in the actionable table
    expect(text).not.toContain("skill-same");
  });

  it("reports 'All entries are in sync' when nothing changed", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
    ]);
    createManifest([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("All entries are in sync");
  });

  it("returns error when registry.json is missing", async () => {
    // No registry created, no toolkit dir
    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: path.join(TEST_ROOT, "nonexistent-toolkit"),
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ERROR");
    expect(parsed.summary).toContain("registry.json");
  });

  it("returns both formats when format is 'both'", async () => {
    createRegistry([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
    ]);
    createManifest([
      { name: "skill-a", hash: "sha256:aaa", type: "skill" },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      toolkit_root: TOOLKIT_ROOT,
      format: "both",
    });

    const text = extractText(result);
    expect(text).toContain('"unchanged_count"');
    expect(text).toContain("L0 Diff Report");
    expect(text).toContain("---");
  });
});
