/**
 * Tests for the pattern-coverage MCP tool.
 *
 * Uses temp directory fixtures with docs (containing YAML frontmatter),
 * detekt-rules, scripts/sh, and .claude/agents directories. Verifies
 * coverage computation, gap detection, and output formats.
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
import { registerPatternCoverageTool } from "../../../src/tools/pattern-coverage.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "pattern-coverage-test-" + process.pid,
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

function makeToolkit(): string {
  const root = path.join(TEST_ROOT, "toolkit");
  mkdirSync(path.join(root, "docs"), { recursive: true });
  mkdirSync(path.join(root, "detekt-rules"), { recursive: true });
  mkdirSync(path.join(root, "scripts", "sh"), { recursive: true });
  mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  return root;
}

function writeDoc(root: string, filename: string, slug: string): void {
  const content = [
    "---",
    `slug: ${slug}`,
    "scope: [commonMain]",
    "sources: [kotlin-docs]",
    "targets: [android, desktop]",
    "category: architecture",
    "---",
    "",
    `# ${slug}`,
    "",
    "Pattern documentation content.",
  ].join("\n");
  writeFileSync(path.join(root, "docs", filename), content, "utf-8");
}

function writeDetektRule(root: string, filename: string, content: string): void {
  writeFileSync(
    path.join(root, "detekt-rules", filename),
    content,
    "utf-8",
  );
}

function writeScript(root: string, filename: string, content: string): void {
  writeFileSync(
    path.join(root, "scripts", "sh", filename),
    content,
    "utf-8",
  );
}

function writeAgent(root: string, filename: string, content: string): void {
  writeFileSync(
    path.join(root, ".claude", "agents", filename),
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
  registerPatternCoverageTool(server, limiter);

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
    name: "pattern-coverage",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("pattern-coverage tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "pattern-coverage");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("coverage");
  });

  it("returns 0% coverage for docs with no enforcement", async () => {
    const root = makeToolkit();
    writeDoc(root, "cancellation-exception.md", "cancellation-exception");
    writeDoc(root, "viewmodel-state.md", "viewmodel-state");

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_docs).toBe(2);
    expect(parsed.enforced_docs).toBe(0);
    expect(parsed.coverage_pct).toBe(0);
    expect(parsed.gaps).toHaveLength(2);
  });

  it("detects detekt rule enforcement", async () => {
    const root = makeToolkit();
    writeDoc(root, "cancellation-exception.md", "cancellation-exception");
    writeDetektRule(
      root,
      "CancellationCheck.kt",
      '// Rule for cancellation-exception pattern\nclass CancellationExceptionRule { }',
    );

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_docs).toBe(1);
    expect(parsed.enforced_docs).toBe(1);
    expect(parsed.coverage_pct).toBe(100);
    expect(parsed.patterns[0].has_detekt_rule).toBe(true);
    expect(parsed.gaps).toHaveLength(0);
  });

  it("detects script enforcement", async () => {
    const root = makeToolkit();
    writeDoc(root, "viewmodel-state.md", "viewmodel-state");
    writeScript(
      root,
      "check-viewmodel.sh",
      '#!/bin/bash\n# Checks viewmodel-state pattern compliance\ngrep -r "sealed interface" src/',
    );

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.enforced_docs).toBe(1);
    expect(parsed.patterns[0].has_script_check).toBe(true);
  });

  it("detects agent mention enforcement", async () => {
    const root = makeToolkit();
    writeDoc(root, "error-handling.md", "error-handling");
    writeAgent(
      root,
      "code-review-agent.md",
      "# Code Review Agent\n\nEnforces error-handling pattern across all modules.",
    );

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.enforced_docs).toBe(1);
    expect(parsed.patterns[0].has_agent_mention).toBe(true);
  });

  it("computes mixed coverage correctly", async () => {
    const root = makeToolkit();
    // Doc 1: enforced via detekt
    writeDoc(root, "cancellation-exception.md", "cancellation-exception");
    writeDetektRule(root, "Rules.kt", "// checks cancellation-exception");

    // Doc 2: enforced via script
    writeDoc(root, "viewmodel-state.md", "viewmodel-state");
    writeScript(root, "validate.sh", "# viewmodel-state check");

    // Doc 3: not enforced
    writeDoc(root, "compose-nav.md", "compose-nav");

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_docs).toBe(3);
    expect(parsed.enforced_docs).toBe(2);
    // 2/3 = 66.7%
    expect(parsed.coverage_pct).toBe(66.7);
    expect(parsed.gaps).toHaveLength(1);
    expect(parsed.gaps[0].slug).toBe("compose-nav");
  });

  it("skips docs without slug in frontmatter", async () => {
    const root = makeToolkit();
    writeDoc(root, "proper-doc.md", "proper-slug");

    // Write a doc without frontmatter
    writeFileSync(
      path.join(root, "docs", "no-frontmatter.md"),
      "# No Frontmatter\n\nJust plain content.",
      "utf-8",
    );

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    // Only the doc with a valid slug should be counted
    expect(parsed.total_docs).toBe(1);
    expect(parsed.patterns[0].slug).toBe("proper-slug");
  });

  it("returns markdown output with table and gaps section", async () => {
    const root = makeToolkit();
    writeDoc(root, "enforced.md", "enforced-pattern");
    writeDetektRule(root, "Rule.kt", "// enforced-pattern");
    writeDoc(root, "gap.md", "gap-pattern");

    const result = await callTool({
      toolkit_root: root,
      format: "markdown",
    });

    const text = extractText(result);

    expect(text).toContain("## Pattern Enforcement Coverage");
    expect(text).toContain("| Slug | Detekt | Script | Agent | Enforced |");
    expect(text).toContain("enforced-pattern");
    expect(text).toContain("### Enforcement Gaps");
    expect(text).toContain("gap-pattern");
  });

  it("both format returns json and markdown separated by divider", async () => {
    const root = makeToolkit();
    writeDoc(root, "test.md", "test-slug");

    const result = await callTool({
      toolkit_root: root,
      format: "both",
    });

    const text = extractText(result);
    expect(text).toContain("```json");
    expect(text).toContain("---");
    expect(text).toContain("## Pattern Enforcement Coverage");
  });

  it("handles empty docs directory gracefully", async () => {
    const root = makeToolkit();
    // docs/ exists but no .md files

    const result = await callTool({
      toolkit_root: root,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.total_docs).toBe(0);
    expect(parsed.enforced_docs).toBe(0);
    expect(parsed.coverage_pct).toBe(0);
    expect(parsed.patterns).toHaveLength(0);
    expect(parsed.gaps).toHaveLength(0);
  });
});
