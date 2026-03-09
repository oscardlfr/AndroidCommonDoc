/**
 * Tests for the proguard-validator MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temp Gradle projects with build.gradle.kts files referencing
 * proguard configurations to test validation logic.
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
import { registerProguardValidatorTool } from "../../../src/tools/proguard-validator.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "proguard-validator-test-" + process.pid,
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

function writeModuleFile(modulePath: string, filename: string, content: string): void {
  const moduleDir = path.join(
    PROJECT_ROOT,
    modulePath.replace(/^:/, "").replace(/:/g, "/"),
  );
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(path.join(moduleDir, filename), content, "utf-8");
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerProguardValidatorTool(server, limiter);

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
    name: "proguard-validator",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

function extractJson(text: string): Record<string, unknown> {
  const jsonMatch = text.match(/```json\n([\s\S]+?)\n```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }
  return JSON.parse(text);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("proguard-validator tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "proguard-validator");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("ProGuard");
  });

  it("returns error when settings.gradle.kts is missing", async () => {
    const result = await callTool({
      project_root: path.join(TEST_ROOT, "nonexistent"),
    });

    const text = extractText(result);
    expect(text).toContain("Could not read settings.gradle.kts");
    expect(result.isError).toBe(true);
  });

  it("detects missing proguard files", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
plugins {
    id("com.android.application")
}

android {
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
`,
    );
    // Note: NOT creating proguard-rules.pro file

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        module: string;
        missing_files: string[];
        references: Array<{ filename: string; isDefault: boolean; exists: boolean }>;
      }>;
      summary: { total_missing_files: number };
    };

    const appModule = json.modules.find((m) => m.module === ":app");
    expect(appModule).toBeDefined();
    expect(appModule!.missing_files).toContain("proguard-rules.pro");
    expect(json.summary.total_missing_files).toBe(1);
  });

  it("validates existing proguard files", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
android {
    buildTypes {
        release {
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
}
`,
    );
    // Create the proguard file
    writeModuleFile(":app", "proguard-rules.pro", "# Keep rules\n-keepattributes *Annotation*\n");

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        missing_files: string[];
        references: Array<{ filename: string; exists: boolean }>;
      }>;
      summary: { total_missing_files: number };
    };

    expect(json.summary.total_missing_files).toBe(0);
    const appModule = json.modules[0];
    expect(appModule.missing_files).toHaveLength(0);
  });

  it("recommends Ktor keep rules when Ktor dependency detected", async () => {
    writeSettings([":core:network"]);
    writeModuleBuild(
      ":core:network",
      `
dependencies {
    implementation("io.ktor:ktor-client-core:2.3.0")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.0")
}

android {
    buildTypes {
        release {
            proguardFiles(getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro")
        }
    }
}
`,
    );
    // Create proguard file without Ktor rules
    writeModuleFile(":core:network", "proguard-rules.pro", "# Empty rules\n");

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        module: string;
        missing_library_rules: string[];
        library_recommendations: Array<{ library: string; rules: string[] }>;
      }>;
      summary: { total_missing_library_rules: number };
    };

    const networkModule = json.modules.find((m) => m.module === ":core:network");
    expect(networkModule).toBeDefined();
    expect(networkModule!.missing_library_rules).toContain("Ktor");
    expect(json.summary.total_missing_library_rules).toBeGreaterThanOrEqual(1);
  });

  it("recommends kotlinx.serialization keep rules", async () => {
    writeSettings([":core:data"]);
    writeModuleBuild(
      ":core:data",
      `
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        missing_library_rules: string[];
      }>;
    };

    expect(json.modules[0].missing_library_rules).toContain("kotlinx.serialization");
  });

  it("recommends Room keep rules", async () => {
    writeSettings([":core:database"]);
    writeModuleBuild(
      ":core:database",
      `
dependencies {
    implementation("androidx.room:room-runtime:2.6.0")
    kapt("androidx.room:room-compiler:2.6.0")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        missing_library_rules: string[];
      }>;
    };

    expect(json.modules[0].missing_library_rules).toContain("Room");
  });

  it("recommends Compose keep rules", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
dependencies {
    implementation("androidx.compose.ui:ui:1.5.0")
    implementation("androidx.compose.material3:material3:1.2.0")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        missing_library_rules: string[];
      }>;
    };

    expect(json.modules[0].missing_library_rules).toContain("Compose");
  });

  it("does not flag library when proguard file already has rules", async () => {
    writeSettings([":core:network"]);
    writeModuleBuild(
      ":core:network",
      `
dependencies {
    implementation("io.ktor:ktor-client-core:2.3.0")
}

android {
    buildTypes {
        release {
            proguardFiles(getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro")
        }
    }
}
`,
    );
    // Create proguard file WITH Ktor rules
    writeModuleFile(
      ":core:network",
      "proguard-rules.pro",
      `# Ktor keep rules
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        missing_library_rules: string[];
      }>;
    };

    expect(json.modules[0].missing_library_rules).not.toContain("Ktor");
  });

  it("reports modules without proguard config", async () => {
    writeSettings([":core:utils"]);
    writeModuleBuild(
      ":core:utils",
      `
plugins {
    id("org.jetbrains.kotlin.jvm")
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules: Array<{
        has_proguard_config: boolean;
      }>;
      summary: { modules_without_proguard: number };
    };

    expect(json.modules[0].has_proguard_config).toBe(false);
    expect(json.summary.modules_without_proguard).toBe(1);
  });

  it("handles multiple modules with mixed issues", async () => {
    writeSettings([":app", ":core:network"]);

    // App: has proguard but missing file
    writeModuleBuild(
      ":app",
      `
android {
    buildTypes {
        release {
            proguardFiles(getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro")
        }
    }
}
dependencies {
    implementation("androidx.compose.ui:ui:1.5.0")
}
`,
    );

    // Network: no proguard config, uses Ktor
    writeModuleBuild(
      ":core:network",
      `
dependencies {
    implementation("io.ktor:ktor-client-core:2.3.0")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      modules_checked: number;
      modules: Array<{
        module: string;
        has_proguard_config: boolean;
        missing_files: string[];
      }>;
    };

    expect(json.modules_checked).toBe(2);

    const appModule = json.modules.find((m) => m.module === ":app");
    expect(appModule!.missing_files).toContain("proguard-rules.pro");

    const networkModule = json.modules.find((m) => m.module === ":core:network");
    expect(networkModule!.has_proguard_config).toBe(false);
  });

  it("markdown output contains expected sections", async () => {
    writeSettings([":app"]);
    writeModuleBuild(
      ":app",
      `
android {
    buildTypes {
        release {
            proguardFiles(getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro")
        }
    }
}
dependencies {
    implementation("io.ktor:ktor-client-core:2.3.0")
}
`,
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    expect(text).toContain("## ProGuard Validator Report");
    expect(text).toContain("**Modules checked:**");
    expect(text).toContain("**Missing proguard files:**");
    expect(text).toContain("**Missing library rules:**");
    expect(text).toContain("### Issues Found");
  });
});
