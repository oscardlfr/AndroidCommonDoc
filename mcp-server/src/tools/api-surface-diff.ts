/**
 * MCP tool: api-surface-diff
 *
 * Runs git diff between two branches and parses the output to identify
 * public API changes in Kotlin source files. Classifies changes as
 * breaking, additive, or compatible and emits AuditFindings accordingly.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import type { AuditFinding } from "../types/findings.js";
import { createFinding, buildDedupeKey } from "../types/findings.js";

const execFileAsync = promisify(execFile);

// ── Public API regex ─────────────────────────────────────────────────────────

const PUBLIC_API_RE =
  /^\s*(public\s+)?(fun|class|interface|object|val|var|enum|sealed|data|abstract)\s+/;

// ── Change classification ────────────────────────────────────────────────────

interface ApiChange {
  type: "breaking" | "additive" | "compatible";
  line: string;
  file?: string;
}

function parseDiffOutput(diffOutput: string): ApiChange[] {
  const changes: ApiChange[] = [];
  let currentFile: string | undefined;

  for (const rawLine of diffOutput.split("\n")) {
    // Track current file from diff header
    if (rawLine.startsWith("diff --git")) {
      const match = rawLine.match(/b\/(.+)$/);
      if (match) {
        currentFile = match[1];
      }
      continue;
    }

    // Skip non-change lines
    if (!rawLine.startsWith("+") && !rawLine.startsWith("-")) continue;
    // Skip diff headers
    if (rawLine.startsWith("+++") || rawLine.startsWith("---")) continue;

    const content = rawLine.slice(1); // remove +/- prefix

    if (PUBLIC_API_RE.test(content)) {
      if (rawLine.startsWith("-")) {
        changes.push({ type: "breaking", line: content.trim(), file: currentFile });
      } else {
        changes.push({ type: "additive", line: content.trim(), file: currentFile });
      }
    } else if (rawLine.startsWith("+") || rawLine.startsWith("-")) {
      changes.push({ type: "compatible", line: content.trim(), file: currentFile });
    }
  }

  return changes;
}

// ── Markdown rendering ───────────────────────────────────────────────────────

interface DiffReport {
  base_branch: string;
  head_branch: string;
  scope: string;
  breaking: ApiChange[];
  additive: ApiChange[];
  compatible_count: number;
  findings: AuditFinding[];
}

function renderMarkdown(report: DiffReport): string {
  const lines: string[] = [
    `## API Surface Diff`,
    `**Base:** ${report.base_branch} | **Head:** ${report.head_branch} | **Scope:** ${report.scope}`,
    "",
  ];

  if (report.breaking.length > 0) {
    lines.push("### Breaking Changes");
    lines.push("| File | Removed API |");
    lines.push("|------|-------------|");
    for (const c of report.breaking) {
      lines.push(`| ${c.file ?? "-"} | \`${c.line}\` |`);
    }
    lines.push("");
  }

  if (report.additive.length > 0) {
    lines.push("### Additive Changes");
    lines.push("| File | New API |");
    lines.push("|------|---------|");
    for (const c of report.additive) {
      lines.push(`| ${c.file ?? "-"} | \`${c.line}\` |`);
    }
    lines.push("");
  }

  lines.push("### Summary");
  lines.push(`- Breaking: ${report.breaking.length}`);
  lines.push(`- Additive: ${report.additive.length}`);
  lines.push(`- Compatible (internal): ${report.compatible_count}`);

  return lines.join("\n");
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerApiSurfaceDiffTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "api-surface-diff",
    "Run git diff between two branches and identify public API changes in Kotlin source files. Classifies changes as breaking, additive, or compatible.",
    {
      project_root: z.string().describe("Absolute path to the git project root"),
      base_branch: z.string().default("main").describe("Base branch for comparison (default: main)"),
      head_branch: z.string().optional().describe("Head branch or commit (default: HEAD)"),
      scope: z
        .enum(["commonMain", "all"])
        .default("commonMain")
        .describe("Scope of files to diff: commonMain (KMP shared) or all Kotlin files"),
    },
    async ({ project_root, base_branch = "main", head_branch, scope = "commonMain" }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "api-surface-diff");
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      const headRef = head_branch || "HEAD";
      const pathSpec =
        scope === "commonMain"
          ? "*/commonMain/**/*.kt"
          : "*.kt";

      let diffOutput: string;
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["diff", `${base_branch}..${headRef}`, "--", pathSpec],
          { cwd: project_root, maxBuffer: 10 * 1024 * 1024 },
        );
        diffOutput = stdout;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`api-surface-diff: git diff failed: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to run git diff: ${message}\n\nEnsure the path is a valid git repository and the branches exist.`,
            },
          ],
        };
      }

      if (!diffOutput.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No differences found between ${base_branch} and ${headRef} for scope "${scope}".`,
            },
          ],
        };
      }

      const allChanges = parseDiffOutput(diffOutput);
      const breaking = allChanges.filter((c) => c.type === "breaking");
      const additive = allChanges.filter((c) => c.type === "additive");
      const compatibleCount = allChanges.filter((c) => c.type === "compatible").length;

      // Emit findings
      const findings: AuditFinding[] = [];

      for (const change of breaking) {
        const dedupeKey = buildDedupeKey("api-breaking", change.file);
        findings.push(
          createFinding({
            dedupe_key: dedupeKey,
            severity: "HIGH",
            category: "architecture",
            source: "api-surface-diff",
            check: "api-breaking",
            title: `Breaking API change: ${change.line}`,
            file: change.file,
          }),
        );
      }

      for (const change of additive) {
        const dedupeKey = buildDedupeKey("api-addition", change.file);
        findings.push(
          createFinding({
            dedupe_key: dedupeKey,
            severity: "INFO",
            category: "architecture",
            source: "api-surface-diff",
            check: "api-addition",
            title: `New API: ${change.line}`,
            file: change.file,
          }),
        );
      }

      const report: DiffReport = {
        base_branch,
        head_branch: headRef,
        scope,
        breaking,
        additive,
        compatible_count: compatibleCount,
        findings,
      };

      const parts: string[] = [];
      parts.push("```json\n" + JSON.stringify(report, null, 2) + "\n```");
      parts.push(renderMarkdown(report));

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
      };
    },
  );
}
