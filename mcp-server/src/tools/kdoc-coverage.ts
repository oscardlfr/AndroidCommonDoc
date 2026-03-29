/**
 * MCP tool: kdoc-coverage
 *
 * Measures KDoc documentation coverage on public Kotlin APIs.
 * Scans .kt files for public declarations (classes, interfaces, functions,
 * properties, objects) and checks whether each has a preceding KDoc block.
 * Reports per-module coverage percentages and lists undocumented symbols.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import { parseSettingsModules } from "../utils/gradle-parser.js";

// ── Types ───────────────────────────────────────────────────────────────────

type SymbolType = "class" | "interface" | "object" | "function" | "property" | "enum";

interface UndocumentedSymbol {
  file: string;
  line: number;
  type: SymbolType;
  name: string;
}

interface ModuleCoverage {
  module: string;
  total_public: number;
  documented: number;
  coverage_pct: number;
  undocumented: UndocumentedSymbol[];
}

interface CoverageResult {
  modules: ModuleCoverage[];
  overall_coverage: number;
  changed_files_coverage?: number;
}

// ── File walker (same pattern as code-metrics.ts) ───────────────────────────

function walkDir(dir: string, filter: (name: string) => boolean): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, filter));
    } else if (filter(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Skip test source directories (same heuristic as code-metrics.ts). */
function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return (
    segments.some((s) => s === "test" || s === "androidTest" || s === "testFixtures") ||
    normalized.endsWith("Test.kt")
  );
}

// ── KDoc detection ──────────────────────────────────────────────────────────

/** Visibility modifiers that make a declaration non-public. */
const NON_PUBLIC_MODIFIERS = /\b(private|internal|protected)\b/;

/** Matches an `override` modifier — overrides inherit parent KDoc. */
const OVERRIDE_RE = /\boverride\b/;

/** Matches `actual` keyword for expect/actual KMP declarations. */
const ACTUAL_RE = /\bactual\b/;

/**
 * Regexes for public API declarations.
 * Each captures the symbol name in group 1.
 */
const DECLARATION_PATTERNS: Array<{ re: RegExp; type: SymbolType }> = [
  { re: /\benum\s+class\s+(\w+)/, type: "enum" },
  // Function: handles regular `fun name(`, extension `fun Type.name(`,
  // generic `fun <T> name(`, and generic receiver `fun <T> List<T>.name(`
  { re: /\bfun\s+(?:<[^>]+>\s+)?(?:[\w<>,\s]+\.)?(\w+)\s*\(/, type: "function" },
  { re: /\bclass\s+(\w+)/, type: "class" },
  { re: /\binterface\s+(\w+)/, type: "interface" },
  { re: /\bobject\s+(\w+)/, type: "object" },
  { re: /\bval\s+(?:\w+\.)*(\w+)\s*[:=]/, type: "property" },
  { re: /\bvar\s+(?:\w+\.)*(\w+)\s*[:=]/, type: "property" },
];

/**
 * Build a map of which lines are inside block comments (not KDoc).
 * Simple heuristic tracking slash-star ... star-slash nesting.
 */
function buildCommentMap(lines: string[]): boolean[] {
  const inComment: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inside) {
      inComment[i] = true;
      if (line.includes("*/")) {
        inside = false;
      }
    } else {
      if (line.includes("/*") && !line.includes("/**")) {
        inside = true;
        inComment[i] = true;
        if (line.includes("*/")) inside = false;
      }
    }
  }

  return inComment;
}

/**
 * Look backward from a declaration line to find a KDoc block.
 * Allows annotations (lines starting with @) between KDoc and declaration.
 */
function hasKDoc(lines: string[], declLine: number): boolean {
  let i = declLine - 1;

  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("@") || trimmed.startsWith("//")) {
      i--;
      continue;
    }
    if (trimmed.endsWith("*/")) {
      let j = i;
      while (j >= 0) {
        if (lines[j].trim().startsWith("/**")) {
          return true;
        }
        j--;
      }
      return false;
    }
    return false;
  }

  return false;
}

/**
 * Analyze a single .kt file for public API declarations and KDoc coverage.
 * Exported for direct use in tests.
 */
