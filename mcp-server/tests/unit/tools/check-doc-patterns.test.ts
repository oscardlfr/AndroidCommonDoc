/**
 * Tests for the check-doc-patterns MCP tool.
 *
 * Creates temporary docs and detekt-rules structures to test
 * rule candidate detection, orphaned rule finding, and alignment checks.
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
import { registerCheckDocPatternsTool } from "../../../src/tools/check-doc-patterns.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_ROOT = path.join(os.tmpdir(), "check-doc-patterns-test-" + process.pid);
const PROJECT_ROOT = path.join(TEST_ROOT, "project");
const DOCS_DIR = path.join(PROJECT_ROOT, "docs");
const DETEKT_DIR = path.join(PROJECT_ROOT, "detekt-rules");
const GENERATED_DIR = path.join(
  DETEKT_DIR, "src", "main", "kotlin",
  "com", "androidcommondoc", "detekt", "rules", "generated",
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(DOCS_DIR, { recursive: true });
  mkdirSync(GENERATED_DIR, { recursive: true });
}

function writeDoc(subPath: string, content: string): void {
  const fullPath = path.join(DOCS_DIR, subPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function writeRule(fileName: string, content: string): void {
  writeFileSync(path.join(GENERATED_DIR, fileName), content, "utf-8");
}

function fm(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) {
        if (typeof item === "object") {
          lines.push(`  - id: ${(item as Record<string, unknown>).id}`);
          lines.push(`    type: ${(item as Record<string, unknown>).type}`);
          lines.push(`    message: "${(item as Record<string, unknown>).message}"`);
          lines.push(`    detect:`);
          lines.push(`      pattern: "${((item as Record<string, unknown>).detect as Record<string, unknown>)?.pattern}"`);
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

// ── MCP lifecycle ────────────────────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerCheckDocPatternsTool(server, limiter);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(() => ensureClean());

afterEach(() => {
  try {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch { /* Windows cleanup */ }
});

async function callTool(): Promise<string> {
  const result = await client.callTool({
    name: "check-doc-patterns",
    arguments: { project_root: PROJECT_ROOT },
  });
  return (result.content as Array<{ text: string }>)[0].text;
}

function extractJson(output: string): Record<string, unknown> {
  const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
  return jsonMatch ? JSON.parse(jsonMatch[1]) : {};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("rule candidates", () => {
  it("detects docs with normative language but no rules:", async () => {
    writeDoc("testing/test-rules.md", fm({
      slug: "test-rules",
      category: "testing",
    }) + "# Testing Rules\nYou MUST use runTest for coroutine tests.\nYou MUST NEVER use Dispatchers.Default.\n");

    const output = await callTool();
    const json = extractJson(output);
    const candidates = json.new_rule_candidates as Array<{ slug: string }>;

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.some((c) => c.slug === "test-rules")).toBe(true);
  });

  it("ignores docs that already have rules: frontmatter", async () => {
    writeDoc("testing/with-rules.md", fm({
      slug: "with-rules",
      category: "testing",
      rules: [
        { id: "NoDirectDispatchers", type: "banned-import", message: "test", detect: { pattern: "test" } },
      ],
    }) + "# With Rules\nYou MUST NEVER use Dispatchers.Default directly.\n");

    const output = await callTool();
    const json = extractJson(output);
    const candidates = json.new_rule_candidates as Array<{ slug: string }>;

    expect(candidates.every((c) => c.slug !== "with-rules")).toBe(true);
  });

  it("ignores generated docs", async () => {
    writeDoc("api/core-hub.md", fm({
      slug: "core-hub",
      generated: true,
    }) + "# Core API\nYou MUST always call init() first.\nYou MUST NEVER call dispose() twice.\n");

    const output = await callTool();
    const json = extractJson(output);
    const candidates = json.new_rule_candidates as Array<{ slug: string }>;

    expect(candidates.every((c) => c.slug !== "core-hub")).toBe(true);
  });

  it("requires at least 2 normative statements", async () => {
    writeDoc("guides/single-must.md", fm({
      slug: "single-must",
      category: "guides",
    }) + "# Guide\nYou MUST do this one thing.\nEverything else is optional.\n");

    const output = await callTool();
    const json = extractJson(output);
    const candidates = json.new_rule_candidates as Array<{ slug: string }>;

    expect(candidates.every((c) => c.slug !== "single-must")).toBe(true);
  });
});

describe("orphaned rules", () => {
  it("detects generated rule with no source doc", async () => {
    // No docs, but a generated rule exists
    writeRule("NoOrphanRule.kt", [
      "package com.androidcommondoc.detekt.rules.generated",
      "class NoOrphanRule : Rule() {",
      "  override fun visitClass(node: KtClass) {}",
      "}",
    ].join("\n"));

    const output = await callTool();
    const json = extractJson(output);
    const orphaned = json.orphaned_rules as Array<{ rule_id: string }>;

    expect(orphaned.some((o) => o.rule_id === "NoOrphanRule")).toBe(true);
  });

  it("does not flag rules that have a source doc", async () => {
    writeDoc("testing/covered-rule.md", fm({
      slug: "covered-rule",
      category: "testing",
      rules: [
        { id: "CoveredRule", type: "banned-import", message: "test", detect: { pattern: "test" } },
      ],
    }) + "# Covered\n");

    writeRule("CoveredRule.kt", [
      "package com.androidcommondoc.detekt.rules.generated",
      "class CoveredRule : Rule() {}",
    ].join("\n"));

    const output = await callTool();
    const json = extractJson(output);
    const orphaned = json.orphaned_rules as Array<{ rule_id: string }>;

    expect(orphaned.every((o) => o.rule_id !== "CoveredRule")).toBe(true);
  });
});

describe("rule alignment", () => {
  it("reports aligned when generated file exists", async () => {
    writeDoc("testing/aligned-rule.md", fm({
      slug: "aligned-rule",
      category: "testing",
      rules: [
        { id: "AlignedCheck", type: "banned-import", message: "test", detect: { pattern: "test" } },
      ],
    }) + "# Aligned\n");

    writeRule("AlignedCheck.kt", "class AlignedCheck : Rule() {}");

    const output = await callTool();
    const json = extractJson(output);
    const alignment = json.rule_doc_alignment as Array<{ rule: string; status: string }>;

    expect(alignment.some((a) => a.rule === "AlignedCheck" && a.status === "aligned")).toBe(true);
  });

  it("reports drifted when generated file is missing", async () => {
    writeDoc("testing/drifted-rule.md", fm({
      slug: "drifted-rule",
      category: "testing",
      rules: [
        { id: "MissingRule", type: "banned-import", message: "test", detect: { pattern: "test" } },
      ],
    }) + "# Drifted\n");

    // No generated file for MissingRule

    const output = await callTool();
    const json = extractJson(output);
    const alignment = json.rule_doc_alignment as Array<{ rule: string; status: string }>;

    expect(alignment.some((a) => a.rule === "MissingRule" && a.status === "drifted")).toBe(true);
  });
});

describe("summary output", () => {
  it("includes markdown summary", async () => {
    writeDoc("testing/summary-test.md", fm({
      slug: "summary-test",
      category: "testing",
    }) + "# Summary\nYou MUST do X.\nYou MUST NEVER do Y.\n");

    const output = await callTool();

    expect(output).toContain("## Doc-Pattern Check");
    expect(output).toContain("New rule candidates");
  });
});
