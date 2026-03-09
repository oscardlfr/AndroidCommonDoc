/**
 * MCP tool: validate-all
 *
 * Consolidated meta-tool that runs all individual validation gates
 * and returns combined results. Mirrors the quality-gate-orchestrator
 * pattern from .claude/agents/.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runScript } from "../utils/script-runner.js";
import { getToolkitRoot } from "../utils/paths.js";
import { readdir } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import type {
  ValidationResult,
  ValidationDetail,
  ToolResult,
} from "../types/results.js";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";

interface ValidateAllResult {
  status: "PASS" | "FAIL";
  tools: ToolResult[];
  summary: string;
  duration_ms: number;
}

/**
 * Gate definitions mapping gate names to their execution functions.
 */
interface GateDefinition {
  name: string;
  execute: (root: string) => Promise<ValidationResult>;
}

/**
 * Run check-doc-freshness gate.
 */
async function runFreshnessGate(root: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const result = await runScript("check-doc-freshness", [], root);
  const durationMs = Date.now() - startTime;

  const lines = result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const details: ValidationDetail[] = [];
  let passCount = 0;
  let failCount = 0;

  for (const line of lines) {
    const match = line.trim().match(/^(PASS|FAIL|WARN|OK|ERROR):\s*(.+)/i);
    if (match) {
      const rawStatus = match[1].toUpperCase();
      const status =
        rawStatus === "OK"
          ? "PASS"
          : rawStatus === "ERROR"
            ? "FAIL"
            : (rawStatus as "PASS" | "FAIL" | "WARN");
      if (status === "PASS") passCount++;
      if (status === "FAIL") failCount++;
      details.push({ check: "doc-freshness", status, message: match[2] });
    }
  }

  if (details.length === 0) {
    details.push({
      check: "doc-freshness",
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      message: result.stdout.trim().substring(0, 500) || "No output",
    });
    if (result.exitCode === 0) passCount++;
    else failCount++;
  }

  return {
    status: result.exitCode !== 0 || failCount > 0 ? "FAIL" : "PASS",
    summary: `${passCount} passed, ${failCount} failed`,
    details,
    duration_ms: durationMs,
  };
}

/**
 * Run verify-kmp-packages gate (requires a KMP project to check).
 * In the toolkit context, this validates the toolkit's own structure.
 */
async function runKmpGate(root: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const result = await runScript("verify-kmp-packages", ["--project-root", root], root);
  const durationMs = Date.now() - startTime;

  const lines = result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const details: ValidationDetail[] = [];
  let passCount = 0;
  let failCount = 0;

  for (const line of lines) {
    const match = line.trim().match(/^(PASS|FAIL|WARN|OK|ERROR):\s*(.+)/i);
    if (match) {
      const rawStatus = match[1].toUpperCase();
      const status =
        rawStatus === "OK"
          ? "PASS"
          : rawStatus === "ERROR"
            ? "FAIL"
            : (rawStatus as "PASS" | "FAIL" | "WARN");
      if (status === "PASS") passCount++;
      if (status === "FAIL") failCount++;
      details.push({ check: "kmp-packages", status, message: match[2] });
    }
  }

  if (details.length === 0) {
    details.push({
      check: "kmp-packages",
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      message: result.stdout.trim().substring(0, 500) || "No output",
    });
    if (result.exitCode === 0) passCount++;
    else failCount++;
  }

  return {
    status: result.exitCode !== 0 || failCount > 0 ? "FAIL" : "PASS",
    summary: `${passCount} passed, ${failCount} failed`,
    details,
    duration_ms: durationMs,
  };
}

/**
 * Run check-version-sync gate.
 */
