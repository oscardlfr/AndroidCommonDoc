/**
 * Tests for the kdoc-coverage MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temporary Kotlin project structures to test KDoc
 * detection, public API counting, and coverage computation.
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
import { registerKdocCoverageTool, analyzeFile } from "../../../src/tools/kdoc-coverage.js";
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

const TEST_ROOT = path.join(os.tmpdir(), "kdoc-coverage-test-" + process.pid);
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

function writeSettings(modules: string[]): void {
  const includes = modules.map((m) => `include(":${m}")`).join("\n");
  writeFileSync(
    path.join(PROJECT_ROOT, "settings.gradle.kts"),
    includes,
    "utf-8",
  );
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerKdocCoverageTool(server, limiter);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
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
    if (existsSync(TEST_ROOT)) {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup errors on Windows
  }
});

// ── Helper ───────────────────────────────────────────────────────────────────

async function callTool(args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({
    name: "kdoc-coverage",
    arguments: { project_root: PROJECT_ROOT, persist: false, ...args },
  });
  return (result.content as Array<{ text: string }>)[0].text;
}

// ── Unit tests: analyzeFile ──────────────────────────────────────────────────

describe("analyzeFile", () => {
  it("detects public function without KDoc", () => {
    const result = analyzeFile("Test.kt", "fun doSomething(x: Int): String = x.toString()");
    expect(result.total).toBe(1);
    expect(result.documented).toBe(0);
    expect(result.undocumented[0].name).toBe("doSomething");
    expect(result.undocumented[0].type).toBe("function");
  });

  it("detects public function with KDoc", () => {
    const result = analyzeFile("Test.kt", [
      "/** Converts an integer to a string. */",
      "fun doSomething(x: Int): String = x.toString()",
    ].join("\n"));
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
    expect(result.undocumented).toHaveLength(0);
  });

  it("detects multiline KDoc", () => {
    const result = analyzeFile("Test.kt", [
      "/**",
      " * Converts an integer to a string.",
      " * @param x the input",
      " * @return string representation",
      " */",
      "fun doSomething(x: Int): String = x.toString()",
    ].join("\n"));
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
  });

  it("allows annotations between KDoc and declaration", () => {
    const result = analyzeFile("Test.kt", [
      "/** Documented function. */",
      "@JvmStatic",
      "@Deprecated(\"use other\")",
      "fun oldMethod(): Unit = Unit",
    ].join("\n"));
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
  });

  it("skips private functions", () => {
    const result = analyzeFile("Test.kt", "private fun helper(): Int = 42");
    expect(result.total).toBe(0);
  });

  it("skips internal functions", () => {
    const result = analyzeFile("Test.kt", "internal fun helper(): Int = 42");
    expect(result.total).toBe(0);
  });

  it("skips protected functions", () => {
    const result = analyzeFile("Test.kt", "protected fun helper(): Int = 42");
    expect(result.total).toBe(0);
  });

  it("skips override declarations", () => {
    const result = analyzeFile("Test.kt", "override fun toString(): String = \"\"");
    expect(result.total).toBe(0);
  });

  it("skips actual declarations (KMP expect/actual)", () => {
    const result = analyzeFile("Test.kt", "actual fun platformName(): String = \"JVM\"");
    expect(result.total).toBe(0);
  });

  it("detects public class", () => {
    const result = analyzeFile("Test.kt", "class MyRepository(val dao: Dao)");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].type).toBe("class");
    expect(result.undocumented[0].name).toBe("MyRepository");
  });

  it("detects public interface", () => {
    const result = analyzeFile("Test.kt", "interface Repository<T>");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].type).toBe("interface");
  });

  it("detects public object", () => {
    const result = analyzeFile("Test.kt", "object Singleton { }");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].type).toBe("object");
  });

  it("detects enum class", () => {
    const result = analyzeFile("Test.kt", "enum class Status { ACTIVE, INACTIVE }");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].type).toBe("enum");
    expect(result.undocumented[0].name).toBe("Status");
  });

  it("detects public val property", () => {
    const result = analyzeFile("Test.kt", "val name: String = \"test\"");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].type).toBe("property");
  });

  it("detects public var property", () => {
    const result = analyzeFile("Test.kt", "var count: Int = 0");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].type).toBe("property");
  });

  it("handles mixed documented and undocumented", () => {
    const result = analyzeFile("Test.kt", [
      "/** Documented class. */",
      "class Foo {",
      "  /** Documented function. */",
      "  fun bar(): Int = 1",
      "  fun baz(): Int = 2",
      "}",
    ].join("\n"));
    expect(result.total).toBe(3); // class + 2 functions
    expect(result.documented).toBe(2); // class + bar
    expect(result.undocumented).toHaveLength(1);
    expect(result.undocumented[0].name).toBe("baz");
  });

  it("skips declarations inside block comments", () => {
    const result = analyzeFile("Test.kt", [
      "/* This is a comment",
      "fun commentedOut(): Int = 42",
      "*/",
      "fun realFunction(): Int = 1",
    ].join("\n"));
    expect(result.total).toBe(1);
    expect(result.undocumented[0].name).toBe("realFunction");
  });

  it("skips declarations inside KDoc content (Bug 2 fix)", () => {
    const result = analyzeFile("Test.kt", [
      "/**",
      " * Logger for tracking events in the application.",
      " *",
      " * Example usage:",
      " * ```kotlin",
      " * class MyRepository {",
      " *   fun fetchData(): Result<Data> {",
      " *     val result = api.get()",
      " *   }",
      " * }",
      " * ```",
      " */",
      "interface EventLogger {",
      "  fun log(event: String)",
      "}",
    ].join("\n"));
    // Only interface + function count, NOT the class/fun/val inside KDoc
    expect(result.total).toBe(2);
    expect(result.undocumented.map(u => u.name).sort()).toEqual(["log"]); // interface has KDoc
    expect(result.documented).toBe(1); // EventLogger has KDoc
  });

  it("skips keywords in KDoc descriptive text", () => {
    const result = analyzeFile("Test.kt", [
      "/**",
      " * Sealed class representing the result of an operation",
      " * which can be either Success or Failure.",
      " */",
      "sealed interface Result<out T>",
    ].join("\n"));
    // Only the sealed interface counts, not "class" or "interface" in KDoc text
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
    expect(result.undocumented).toHaveLength(0);
  });

  it("reports correct line numbers (1-based)", () => {
    const result = analyzeFile("Test.kt", [
      "package com.example",
      "",
      "class MyClass {",
      "  fun myMethod(): Unit = Unit",
      "}",
    ].join("\n"));
    expect(result.undocumented[0].line).toBe(3); // class on line 3
    expect(result.undocumented[1].line).toBe(4); // function on line 4
  });

  it("counts no declarations as 100% coverage", () => {
    const result = analyzeFile("Test.kt", "// empty file");
    expect(result.total).toBe(0);
    expect(result.documented).toBe(0);
  });

  it("skips local val/var inside function bodies (false positive fix)", () => {
    const result = analyzeFile("Test.kt", [
      "class Converter {",
      "  fun encode(data: ByteArray): String {",
      "    val buffer = StringBuilder()",
      "    var index = 0",
      "    val result = process(buffer)",
      "    return result.toString()",
      "  }",
      "}",
    ].join("\n"));
    // Only class + function should count, NOT the 3 local val/var
    expect(result.total).toBe(2);
    expect(result.undocumented.map(u => u.name)).toEqual(["Converter", "encode"]);
  });

  it("counts class-level val/var (depth 1) as public API", () => {
    const result = analyzeFile("Test.kt", [
      "class Config {",
      "  val timeout: Long = 5000",
      "  var retries: Int = 3",
      "}",
    ].join("\n"));
    // class + 2 properties = 3 public APIs
    expect(result.total).toBe(3);
  });

  it("counts top-level val/var (depth 0) as public API", () => {
    const result = analyzeFile("Test.kt", [
      "val DEFAULT_TIMEOUT: Long = 5000",
      "fun helper(): Unit = Unit",
    ].join("\n"));
    expect(result.total).toBe(2);
  });

  it("skips local val/var inside top-level functions (depth 1)", () => {
    // Top-level function (no enclosing class) — body is at depth 1
    const result = analyzeFile("Test.kt", [
      "fun calculateNext(): Long {",
      "    val epochMillis = System.currentTimeMillis()",
      "    val calendar = Calendar.getInstance()",
      "    return epochMillis + 1000",
      "}",
    ].join("\n"));
    // Only the function counts, NOT the 2 local vals
    expect(result.total).toBe(1);
    expect(result.undocumented[0].name).toBe("calculateNext");
  });

  it("extracts correct name for extension functions", () => {
    const result = analyzeFile("Test.kt", "fun ByteArray.encode(): String = \"\"");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].name).toBe("encode");
    expect(result.undocumented[0].type).toBe("function");
  });

  it("extracts correct name for generic functions", () => {
    const result = analyzeFile("Test.kt", "fun <T> List<T>.first(): T = get(0)");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].name).toBe("first");
  });

  it("extracts correct name for extension properties", () => {
    const result = analyzeFile("Test.kt", "val String.length: Int = 0");
    expect(result.total).toBe(1);
    expect(result.undocumented[0].name).toBe("length");
  });

  it("skips data class constructor properties (single line)", () => {
    const result = analyzeFile("Test.kt", [
      "/** Configuration data class. */",
      "data class Config(val name: String, val size: Int, var mutable: Boolean)",
    ].join("\n"));
    // Only the class counts, NOT the constructor val/var params
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
  });

  it("skips data class constructor properties (multiline)", () => {
    const result = analyzeFile("Test.kt", [
      "/**",
      " * Resource was not found.",
      " * @param resourceType The type of resource",
      " * @param resourceId The identifier of the resource",
      " */",
      "data class NotFound(",
      "    val resourceType: String,",
      "    val resourceId: String",
      ") : DomainException()",
    ].join("\n"));
    // Only the class counts, NOT the multiline constructor params
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
  });

  it("skips data class with @property documented properties", () => {
    const result = analyzeFile("Test.kt", [
      "/**",
      " * Version information for a library module.",
      " * @property major Major version number",
      " * @property minor Minor version number",
      " */",
      "data class VersionInfo(",
      "    val major: Int,",
      "    val minor: Int",
      ")",
    ].join("\n"));
    expect(result.total).toBe(1);
    expect(result.documented).toBe(1);
    expect(result.undocumented).toHaveLength(0);
  });

  it("skips const val declarations", () => {
    const result = analyzeFile("Test.kt", [
      "const val MAX_SIZE = 100",
      "const val DEFAULT_NAME = \"test\"",
      "fun process(): Unit = Unit",
    ].join("\n"));
    // Only the function counts, NOT the const vals
    expect(result.total).toBe(1);
    expect(result.undocumented[0].name).toBe("process");
  });

  it("skips const val in companion object", () => {
    const result = analyzeFile("Test.kt", [
      "class Config {",
      "  companion object {",
      "    const val MAX = 100",
      "    const val MIN = 0",
      "  }",
      "}",
    ].join("\n"));
    // Only the class counts
    expect(result.total).toBe(1);
  });
});

