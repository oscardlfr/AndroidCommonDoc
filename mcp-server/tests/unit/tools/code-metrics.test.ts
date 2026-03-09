/**
 * Tests for the code-metrics MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temporary project structures with .kt files to test
 * metric computation and output formatting.
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
import { registerCodeMetricsTool } from "../../../src/tools/code-metrics.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "code-metrics-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(PROJECT_ROOT, { recursive: true });
}

function writeKtFile(modulePath: string, fileName: string, content: string): void {
  const dir = path.join(PROJECT_ROOT, modulePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content, "utf-8");
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerCodeMetricsTool(server, limiter);

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
    name: "code-metrics",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("code-metrics tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "code-metrics");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("metric");
  });

  it("returns no-files message when project has no Kotlin files", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: ["."],
      persist: false,
    });

    const text = extractText(result);
    expect(text).toContain("No Kotlin files found");
  });

  it("computes metrics for a single module", async () => {
    // Create source files
    writeKtFile("core/src/commonMain/kotlin", "Main.kt", [
      "package com.example",
      "",
      "fun greet(name: String): String {",
      '    return "Hello, $name"',
      "}",
      "",
      "fun farewell(name: String): String {",
      '    return "Goodbye, $name"',
      "}",
    ].join("\n"));

    writeKtFile("core/src/commonMain/kotlin", "Utils.kt", [
      "package com.example",
      "",
      "fun formatName(first: String, last: String): String {",
      '    return "$first $last"',
      "}",
    ].join("\n"));

    // Create a test file
    writeKtFile("core/src/test/kotlin", "MainTest.kt", [
      "package com.example",
      "",
      "class MainTest {",
      "    fun testGreet() { }",
      "}",
    ].join("\n"));

    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: ["core"],
      format: "json",
      persist: false,
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.modules).toHaveLength(1);
    const mod = parsed.modules[0];
    expect(mod.module).toBe("core");
    expect(mod.kt_files).toBe(2); // Main.kt + Utils.kt (src only)
    expect(mod.test_kt_files).toBe(1); // MainTest.kt
    expect(mod.loc).toBeGreaterThan(0);
    expect(mod.public_functions).toBe(3); // greet, farewell, formatName
  });

  it("markdown output has expected table columns", async () => {
    writeKtFile("app/src/commonMain/kotlin", "App.kt", [
      "package com.example",
      "",
      "fun main() {",
      "    println(\"Hello\")",
      "}",
    ].join("\n"));

    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: ["app"],
      format: "markdown",
      persist: false,
    });

    const text = extractText(result);
    expect(text).toContain("## Code Metrics");
    expect(text).toContain("| Module |");
    expect(text).toContain(".kt Files");
    expect(text).toContain("Test Files");
    expect(text).toContain("LOC");
    expect(text).toContain("Public Fns");
    expect(text).toContain("Max Nesting");
    expect(text).toContain("Avg Fn Length");
    expect(text).toContain("**Total**");
  });

  it("computes nesting depth correctly", async () => {
    writeKtFile("mod/src/commonMain/kotlin", "Nested.kt", [
      "package com.example",
      "",
      "fun deeplyNested() {",
      "    if (true) {",
      "        for (i in 1..10) {",
      "            if (i > 5) {",
      "                println(i)",
      "            }",
      "        }",
      "    }",
      "}",
    ].join("\n"));

    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: ["mod"],
      format: "json",
      persist: false,
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.modules[0].max_nesting_depth).toBeGreaterThanOrEqual(4);
  });

  it("persists metrics to audit-log.jsonl when persist=true", async () => {
    writeKtFile("lib/src/commonMain/kotlin", "Lib.kt", [
      "package com.example",
      "fun compute() = 42",
    ].join("\n"));

    await callTool({
      project_root: PROJECT_ROOT,
      modules: ["lib"],
      format: "json",
      persist: true,
    });

    const logPath = path.join(PROJECT_ROOT, ".androidcommondoc", "audit-log.jsonl");
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event).toBe("code_metrics");
    expect(entry.data.modules).toBe(1);
    expect(entry.data.total_kt_files).toBeGreaterThanOrEqual(1);
  });

  it("handles multiple modules", async () => {
    writeKtFile("core/src/commonMain/kotlin", "Core.kt", [
      "package com.example.core",
      "fun coreFunction() = 1",
    ].join("\n"));

    writeKtFile("app/src/commonMain/kotlin", "App.kt", [
      "package com.example.app",
      "fun appFunction() = 2",
      "fun otherFunction() = 3",
    ].join("\n"));

    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: ["core", "app"],
      format: "json",
      persist: false,
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.modules).toHaveLength(2);
    const names = parsed.modules.map((m: { module: string }) => m.module);
    expect(names).toContain("core");
    expect(names).toContain("app");
  });

  it("both format returns json and markdown", async () => {
    writeKtFile("both/src/commonMain/kotlin", "Both.kt", [
      "package com.example",
      "fun test() = true",
    ].join("\n"));

    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: ["both"],
      format: "both",
      persist: false,
    });

    const text = extractText(result);
    expect(text).toContain("```json");
    expect(text).toContain("---");
    expect(text).toContain("## Code Metrics");
  });
});