async function runVersionSyncGate(root: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const result = await runScript("check-version-sync", [], root);
  const durationMs = Date.now() - startTime;

  const lines = result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const details: ValidationDetail[] = [];
  let passCount = 0;
  let failCount = 0;

  for (const line of lines) {
    const match = line.trim().match(/^(PASS|FAIL|WARN|OK|ERROR):\s*(.+)/i);
    if (match) {
      const rawStatus = match[1].toUpperCase();
      const status =
        rawStatus === "OK"
          ? "PASS"
          : rawStatus === "ERROR"
            ? "FAIL"
            : (rawStatus as "PASS" | "FAIL" | "WARN");
      if (status === "PASS") passCount++;
      if (status === "FAIL") failCount++;
      details.push({ check: "version-sync", status, message: match[2] });
    }
  }

  if (details.length === 0) {
    details.push({
      check: "version-sync",
      status: result.exitCode === 0 ? "PASS" : "FAIL",
      message: result.stdout.trim().substring(0, 500) || "No output",
    });
    if (result.exitCode === 0) passCount++;
    else failCount++;
  }

  return {
    status: result.exitCode !== 0 || failCount > 0 ? "FAIL" : "PASS",
    summary: `${passCount} passed, ${failCount} failed`,
    details,
    duration_ms: durationMs,
  };
}

/**
 * Run script-parity gate (direct implementation).
 */
async function runScriptParityGate(root: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const shDir = path.join(root, "scripts", "sh");
  const ps1Dir = path.join(root, "scripts", "ps1");

  const details: ValidationDetail[] = [];
  let failCount = 0;

  try {
    const getNames = async (
      dirPath: string,
      ext: string,
    ): Promise<Set<string>> => {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        return new Set(
          entries
            .filter((e) => e.isFile() && e.name.endsWith(ext))
            .map((e) => e.name.replace(ext, "")),
        );
      } catch {
        return new Set();
      }
    };

    const shScripts = await getNames(shDir, ".sh");
    const ps1Scripts = await getNames(ps1Dir, ".ps1");

    for (const name of shScripts) {
      if (ps1Scripts.has(name)) {
        details.push({
          check: `parity-${name}`,
          status: "PASS",
          message: `${name}: both .sh and .ps1 exist`,
        });
      } else {
        failCount++;
        details.push({
          check: `parity-${name}`,
          status: "FAIL",
          message: `${name}: .sh exists but .ps1 missing`,
        });
      }
    }

    for (const name of ps1Scripts) {
      if (!shScripts.has(name)) {
        failCount++;
        details.push({
          check: `parity-${name}`,
          status: "FAIL",
          message: `${name}: .ps1 exists but .sh missing`,
        });
      }
    }
  } catch {
    failCount++;
    details.push({
      check: "script-parity",
      status: "FAIL",
      message: "Failed to read script directories",
    });
  }

  const durationMs = Date.now() - startTime;
  return {
    status: failCount > 0 ? "FAIL" : "PASS",
    summary: `${details.length - failCount}/${details.length} scripts have matching counterparts`,
    details,
    duration_ms: durationMs,
  };
}

/**
 * Run setup-check gate.
 */
async function runSetupCheckGate(root: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const details: ValidationDetail[] = [];
  let failCount = 0;

  const pathExists = async (p: string): Promise<boolean> => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  };

  // Check docs/
  const docsDir = path.join(root, "docs");
  const docsExists = await pathExists(docsDir);
  let docsHasMd = false;
  if (docsExists) {
    const entries = await readdir(docsDir);
    docsHasMd = entries.some((e) => e.endsWith(".md"));
  }
  details.push({
    check: "docs-directory",
    status: docsHasMd ? "PASS" : "FAIL",
    message: docsHasMd
      ? "docs/ directory exists with .md files"
      : "docs/ directory missing or empty",
  });
  if (!docsHasMd) failCount++;

  // Check scripts/sh/
  const shExists = await pathExists(path.join(root, "scripts", "sh"));
  details.push({
    check: "scripts-sh-directory",
    status: shExists ? "PASS" : "FAIL",
    message: shExists
      ? "scripts/sh/ directory exists"
      : "scripts/sh/ directory not found",
  });
  if (!shExists) failCount++;

  // Check scripts/ps1/
  const ps1Exists = await pathExists(path.join(root, "scripts", "ps1"));
  details.push({
    check: "scripts-ps1-directory",
    status: ps1Exists ? "PASS" : "FAIL",
    message: ps1Exists
      ? "scripts/ps1/ directory exists"
      : "scripts/ps1/ directory not found",
  });
  if (!ps1Exists) failCount++;

  // Check skills/
  const skillsDir = path.join(root, "skills");
  let skillsExist = false;
  if (await pathExists(skillsDir)) {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (await pathExists(path.join(skillsDir, entry.name, "SKILL.md")))
      ) {
        skillsExist = true;
        break;
      }
    }
  }
  details.push({
    check: "skills-directory",
    status: skillsExist ? "PASS" : "FAIL",
    message: skillsExist
      ? "skills/ directory exists with SKILL.md files"
      : "skills/ directory missing or has no SKILL.md files",
  });
  if (!skillsExist) failCount++;

  // Check .claude/agents/
  const agentsExist = await pathExists(path.join(root, ".claude", "agents"));
  details.push({
    check: "agents-directory",
    status: agentsExist ? "PASS" : "FAIL",
    message: agentsExist
      ? ".claude/agents/ directory exists"
      : ".claude/agents/ directory not found",
  });
  if (!agentsExist) failCount++;

  const durationMs = Date.now() - startTime;
  return {
    status: failCount > 0 ? "FAIL" : "PASS",
    summary: `${details.length - failCount}/${details.length} setup checks passed`,
    details,
    duration_ms: durationMs,
  };
}

