/**
 * Tests for the unused-resources MCP tool.
 *
 * Creates temp project fixtures with strings.xml, drawable resources,
 * and .kt source files. Verifies that unused resources are correctly
 * detected and used resources are not flagged.
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
import { registerUnusedResourcesTool } from "../../../src/tools/unused-resources.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "unused-resources-test-" + process.pid,
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function makeProject(): string {
  const root = path.join(TEST_ROOT, "test-project");
  mkdirSync(root, { recursive: true });
  return root;
}

function writeStringsXml(projectRoot: string, modulePath: string, content: string): void {
  const dir = path.join(projectRoot, modulePath, "src", "main", "res", "values");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "strings.xml"), content, "utf-8");
}

function writeKotlinFile(projectRoot: string, filePath: string, content: string): void {
  const fullPath = path.join(projectRoot, filePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function writeDrawable(projectRoot: string, modulePath: string, drawableDir: string, filename: string): void {
  const dir = path.join(projectRoot, modulePath, "src", "main", "res", drawableDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), "<vector />", "utf-8");
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerUnusedResourcesTool(server, limiter);

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
    name: "unused-resources",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("unused-resources tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "unused-resources");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("unused");
  });

  it("detects unused string resources", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="app_name">MyApp</string>',
      '    <string name="unused_label">Unused</string>',
      '    <string name="welcome_message">Welcome</string>',
      "</resources>",
    ].join("\n"));

    // Only reference app_name and welcome_message
    writeKotlinFile(root, "app/src/main/kotlin/MainActivity.kt", [
      "package com.example",
      "",
      "class MainActivity {",
      "    val name = R.string.app_name",
      "    val welcome = R.string.welcome_message",
      "}",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_strings).toBe(3);
    expect(parsed.unused_strings).toBe(1);
    expect(parsed.unused).toHaveLength(1);
    expect(parsed.unused[0].name).toBe("unused_label");
    expect(parsed.unused[0].type).toBe("string");
  });

  it("does not flag strings referenced via Res.string", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="compose_label">Compose</string>',
      "</resources>",
    ].join("\n"));

    writeKotlinFile(root, "app/src/main/kotlin/Screen.kt", [
      "package com.example",
      "",
      "@Composable",
      "fun Screen() {",
      "    Text(stringResource(Res.string.compose_label))",
      "}",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_strings).toBe(1);
    expect(parsed.unused_strings).toBe(0);
    expect(parsed.unused).toHaveLength(0);
  });

  it("does not flag strings referenced via @string/ in XML", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="xml_ref">Referenced in XML</string>',
      "</resources>",
    ].join("\n"));

    // Write a layout XML that references the string
    const layoutDir = path.join(root, "app", "src", "main", "res", "layout");
    mkdirSync(layoutDir, { recursive: true });
    writeFileSync(
      path.join(layoutDir, "activity_main.xml"),
      '<TextView android:text="@string/xml_ref" />',
      "utf-8",
    );

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.unused_strings).toBe(0);
  });

  it("detects unused drawable resources", async () => {
    const root = makeProject();
    writeDrawable(root, "app", "drawable", "ic_used.xml");
    writeDrawable(root, "app", "drawable", "ic_unused.xml");
    writeDrawable(root, "app", "drawable-hdpi", "bg_splash.png");

    writeKotlinFile(root, "app/src/main/kotlin/Icons.kt", [
      "package com.example",
      "",
      "val icon = R.drawable.ic_used",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "drawables",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_drawables).toBe(3);
    expect(parsed.unused_drawables).toBe(2);
    // ic_unused and bg_splash are unused
    const unusedNames = parsed.unused.map((u: { name: string }) => u.name);
    expect(unusedNames).toContain("ic_unused");
    expect(unusedNames).toContain("bg_splash");
    expect(unusedNames).not.toContain("ic_used");
  });

  it("handles project with no strings.xml gracefully", async () => {
    const root = makeProject();
    // No strings.xml, just a Kotlin file
    writeKotlinFile(root, "app/src/main/kotlin/Main.kt", "package com.example");

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_strings).toBe(0);
    expect(parsed.unused_strings).toBe(0);
    expect(parsed.unused).toHaveLength(0);
  });

  it("emits AuditFinding for each unused resource", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="dead_string">Dead</string>',
      "</resources>",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.findings).toHaveLength(1);
    const finding = parsed.findings[0];
    expect(finding.severity).toBe("LOW");
    expect(finding.category).toBe("code-quality");
    expect(finding.check).toBe("unused-string");
    expect(finding.title).toContain("dead_string");
    expect(finding.dedupe_key).toBeTruthy();
    expect(finding.id).toBeTruthy();
  });

  it("scans both strings and drawables with resource_type=all", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="used_str">Used</string>',
      '    <string name="dead_str">Dead</string>',
      "</resources>",
    ].join("\n"));
    writeDrawable(root, "app", "drawable", "ic_dead.xml");

    writeKotlinFile(root, "app/src/main/kotlin/Main.kt", [
      "package com.example",
      "val s = R.string.used_str",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "all",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_strings).toBe(2);
    expect(parsed.unused_strings).toBe(1);
    expect(parsed.total_drawables).toBe(1);
    expect(parsed.unused_drawables).toBe(1);
    expect(parsed.unused).toHaveLength(2);
    expect(parsed.findings).toHaveLength(2);
  });

  it("returns markdown output with table", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="orphan">Orphan</string>',
      "</resources>",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "markdown",
    });

    const text = extractText(result);

    expect(text).toContain("## Unused Resources");
    expect(text).toContain("| # | Type | Name | Defined In | Line |");
    expect(text).toContain("orphan");
    expect(text).toContain("string");
  });

  it("both format returns json and markdown separated by divider", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="test_str">Test</string>',
      "</resources>",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "both",
    });

    const text = extractText(result);
    expect(text).toContain("```json");
    expect(text).toContain("---");
    expect(text).toContain("## Unused Resources");
  });

  it("reports no unused resources when all are referenced", async () => {
    const root = makeProject();
    writeStringsXml(root, "app", [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      '    <string name="title">Title</string>',
      '    <string name="subtitle">Subtitle</string>',
      "</resources>",
    ].join("\n"));

    writeKotlinFile(root, "app/src/main/kotlin/Ui.kt", [
      "package com.example",
      "val t = R.string.title",
      "val s = R.string.subtitle",
    ].join("\n"));

    const result = await callTool({
      project_root: root,
      resource_type: "strings",
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("No unused resources found");
  });
});
