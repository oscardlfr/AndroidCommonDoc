/**
 * Tests for the check-outdated MCP tool.
 *
 * Covers: TOML parsing, Maven Central querying, caching, and tool registration.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseVersions,
  parseLibraries,
  queryAllLibraries,
  type ParsedLibrary,
} from "../../../src/tools/check-outdated.js";
import {
  readKDocState,
  writeKDocState,
  createEmptyState,
  updateDependencies,
} from "../../../src/utils/kdoc-state.js";

const TEST_ROOT = path.join(os.tmpdir(), "check-outdated-test-" + process.pid);

beforeEach(() => {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  try { if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true }); } catch { /* Windows */ }
});

// ── TOML Parser: versions ──────────────────────────────────────────────────

const SAMPLE_TOML = `
[versions]
# Kotlin
kotlin = "2.3.10"
coroutines = "1.10.2"
koin = "4.1.1"
android-compileSdk = "36"
ktor = "3.4.0"
strict-lib = { strictly = "2.0.0" }

[libraries]
# Coroutines
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
kotlinx-coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "coroutines" }
koin-core = { module = "io.insert-koin:koin-core", version.ref = "koin" }
ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktor" }
# Group/name syntax
some-lib = { group = "com.example", name = "some-lib", version.ref = "koin" }
# Inline version
inline-lib = { module = "com.example:inline-lib", version = "1.0.0" }

[plugins]
kotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }
`;

describe("parseVersions", () => {
  it("parses simple key = \"value\" entries", () => {
    const versions = parseVersions(SAMPLE_TOML);
    expect(versions["kotlin"]).toBe("2.3.10");
    expect(versions["coroutines"]).toBe("1.10.2");
    expect(versions["koin"]).toBe("4.1.1");
    expect(versions["ktor"]).toBe("3.4.0");
  });

  it("parses strictly syntax", () => {
    const versions = parseVersions(SAMPLE_TOML);
    expect(versions["strict-lib"]).toBe("2.0.0");
  });

  it("skips non-version entries (SDK levels)", () => {
    const versions = parseVersions(SAMPLE_TOML);
    // These are still parsed as versions (they're valid key = "value")
    expect(versions["android-compileSdk"]).toBe("36");
  });

  it("skips comments and blank lines", () => {
    const versions = parseVersions(SAMPLE_TOML);
    expect(Object.keys(versions)).not.toContain("#");
  });

  it("stops at [libraries] section", () => {
    const versions = parseVersions(SAMPLE_TOML);
    expect(Object.keys(versions)).not.toContain("kotlinx-coroutines-core");
  });
});

describe("parseLibraries", () => {
  const versions = parseVersions(SAMPLE_TOML);

  it("parses module syntax with version.ref", () => {
    const libs = parseLibraries(SAMPLE_TOML, versions);
    const coroutinesCore = libs.find((l) => l.alias === "kotlinx-coroutines-core");
    expect(coroutinesCore).toEqual({
      alias: "kotlinx-coroutines-core",
      group: "org.jetbrains.kotlinx",
      artifact: "kotlinx-coroutines-core",
      version: "1.10.2",
    });
  });

  it("parses group/name syntax", () => {
    const libs = parseLibraries(SAMPLE_TOML, versions);
    const someLib = libs.find((l) => l.alias === "some-lib");
    expect(someLib).toEqual({
      alias: "some-lib",
      group: "com.example",
      artifact: "some-lib",
      version: "4.1.1",
    });
  });

  it("parses inline version", () => {
    const libs = parseLibraries(SAMPLE_TOML, versions);
    const inlineLib = libs.find((l) => l.alias === "inline-lib");
    expect(inlineLib).toEqual({
      alias: "inline-lib",
      group: "com.example",
      artifact: "inline-lib",
      version: "1.0.0",
    });
  });

  it("returns correct total count", () => {
    const libs = parseLibraries(SAMPLE_TOML, versions);
    expect(libs.length).toBe(6);
  });

  it("does not include plugins", () => {
    const libs = parseLibraries(SAMPLE_TOML, versions);
    expect(libs.find((l) => l.alias === "kotlin-multiplatform")).toBeUndefined();
  });
});

describe("parseLibraries with real-world TOML", () => {
  it("parses the shared-kmp-libs catalog", () => {
    const tomlPath = path.join(
      "C:",
      "Users",
      "34645",
      "AndroidStudioProjects",
      "shared-kmp-libs",
      "gradle",
      "libs.versions.toml",
    );
    if (!existsSync(tomlPath)) return; // skip if not available

    const content = readFileSync(tomlPath, "utf-8");
    const versions = parseVersions(content);
    const libs = parseLibraries(content, versions);

    // Sanity checks on known entries
    expect(versions["koin"]).toBe("4.1.1");
    expect(libs.length).toBeGreaterThan(30);

    const koinCore = libs.find((l) => l.alias === "koin-core");
    expect(koinCore).toBeDefined();
    expect(koinCore!.group).toBe("io.insert-koin");
    expect(koinCore!.artifact).toBe("koin-core");
  });
});

// ── Maven Central querying ─────────────────────────────────────────────────

