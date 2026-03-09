/**
 * Tests for the skill-usage-analytics MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temporary project structures with mock audit-log.jsonl
 * and findings-log.jsonl to test usage analytics computation.
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
import { registerSkillUsageAnalyticsTool } from "../../../src/tools/skill-usage-analytics.js";
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

const TEST_ROOT = path.join(
  os.tmpdir(),
  "skill-usage-analytics-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");
const AUDIT_DIR = path.join(PROJECT_ROOT, ".androidcommondoc");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(AUDIT_DIR, { recursive: true });
}

function writeAuditLog(entries: object[]): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path.join(AUDIT_DIR, "audit-log.jsonl"), content, "utf-8");
}

function writeFindingsLog(entries: object[]): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path.join(AUDIT_DIR, "findings-log.jsonl"), content, "utf-8");
}

/**
 * Generate a recent ISO timestamp (within the last N days).
 */
function recentTs(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/**
 * Generate an old ISO timestamp (N weeks + extra days ago).
 */
function oldTs(weeksAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeksAgo * 7 - 1);
  return d.toISOString();
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerSkillUsageAnalyticsTool(server, limiter);

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
    name: "skill-usage-analytics",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("skill-usage-analytics tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "skill-usage-analytics");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("usage");
  });

  it("handles empty logs gracefully", async () => {
    // No log files at all -- directory exists but no files
    rmSync(path.join(AUDIT_DIR, "audit-log.jsonl"), { force: true });
    rmSync(path.join(AUDIT_DIR, "findings-log.jsonl"), { force: true });

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
    });

    const text = extractText(result);
    expect(text).toContain("No audit or findings data found");
  });

  it("handles empty log files gracefully", async () => {
    writeFileSync(path.join(AUDIT_DIR, "audit-log.jsonl"), "", "utf-8");
    writeFileSync(path.join(AUDIT_DIR, "findings-log.jsonl"), "", "utf-8");

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
    });

    const text = extractText(result);
    expect(text).toContain("No audit or findings data found");
  });

  it("computes usage stats from audit log entries", async () => {
    writeAuditLog([
      { ts: recentTs(1), event: "coverage", data: { run_id: "run-1" } },
      { ts: recentTs(2), event: "coverage", data: { run_id: "run-2" } },
      { ts: recentTs(3), event: "sbom_scan", data: { run_id: "run-3" } },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    expect(parsed.skills.length).toBeGreaterThanOrEqual(2);

    const coverage = parsed.skills.find(
      (s: { skill: string }) => s.skill === "coverage",
    );
    expect(coverage).toBeDefined();
    expect(coverage.run_count).toBe(2);

    const sbom = parsed.skills.find(
      (s: { skill: string }) => s.skill === "sbom_scan",
    );
    expect(sbom).toBeDefined();
    expect(sbom.run_count).toBe(1);
  });

  it("computes usage stats from findings log entries", async () => {
    writeFindingsLog([
      {
        ts: recentTs(1),
        run_id: "run-1",
        commit: "abc123",
        branch: "main",
        finding: {
          source: "detekt-agent",
          check: "magic-number",
          severity: "MEDIUM",
          title: "Magic number",
        },
      },
      {
        ts: recentTs(1),
        run_id: "run-1",
        commit: "abc123",
        branch: "main",
        finding: {
          source: "detekt-agent",
          check: "magic-number",
          severity: "MEDIUM",
          title: "Another magic number",
        },
      },
      {
        ts: recentTs(2),
        run_id: "run-2",
        commit: "def456",
        branch: "main",
        finding: {
          source: "detekt-agent",
          check: "long-method",
          severity: "LOW",
          title: "Long method",
        },
      },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    const detekt = parsed.skills.find(
      (s: { skill: string }) => s.skill === "detekt-agent",
    );
    expect(detekt).toBeDefined();
    expect(detekt.run_count).toBe(2); // run-1 and run-2
    expect(detekt.total_findings).toBe(3);
    expect(detekt.avg_findings_per_run).toBe(1.5);
    expect(detekt.most_common_checks).toContain("magic-number");
  });

  it("filters by weeks_lookback correctly", async () => {
    writeAuditLog([
      // Recent entry (within 4 weeks)
      { ts: recentTs(7), event: "recent-skill", data: { run_id: "r1" } },
      // Old entry (beyond 4 weeks)
      { ts: oldTs(5), event: "old-skill", data: { run_id: "r2" } },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 4,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    const skillNames = parsed.skills.map((s: { skill: string }) => s.skill);
    expect(skillNames).toContain("recent-skill");
    expect(skillNames).not.toContain("old-skill");
  });

  it("markdown output has expected table structure", async () => {
    writeAuditLog([
      { ts: recentTs(1), event: "coverage", data: { run_id: "r1" } },
    ]);

    writeFindingsLog([
      {
        ts: recentTs(1),
        run_id: "r1",
        commit: "abc",
        branch: "main",
        finding: {
          source: "test-agent",
          check: "check-1",
          severity: "HIGH",
          title: "Issue",
        },
      },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
      format: "markdown",
    });

    const text = extractText(result);
    expect(text).toContain("## Skill Usage Analytics");
    expect(text).toContain("| Skill |");
    expect(text).toContain("Runs");
    expect(text).toContain("Last Run");
    expect(text).toContain("Findings");
    expect(text).toContain("Avg/Run");
    expect(text).toContain("Top Checks");
  });

  it("both format returns json and markdown", async () => {
    writeAuditLog([
      { ts: recentTs(1), event: "coverage", data: { run_id: "r1" } },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
      format: "both",
    });

    const text = extractText(result);
    expect(text).toContain("```json");
    expect(text).toContain("---");
    expect(text).toContain("## Skill Usage Analytics");
  });

  it("combines data from both audit and findings logs", async () => {
    writeAuditLog([
      { ts: recentTs(1), event: "coverage", data: { run_id: "r1" } },
    ]);

    writeFindingsLog([
      {
        ts: recentTs(1),
        run_id: "r1",
        commit: "abc",
        branch: "main",
        finding: {
          source: "coverage",
          check: "low-coverage",
          severity: "MEDIUM",
          title: "Low coverage",
        },
      },
    ]);

    const result = await callTool({
      project_root: PROJECT_ROOT,
      weeks_lookback: 12,
      format: "json",
    });

    const text = extractText(result);
    const jsonStr = text.replace(/^```json\n/, "").replace(/\n```$/, "");
    const parsed = JSON.parse(jsonStr);

    // The "coverage" skill should appear once with combined data
    const coverage = parsed.skills.find(
      (s: { skill: string }) => s.skill === "coverage",
    );
    expect(coverage).toBeDefined();
    expect(coverage.total_findings).toBe(1);
    expect(coverage.most_common_checks).toContain("low-coverage");
  });
});
