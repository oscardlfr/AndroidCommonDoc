/**
 * Tests for the gradle-config-lint MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temp Gradle projects with settings.gradle.kts and module
 * build.gradle.kts files to test lint detection.
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
import { registerGradleConfigLintTool } from "../../../src/tools/gradle-config-lint.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "gradle-config-lint-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(PROJECT_ROOT, { recursive: true });
}

function writeSettings(modules: string[]): void {
  const includes = modules.map((m) => `include("${m}")`).join("\n");
  writeFileSync(
    path.join(PROJECT_ROOT, "settings.gradle.kts"),
    includes,
    "utf-8",
  );
}

function writeModuleBuild(modulePath: string, content: string): void {
  const moduleDir = path.join(
    PROJECT_ROOT,
    modulePath.replace(/^:/, "").replace(/:/g, "/"),
  );
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(path.join(moduleDir, "build.gradle.kts"), content, "utf-8");
}

function writeRootBuild(content: string): void {
  writeFileSync(
    path.join(PROJECT_ROOT, "build.gradle.kts"),
    content,
    "utf-8",
  );
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerGradleConfigLintTool(server, limiter);

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
    name: "gradle-config-lint",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

function extractJson(text: string): Record<string, unknown> {
  // JSON is after the markdown separator and inside code fence
  const jsonMatch = text.match(/```json\n([\s\S]+?)\n```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }
  return JSON.parse(text);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("gradle-config-lint tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "gradle-config-lint");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Gradle");
  });

  it("returns error when settings.gradle.kts is missing", async () => {
    const result = await callTool({
      project_root: path.join(TEST_ROOT, "nonexistent"),
    });

    const text = extractText(result);
    expect(text).toContain("Could not read settings.gradle.kts");
    expect(result.isError).toBe(true);
  });

  it("detects hardcoded versions in module build files", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    id("com.android.application")
}

dependencies {
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string }> };

    const hardcodedFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("Hardcoded version"),
    );
    expect(hardcodedFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("detects missing convention plugins", async () => {
    writeSettings([":core:network"]);
    writeModuleBuild(
      ":core:network",
      `
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string; severity: string }> };

    const conventionFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("convention plugin"),
    );
    expect(conventionFindings.length).toBe(1);
    // Non-strict mode: severity should be LOW
    expect(conventionFindings[0].severity).toBe("LOW");
  });

  it("reports MEDIUM severity for missing convention in strict mode", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    id("com.android.application")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      strict: true,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string; severity: string }> };

    const conventionFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("convention plugin"),
    );
    expect(conventionFindings.length).toBe(1);
    expect(conventionFindings[0].severity).toBe("MEDIUM");
  });

  it("detects buildscript block in root build.gradle.kts", async () => {
    writeSettings([":app"]);
    writeRootBuild(`
buildscript {
    repositories {
        google()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.0.0")
    }
}
`);
    writeModuleBuild(
      ":app",
      `
plugins {
    alias(libs.plugins.android.application)
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string; module: string }> };

    const buildscriptFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("buildscript"),
    );
    expect(buildscriptFindings.length).toBe(1);
    expect(buildscriptFindings[0].module).toBe("root");
  });

  it("detects hardcoded SDK values in strict mode", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    alias(libs.plugins.android.application)
}

android {
    compileSdk = 34
    defaultConfig {
        minSdk = 24
        targetSdk = 34
    }
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      strict: true,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string }> };

    const sdkFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("Hardcoded SDK"),
    );
    expect(sdkFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag hardcoded SDK in non-strict mode", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    alias(libs.plugins.android.application)
}

android {
    compileSdk = 34
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      strict: false,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string }> };

    const sdkFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("Hardcoded SDK"),
    );
    expect(sdkFindings.length).toBe(0);
  });

  it("recognizes convention plugins (no false positive)", async () => {
    writeSettings([":core:data"]);
    writeModuleBuild(
      ":core:data",
      `
plugins {
    alias(libs.plugins.kmp.library.convention)
}

dependencies {
    implementation(libs.kotlinx.coroutines)
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as { findings: Array<{ message: string }> };

    const conventionFindings = json.findings.filter((f: { message: string }) =>
      f.message.includes("convention plugin"),
    );
    expect(conventionFindings.length).toBe(0);
  });

  it("includes summary counts in report", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    id("com.android.application")
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      summary: { total: number; high: number; medium: number; low: number };
      modules_checked: number;
    };

    expect(json.summary).toHaveProperty("total");
    expect(json.summary).toHaveProperty("high");
    expect(json.summary).toHaveProperty("medium");
    expect(json.summary).toHaveProperty("low");
    expect(json.modules_checked).toBe(1);
    expect(json.summary.total).toBeGreaterThan(0);
  });

  it("markdown output contains expected sections", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    id("com.android.application")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    expect(text).toContain("## Gradle Config Lint Report");
    expect(text).toContain("**Project:**");
    expect(text).toContain("**Findings:**");
    expect(text).toContain("| # | Severity | Module | Message |");
  });
});