const GATES: GateDefinition[] = [
  { name: "check-doc-freshness", execute: runFreshnessGate },
  { name: "verify-kmp-packages", execute: runKmpGate },
  { name: "check-version-sync", execute: runVersionSyncGate },
  { name: "script-parity", execute: runScriptParityGate },
  { name: "setup-check", execute: runSetupCheckGate },
];

export function registerValidateAllTool(
  server: McpServer,
  limiter?: RateLimiter,
): void {
  server.registerTool(
    "validate-all",
    {
      title: "Validate All",
      description:
        "Run all validation gates and return combined results. Mirrors the quality-gate-orchestrator pattern.",
      inputSchema: z.object({
        projectRoot: z
          .string()
          .optional()
          .describe(
            "Path to AndroidCommonDoc root (defaults to ANDROID_COMMON_DOC env var)",
          ),
        gates: z
          .array(z.string())
          .optional()
          .describe(
            "Filter to specific gates (e.g., ['setup-check', 'script-parity']). Runs all if omitted.",
          ),
      }),
    },
    async ({ projectRoot, gates }) => {
      const rateLimitResponse = checkRateLimit(limiter, "validate-all");
      if (rateLimitResponse) return rateLimitResponse;

      const root = projectRoot ?? getToolkitRoot();
      const startTime = Date.now();

      try {
        // Filter gates if specified
        const gatesToRun = gates
          ? GATES.filter((g) => gates.includes(g.name))
          : GATES;

        const toolResults: ToolResult[] = [];

        // Run gates sequentially to avoid resource contention
        for (const gate of gatesToRun) {
          try {
            const result = await gate.execute(root);
            toolResults.push({ tool: gate.name, result });
          } catch (error) {
            toolResults.push({
              tool: gate.name,
              result: {
                status: "ERROR",
                summary: `Gate failed: ${error instanceof Error ? error.message : String(error)}`,
                details: [],
                duration_ms: 0,
              },
            });
          }
        }

        const durationMs = Date.now() - startTime;
        const passedGates = toolResults.filter(
          (tr) => tr.result.status === "PASS",
        ).length;
        const totalGates = toolResults.length;
        const overallStatus: ValidateAllResult["status"] =
          passedGates === totalGates ? "PASS" : "FAIL";

        const combined: ValidateAllResult = {
          status: overallStatus,
          tools: toolResults,
          summary: `${passedGates}/${totalGates} gates passed`,
          duration_ms: durationMs,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(combined, null, 2) },
          ],
        };
      } catch (error) {
        const durationMs = Date.now() - startTime;
        logger.error(`validate-all failed: ${String(error)}`);

        const errorResult: ValidateAllResult = {
          status: "FAIL",
          tools: [],
          summary: `Meta-tool failed: ${error instanceof Error ? error.message : String(error)}`,
          duration_ms: durationMs,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(errorResult, null, 2) },
          ],
          isError: true,
        };
      }
    },
  );
}