export function analyzeFile(
  filePath: string,
  content: string,
): { total: number; documented: number; undocumented: UndocumentedSymbol[] } {
  const lines = content.split("\n");
  const commentMap = buildCommentMap(lines);
  const relativePath = filePath.replace(/\\/g, "/");

  let total = 0;
  let documented = 0;
  const undocumented: UndocumentedSymbol[] = [];

  // Scope tracking: stack of scope types to distinguish class body from function body.
  // "file" = top-level, "class" = class/interface/object/enum body, "function" = function body.
  // Properties (val/var) inside "function" scope are local variables — skip them.
  const scopeStack: Array<"file" | "class" | "function"> = ["file"];
  let braceDepth = 0;

  /** Regex to detect lines that open a class/interface/object/enum scope. */
  const CLASS_OPENER = /\b(class|interface|object|enum)\s+\w+/;
  /** Regex to detect lines that open a function scope. */
  const FUN_OPENER = /\bfun\s+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track braces and scope for ALL lines (including comments)
    for (const ch of line) {
      if (ch === "{") {
        braceDepth++;
        // Determine what scope this brace opens (check the line content)
        if (!commentMap[i]) {
          const trimmedLine = line.trim();
          if (CLASS_OPENER.test(trimmedLine)) {
            scopeStack.push("class");
          } else if (FUN_OPENER.test(trimmedLine)) {
            scopeStack.push("function");
          } else {
            // Lambda, init block, etc. — inherit parent scope type
            const parent = scopeStack[scopeStack.length - 1] ?? "file";
            scopeStack.push(parent === "class" ? "function" : parent);
          }
        } else {
          scopeStack.push(scopeStack[scopeStack.length - 1] ?? "file");
        }
      } else if (ch === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        if (scopeStack.length > 1) scopeStack.pop();
      }
    }

    if (commentMap[i]) continue;

    const trimmed = line.trim();
    // Current scope BEFORE this line's braces were processed
    // We need the scope at the point of the declaration
    const currentScope = scopeStack[scopeStack.length - 1] ?? "file";

    if (NON_PUBLIC_MODIFIERS.test(trimmed)) continue;
    if (OVERRIDE_RE.test(trimmed)) continue;
    if (ACTUAL_RE.test(trimmed)) continue;
    if (trimmed.startsWith("//")) continue;

    for (const { re, type } of DECLARATION_PATTERNS) {
      const match = re.exec(trimmed);
      if (match) {
        // Skip local variables: val/var inside function bodies are not public API
        if (type === "property" && currentScope === "function") {
          break;
        }

        total++;
        if (hasKDoc(lines, i)) {
          documented++;
        } else {
          undocumented.push({
            file: relativePath,
            line: i + 1,
            type,
            name: match[1],
          });
        }
        break;
      }
    }
  }

  return { total, documented, undocumented };
}

// ── Module analysis ─────────────────────────────────────────────────────────

