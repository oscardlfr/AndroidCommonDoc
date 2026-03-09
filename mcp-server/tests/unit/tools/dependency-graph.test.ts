/**
 * Tests for the dependency-graph MCP tool.
 *
 * Uses temp project directories with settings.gradle.kts and per-module
 * build.gradle.kts files to verify graph construction, Mermaid output,
 * and cycle detection.
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
import { registerDependencyGraphTool, detectCycles } from "../../../src/tools/dependency-graph.js";
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
  "dep-graph-test-" + process.pid,
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function createAcyclicProject(): string {
  const projectRoot = path.join(TEST_ROOT, "acyclic-project");
  mkdirSync(projectRoot, { recursive: true });

  // settings.gradle.kts
  writeFileSync(
    path.join(projectRoot, "settings.gradle.kts"),
    `
rootProject.name = "acyclic"
include(":app")
include(":core:network")
include(":core:model")
`,
  );

  // :app depends on :core:network
  mkdirSync(path.join(projectRoot, "app"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "app", "build.gradle.kts"),
    `
dependencies {
  implementation(project(":core:network"))
}
`,
  );

  // :core:network depends on :core:model
  mkdirSync(path.join(projectRoot, "core", "network"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "core", "network", "build.gradle.kts"),
    `
dependencies {
  api(project(":core:model"))
}
`,
  );

  // :core:model has no project deps
  mkdirSync(path.join(projectRoot, "core", "model"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "core", "model", "build.gradle.kts"),
    `
dependencies {
  implementation("org.jetbrains.kotlin:kotlin-stdlib")
}
`,
  );

  return projectRoot;
}

function createCyclicProject(): string {
  const projectRoot = path.join(TEST_ROOT, "cyclic-project");
  mkdirSync(projectRoot, { recursive: true });

  writeFileSync(
    path.join(projectRoot, "settings.gradle.kts"),
    `
include(":moduleA")
include(":moduleB")
include(":moduleC")
`,
  );

  // A -> B
  mkdirSync(path.join(projectRoot, "moduleA"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "moduleA", "build.gradle.kts"),
    `
dependencies {
  implementation(project(":moduleB"))
}
`,
  );

  // B -> C
  mkdirSync(path.join(projectRoot, "moduleB"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "moduleB", "build.gradle.kts"),
    `
dependencies {
  implementation(project(":moduleC"))
}
`,
  );

  // C -> A (creates cycle)
  mkdirSync(path.join(projectRoot, "moduleC"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "moduleC", "build.gradle.kts"),
    `
dependencies {
  implementation(project(":moduleA"))
}
`,
  );

  return projectRoot;
}

// ── MCP client/server lifecycle ─────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerDependencyGraphTool(server, limiter);

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

// ── Helpers ─────────────────────────────────────────────────────────────────

function callTool(args: Record<string, unknown>) {
  return client.callTool({
    name: "dependency-graph",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("dependency-graph tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "dependency-graph");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
  });

  it("produces valid mermaid for acyclic graph", async () => {
    const projectRoot = createAcyclicProject();

    const result = await callTool({
      project_root: projectRoot,
      output: "mermaid",
    });

    const text = extractText(result);
    expect(text).toContain("graph TD");
    expect(text).toContain(":app --> :core:network");
    expect(text).toContain(":core:network --> :core:model");
    expect(text).not.toContain("Cycles Detected");
  });

  it("returns adjacency list JSON for acyclic graph", async () => {
    const projectRoot = createAcyclicProject();

    const result = await callTool({
      project_root: projectRoot,
      output: "adjacency",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);

    expect(parsed.adjacency[":app"]).toEqual([":core:network"]);
    expect(parsed.adjacency[":core:network"]).toEqual([":core:model"]);
    expect(parsed.adjacency[":core:model"]).toEqual([]);

    expect(parsed.stats.total_modules).toBe(3);
    expect(parsed.stats.cycles).toHaveLength(0);
    expect(parsed.stats.leaf_modules).toContain(":core:model");
  });

  it("reports cycles in cyclic graph", async () => {
    const projectRoot = createCyclicProject();

    const result = await callTool({
      project_root: projectRoot,
      output: "mermaid",
      detect_cycles: true,
    });

    const text = extractText(result);
    expect(text).toContain("Cycles Detected");
    // The cycle should contain all three modules
    expect(text).toContain(":moduleA");
    expect(text).toContain(":moduleB");
    expect(text).toContain(":moduleC");
  });

  it("reports most-depended-on modules", async () => {
    const projectRoot = createAcyclicProject();

    const result = await callTool({
      project_root: projectRoot,
      output: "mermaid",
    });

    const text = extractText(result);
    expect(text).toContain("Most Depended On");
    // :core:network is depended on by :app (1 incoming)
    // :core:model is depended on by :core:network (1 incoming)
    expect(text).toContain(":core:network");
    expect(text).toContain(":core:model");
  });

  it("returns error for missing settings.gradle.kts", async () => {
    const result = await callTool({
      project_root: path.join(TEST_ROOT, "nonexistent"),
      output: "adjacency",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ERROR");
    expect(parsed.summary).toContain("settings.gradle.kts");
  });

  it("handles modules with no build.gradle.kts gracefully", async () => {
    const projectRoot = path.join(TEST_ROOT, "no-build");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      path.join(projectRoot, "settings.gradle.kts"),
      'include(":bare-module")\n',
    );
    mkdirSync(path.join(projectRoot, "bare-module"), { recursive: true });
    // No build.gradle.kts for bare-module

    const result = await callTool({
      project_root: projectRoot,
      output: "adjacency",
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);
    expect(parsed.adjacency[":bare-module"]).toEqual([]);
    expect(parsed.stats.total_modules).toBe(1);
  });

  it("skips cycle detection when detect_cycles is false", async () => {
    const projectRoot = createCyclicProject();

    const result = await callTool({
      project_root: projectRoot,
      output: "adjacency",
      detect_cycles: false,
    });

    const text = extractText(result);
    const parsed = JSON.parse(text);
    expect(parsed.stats.cycles).toHaveLength(0);
  });
});

// ── Unit tests for detectCycles function ────────────────────────────────────

describe("detectCycles", () => {
  it("returns empty array for acyclic graph", () => {
    const adj: Record<string, string[]> = {
      A: ["B"],
      B: ["C"],
      C: [],
    };
    expect(detectCycles(adj)).toHaveLength(0);
  });

  it("detects a simple cycle", () => {
    const adj: Record<string, string[]> = {
      A: ["B"],
      B: ["A"],
    };
    const cycles = detectCycles(adj);
    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should contain A and B
    const flatCycle = cycles.flat();
    expect(flatCycle).toContain("A");
    expect(flatCycle).toContain("B");
  });

  it("detects a three-node cycle", () => {
    const adj: Record<string, string[]> = {
      A: ["B"],
      B: ["C"],
      C: ["A"],
    };
    const cycles = detectCycles(adj);
    expect(cycles.length).toBeGreaterThan(0);
    const flatCycle = cycles.flat();
    expect(flatCycle).toContain("A");
    expect(flatCycle).toContain("B");
    expect(flatCycle).toContain("C");
  });

  it("handles graph with no edges", () => {
    const adj: Record<string, string[]> = {
      A: [],
      B: [],
    };
    expect(detectCycles(adj)).toHaveLength(0);
  });

  it("handles empty graph", () => {
    expect(detectCycles({})).toHaveLength(0);
  });
});