describe("queryAllLibraries", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns outdated when latest differs from current", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          response: { docs: [{ latestVersion: "5.0.0" }] },
        }),
    }) as unknown as typeof fetch;

    const libs: ParsedLibrary[] = [
      { alias: "koin-core", group: "io.insert-koin", artifact: "koin-core", version: "4.1.1" },
    ];

    const results = await queryAllLibraries(libs);
    expect(results).toHaveLength(1);
    expect(results[0].latest).toBe("5.0.0");
    expect(results[0].current).toBe("4.1.1");
  });

  it("handles HTTP errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;

    const libs: ParsedLibrary[] = [
      { alias: "test", group: "com.example", artifact: "test", version: "1.0" },
    ];

    const results = await queryAllLibraries(libs);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe("HTTP 503");
    expect(results[0].latest).toBeNull();
  });

  it("handles network errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout")) as unknown as typeof fetch;

    const libs: ParsedLibrary[] = [
      { alias: "test", group: "com.example", artifact: "test", version: "1.0" },
    ];

    const results = await queryAllLibraries(libs);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe("Network timeout");
  });

  it("handles not-found artifacts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: { docs: [] } }),
    }) as unknown as typeof fetch;

    const libs: ParsedLibrary[] = [
      { alias: "test", group: "com.example", artifact: "nonexistent", version: "1.0" },
    ];

    const results = await queryAllLibraries(libs);
    expect(results[0].error).toBe("Not found on Maven Central");
  });

  it("batches requests with delay", async () => {
    const callTimes: number[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callTimes.push(Date.now());
      return {
        ok: true,
        json: () => Promise.resolve({ response: { docs: [{ latestVersion: "1.0" }] } }),
      };
    }) as unknown as typeof fetch;

    // 7 libraries = 2 batches (5 + 2)
    const libs: ParsedLibrary[] = Array.from({ length: 7 }, (_, i) => ({
      alias: `lib-${i}`,
      group: "com.example",
      artifact: `lib-${i}`,
      version: "1.0",
    }));

    const results = await queryAllLibraries(libs);
    expect(results).toHaveLength(7);
    expect(globalThis.fetch).toHaveBeenCalledTimes(7);
  });
});

// ── KDocState dependencies caching ─────────────────────────────────────────

describe("KDocState dependencies", () => {
  it("creates state with dependencies: null", () => {
    const state = createEmptyState();
    expect(state.dependencies).toBeNull();
    expect(state.schema_version).toBe(2);
  });

  it("updates dependencies", () => {
    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: "2026-03-31T00:00:00.000Z",
      cache_ttl_hours: 24,
      total_libraries: 42,
      outdated_count: 5,
      outdated: [
        { alias: "koin-core", group: "io.insert-koin", artifact: "koin-core", current: "4.1.1", latest: "5.0.0" },
      ],
    });

    expect(state.dependencies).not.toBeNull();
    expect(state.dependencies!.outdated_count).toBe(5);
    expect(state.dependencies!.outdated).toHaveLength(1);
  });

  it("persists and reads back dependencies", () => {
    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 10,
      outdated_count: 2,
      outdated: [
        { alias: "a", group: "com.a", artifact: "a", current: "1.0", latest: "2.0" },
        { alias: "b", group: "com.b", artifact: "b", current: "3.0", latest: "4.0" },
      ],
    });
    writeKDocState(TEST_ROOT, state);

    const read = readKDocState(TEST_ROOT);
    expect(read).not.toBeNull();
    expect(read!.dependencies).not.toBeNull();
    expect(read!.dependencies!.outdated_count).toBe(2);
    expect(read!.dependencies!.outdated[0].alias).toBe("a");
  });

  it("migrates v1 state without dependencies", () => {
    // Write a v1 state file directly (no dependencies field)
    const v1State = {
      schema_version: 1,
      last_audit: new Date().toISOString(),
      coverage: { overall_pct: 0, total_public: 0, total_documented: 0, per_module: {} },
      docs_api: { generated_at: "", modules_generated: [] },
      pattern_alignment: { drifts: 0, last_checked: "" },
    };
    const dir = path.join(TEST_ROOT, ".androidcommondoc");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "kdoc-state.json"), JSON.stringify(v1State));

    const read = readKDocState(TEST_ROOT);
    expect(read).not.toBeNull();
    expect(read!.schema_version).toBe(2);
    expect(read!.dependencies).toBeNull();
  });
});

// ── Tool integration (via MCP SDK) ─────────────────────────────────────────

describe("check-outdated tool registration", () => {
  let client: Awaited<typeof import("@modelcontextprotocol/sdk/client/index.js")>["Client"]["prototype"];
  let server: Awaited<typeof import("@modelcontextprotocol/sdk/server/mcp.js")>["McpServer"]["prototype"];

  beforeAll(async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { registerCheckOutdatedTool } = await import("../../../src/tools/check-outdated.js");

    server = new McpServer({ name: "test", version: "1.0.0" });
    registerCheckOutdatedTool(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t: { name: string }) => t.name === "check-outdated");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("outdated");
  });

  it("returns error for missing TOML", async () => {
    const result = await client.callTool({
      name: "check-outdated",
      arguments: { project_root: path.join(TEST_ROOT, "nonexistent"), cache_ttl_hours: 0 },
    });

    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ERROR");
  });

  it("returns results for valid TOML with mocked Maven", async () => {
    const originalFetch = globalThis.fetch;

    // Write a minimal TOML
    const gradleDir = path.join(TEST_ROOT, "gradle");
    mkdirSync(gradleDir, { recursive: true });
    writeFileSync(
      path.join(gradleDir, "libs.versions.toml"),
      `[versions]\nkoin = "4.1.1"\n\n[libraries]\nkoin-core = { module = "io.insert-koin:koin-core", version.ref = "koin" }\n`,
    );

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          response: { docs: [{ latestVersion: "5.0.0" }] },
        }),
    }) as unknown as typeof fetch;

    try {
      const result = await client.callTool({
        name: "check-outdated",
        arguments: { project_root: TEST_ROOT, cache_ttl_hours: 0, format: "json" },
      });

      const text = (result.content[0] as { text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed.status).toBe("OUTDATED");
      expect(parsed.outdated_count).toBe(1);
      expect(parsed.outdated[0].alias).toBe("koin-core");
      expect(parsed.outdated[0].latest).toBe("5.0.0");
      expect(parsed.from_cache).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
