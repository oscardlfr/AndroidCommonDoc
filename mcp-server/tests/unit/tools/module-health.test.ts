/**
 * Tests for the module-health MCP tool.
 *
 * Uses temp project directories with settings.gradle.kts, module dirs,
 * and .kt files to verify health metric collection.
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
import { registerModuleHealthTool } from "../../../src/tools/module-health.js";
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

const TEST_ROOT = path.join(
  os.tmpdir(),
  "module-health-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function createProject(): void {
  ensureClean();

  // settings.gradle.kts with two modules
  mkdirSync(PROJECT_ROOT, { recursive: true });
  writeFileSync(
    path.join(PROJECT_ROOT, "settings.gradle.kts"),
    `
rootProject.name = "test-project"
include(":core:network")
include(":app")
`,
  );

  // :core:network module
  const networkSrc = path.join(
    PROJECT_ROOT,
    "core",
    "network",
    "src",
    "commonMain",
    "kotlin",
  );
  const networkTest = path.join(
    PROJECT_ROOT,
    "core",
    "network",
    "src",
    "commonTest",
    "kotlin",
  );
  mkdirSync(networkSrc, { recursive: true });
  mkdirSync(networkTest, { recursive: true });

  writeFileSync(
    path.join(networkSrc, "HttpClient.kt"),
    "class HttpClient {\n  fun get() {}\n  fun post() {}\n}\n",
  );
  writeFileSync(
    path.join(networkSrc, "ApiService.kt"),
    "class ApiService {\n  fun call() {}\n}\n",
  );
  writeFileSync(
    path.join(networkTest, "HttpClientTest.kt"),
    "class HttpClientTest {\n  fun testGet() {}\n}\n",
  );

  writeFileSync(
    path.join(PROJECT_ROOT, "core", "network", "build.gradle.kts"),
    `
plugins {
  id("com.android.library")
}
dependencies {
  implementation(project(":core:model"))
  api(project(":core:common"))
}
`,
  );

  // :app module
  const appSrc = path.join(
    PROJECT_ROOT,
    "app",
    "src",
    "main",
    "kotlin",
  );
  mkdirSync(appSrc, { recursive: true });

  writeFileSync(
    path.join(appSrc, "MainActivity.kt"),
    "class MainActivity {\n  fun onCreate() {}\n}\n",
  );

  writeFileSync(
    path.join(PROJECT_ROOT, "app", "build.gradle.kts"),
    `
plugins {
  id("com.android.application")
}
dependencies {
  implementation(project(":core:network"))
}
`,
  );
}

// ── MCP client/server lifecycle ─────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerModuleHealthTool(server, limiter);

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
  createProject();
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
    name: "module-health",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("module-health tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "module-health");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("returns markdown with module names", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("Module Health Report");
    expect(text).toContain(":core:network");
    expect(text).toContain(":app");
    expect(text).toContain("Src Files");
    expect(text).toContain("Test Files");
  });

  it("returns json with module metrics", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.modules).toHaveLength(2);

    const networkMod = parsed.modules.find(
      (m: { module: string }) => m.module === ":core:network",
    );
    expect(networkMod).toBeDefined();
    expect(networkMod.src_files).toBe(2);
    expect(networkMod.test_files).toBe(1);
    expect(networkMod.dep_count).toBe(2);
    expect(networkMod.loc).toBeGreaterThan(0);

    const appMod = parsed.modules.find(
      (m: { module: string }) => m.module === ":app",
    );
    expect(appMod).toBeDefined();
    expect(appMod.src_files).toBe(1);
    expect(appMod.test_files).toBe(0);
    expect(appMod.dep_count).toBe(1);
  });

  it("filters to specific modules when provided", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: [":app"],
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.modules).toHaveLength(1);
    expect(parsed.modules[0].module).toBe(":app");
  });

  it("handles missing modules gracefully", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      modules: [":nonexistent"],
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    // :nonexistent is not in settings.gradle.kts, so filter returns empty
    expect(parsed.modules).toHaveLength(0);
  });

  it("returns error for missing settings.gradle.kts", async () => {
    const result = await callTool({
      project_root: path.join(TEST_ROOT, "nonexistent-project"),
      format: "json",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ERROR");
    expect(parsed.summary).toContain("settings.gradle.kts");
  });

  it("returns both formats when format is 'both'", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "both",
    });

    const text = extractText(result);
    // Should contain JSON (modules array) and markdown (table header)
    expect(text).toContain('"modules"');
    expect(text).toContain("Module Health Report");
    expect(text).toContain("---"); // separator
  });
});
