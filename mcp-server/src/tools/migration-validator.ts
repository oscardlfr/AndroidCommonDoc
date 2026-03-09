/**
 * MCP tool: migration-validator
 *
 * Validates database migration files for Room and SQLDelight projects.
 * Detects version gaps, non-sequential migrations, and unguarded
 * destructive operations (DROP TABLE/COLUMN without backup).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RateLimiter } from "../utils/rate-limiter.js";
import { checkRateLimit } from "../utils/rate-limit-guard.js";
import { logger } from "../utils/logger.js";
import type { AuditFinding } from "../types/findings.js";
import { createFinding, buildDedupeKey } from "../types/findings.js";

// ── File walker ──────────────────────────────────────────────────────────────

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

// ── Room migration analysis ──────────────────────────────────────────────────

interface MigrationInfo {
  file: string;
  from: number;
  to: number;
  hasDestructive: boolean;
  hasBackup: boolean;
  content: string;
}

function parseRoomMigrations(rootDir: string, modulePath?: string): MigrationInfo[] {
  const searchDir = modulePath ? path.join(rootDir, modulePath) : rootDir;
  const migrationFiles = walkDir(searchDir, (name) =>
    /Migration/i.test(name) && name.endsWith(".kt"),
  );

  const migrations: MigrationInfo[] = [];

  for (const filePath of migrationFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Match Migration(X, Y) pattern
    const migrationRegex = /Migration\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = migrationRegex.exec(content)) !== null) {
      const from = parseInt(match[1], 10);
      const to = parseInt(match[2], 10);

      const hasDestructive =
        /DROP\s+TABLE/i.test(content) || /DROP\s+COLUMN/i.test(content);

      // Check for backup indicators: CREATE TABLE ... AS SELECT, or INSERT INTO ... SELECT
      const hasBackup =
        /CREATE\s+TABLE\s+\S+\s+AS\s+SELECT/i.test(content) ||
        /INSERT\s+INTO\s+\S+\s+SELECT/i.test(content) ||
        /backup/i.test(content);

      migrations.push({
        file: path.relative(rootDir, filePath),
        from,
        to,
        hasDestructive,
        hasBackup,
        content,
      });
    }
  }

  return migrations;
}

// ── SQLDelight migration analysis ────────────────────────────────────────────

interface SqmInfo {
  file: string;
  version: number;
  hasDestructive: boolean;
  hasBackup: boolean;
}

function parseSqlDelightMigrations(rootDir: string, modulePath?: string): SqmInfo[] {
  const searchDir = modulePath ? path.join(rootDir, modulePath) : rootDir;
  const sqmFiles = walkDir(searchDir, (name) => name.endsWith(".sqm"));

  const migrations: SqmInfo[] = [];

  for (const filePath of sqmFiles) {
    const baseName = path.basename(filePath, ".sqm");
    const version = parseInt(baseName, 10);
    if (isNaN(version)) continue;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const hasDestructive =
      /DROP\s+TABLE/i.test(content) || /DROP\s+COLUMN/i.test(content);

    const hasBackup =
      /CREATE\s+TABLE\s+\S+\s+AS\s+SELECT/i.test(content) ||
      /INSERT\s+INTO\s+\S+\s+SELECT/i.test(content) ||
      /backup/i.test(content);

    migrations.push({
      file: path.relative(rootDir, filePath),
      version,
      hasDestructive,
      hasBackup,
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

// ── Auto-detect database type ────────────────────────────────────────────────

function autoDetectDbType(rootDir: string, modulePath?: string): "room" | "sqldelight" | null {
  const searchDir = modulePath ? path.join(rootDir, modulePath) : rootDir;

  const hasMigrationKt = walkDir(searchDir, (name) =>
    /Migration/i.test(name) && name.endsWith(".kt"),
  ).length > 0;

  const hasSqm = walkDir(searchDir, (name) => name.endsWith(".sqm")).length > 0;

  if (hasMigrationKt && !hasSqm) return "room";
  if (hasSqm && !hasMigrationKt) return "sqldelight";
  if (hasMigrationKt) return "room"; // prefer Room when both exist
  return null;
}

// ── Validation logic ─────────────────────────────────────────────────────────

interface ValidationResult {
  db_type: "room" | "sqldelight";
  migrations_found: number;
  issues: string[];
  findings: AuditFinding[];
}

function validateRoom(rootDir: string, modulePath?: string): ValidationResult {
  const migrations = parseRoomMigrations(rootDir, modulePath);
  const issues: string[] = [];
  const findings: AuditFinding[] = [];

  if (migrations.length === 0) {
    return { db_type: "room", migrations_found: 0, issues: ["No Room migrations found"], findings };
  }

  // Sort by from version
  const sorted = [...migrations].sort((a, b) => a.from - b.from);

  // Check sequential: each migration should go from N to N+1
  for (const m of sorted) {
    if (m.to !== m.from + 1) {
      const msg = `Migration in ${m.file} jumps from version ${m.from} to ${m.to} (expected ${m.from + 1})`;
      issues.push(msg);
      findings.push(
        createFinding({
          dedupe_key: buildDedupeKey("migration-non-sequential", m.file),
          severity: "MEDIUM",
          category: "architecture",
          source: "migration-validator",
          check: "migration-non-sequential",
          title: msg,
          file: m.file,
        }),
      );
    }
  }

  // Check for gaps in the version chain
  const fromVersions = new Set(sorted.map((m) => m.from));
  const minFrom = Math.min(...sorted.map((m) => m.from));
  const maxTo = Math.max(...sorted.map((m) => m.to));

  for (let v = minFrom; v < maxTo; v++) {
    if (!fromVersions.has(v)) {
      const msg = `Missing migration from version ${v} to ${v + 1}`;
      issues.push(msg);
      findings.push(
        createFinding({
          dedupe_key: buildDedupeKey("migration-gap", undefined, v),
          severity: "MEDIUM",
          category: "architecture",
          source: "migration-validator",
          check: "migration-gap",
          title: msg,
        }),
      );
    }
  }

  // Check destructive operations without backup
  for (const m of sorted) {
    if (m.hasDestructive && !m.hasBackup) {
      const msg = `Destructive operation (DROP) in ${m.file} without backup/migration guard`;
      issues.push(msg);
      findings.push(
        createFinding({
          dedupe_key: buildDedupeKey("migration-destructive-unguarded", m.file),
          severity: "HIGH",
          category: "architecture",
          source: "migration-validator",
          check: "migration-destructive-unguarded",
          title: msg,
          file: m.file,
          suggestion: "Add CREATE TABLE ... AS SELECT backup before DROP, or INSERT INTO ... SELECT to preserve data.",
        }),
      );
    }
  }

  return { db_type: "room", migrations_found: migrations.length, issues, findings };
}

function validateSqlDelight(rootDir: string, modulePath?: string): ValidationResult {
  const migrations = parseSqlDelightMigrations(rootDir, modulePath);
  const issues: string[] = [];
  const findings: AuditFinding[] = [];

  if (migrations.length === 0) {
    return { db_type: "sqldelight", migrations_found: 0, issues: ["No SQLDelight migrations found"], findings };
  }

  // Check sequential numbering
  for (let i = 0; i < migrations.length - 1; i++) {
    const current = migrations[i];
    const next = migrations[i + 1];
    if (next.version !== current.version + 1) {
      const msg = `Gap in SQLDelight migrations: ${current.version}.sqm -> ${next.version}.sqm (missing ${current.version + 1}.sqm)`;
      issues.push(msg);
      findings.push(
        createFinding({
          dedupe_key: buildDedupeKey("sqm-gap", undefined, current.version + 1),
          severity: "MEDIUM",
          category: "architecture",
          source: "migration-validator",
          check: "sqm-gap",
          title: msg,
        }),
      );
    }
  }

  // Check destructive operations without backup
  for (const m of migrations) {
    if (m.hasDestructive && !m.hasBackup) {
      const msg = `Destructive operation (DROP) in ${m.file} without backup`;
      issues.push(msg);
      findings.push(
        createFinding({
          dedupe_key: buildDedupeKey("sqm-destructive-unguarded", m.file),
          severity: "HIGH",
          category: "architecture",
          source: "migration-validator",
          check: "sqm-destructive-unguarded",
          title: msg,
          file: m.file,
          suggestion: "Add backup SELECT before DROP to preserve data during migration.",
        }),
      );
    }
  }

  return { db_type: "sqldelight", migrations_found: migrations.length, issues, findings };
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(result: ValidationResult): string {
  const status = result.findings.length === 0 ? "PASS" : "ISSUES FOUND";
  const lines: string[] = [
    `## Migration Validation -- ${result.db_type}`,
    `**Status:** ${status} | **Migrations found:** ${result.migrations_found}`,
    "",
  ];

  if (result.issues.length === 0) {
    lines.push("All migrations are sequential with no unguarded destructive operations.");
  } else {
    lines.push("| # | Severity | Issue |");
    lines.push("|---|----------|-------|");
    result.findings.forEach((f, i) => {
      lines.push(`| ${i + 1} | ${f.severity} | ${f.title} |`);
    });
  }

  return lines.join("\n");
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerMigrationValidatorTool(
  server: McpServer,
  rateLimiter: RateLimiter,
): void {
  server.tool(
    "migration-validator",
    "Validate database migration files for Room and SQLDelight projects. Detects version gaps, non-sequential migrations, and unguarded destructive operations.",
    {
      project_root: z.string().describe("Absolute path to the project root"),
      db_type: z
        .enum(["room", "sqldelight", "auto"])
        .default("auto")
        .describe("Database type to validate (auto-detects if not specified)"),
      module_path: z
        .string()
        .optional()
        .describe("Relative path to a specific module within the project"),
    },
    async ({ project_root, db_type = "auto", module_path }) => {
      const rateLimitResponse = checkRateLimit(rateLimiter, "migration-validator");
      if (rateLimitResponse) {
        return rateLimitResponse;
      }

      let effectiveDbType: "room" | "sqldelight";

      if (db_type === "auto") {
        const detected = autoDetectDbType(project_root, module_path);
        if (!detected) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No migration files found. Could not auto-detect database type.\n\nLook for *Migration*.kt files (Room) or *.sqm files (SQLDelight).",
              },
            ],
          };
        }
        effectiveDbType = detected;
        logger.info(`migration-validator: auto-detected ${effectiveDbType}`);
      } else {
        effectiveDbType = db_type;
      }

      let result: ValidationResult;
      try {
        if (effectiveDbType === "room") {
          result = validateRoom(project_root, module_path);
        } else {
          result = validateSqlDelight(project_root, module_path);
        }
      } catch (err) {
        logger.error(`migration-validator: validation failed: ${err}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Migration validation failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }

      const parts: string[] = [];
      parts.push("```json\n" + JSON.stringify(result, null, 2) + "\n```");
      parts.push(renderMarkdown(result));

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n---\n\n") }],
      };
    },
  );
}
