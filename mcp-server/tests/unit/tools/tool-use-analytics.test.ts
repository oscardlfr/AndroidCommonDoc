import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeToolUseReport, renderToolUseMarkdown } from "../../../src/tools/tool-use-analytics.js";
import { readJsonlFile } from "../../../src/utils/jsonl-reader.js";

const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../scripts/tests/fixtures/tool-use-log-fixture.jsonl",
);

interface ToolUseLogEntry {
  ts: string;
  session_id: string;
  tool_name: string;
  mcp_server: string | null;
  mcp_tool: string | null;
  skill_name: string | null;
  input_summary: string;
  duration_ms: number | null;
  success: boolean;
  agent_name: string | null;
  agent_id: string | null;
  agent_type: string | null;
  cp_bypass_blocked: boolean;
}

describe("tool-use-analytics", () => {
  let entries: ToolUseLogEntry[];

  beforeAll(async () => {
    entries = await readJsonlFile<ToolUseLogEntry>(FIXTURE_PATH);
  });

  it("fixture has 50 entries", () => {
    expect(entries).toHaveLength(50);
  });

  it("top_tools[0] is Bash with 12 calls", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.top_tools[0].tool_name).toBe("Bash");
    expect(report.top_tools[0].calls).toBe(12);
  });

  it("cp_bypass_blocked sum is 3", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.cp_bypass_blocked).toBe(3);
  });

  it("context7_calls is 5", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.context7_calls).toBe(5);
  });

  it("our_mcp_calls is 5", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.our_mcp_calls).toBe(5);
  });

  it("skill_calls is 5", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.skill_calls).toBe(5);
  });

  it("by_agent groups by agent_id, falling back to agent_type then unknown", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.by_agent["arch-integration-3@session-androidcommondoc"]).toBe(15); // Read(10) + SendMessage(5)
    expect(report.by_agent["arch-platform-3@session-androidcommondoc"]).toBe(20);   // Grep(8) + Bash(12)
    expect(report.by_agent["arch-testing-3@session-androidcommondoc"]).toBe(5);     // Skill(5)
    expect(report.by_agent["unknown"]).toBe(10); // mcp__ entries with null agent_id+agent_type
  });

  it("session_summary totals are correct", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.session_summary.total_calls).toBe(50);
    expect(report.session_summary.unique_tools).toBeGreaterThan(0);
    expect(report.session_summary.period_days).toBe(28);
  });

  it("success_rate is between 0 and 1", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    for (const t of report.top_tools) {
      expect(t.success_rate).toBeGreaterThanOrEqual(0);
      expect(t.success_rate).toBeLessThanOrEqual(1);
    }
  });

  it("mcp_calls counts entries starting with mcp__", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.mcp_calls).toBe(10); // 5 context7 + 5 androidcommondoc
  });

  it("our_mcp_calls counts androidcommondoc entries, not context7", () => {
    // BL-W30-01: tool-use-logger.js logs mcp_server="androidcommondoc", not "mcp-server"
    const base = {
      ts: new Date().toISOString(),
      session_id: "s1",
      tool_name: "mcp__androidcommondoc__search-docs",
      mcp_tool: "search-docs",
      skill_name: null,
      input_summary: "",
      duration_ms: null,
      success: true,
      agent_name: null,
      agent_id: null,
      agent_type: null,
      cp_bypass_blocked: false,
    };
    const ourEntries = Array.from({ length: 12 }, (_, i) => ({
      ...base,
      mcp_server: "androidcommondoc" as const,
      tool_name: `mcp__androidcommondoc__tool-${i}`,
    }));
    const otherEntries = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      mcp_server: "context7" as const,
      tool_name: `mcp__context7__get-library-docs-${i}`,
    }));
    const report = computeToolUseReport([...ourEntries, ...otherEntries], 4, 10, 0);
    expect(report.our_mcp_calls).toBe(12);
    expect(report.context7_calls).toBe(5);
    expect(report.our_mcp_calls).toBeGreaterThan(0);
  });

  it("markdown snapshot", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    const md = renderToolUseMarkdown(report);
    expect(md).toMatchSnapshot();
  });

  it("dead_tools is empty when all entries are within window", () => {
    const report = computeToolUseReport(entries, 4, 10, 0);
    expect(report.dead_tools).toHaveLength(0);
  });

  it("dead_tools appear when lookback window shrinks to exclude fixture entries", () => {
    // 0.001 weeks (~10 minutes) excludes all 2026-04-15 entries
    const report = computeToolUseReport(entries, 0.001, 10, 0);
    expect(report.dead_tools.length).toBeGreaterThan(0);
  });

  describe("perf: 10k entries < 500ms", () => {
    let largeEntries: ToolUseLogEntry[];

    beforeAll(async () => {
      const tmpPath = path.join(os.tmpdir(), `tool-use-perf-${process.pid}.jsonl`);
      const base = {
        ts: new Date().toISOString(),
        session_id: "perf-session",
        tool_name: "Read",
        mcp_server: null,
        mcp_tool: null,
        skill_name: null,
        input_summary: "perf test entry",
        duration_ms: 20,
        success: true,
        agent_name: "arch-platform-3",
        cp_bypass_blocked: false,
      };
      const toolNames = ["Read", "Grep", "Bash", "SendMessage", "Skill"];
      const lines: string[] = [];
      for (let i = 0; i < 10_000; i++) {
        lines.push(
          JSON.stringify({
            ...base,
            ts: new Date(Date.now() - i * 1000).toISOString(),
            tool_name: toolNames[i % 5],
          }),
        );
      }
      fs.writeFileSync(tmpPath, lines.join("\n") + "\n");
      largeEntries = await readJsonlFile<ToolUseLogEntry>(tmpPath);
      fs.rmSync(tmpPath, { force: true });
    });

    it("processes 10k entries in < 500ms", () => {
      const start = Date.now();
      computeToolUseReport(largeEntries, 4, 10, 0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });
  });
});
