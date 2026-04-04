/**
 * MCP tool: validate-agents
 *
 * Validates agent templates and production agents for:
 * - Frontmatter completeness (name, description, tools, model, token_budget, template_version)
 * - Role keyword contracts (PM: TeamCreate, arch: APPROVE, etc.)
 * - Imperative instruction style (detects passive prose anti-patterns)
 * - Tool-body cross-reference (body tool references match frontmatter tools)
 * - Anti-pattern detection (missing triggers, Write on architects, named devs)
 * - Size limits (agents ≤400 lines)
 * - Migration version tracking (template_version present, in MIGRATIONS.json)
 *
 * Returns structured JSON with errors, warnings, and summary counts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../registry/frontmatter.js";
import { getToolkitRoot } from "../utils/paths.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationIssue {
  level: "error" | "warning";
  category: string;
  file: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Role keyword contracts
// ---------------------------------------------------------------------------

const ROLE_KEYWORDS: Record<string, string[]> = {
  "project-manager": [
    "TeamCreate",
    "SendMessage",
    "FORBIDDEN",
    "ALLOWED",
    "IMMEDIATELY",
    "DISPOSABLE",
    "PHASE TRANSITIONS ARE AUTOMATIC",
  ],
  planner: ["SendMessage", "Planning Team"],
  "quality-gater": ["SendMessage", "PASS", "FAIL"],
  "arch-testing": ["SendMessage", "APPROVE", "ESCALATE"],
  "arch-platform": ["SendMessage", "APPROVE", "ESCALATE"],
  "arch-integration": ["SendMessage", "APPROVE", "ESCALATE"],
  "context-provider": ["MANDATORY"],
  "doc-updater": ["MANDATORY"],
  "doc-migrator": ["Full Migration", "Gap Fill", "Realignment"],
};

// Passive prose patterns that indicate documentation instead of instructions
const PASSIVE_PATTERNS = [
  /^Teams are /m,
  /^Agents are /m,
  /^Work is /m,
  /^The team /m,
  /^This section describes/m,
  /^The following /m,
  /^In this model/m,
];

// Tool call patterns to detect in body
const TOOL_PATTERNS: Record<string, RegExp> = {
  TeamCreate: /TeamCreate\(/,
  Agent: /Agent\(/,
  SendMessage: /SendMessage\(/,
  Write: /Write\(/,
  Edit: /Edit\(/,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract body content after the second --- delimiter */
function getBody(content: string): string {
  const parts = content.split("---");
  return parts.length >= 3 ? parts.slice(2).join("---") : "";
}

/** Strip fenced code blocks from body */
function stripCodeFences(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "");
}

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

async function loadAgentFiles(
  dir: string,
): Promise<Array<{ path: string; name: string; content: string }>> {
  const files: Array<{ path: string; name: string; content: string }> = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (entry.name === "README.md") continue;
      const filePath = path.join(dir, entry.name);
      const content = await readFile(filePath, "utf-8");
      files.push({ path: filePath, name: entry.name, content });
    }
  } catch {
    // Directory doesn't exist — not an error
  }
  return files;
}

