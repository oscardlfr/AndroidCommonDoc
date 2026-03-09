/**
 * Tests for the findings-report MCP tool.
 *
 * Follows the setup pattern from setup-check.test.ts:
 * uses in-memory MCP transport with real tool registration.
 *
 * Tests cover registration, empty/missing log, filtering, dedup,
 * resolution tracking, and output formats.
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
import { registerFindingsReport } from "../../../src/tools/findings-report.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "findings-report-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");
const AUDIT_DIR = path.join(PROJECT_ROOT, ".androidcommondoc");
const LOG_FILE = path.join(AUDIT_DIR, "findings-log.jsonl");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(AUDIT_DIR, { recursive: true });
}

function writeLog(entries: object[]): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(LOG_FILE, content, "utf-8");
}

function makeFindingEntry(overrides: Record<string, unknown> = {}): object {
  return {
    ts: "2026-03-19T10:00:00Z",
    run_id: "run-1",
    commit: "abc1234",
    branch: "main",
    finding: {
      id: "0000000000000001",
      dedupe_key: "test-check:file.kt:10",
      severity: "HIGH",
      category: "code-quality",
      source: "test-agent",
      check: "test-check",
      title: "Test finding",
      file: "src/Main.kt",
      line: 10,
    },
    ...overrides,
  };
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerFindingsReport(server, limiter);

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
    name: "findings-report",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("findings-report tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "findings-report");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("findings");
  });

  it("returns 'no findings log' message when file does not exist", async () => {
    const result = await callTool({
      project_root: path.join(TEST_ROOT, "nonexistent-project"),
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("No findings log found");
  });

  it("returns 'no entries' message for empty log", async () => {
    writeFileSync(LOG_FILE, "", "utf-8");

    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("no entries");
  });

  it("returns findings grouped in markdown format", async () => {
    writeLog([
      makeFindingEntry(),
      makeFindingEntry({
        finding: {
          id: "0000000000000002",
          dedupe_key: "other-check:file2.kt:20",
          severity: "CRITICAL",
          category: "security",
          source: "security-agent",
          check: "oauth-plaintext",
          title: "OAuth tokens in plaintext",
          file: "core/storage/TokenStore.kt",
          line: 42,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("Findings Report");
    expect(text).toContain("CRITICAL");
    expect(text).toContain("oauth-plaintext");
    expect(text).toContain("Resolution Trend");
  });

  it("returns JSON output with summary structure", async () => {
    writeLog([
      makeFindingEntry({
        finding: {
          id: "id1",
          dedupe_key: "check-a:f.kt:1",
          severity: "CRITICAL",
          category: "security",
          source: "agent",
          check: "check-a",
          title: "Critical issue",
          file: "f.kt",
          line: 1,
        },
      }),
      makeFindingEntry({
        finding: {
          id: "id2",
          dedupe_key: "check-b:f.kt:2",
          severity: "MEDIUM",
          category: "code-quality",
          source: "agent",
          check: "check-b",
          title: "Medium issue",
          file: "f.kt",
          line: 2,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    // Strip markdown code fence
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed).toHaveProperty("project");
    expect(parsed).toHaveProperty("health");
    expect(parsed).toHaveProperty("summary");
    expect(parsed.summary).toHaveProperty("total");
    expect(parsed.summary).toHaveProperty("critical");
    expect(parsed.summary).toHaveProperty("by_category");
    expect(parsed).toHaveProperty("findings");
    expect(parsed).toHaveProperty("resolution");
    expect(parsed.summary.total).toBe(2);
    expect(parsed.summary.critical).toBe(1);
    expect(parsed.health).toBe("CRITICAL");
  });

  it("filters by severity correctly", async () => {
    writeLog([
      makeFindingEntry({
        finding: {
          id: "id1",
          dedupe_key: "c1:f.kt:1",
          severity: "CRITICAL",
          category: "security",
          source: "a",
          check: "c1",
          title: "Critical",
          file: "f.kt",
          line: 1,
        },
      }),
      makeFindingEntry({
        finding: {
          id: "id2",
          dedupe_key: "c2:f.kt:2",
          severity: "HIGH",
          category: "code-quality",
          source: "a",
          check: "c2",
          title: "High",
          file: "f.kt",
          line: 2,
        },
      }),
      makeFindingEntry({
        finding: {
          id: "id3",
          dedupe_key: "c3:f.kt:3",
          severity: "LOW",
          category: "testing",
          source: "a",
          check: "c3",
          title: "Low",
          file: "f.kt",
          line: 3,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      severity_filter: "HIGH",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    // Should only include CRITICAL and HIGH (severity >= HIGH)
    expect(parsed.findings).toHaveLength(2);
    const severities = parsed.findings.map(
      (f: { severity: string }) => f.severity,
    );
    expect(severities).toContain("CRITICAL");
    expect(severities).toContain("HIGH");
    expect(severities).not.toContain("LOW");
  });

  it("filters by category correctly", async () => {
    writeLog([
      makeFindingEntry({
        finding: {
          id: "id1",
          dedupe_key: "c1:f.kt:1",
          severity: "HIGH",
          category: "security",
          source: "a",
          check: "c1",
          title: "Security issue",
          file: "f.kt",
          line: 1,
        },
      }),
      makeFindingEntry({
        finding: {
          id: "id2",
          dedupe_key: "c2:f.kt:2",
          severity: "MEDIUM",
          category: "code-quality",
          source: "a",
          check: "c2",
          title: "Quality issue",
          file: "f.kt",
          line: 2,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      category_filter: "security",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].category).toBe("security");
  });

  it("filters by run_id correctly", async () => {
    writeLog([
      makeFindingEntry({
        run_id: "run-1",
        finding: {
          id: "id1",
          dedupe_key: "c1:f.kt:1",
          severity: "HIGH",
          category: "security",
          source: "a",
          check: "c1",
          title: "Run 1 finding",
          file: "f.kt",
          line: 1,
        },
      }),
      makeFindingEntry({
        run_id: "run-2",
        finding: {
          id: "id2",
          dedupe_key: "c2:f.kt:2",
          severity: "MEDIUM",
          category: "code-quality",
          source: "a",
          check: "c2",
          title: "Run 2 finding",
          file: "f.kt",
          line: 2,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      run_id: "run-1",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.run_id).toBe("run-1");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].title).toBe("Run 1 finding");
  });

  it("applies deduplication", async () => {
    // Two findings with the same dedupe_key should be merged
    writeLog([
      makeFindingEntry({
        finding: {
          id: "id1",
          dedupe_key: "same-key:f.kt:10",
          severity: "MEDIUM",
          category: "code-quality",
          source: "agent-a",
          check: "same-check",
          title: "Duplicate finding",
          file: "f.kt",
          line: 10,
        },
      }),
      makeFindingEntry({
        finding: {
          id: "id2",
          dedupe_key: "same-key:f.kt:10",
          severity: "HIGH",
          category: "code-quality",
          source: "agent-b",
          check: "same-check",
          title: "Duplicate finding",
          file: "f.kt",
          line: 10,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    // Dedup should merge these into 1 finding with HIGH severity
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].severity).toBe("HIGH");
  });

  it("tracks resolution between runs", async () => {
    writeLog([
      // Run 1: two findings
      makeFindingEntry({
        run_id: "run-1",
        finding: {
          id: "id1",
          dedupe_key: "check-a:f.kt:1",
          severity: "HIGH",
          category: "security",
          source: "a",
          check: "check-a",
          title: "Issue A",
          file: "f.kt",
          line: 1,
        },
      }),
      makeFindingEntry({
        run_id: "run-1",
        finding: {
          id: "id2",
          dedupe_key: "check-b:f.kt:2",
          severity: "MEDIUM",
          category: "code-quality",
          source: "a",
          check: "check-b",
          title: "Issue B",
          file: "f.kt",
          line: 2,
        },
      }),
      // Run 2: only check-a persists, check-b is resolved, check-c is new
      makeFindingEntry({
        run_id: "run-2",
        finding: {
          id: "id1",
          dedupe_key: "check-a:f.kt:1",
          severity: "HIGH",
          category: "security",
          source: "a",
          check: "check-a",
          title: "Issue A",
          file: "f.kt",
          line: 1,
        },
      }),
      makeFindingEntry({
        run_id: "run-2",
        finding: {
          id: "id3",
          dedupe_key: "check-c:f.kt:3",
          severity: "LOW",
          category: "testing",
          source: "a",
          check: "check-c",
          title: "Issue C",
          file: "f.kt",
          line: 3,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      run_id: "run-2",
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.resolution.persistent).toBe(1); // check-a
    expect(parsed.resolution.new_this_run).toBe(1); // check-c
    expect(parsed.resolution.resolved_since_last).toBe(1); // check-b
  });

  it("markdown output format includes expected sections", async () => {
    writeLog([
      makeFindingEntry({
        finding: {
          id: "id1",
          dedupe_key: "check:f.kt:1",
          severity: "HIGH",
          category: "code-quality",
          source: "agent",
          check: "my-check",
          title: "Important issue",
          file: "src/Main.kt",
          line: 42,
        },
      }),
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "markdown",
    });

    const text = extractText(result);

    // Check required markdown sections
    expect(text).toContain("## Findings Report");
    expect(text).toContain("**Run:**");
    expect(text).toContain("**Health:**");
    expect(text).toContain("| # | Severity | Category | Check | Title | File | Line |");
    expect(text).toContain("### Resolution Trend");
    expect(text).toContain("my-check");
    expect(text).toContain("Important issue");
    expect(text).toContain("42");
  });

  it("both format returns json and markdown separated by divider", async () => {
    writeLog([makeFindingEntry()]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      format: "both",
    });

    const text = extractText(result);
    expect(text).toContain("```json");
    expect(text).toContain("---");
    expect(text).toContain("## Findings Report");
  });
});
