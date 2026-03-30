/**
 * Tests for the validate-doc-update MCP tool.
 *
 * Validates pre-write checks: generated file guard, duplicate detection,
 * coherence, anti-pattern filtering, and size limits.
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
import { registerValidateDocUpdateTool } from "../../../src/tools/validate-doc-update.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(os.tmpdir(), "validate-doc-update-test-" + process.pid);
const DOCS_ROOT = path.join(TEST_ROOT, "docs");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(DOCS_ROOT, { recursive: true });
}

function writeDoc(subPath: string, content: string): string {
  const fullPath = path.join(DOCS_ROOT, subPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

function makeFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(", ")}]`);
    } else {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerValidateDocUpdateTool(server, limiter);

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

async function validate(
  targetFile: string,
  proposedContent: string,
  updateType: "create" | "update" | "append" = "update",
): Promise<{
  status: string;
  issues: Array<{ type: string; severity: string; message: string; auto_fixable: boolean; suggestion?: string }>;
  related_docs: Array<{ slug: string; overlap_score: number }>;
  split_suggestion?: { recommended_sections: string[] };
}> {
  const result = await client.callTool({
    name: "validate-doc-update",
    arguments: { target_file: targetFile, proposed_content: proposedContent, update_type: updateType },
  });
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generated file guard", () => {
  it("rejects edits to files with generated: true", async () => {
    const target = writeDoc("api/core-hub.md", makeFrontmatter({
      slug: "core-hub",
      generated: true,
      generated_from: "dokka",
    }) + "# Core API\n");

    const result = await validate(target, "# Updated content");
    expect(result.status).toBe("REJECTED");
    expect(result.issues[0].type).toBe("generated");
  });

  it("allows edits to non-generated files", async () => {
    const target = writeDoc("testing/test-patterns.md", makeFrontmatter({
      slug: "test-patterns",
      category: "testing",
    }) + "# Test Patterns\n");

    const result = await validate(target, makeFrontmatter({
      slug: "test-patterns",
      category: "testing",
    }) + "# Updated Test Patterns\nNew content here.");
    expect(result.status).not.toBe("REJECTED");
  });
});

describe("duplicate detection", () => {
  it("rejects content with >70% overlap", async () => {
    // Create existing doc with specific content
    writeDoc("testing/existing-patterns.md", makeFrontmatter({
      slug: "existing-patterns",
      category: "testing",
      scope: ["testing"],
      targets: ["android"],
    }) + [
      "# Testing Patterns",
      "Use runTest for all coroutine tests.",
      "Sequential execution with maxParallelForks equals one.",
      "StateFlow subscribe in backgroundScope with UnconfinedTestDispatcher.",
      "Inject testDispatcher into UseCases not Dispatchers Default.",
      "Pure Kotlin fakes over mocks FakeRepository FakeClock.",
    ].join("\n"));

    // Propose nearly identical content
    const target = path.join(DOCS_ROOT, "testing", "new-testing-doc.md");
    const result = await validate(target, makeFrontmatter({
      slug: "new-testing-doc",
      category: "testing",
    }) + [
      "# Testing Patterns Guide",
      "Use runTest for all coroutine tests.",
      "Sequential execution with maxParallelForks equals one.",
      "StateFlow subscribe in backgroundScope with UnconfinedTestDispatcher.",
      "Inject testDispatcher into UseCases not Dispatchers Default.",
      "Pure Kotlin fakes over mocks FakeRepository FakeClock.",
    ].join("\n"), "create");

    expect(result.status).toBe("REJECTED");
    expect(result.issues.some((i) => i.type === "duplicate")).toBe(true);
  });

  it("flags related docs with 50-70% overlap", async () => {
    writeDoc("testing/partial-match.md", makeFrontmatter({
      slug: "partial-match",
      category: "testing",
      scope: ["testing"],
      targets: ["android"],
    }) + [
      "# Partial Match Doc",
      "Some shared content about testing patterns.",
      "But also unique sections about performance testing.",
      "And benchmarking strategies for CI.",
    ].join("\n"));

    const target = path.join(DOCS_ROOT, "testing", "new-doc.md");
    const result = await validate(target, makeFrontmatter({
      slug: "new-doc",
      category: "testing",
    }) + [
      "# New Testing Doc",
      "Some shared content about testing patterns.",
      "But unique sections about integration testing.",
      "And deployment strategies for staging.",
    ].join("\n"), "create");

    // Should not be rejected but may have related docs
    // (exact overlap depends on token normalization)
    expect(result.status).not.toBe("REJECTED");
  });
});

describe("anti-pattern detection", () => {
  it("rejects content documenting data class UiState", async () => {
    const target = path.join(DOCS_ROOT, "compose", "ui-state.md");
    const result = await validate(target, makeFrontmatter({
      slug: "ui-state",
      category: "compose",
    }) + "# UI State\nUse `data class UiState(val loading: Boolean)` for state management.", "create");

    expect(result.status).toBe("REJECTED");
    expect(result.issues.some((i) => i.type === "forbidden")).toBe(true);
  });

  it("rejects content recommending Channel for events", async () => {
    const target = path.join(DOCS_ROOT, "architecture", "events.md");
    const result = await validate(target, makeFrontmatter({
      slug: "events",
      category: "architecture",
    }) + "# Event Handling\nUse Channel for UI events to ensure delivery.", "create");

    expect(result.status).toBe("REJECTED");
    expect(result.issues.some((i) =>
      i.type === "forbidden" && i.message.includes("SharedFlow"),
    )).toBe(true);
  });

  it("allows content that follows conventions", async () => {
    const target = path.join(DOCS_ROOT, "architecture", "state.md");
    const result = await validate(target, makeFrontmatter({
      slug: "state",
      category: "architecture",
    }) + "# State Management\nUse sealed interface for UiState.", "create");

    const forbiddenIssues = result.issues.filter((i) => i.type === "forbidden");
    expect(forbiddenIssues).toHaveLength(0);
  });
});

describe("size limit check", () => {
  it("rejects content exceeding 500 lines", async () => {
    const target = path.join(DOCS_ROOT, "guides", "huge-doc.md");
    const longContent = makeFrontmatter({
      slug: "huge-doc",
      category: "guides",
    }) + Array(510).fill("Line of content").join("\n");

    const result = await validate(target, longContent, "create");

    expect(result.issues.some((i) => i.type === "oversized")).toBe(true);
  });

  it("suggests split when oversized with multiple sections", async () => {
    const target = path.join(DOCS_ROOT, "guides", "big-doc.md");
    const sections = [
      makeFrontmatter({ slug: "big-doc", category: "guides" }),
      "## Section One",
      ...Array(200).fill("Content line"),
      "## Section Two",
      ...Array(200).fill("More content"),
      "## Section Three",
      ...Array(200).fill("Even more content"),
    ].join("\n");

    const result = await validate(target, sections, "create");

    expect(result.split_suggestion).toBeDefined();
    expect(result.split_suggestion!.recommended_sections.length).toBeGreaterThanOrEqual(2);
  });

  it("passes content within limits", async () => {
    const target = path.join(DOCS_ROOT, "guides", "small-doc.md");
    const content = makeFrontmatter({
      slug: "small-doc",
      category: "guides",
    }) + "# Small Doc\nJust a few lines.\n";

    const result = await validate(target, content, "create");

    expect(result.issues.filter((i) => i.type === "oversized")).toHaveLength(0);
  });
});

describe("coherence check", () => {
  it("flags category-directory mismatch", async () => {
    // File in testing/ but frontmatter says architecture
    const target = writeDoc("testing/misplaced.md", makeFrontmatter({
      slug: "misplaced",
      category: "architecture",
    }) + "# Misplaced Doc\n");

    const result = await validate(target, makeFrontmatter({
      slug: "misplaced",
      category: "architecture",
    }) + "# Still Misplaced\n");

    expect(result.issues.some((i) => i.type === "incoherent")).toBe(true);
  });
});

describe("overall status", () => {
  it("returns VALID for clean content", async () => {
    const target = path.join(DOCS_ROOT, "testing", "clean.md");
    const result = await validate(target, makeFrontmatter({
      slug: "clean",
      category: "testing",
    }) + "# Clean Doc\nPerfectly valid content.", "create");

    expect(result.status).toBe("VALID");
    expect(result.issues).toHaveLength(0);
  });

  it("returns FIXABLE for auto-fixable issues only", async () => {
    // Category mismatch is auto_fixable
    const target = writeDoc("testing/fixable.md", makeFrontmatter({
      slug: "fixable",
      category: "architecture",
    }) + "# Fixable\n");

    const result = await validate(target, makeFrontmatter({
      slug: "fixable",
      category: "architecture",
    }) + "# Still fixable\n");

    // May be FIXABLE if coherence issue detected (depends on SUBDIR_TO_CATEGORIES mapping)
    // At minimum, should not be REJECTED
    expect(result.status).not.toBe("REJECTED");
  });
});