function validateFrontmatter(
  files: Array<{ name: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const required = ["name", "description", "tools"];
  const recommended = ["model", "token_budget"];

  for (const file of files) {
    const fm = parseFrontmatter(file.content);
    const data: Record<string, unknown> = fm?.data ?? {};

    for (const field of required) {
      if (!data[field]) {
        issues.push({
          level: "error",
          category: "frontmatter",
          file: file.name,
          message: `Missing required field: ${field}`,
        });
      }
    }

    for (const field of recommended) {
      if (!data[field]) {
        issues.push({
          level: "warning",
          category: "frontmatter",
          file: file.name,
          message: `Missing recommended field: ${field}`,
        });
      }
    }
  }
  return issues;
}

function validateRoleKeywords(
  files: Array<{ name: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const fm = parseFrontmatter(file.content);
    const agentName = (fm?.data as Record<string, unknown>)?.name as string;
    if (!agentName || !ROLE_KEYWORDS[agentName]) continue;

    const body = getBody(file.content);
    const toolsField = String(
      (fm?.data as Record<string, unknown>)?.tools ?? "",
    );

    for (const keyword of ROLE_KEYWORDS[agentName]) {
      const inBody = body.toLowerCase().includes(keyword.toLowerCase());
      const inTools = toolsField.toLowerCase().includes(keyword.toLowerCase());
      if (!inBody && !inTools) {
        issues.push({
          level: "error",
          category: "role-keywords",
          file: file.name,
          message: `Missing required keyword for ${agentName}: "${keyword}"`,
        });
      }
    }
  }
  return issues;
}

function validateImperativeStyle(
  files: Array<{ name: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const bodyNoFences = stripCodeFences(getBody(file.content));

    for (const pattern of PASSIVE_PATTERNS) {
      const matches = bodyNoFences.match(pattern);
      if (matches) {
        issues.push({
          level: "warning",
          category: "imperative-style",
          file: file.name,
          message: `Passive prose detected: "${matches[0].trim()}"`,
        });
      }
    }
  }
  return issues;
}

function validateToolBodyXref(
  files: Array<{ name: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const fm = parseFrontmatter(file.content);
    const toolsField = String(
      (fm?.data as Record<string, unknown>)?.tools ?? "",
    ).toLowerCase();
    const bodyNoFences = stripCodeFences(getBody(file.content));

    for (const [toolName, pattern] of Object.entries(TOOL_PATTERNS)) {
      if (pattern.test(bodyNoFences)) {
        if (!toolsField.includes(toolName.toLowerCase())) {
          // Skip WRONG/FORBIDDEN examples
          const context = bodyNoFences
            .split("\n")
            .filter((line) => pattern.test(line))
            .join(" ");
          if (/WRONG|NEVER|FORBIDDEN|CANNOT/i.test(context)) continue;

          issues.push({
            level: "warning",
            category: "tool-body-xref",
            file: file.name,
            message: `Body references "${toolName}" but not in frontmatter tools`,
          });
        }
      }
    }
  }
  return issues;
}

function validateAntiPatterns(
  files: Array<{ name: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const fm = parseFrontmatter(file.content);
    const agentName = (fm?.data as Record<string, unknown>)?.name as string;
    const toolsField = String(
      (fm?.data as Record<string, unknown>)?.tools ?? "",
    );
    const bodyNoFences = stripCodeFences(getBody(file.content));

    // PM must have phase transition enforcement
    if (agentName === "project-manager") {
      if (!/PHASE TRANSITIONS ARE AUTOMATIC|STOP PLANNING/i.test(bodyNoFences)) {
        issues.push({
          level: "warning",
          category: "anti-patterns",
          file: file.name,
          message: "PM missing phase transition enforcement rule",
        });
      }
      if (!/DISPOSABLE/i.test(bodyNoFences)) {
        issues.push({
          level: "warning",
          category: "anti-patterns",
          file: file.name,
          message: "PM missing DISPOSABLE dev rule",
        });
      }
      if (!/TeamDelete/i.test(toolsField)) {
        issues.push({
          level: "warning",
          category: "anti-patterns",
          file: file.name,
          message: "PM missing TeamDelete in tools (causes team zombies)",
        });
      }
    }

    // Architects must NOT have Write/Edit
    if (agentName?.startsWith("arch-")) {
      if (/Write|Edit/i.test(toolsField)) {
        issues.push({
          level: "error",
          category: "anti-patterns",
          file: file.name,
          message: "Architect has Write/Edit in tools — architects are read-only",
        });
      }
    }

    // Planner/quality-gater must be "peer" not "sub-agent"
    if (agentName === "planner" || agentName === "quality-gater") {
      if (/sub-agent spawned by PM/i.test(bodyNoFences)) {
        issues.push({
          level: "error",
          category: "anti-patterns",
          file: file.name,
          message: `${agentName} describes self as sub-agent — should be "team peer"`,
        });
      }
    }
  }
  return issues;
}

function validateSizeLimits(
  files: Array<{ name: string; content: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const MAX_LINES = 400;

  for (const file of files) {
    const lines = file.content.split("\n").length;
    if (lines > MAX_LINES) {
      issues.push({
        level: "error",
        category: "size-limits",
        file: file.name,
        message: `${lines} lines (limit: ${MAX_LINES})`,
      });
    }
  }
  return issues;
}

function validateVersioning(
  files: Array<{ name: string; content: string }>,
  migrations: Record<string, unknown> | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const fm = parseFrontmatter(file.content);
    const data = fm?.data as Record<string, unknown>;
    const agentName = data?.name as string;
    const version = data?.template_version as string;

    if (!version) {
      issues.push({
        level: "warning",
        category: "versioning",
        file: file.name,
        message: "Missing template_version in frontmatter",
      });
    } else if (migrations && agentName) {
      // Skip placeholder names
      if (agentName.includes("{{")) continue;

      const templates = migrations as Record<string, Record<string, unknown>>;
      if (!templates[agentName]) {
        issues.push({
          level: "warning",
          category: "versioning",
          file: file.name,
          message: `Agent "${agentName}" not found in MIGRATIONS.json`,
        });
      } else if (!templates[agentName][version]) {
        issues.push({
          level: "warning",
          category: "versioning",
          file: file.name,
          message: `Version ${version} not found in MIGRATIONS.json for "${agentName}"`,
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function validateAgents(
  rootDir: string,
): Promise<ValidationResult> {
  const allIssues: ValidationIssue[] = [];

  // Load files from both templates and production agents
  const templatesDir = path.join(rootDir, "setup", "agent-templates");
  const agentsDir = path.join(rootDir, ".claude", "agents");

  const templateFiles = await loadAgentFiles(templatesDir);
  const agentFiles = await loadAgentFiles(agentsDir);
  const allFiles = [...templateFiles, ...agentFiles];

  if (allFiles.length === 0) {
    return {
      valid: true,
      errors: 0,
      warnings: 0,
      issues: [],
      summary: "No agent files found",
    };
  }

  // Load MIGRATIONS.json
  let migrations: Record<string, unknown> | null = null;
  try {
    const migrationsPath = path.join(templatesDir, "MIGRATIONS.json");
    const migrationsContent = await readFile(migrationsPath, "utf-8");
    const parsed = JSON.parse(migrationsContent);
    migrations = parsed.templates ?? null;
  } catch {
    // No migrations file — skip version checks
  }

  // Run all checks
  allIssues.push(...validateFrontmatter(allFiles));
  allIssues.push(...validateRoleKeywords(allFiles));
  allIssues.push(...validateImperativeStyle(allFiles));
  allIssues.push(...validateToolBodyXref(allFiles));
  allIssues.push(...validateAntiPatterns(allFiles));
  allIssues.push(...validateSizeLimits(allFiles));
  allIssues.push(...validateVersioning(templateFiles, migrations));

  const errors = allIssues.filter((i) => i.level === "error").length;
  const warnings = allIssues.filter((i) => i.level === "warning").length;

  return {
    valid: errors === 0,
    errors,
    warnings,
    issues: allIssues,
    summary: `Agent validation: ${allFiles.length} files, ${errors} error(s), ${warnings} warning(s)`,
  };
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

export function registerValidateAgentsTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-agents",
    {
      title: "Validate Agents",
      description:
        "Validates agent templates and production agents: frontmatter, role keywords, imperative style, tool-body xref, anti-patterns, size limits, versioning. Returns structured JSON.",
      inputSchema: z.object({}),
    },
    async () => {
      const rateLimitResponse = checkRateLimit(limiter, "validate-agents");
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const rootDir = getToolkitRoot();
        const result = await validateAgents(rootDir);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.error(`validate-agents error: ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: message }),
            },
          ],
        };
      }
    },
  );
}