function analyzeModule(
  moduleDir: string,
  moduleName: string,
  changedFiles?: Set<string>,
): ModuleCoverage {
  let ktFiles = walkDir(moduleDir, (name) => name.endsWith(".kt"));
  ktFiles = ktFiles.filter((f) => !isTestPath(f));

  if (changedFiles) {
    ktFiles = ktFiles.filter((f) => {
      const normalized = f.replace(/\\/g, "/");
      return Array.from(changedFiles).some(
        (cf) => normalized.endsWith(cf) || normalized.includes(cf),
      );
    });
  }

  let totalPublic = 0;
  let totalDocumented = 0;
  const allUndocumented: UndocumentedSymbol[] = [];

  for (const filePath of ktFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const result = analyzeFile(filePath, content);
    totalPublic += result.total;
    totalDocumented += result.documented;
    allUndocumented.push(...result.undocumented);
  }

  return {
    module: moduleName,
    total_public: totalPublic,
    documented: totalDocumented,
    coverage_pct: totalPublic > 0
      ? Math.round((totalDocumented / totalPublic) * 1000) / 10
      : 100,
    undocumented: allUndocumented,
  };
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function renderMarkdown(result: CoverageResult): string {
  const lines: string[] = [
    "## KDoc Coverage",
    "",
    "| Module | Public APIs | Documented | Coverage |",
    "|--------|------------|------------|----------|",
  ];

  for (const m of result.modules) {
    lines.push(
      `| ${m.module} | ${m.total_public} | ${m.documented} | ${m.coverage_pct}% |`,
    );
  }

  const totalPub = result.modules.reduce((s, m) => s + m.total_public, 0);
  const totalDoc = result.modules.reduce((s, m) => s + m.documented, 0);
  lines.push(
    `| **Overall** | **${totalPub}** | **${totalDoc}** | **${result.overall_coverage}%** |`,
  );

  if (result.changed_files_coverage !== undefined) {
    lines.push("", `**Changed files coverage**: ${result.changed_files_coverage}%`);
  }

  const allUndoc = result.modules.flatMap((m) => m.undocumented);
  if (allUndoc.length > 0) {
    lines.push("", "### Undocumented Public APIs", "");
    const shown = allUndoc.slice(0, 30);
    for (const u of shown) {
      lines.push(`- \`${u.name}\` (${u.type}) — ${u.file}:${u.line}`);
    }
    if (allUndoc.length > 30) {
      lines.push(`- ... and ${allUndoc.length - 30} more`);
    }
  }

  return lines.join("\n");
}

// ── Audit log persistence ───────────────────────────────────────────────────

function persistCoverage(projectRoot: string, result: CoverageResult): void {
  const auditDir = path.join(projectRoot, ".androidcommondoc");
  mkdirSync(auditDir, { recursive: true });

  const logPath = path.join(auditDir, "audit-log.jsonl");
  const entry = {
    ts: new Date().toISOString(),
    event: "kdoc_coverage",
    data: {
      modules: result.modules.length,
      overall_coverage: result.overall_coverage,
      total_public: result.modules.reduce((s, m) => s + m.total_public, 0),
      total_documented: result.modules.reduce((s, m) => s + m.documented, 0),
      per_module: result.modules.map((m) => ({
        module: m.module,
        total_public: m.total_public,
        documented: m.documented,
        coverage_pct: m.coverage_pct,
      })),
    },
  };

  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerKdocCoverageTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "kdoc-coverage",
    "Measure KDoc documentation coverage on public Kotlin APIs. Reports per-module coverage percentages and lists undocumented symbols.",
    {
      project_root: z.string().describe("Absolute path to the project root"),
      modules: z
        .array(z.string())
        .optional()
        .describe("Specific module paths (default: auto-detect from settings.gradle.kts)"),
      changed_files: z
        .array(z.string())
        .optional()
        .describe("Only analyze these files (quality gate mode)"),
      format: z
        .enum(["json", "markdown", "both"])
        .default("both")
        .describe("Output format (default: both)"),
      persist: z
        .boolean()
        .default(true)
        .describe("Write kdoc_coverage event to audit-log.jsonl (default: true)"),
    },
    async ({ project_root, modules, changed_files, format = "both", persist = true }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "kdoc-coverage");
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      let moduleList: string[];

      if (modules && modules.length > 0) {
        moduleList = modules;
      } else {
        const settingsPath = path.join(project_root, "settings.gradle.kts");
        try {
          const parsed = await parseSettingsModules(settingsPath);
          moduleList = parsed.map((m) => m.replace(/^:/, "").replace(/:/g, "/"));
        } catch {
          moduleList = ["."];
        }
      }

      const changedSet = changed_files ? new Set(changed_files) : undefined;
      const moduleCoverages: ModuleCoverage[] = [];

      for (const mod of moduleList) {
        const moduleDir = mod === "." ? project_root : path.join(project_root, mod);

        let stat;
        try {
          stat = statSync(moduleDir);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;

        const coverage = analyzeModule(moduleDir, mod, changedSet);
        if (coverage.total_public > 0 || !changedSet) {
          moduleCoverages.push(coverage);
        }
      }

      const totalPublic = moduleCoverages.reduce((s, m) => s + m.total_public, 0);
      const totalDocumented = moduleCoverages.reduce((s, m) => s + m.documented, 0);

      const result: CoverageResult = {
        modules: moduleCoverages,
        overall_coverage: totalPublic > 0
          ? Math.round((totalDocumented / totalPublic) * 1000) / 10
          : 100,
      };

      if (changedSet) {
        result.changed_files_coverage = result.overall_coverage;
      }

      if (moduleCoverages.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No Kotlin files found in any module. Ensure project_root points to a Kotlin project.",
            },
          ],
        };
      }

      if (persist) {
        try {
          persistCoverage(project_root, result);
          logger.info(`kdoc-coverage: persisted for ${moduleCoverages.length} modules`);
        } catch (err) {
          logger.error(`kdoc-coverage: failed to persist: ${err}`);
        }
      }

      const parts: string[] = [];

      if (format === "json" || format === "both") {
        parts.push("```json\n" + JSON.stringify(result, null, 2) + "\n```");
      }
      if (format === "markdown" || format === "both") {
        parts.push(renderMarkdown(result));
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
      };
    },
  );
}
