/**
 * Tests for the vault-status MCP tool.
 *
 * Verifies tool registration, structured health info response,
 * and error handling. Uses vi.mock to mock getVaultStatus.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";

// Mock sync-engine to control getVaultStatus
const mockGetVaultStatus = vi.fn();

vi.mock("../../../src/vault/sync-engine.js", () => ({
  syncVault: vi.fn(),
  initVault: vi.fn(),
  cleanOrphans: vi.fn(),
  getVaultStatus: (...args: unknown[]) => mockGetVaultStatus(...args),
}));

const defaultStatus = {
  configured: true,
  vaultPath: "/home/user/.obsidian-vault",
  lastSync: "2026-03-14T01:00:00Z",
  fileCount: 42,
  orphanCount: 3,
  projects: ["MyProject", "MyApp"],
};

describe("vault-status tool", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    mockGetVaultStatus.mockResolvedValue(defaultStatus);

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

  beforeEach(() => {
    mockGetVaultStatus.mockClear();
    mockGetVaultStatus.mockResolvedValue(defaultStatus);
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  it("is listed as a registered tool with description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "vault-status");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain("vault");
  });

  it("returns configured, vaultPath, lastSync, fileCount, orphanCount, projects", async () => {
    const result = await client.callTool({
      name: "vault-status",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.configured).toBe(true);
    expect(parsed.vault_path).toBe("/home/user/.obsidian-vault");
    expect(parsed.last_sync).toBe("2026-03-14T01:00:00Z");
    expect(parsed.file_count).toBe(42);
    expect(parsed.orphan_count).toBe(3);
    expect(parsed.projects).toEqual(["MyProject", "MyApp"]);
  });

  it("returns error text on exception (not crash)", async () => {
    mockGetVaultStatus.mockRejectedValue(new Error("Config missing"));

    const result = await client.callTool({
      name: "vault-status",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.error).toContain("Config missing");
  });
});
