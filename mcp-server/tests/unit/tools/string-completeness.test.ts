/**
 * Tests for the string-completeness MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temp projects with values/strings.xml and locale variants
 * to test missing translation detection.
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
import { registerStringCompletenessTool } from "../../../src/tools/string-completeness.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "string-completeness-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(PROJECT_ROOT, { recursive: true });
}

function writeStringsXml(valuesDir: string, strings: Record<string, string>): void {
  mkdirSync(valuesDir, { recursive: true });
  const entries = Object.entries(strings)
    .map(([name, value]) => `    <string name="${name}">${value}</string>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${entries}\n</resources>`;
  writeFileSync(path.join(valuesDir, "strings.xml"), xml, "utf-8");
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerStringCompletenessTool(server, limiter);

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
    name: "string-completeness",
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

describe("string-completeness tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "string-completeness");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("string");
  });

  it("returns message when no base strings.xml found", async () => {
    // Empty project, no strings.xml
    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    expect(text).toContain("No base strings.xml");
  });

  it("detects missing translations in locale variant", async () => {
    const resDir = path.join(PROJECT_ROOT, "app", "src", "main", "res");

    // Base: 4 strings
    writeStringsXml(path.join(resDir, "values"), {
      app_name: "My App",
      hello: "Hello",
      goodbye: "Goodbye",
      settings: "Settings",
    });

    // Spanish: only 2 strings (missing goodbye and settings)
    writeStringsXml(path.join(resDir, "values-es"), {
      app_name: "Mi App",
      hello: "Hola",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      base_string_count: number;
      locales: Array<{
        locale: string;
        missing: string[];
        coverage_percent: number;
        translated: number;
      }>;
    };

    expect(json.base_string_count).toBe(4);
    expect(json.locales).toHaveLength(1);

    const es = json.locales[0];
    expect(es.locale).toBe("es");
    expect(es.translated).toBe(2);
    expect(es.missing).toContain("goodbye");
    expect(es.missing).toContain("settings");
    expect(es.coverage_percent).toBe(50);
  });

  it("handles multiple locale variants", async () => {
    const resDir = path.join(PROJECT_ROOT, "app", "src", "main", "res");

    writeStringsXml(path.join(resDir, "values"), {
      app_name: "My App",
      hello: "Hello",
      goodbye: "Goodbye",
    });

    // Spanish: missing 1
    writeStringsXml(path.join(resDir, "values-es"), {
      app_name: "Mi App",
      hello: "Hola",
    });

    // French: all present
    writeStringsXml(path.join(resDir, "values-fr"), {
      app_name: "Mon App",
      hello: "Bonjour",
      goodbye: "Au revoir",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      locales: Array<{
        locale: string;
        coverage_percent: number;
        missing: string[];
      }>;
      overall_coverage_percent: number;
    };

    expect(json.locales).toHaveLength(2);

    const es = json.locales.find((l) => l.locale === "es");
    const fr = json.locales.find((l) => l.locale === "fr");

    expect(es).toBeDefined();
    expect(es!.missing).toContain("goodbye");
    expect(fr).toBeDefined();
    expect(fr!.missing).toHaveLength(0);
    expect(fr!.coverage_percent).toBe(100);
  });

  it("filters by specific locales", async () => {
    const resDir = path.join(PROJECT_ROOT, "app", "src", "main", "res");

    writeStringsXml(path.join(resDir, "values"), {
      app_name: "My App",
      hello: "Hello",
    });

    writeStringsXml(path.join(resDir, "values-es"), {
      app_name: "Mi App",
    });

    writeStringsXml(path.join(resDir, "values-fr"), {
      app_name: "Mon App",
    });

    writeStringsXml(path.join(resDir, "values-de"), {
      app_name: "Meine App",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
      locales: ["es", "fr"],
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      locales: Array<{ locale: string }>;
    };

    // Should only include es and fr, not de
    expect(json.locales).toHaveLength(2);
    const localeNames = json.locales.map((l) => l.locale);
    expect(localeNames).toContain("es");
    expect(localeNames).toContain("fr");
    expect(localeNames).not.toContain("de");
  });

  it("computes correct overall coverage percentage", async () => {
    const resDir = path.join(PROJECT_ROOT, "app", "src", "main", "res");

    writeStringsXml(path.join(resDir, "values"), {
      a: "A",
      b: "B",
      c: "C",
      d: "D",
    });

    // es: 2/4 = 50%
    writeStringsXml(path.join(resDir, "values-es"), {
      a: "A",
      b: "B",
    });

    // fr: 4/4 = 100%
    writeStringsXml(path.join(resDir, "values-fr"), {
      a: "A",
      b: "B",
      c: "C",
      d: "D",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      overall_coverage_percent: number;
    };

    // Average of 50% and 100% = 75%
    expect(json.overall_coverage_percent).toBe(75);
  });

  it("handles module_path parameter", async () => {
    // Create strings in a specific module
    const moduleResDir = path.join(
      PROJECT_ROOT,
      "feature",
      "auth",
      "src",
      "main",
      "res",
    );

    writeStringsXml(path.join(moduleResDir, "values"), {
      login: "Login",
      logout: "Logout",
    });

    writeStringsXml(path.join(moduleResDir, "values-es"), {
      login: "Iniciar sesion",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
      module_path: "feature/auth",
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      module_path: string;
      base_string_count: number;
      locales: Array<{ missing: string[] }>;
    };

    expect(json.module_path).toBe("feature/auth");
    expect(json.base_string_count).toBe(2);
    expect(json.locales[0].missing).toContain("logout");
  });

  it("returns error for non-existent module path", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      module_path: "nonexistent/module",
    });

    const text = extractText(result);
    expect(text).toContain("Directory not found");
    expect(result.isError).toBe(true);
  });

  it("reports no locales when only base exists", async () => {
    const resDir = path.join(PROJECT_ROOT, "app", "src", "main", "res");

    writeStringsXml(path.join(resDir, "values"), {
      app_name: "My App",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    const json = extractJson(text) as {
      locales: Array<unknown>;
      overall_coverage_percent: number;
    };

    expect(json.locales).toHaveLength(0);
    expect(json.overall_coverage_percent).toBe(100);
  });

  it("markdown output contains expected sections", async () => {
    const resDir = path.join(PROJECT_ROOT, "app", "src", "main", "res");

    writeStringsXml(path.join(resDir, "values"), {
      app_name: "My App",
      hello: "Hello",
    });

    writeStringsXml(path.join(resDir, "values-es"), {
      app_name: "Mi App",
    });

    const result = await callTool({
      project_root: PROJECT_ROOT,
    });

    const text = extractText(result);
    expect(text).toContain("## String Completeness Report");
    expect(text).toContain("**Base strings:**");
    expect(text).toContain("**Overall coverage:**");
    expect(text).toContain("| Locale | Translated | Missing | Coverage |");
    expect(text).toContain("### Missing in es");
    expect(text).toContain("`hello`");
  });
});