// ── Integration tests: MCP tool ──────────────────────────────────────────────

describe("kdoc-coverage MCP tool", () => {
  it("reports coverage for a simple module", async () => {
    writeSettings(["core"]);
    writeKtFile("core/src/main/kotlin", "Api.kt", [
      "/** Public API class. */",
      "class Api {",
      "  fun undocumented(): String = \"\"",
      "}",
    ].join("\n"));

    const output = await callTool({ format: "json" });
    const json = JSON.parse(output.replace(/```json\n|\n```/g, ""));

    expect(json.modules).toHaveLength(1);
    expect(json.modules[0].module).toBe("core");
    expect(json.modules[0].total_public).toBe(2); // class + function
    expect(json.modules[0].documented).toBe(1); // only class
    expect(json.modules[0].coverage_pct).toBe(50);
  });

  it("auto-detects modules from settings.gradle.kts", async () => {
    writeSettings(["core-domain", "core-data"]);
    writeKtFile("core-domain/src/main/kotlin", "Domain.kt", "/** Doc. */\ninterface UseCase");
    writeKtFile("core-data/src/main/kotlin", "Data.kt", "class Repository");

    const output = await callTool({ format: "json" });
    const json = JSON.parse(output.replace(/```json\n|\n```/g, ""));

    expect(json.modules).toHaveLength(2);
    const domain = json.modules.find((m: { module: string }) => m.module === "core-domain");
    const data = json.modules.find((m: { module: string }) => m.module === "core-data");
    expect(domain.coverage_pct).toBe(100);
    expect(data.coverage_pct).toBe(0);
  });

  it("excludes test files", async () => {
    writeSettings(["app"]);
    writeKtFile("app/src/main/kotlin", "Main.kt", "fun mainFn(): Unit = Unit");
    writeKtFile("app/src/test/kotlin", "MainTest.kt", "fun testFn(): Unit = Unit");

    const output = await callTool({ format: "json" });
    const json = JSON.parse(output.replace(/```json\n|\n```/g, ""));

    expect(json.modules[0].total_public).toBe(1); // only mainFn
  });

  it("changed_files mode filters to specific files", async () => {
    writeSettings(["lib"]);
    writeKtFile("lib/src/main/kotlin", "A.kt", "fun aFn(): Unit = Unit");
    writeKtFile("lib/src/main/kotlin", "B.kt", "/** Doc. */\nfun bFn(): Unit = Unit");

    const output = await callTool({
      format: "json",
      changed_files: ["A.kt"],
    });
    const json = JSON.parse(output.replace(/```json\n|\n```/g, ""));

    // Only A.kt should be analyzed
    expect(json.modules[0].total_public).toBe(1);
    expect(json.modules[0].documented).toBe(0);
    expect(json.changed_files_coverage).toBe(0);
  });

  it("returns markdown output with undocumented list", async () => {
    writeSettings(["mod"]);
    writeKtFile("mod/src/main/kotlin", "Svc.kt", [
      "class ServiceA",
      "class ServiceB",
    ].join("\n"));

    const output = await callTool({ format: "markdown" });

    expect(output).toContain("## KDoc Coverage");
    expect(output).toContain("### Undocumented Public APIs");
    expect(output).toContain("`ServiceA`");
    expect(output).toContain("`ServiceB`");
  });

  it("reports 100% for module with no Kotlin files", async () => {
    writeSettings(["empty"]);
    mkdirSync(path.join(PROJECT_ROOT, "empty"), { recursive: true });

    const output = await callTool({ format: "json" });
    const json = JSON.parse(output.replace(/```json\n|\n```/g, ""));

    // Empty module still listed with 0 APIs and 100% coverage (vacuous truth)
    expect(json.modules[0].total_public).toBe(0);
    expect(json.modules[0].coverage_pct).toBe(100);
    expect(json.overall_coverage).toBe(100);
  });

  it("persists coverage to audit-log.jsonl", async () => {
    writeSettings(["core"]);
    writeKtFile("core/src/main/kotlin", "Api.kt", "/** Doc. */\nclass Api");

    await client.callTool({
      name: "kdoc-coverage",
      arguments: {
        project_root: PROJECT_ROOT,
        format: "json",
        persist: true,
      },
    });

    const logPath = path.join(PROJECT_ROOT, ".androidcommondoc", "audit-log.jsonl");
    expect(existsSync(logPath)).toBe(true);

    const logContent = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(logContent);
    expect(entry.event).toBe("kdoc_coverage");
    expect(entry.data.overall_coverage).toBe(100);
  });

  it("computes overall coverage across multiple modules", async () => {
    writeSettings(["a", "b"]);
    // Module a: 2 public, 2 documented = 100%
    writeKtFile("a/src/main/kotlin", "A.kt", "/** D. */\nclass A\n/** D. */\nfun aFn(): Unit = Unit");
    // Module b: 2 public, 0 documented = 0%
    writeKtFile("b/src/main/kotlin", "B.kt", "class B\nfun bFn(): Unit = Unit");

    const output = await callTool({ format: "json" });
    const json = JSON.parse(output.replace(/```json\n|\n```/g, ""));

    // Overall: 2 documented / 4 total = 50%
    expect(json.overall_coverage).toBe(50);
  });
});
