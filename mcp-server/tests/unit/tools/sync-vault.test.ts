/**
 * Tests for the sync-vault MCP tool.
 *
 * Verifies tool registration, mode dispatching (init/sync/clean),
 * structured JSON responses, vault_path override, and error handling.
 * Uses vi.mock to mock sync-engine functions.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";
import type { SyncResult } from "../../../src/vault/types.js";

// Mock sync-engine functions to avoid real file I/O
const mockSyncVault = vi.fn<[], Promise<SyncResult>>();
const mockInitVault = vi.fn<[], Promise<SyncResult>>();
const mockCleanOrphans = vi.fn<[], Promise<SyncResult>>();

const mockGetVaultStatus = vi.fn();

vi.mock("../../../src/vault/sync-engine.js", () => ({
  syncVault: (...args: unknown[]) => mockSyncVault(...(args as [])),
  initVault: (...args: unknown[]) => mockInitVault(...(args as [])),
  cleanOrphans: (...args: unknown[]) => mockCleanOrphans(...(args as [])),
  getVaultStatus: (...args: unknown[]) => mockGetVaultStatus(...args),
}));

const defaultSyncResult: SyncResult = {
  written: 5,
  unchanged: 10,
  removed: 0,
  errors: [],
  duration: 1234,
};

describe("sync-vault tool", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    mockSyncVault.mockResolvedValue(defaultSyncResult);
    mockInitVault.mockResolvedValue(defaultSyncResult);
    mockCleanOrphans.mockResolvedValue(defaultSyncResult);
    mockGetVaultStatus.mockResolvedValue({
      configured: true,
      vaultPath: "/test/vault",
      lastSync: "2026-03-14T01:00:00Z",
      fileCount: 15,
      orphanCount: 0,
      projects: ["test-project"],
      layers: { L0: 10, L1: 3, L2: 2 },
    });

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
    mockSyncVault.mockClear();
    mockInitVault.mockClear();
    mockCleanOrphans.mockClear();
    mockGetVaultStatus.mockClear();
    mockSyncVault.mockResolvedValue(defaultSyncResult);
    mockInitVault.mockResolvedValue(defaultSyncResult);
    mockCleanOrphans.mockResolvedValue(defaultSyncResult);
    mockGetVaultStatus.mockResolvedValue({
      configured: true,
      vaultPath: "/test/vault",
      lastSync: "2026-03-14T01:00:00Z",
      fileCount: 15,
      orphanCount: 0,
      projects: ["test-project"],
      layers: { L0: 10, L1: 3, L2: 2 },
    });
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  it("is listed as a registered tool with description", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "sync-vault");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain("Obsidian");
  });

  it("with mode 'init' calls initVault and returns structured result", async () => {
    const initResult: SyncResult = {
      written: 20,
      unchanged: 0,
      removed: 0,
      errors: [],
      duration: 3000,
    };
    mockInitVault.mockResolvedValue(initResult);

    const result = await client.callTool({
      name: "sync-vault",
      arguments: { mode: "init" },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.mode).toBe("init");
    expect(parsed.result).toEqual(initResult);
    expect(parsed.message).toContain("init");
    expect(parsed.message).toContain("20 written");
    expect(mockInitVault).toHaveBeenCalled();
  });

  it("with mode 'sync' (default) calls syncVault and returns SyncResult JSON", async () => {
    const result = await client.callTool({
      name: "sync-vault",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.mode).toBe("sync");
    expect(parsed.result).toEqual(defaultSyncResult);
    expect(parsed.message).toContain("sync");
    expect(mockSyncVault).toHaveBeenCalled();
  });

  it("with mode 'clean' calls cleanOrphans and returns result with removed count", async () => {
    const cleanResult: SyncResult = {
      written: 3,
      unchanged: 8,
      removed: 5,
      errors: [],
      duration: 2000,
    };
    mockCleanOrphans.mockResolvedValue(cleanResult);

    const result = await client.callTool({
      name: "sync-vault",
      arguments: { mode: "clean" },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.mode).toBe("clean");
    expect(parsed.result.removed).toBe(5);
    expect(parsed.message).toContain("clean");
    expect(parsed.message).toContain("5 removed");
    expect(mockCleanOrphans).toHaveBeenCalled();
  });

  it("with optional vault_path override passes it to configOverride", async () => {
    const result = await client.callTool({
      name: "sync-vault",
      arguments: { mode: "sync", vault_path: "/custom/vault" },
    });

    expect(result.content).toHaveLength(1);

    // The mock should have been called with configOverride containing vaultPath
    expect(mockSyncVault).toHaveBeenCalledWith(
      expect.objectContaining({ vaultPath: "/custom/vault" }),
    );
  });

  it("returns error text on exception (not crash)", async () => {
    mockSyncVault.mockRejectedValue(new Error("Disk full"));

    const result = await client.callTool({
      name: "sync-vault",
      arguments: { mode: "sync" },
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed.error).toContain("Disk full");
  });
});
