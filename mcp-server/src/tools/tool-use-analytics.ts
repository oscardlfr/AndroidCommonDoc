/**
 * MCP tool: tool-use-analytics
 *
 * Reads tool-use-log.jsonl from a project's .androidcommondoc/ directory
 * and produces a usage dashboard: top tools by call count, dead tools,
 * MCP/skill/context7 call breakdown, CP bypass count, and per-agent stats.
 *
 * Read-only: does NOT write to the log.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { readJsonlFile } from "../utils/jsonl-reader.js";

// ── Types ────────────────────────────────────────────────────────────────────

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

interface TopTool {
  tool_name: string;
  calls: number;
  success_rate: number;
  avg_duration_ms: number | null;
}

interface DeadTool {
  tool_name: string;
  last_seen: string;
}

interface SkillUsage {
  skill_name: string;
  calls: number;
  last_used: string;
}

interface ToolUseReport {
  session_summary: {
    total_calls: number;
    unique_tools: number;
    period_days: number;
    log_size_bytes: number;
  };
  top_tools: TopTool[];
  dead_tools: DeadTool[];
  mcp_calls: number;
  skill_calls: number;
  context7_calls: number;
  our_mcp_calls: number;
  cp_bypass_blocked: number;
  by_agent: Record<string, number>;
  by_skill: SkillUsage[]; // Wave 25 Level A: skill_name aggregation (top N used)
  dead_skills: string[]; // Wave 25 Level A: skills/ directory entries with 0 invocations in window
  user_invokable_skills: string[]; // Wave 25 Level A: user-only skills (disable-model-invocation: true) — excluded from dead-skill alert
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function cutoffDate(weeksBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - weeksBack * 7);
  return d;
}

function isWithinWindow(ts: string, cutoff: Date): boolean {
  const d = new Date(ts);
  return !isNaN(d.getTime()) && d >= cutoff;
}

// ── Analytics computation ────────────────────────────────────────────────────

export function computeToolUseReport(
  allEntries: ToolUseLogEntry[],
  weeksLookback: number,
  topN: number,
  logSizeBytes: number,
  projectRoot?: string, // Wave 25 Level A: enables dead-skill detection from skills/ directory
): ToolUseReport {
  const cutoff = cutoffDate(weeksLookback);
  const periodDays = weeksLookback * 7;

  const windowEntries = allEntries.filter((e) => isWithinWindow(e.ts, cutoff));

  // Aggregate per-tool stats within window
  const toolStats = new Map<
    string,
    { calls: number; successes: number; durations: number[] }
  >();

  let mcpCalls = 0;
  let skillCalls = 0;
  let context7Calls = 0;
  let ourMcpCalls = 0;
  let cpBypassBlocked = 0;
  const byAgent: Record<string, number> = {};

  for (const entry of windowEntries) {
    const key = entry.tool_name;
    if (!toolStats.has(key)) {
      toolStats.set(key, { calls: 0, successes: 0, durations: [] });
    }
    const stats = toolStats.get(key)!;
    stats.calls++;
    if (entry.success) stats.successes++;
    if (entry.duration_ms != null) stats.durations.push(entry.duration_ms);

    if (entry.tool_name.startsWith("mcp__")) mcpCalls++;
    if (entry.tool_name === "Skill") skillCalls++;
    if (entry.mcp_server === "context7") context7Calls++;
    if (entry.mcp_server === "mcp-server") ourMcpCalls++;
    if (entry.cp_bypass_blocked) cpBypassBlocked++;

    const agentKey = entry.agent_id ?? entry.agent_type ?? "unknown";
    byAgent[agentKey] = (byAgent[agentKey] ?? 0) + 1;
  }

  // Build top_tools sorted by call count descending
  const topTools: TopTool[] = [...toolStats.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, topN)
    .map(([tool_name, s]) => ({
      tool_name,
      calls: s.calls,
      success_rate:
        s.calls > 0
          ? Math.round((s.successes / s.calls) * 100) / 100
          : 0,
      avg_duration_ms:
        s.durations.length > 0
          ? Math.round(
              s.durations.reduce((a, b) => a + b, 0) / s.durations.length,
            )
          : null,
    }));

  // Dead tools: seen before cutoff, zero calls within window
  const windowToolNames = new Set(windowEntries.map((e) => e.tool_name));
  const historicalByTool = new Map<string, string>(); // tool_name → latest ts before cutoff

  for (const entry of allEntries) {
    const d = new Date(entry.ts);
    if (!isNaN(d.getTime()) && d < cutoff) {
      const existing = historicalByTool.get(entry.tool_name);
      if (!existing || entry.ts > existing) {
        historicalByTool.set(entry.tool_name, entry.ts);
      }
    }
  }

  const deadTools: DeadTool[] = [];
  for (const [tool_name, last_seen] of historicalByTool.entries()) {
    if (!windowToolNames.has(tool_name)) {
      deadTools.push({ tool_name, last_seen });
    }
  }
  deadTools.sort((a, b) => b.last_seen.localeCompare(a.last_seen));

  // Wave 25 Level A: by_skill aggregation + dead-skill detection
  const skillAgg = new Map<string, { calls: number; lastTs: string }>();
  for (const entry of windowEntries) {
    if (entry.skill_name) {
      const cur = skillAgg.get(entry.skill_name) ?? { calls: 0, lastTs: "" };
      cur.calls++;
      if (entry.ts > cur.lastTs) cur.lastTs = entry.ts;
      skillAgg.set(entry.skill_name, cur);
    }
  }
  const bySkill: SkillUsage[] = [...skillAgg.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, topN)
    .map(([skill_name, s]) => ({
      skill_name,
      calls: s.calls,
      last_used: s.lastTs,
    }));

  // Dead skills: declared in skills/ but 0 invocations in window
  let deadSkills: string[] = [];
  let userInvokable: string[] = [];
  if (projectRoot) {
    try {
      const skillsDir = path.join(projectRoot, "skills");
      const declared = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const invoked = new Set(skillAgg.keys());
      for (const s of declared) {
        if (invoked.has(s)) continue;
        // Check if user-invokable (disable-model-invocation: true) — excluded from dead-skill alert
        const skillMd = path.join(skillsDir, s, "SKILL.md");
        try {
          const fm = fs.readFileSync(skillMd, "utf-8").slice(0, 800);
          if (/disable-model-invocation:\s*true/.test(fm) || /user-invokable:\s*true/.test(fm)) {
            userInvokable.push(s);
            continue;
          }
        } catch {
          // skill without SKILL.md — treat as dead
        }
        deadSkills.push(s);
      }
      deadSkills.sort();
      userInvokable.sort();
    } catch {
      // skills/ not found or unreadable — leave arrays empty
    }
  }

  return {
    session_summary: {
      total_calls: windowEntries.length,
      unique_tools: toolStats.size,
      period_days: periodDays,
      log_size_bytes: logSizeBytes,
    },
    top_tools: topTools,
    dead_tools: deadTools,
    mcp_calls: mcpCalls,
    skill_calls: skillCalls,
    context7_calls: context7Calls,
    our_mcp_calls: ourMcpCalls,
    cp_bypass_blocked: cpBypassBlocked,
    by_agent: byAgent,
    by_skill: bySkill,
    dead_skills: deadSkills,
    user_invokable_skills: userInvokable,
  };
}

// ── Markdown rendering ───────────────────────────────────────────────────────

export function renderToolUseMarkdown(report: ToolUseReport): string {
  const lines: string[] = [
    "## Runtime Tool Usage Dashboard",
    "",
    `**Period:** ${report.session_summary.period_days} days | **Total calls:** ${report.session_summary.total_calls} | **Unique tools:** ${report.session_summary.unique_tools} | **Log size:** ${(report.session_summary.log_size_bytes / 1024).toFixed(1)} KB`,
    "",
  ];

  if (report.cp_bypass_blocked > 0) {
    lines.push(
      `> **WARNING:** ${report.cp_bypass_blocked} CP bypass block(s) detected. Architects are bypassing context-provider consultations.`,
      "",
    );
  }

  // Top tools table
  lines.push("### Top Tools");
  lines.push("| Tool | Calls | Success Rate | Avg Duration (ms) |");
  lines.push("|------|-------|-------------|-------------------|");
  for (const t of report.top_tools) {
    const dur = t.avg_duration_ms != null ? `${t.avg_duration_ms}` : "-";
    lines.push(
      `| ${t.tool_name} | ${t.calls} | ${(t.success_rate * 100).toFixed(0)}% | ${dur} |`,
    );
  }
  lines.push("");

  // Summary stats
  lines.push("### Cross-Cutting Stats");
  lines.push(`- MCP calls (all): **${report.mcp_calls}**`);
  lines.push(`- Skill calls: **${report.skill_calls}**`);
  lines.push(`- Context7 calls: **${report.context7_calls}**`);
  lines.push(`- Our MCP calls (mcp-server): **${report.our_mcp_calls}**`);
  lines.push(`- CP bypass blocks: **${report.cp_bypass_blocked}**`);
  lines.push("");

  // Per-agent breakdown
  lines.push("### Calls by Agent");
  const sortedAgents = Object.entries(report.by_agent).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [agent, count] of sortedAgents) {
    lines.push(`- ${agent}: ${count}`);
  }
  lines.push("");

  // Dead tools
  if (report.dead_tools.length > 0) {
    lines.push("### Dead Tools (seen before window, 0 calls in window)");
    for (const d of report.dead_tools) {
      lines.push(`- ${d.tool_name} (last seen: ${d.last_seen.split("T")[0]})`);
    }
    lines.push("");
  }

  // Wave 25 Level A: skill usage section
  if (report.by_skill.length > 0 || report.dead_skills.length > 0) {
    lines.push("### Skill Usage (Wave 25 Level A)");
    if (report.by_skill.length > 0) {
      lines.push("");
      lines.push("**Top skills by invocation:**");
      lines.push("| Skill | Calls | Last used |");
      lines.push("|-------|-------|-----------|");
      for (const s of report.by_skill) {
        lines.push(`| ${s.skill_name} | ${s.calls} | ${s.last_used.split("T")[0]} |`);
      }
    }
    if (report.dead_skills.length > 0) {
      lines.push("");
      lines.push(
        `**⚠ Dead skills** (declared in \`skills/\` but 0 invocations in window, and NOT user-invokable): ${report.dead_skills.length} of ${report.dead_skills.length + report.by_skill.length + report.user_invokable_skills.length}`,
      );
      lines.push(`> ${report.dead_skills.join(", ")}`);
      lines.push("");
      lines.push(
        "Fix: either wire into an agent's `skills:` frontmatter / slash command, or document as historical and prune.",
      );
    }
    if (report.user_invokable_skills.length > 0) {
      lines.push("");
      lines.push(
        `_User-invokable skills (excluded from dead-skill alert): ${report.user_invokable_skills.length}_`,
      );
    }
    lines.push("");
  }

  // Log rotation reminder
  lines.push(
    "> **Log rotation:** `mv .androidcommondoc/tool-use-log.jsonl .androidcommondoc/tool-use-log-$(date +%Y%m%d).jsonl`",
  );

  return lines.join("\n");
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerToolUseAnalyticsTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "tool-use-analytics",
    "Read tool-use-log.jsonl to produce a usage dashboard: top tools by call count, dead tools, MCP/skill/context7 breakdown, CP bypass count, and per-agent stats.",
    {
      project_root: z.string().describe("Absolute path to the project root"),
      weeks_lookback: z
        .number()
        .min(1)
        .max(52)
        .default(4)
        .describe("Number of weeks to look back (default: 4)"),
      format: z
        .enum(["json", "markdown", "both"])
        .default("both")
        .describe("Output format (default: both)"),
      top_n: z
        .number()
        .min(1)
        .max(100)
        .default(10)
        .describe("Top N tools to include in the table (default: 10)"),
    },
    async ({ project_root, weeks_lookback = 4, format = "both", top_n = 10 }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "tool-use-analytics");
      if (rateLimitResponse) return rateLimitResponse;

      const logPath = path.join(
        project_root,
        ".androidcommondoc",
        "tool-use-log.jsonl",
      );

      let logSizeBytes = 0;
      try {
        logSizeBytes = fs.statSync(logPath).size;
        if (logSizeBytes > 10_000_000) {
          logger.warn(
            `tool-use-analytics: tool-use-log.jsonl exceeds 10MB (${(logSizeBytes / 1_000_000).toFixed(1)}MB). Consider rotating the log.`,
          );
        }
      } catch {
        // file absent — size stays 0
      }

      let allEntries: ToolUseLogEntry[] = [];
      try {
        allEntries = await readJsonlFile<ToolUseLogEntry>(logPath);
      } catch (err) {
        logger.error(`tool-use-analytics: failed to read log: ${err}`);
      }

      if (allEntries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "No tool-use data found.",
                "",
                `Checked: ${logPath}`,
                "",
                "Wire tool-use-logger.js (PostToolUse hook) to populate the log.",
              ].join("\n"),
            },
          ],
        };
      }

      const report = computeToolUseReport(
        allEntries,
        weeks_lookback,
        top_n,
        logSizeBytes,
        project_root, // Wave 25 Level A: enable dead-skill detection
      );

      const parts: string[] = [];
      if (format === "json" || format === "both") {
        parts.push("```json\n" + JSON.stringify(report, null, 2) + "\n```");
      }
      if (format === "markdown" || format === "both") {
        parts.push(renderToolUseMarkdown(report));
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
      };
    },
  );
}
