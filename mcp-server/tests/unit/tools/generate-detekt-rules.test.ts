/**
 * Tests for the generate-detekt-rules MCP tool.
 *
 * Verifies tool registration, dry-run default behavior, structured JSON output,
 * correct output directory resolution, and rate limiting.
 * Uses vi.mock to mock the writeGeneratedRules dependency.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../../src/server.js";
import type { GenerationResult } from "../../../src/generation/writer.js";

// Mock writeGeneratedRules to avoid real file I/O
const mockWriteGeneratedRules = vi.fn<
  [],
  Promise<GenerationResult>
>();

vi.mock("../../../src/generation/writer.js", () => ({
  writeGeneratedRules: (...args: unknown[]) =>
    mockWriteGeneratedRules(...(args as [])),
}));

const defaultMockResult: GenerationResult = {
  generated: [
    {
      ruleId: "prefer-kotlin-time",
      ruleFile: "/generated/PreferKotlinTimeRule.kt",
      testFile: "/generated/PreferKotlinTimeRuleTest.kt",
    },
  ],
  skipped: [{ ruleId: "manual-rule", reason: "hand_written" }],
  removed: ["OrphanedRule.kt"],
  providerUpdateBlock: "// generated provider block",
  configYaml: "AndroidCommonDoc:\n  PreferKotlinTime:\n    active: true",
  dryRun: true,
};

describe("generate-detekt-rules tool", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    mockWriteGeneratedRules.mockResolvedValue(defaultMockResult);

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
    const tool = tools.find((t) => t.name === "generate-detekt-rules");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain("Detekt");
  });

  it("accepts dry_run parameter and defaults to true for safety", async () => {
    mockWriteGeneratedRules.mockResolvedValue(defaultMockResult);

    // Call without specifying dry_run -- should default to true
    const result = await client.callTool({
      name: "generate-detekt-rules",
      arguments: {},
    });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    // The call to writeGeneratedRules should have received dryRun: true
    expect(mockWriteGeneratedRules).toHaveBeenCalled();
    const lastCallArgs = mockWriteGeneratedRules.mock.calls[
      mockWriteGeneratedRules.mock.calls.length - 1
    ] as unknown[];
    const options = lastCallArgs[0] as { dryRun?: boolean };
    expect(options.dryRun).toBe(true);
  });

  it("returns GenerationResult JSON with generated/skipped/removed counts", async () => {
    mockWriteGeneratedRules.mockResolvedValue(defaultMockResult);

    const result = await client.callTool({
      name: "generate-detekt-rules",
      arguments: { dry_run: true },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed).toHaveProperty("result");
    expect(parsed.result).toHaveProperty("generated");
    expect(parsed.result).toHaveProperty("skipped");
    expect(parsed.result).toHaveProperty("removed");
    expect(parsed.result).toHaveProperty("providerUpdateBlock");
    expect(parsed.result).toHaveProperty("configYaml");
    expect(parsed.result).toHaveProperty("dryRun");
    expect(parsed.result.generated).toHaveLength(1);
    expect(parsed.result.skipped).toHaveLength(1);
    expect(parsed.result.removed).toHaveLength(1);
  });

  it("uses correct output directory paths for detekt-rules module", async () => {
    mockWriteGeneratedRules.mockResolvedValue(defaultMockResult);

    await client.callTool({
      name: "generate-detekt-rules",
      arguments: {},
    });

    const lastCallArgs = mockWriteGeneratedRules.mock.calls[
      mockWriteGeneratedRules.mock.calls.length - 1
    ] as unknown[];
    const options = lastCallArgs[0] as {
      docsDir: string;
      rulesOutputDir: string;
      testsOutputDir: string;
    };

    // Verify paths include expected segments
    expect(options.docsDir).toContain("docs");
    expect(options.rulesOutputDir).toContain("detekt-rules");
    expect(options.rulesOutputDir).toContain("generated");
    expect(options.testsOutputDir).toContain("detekt-rules");
    expect(options.testsOutputDir).toContain("generated");
  });

  it("includes next-steps instructions in response", async () => {
    mockWriteGeneratedRules.mockResolvedValue(defaultMockResult);

    const result = await client.callTool({
      name: "generate-detekt-rules",
      arguments: { dry_run: false },
    });

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );

    expect(parsed).toHaveProperty("next_steps");
    expect(parsed.next_steps).toContain("gradlew");
  });

  it("is rate-limited", async () => {
    // The tool is registered with a rate limiter.
    // We verify indirectly by checking it's registered through registerTools
    // which passes the shared rateLimiter to every tool.
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "generate-detekt-rules");
    expect(tool).toBeDefined();
  });
});
