/**
 * Tests for the migration-validator MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates temporary project structures with Room migration files
 * and SQLDelight .sqm files to test validation logic.
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
import { registerMigrationValidatorTool } from "../../../src/tools/migration-validator.js";
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
  "migration-validator-test-" + process.pid,
);
const PROJECT_ROOT = path.join(TEST_ROOT, "test-project");

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(PROJECT_ROOT, { recursive: true });
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerMigrationValidatorTool(server, limiter);

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
    name: "migration-validator",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

function writeRoomMigration(
  modulePath: string,
  fileName: string,
  content: string,
): void {
  const dir = path.join(PROJECT_ROOT, modulePath, "src", "main", "kotlin", "db");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content, "utf-8");
}

function writeSqmFile(
  modulePath: string,
  version: number,
  content: string,
): void {
  const dir = path.join(PROJECT_ROOT, modulePath, "src", "main", "sqldelight", "migrations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${version}.sqm`), content, "utf-8");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("migration-validator tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "migration-validator");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("migration");
  });

  it("returns no-migration message when no files found", async () => {
    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "auto",
    });

    const text = extractText(result);
    expect(text).toContain("No migration files found");
  });

  // ── Room tests ─────────────────────────────────────────────────────────────

  it("validates sequential Room migrations as passing", async () => {
    writeRoomMigration(
      "core/storage",
      "Migration_1_2.kt",
      [
        "package com.example.db",
        "",
        "val MIGRATION_1_2 = Migration(1, 2) {",
        '    it.execSQL("ALTER TABLE users ADD COLUMN email TEXT")',
        "}",
      ].join("\n"),
    );

    writeRoomMigration(
      "core/storage",
      "Migration_2_3.kt",
      [
        "package com.example.db",
        "",
        "val MIGRATION_2_3 = Migration(2, 3) {",
        '    it.execSQL("ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0")',
        "}",
      ].join("\n"),
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "room",
    });

    const text = extractText(result);
    expect(text).toContain("PASS");
    expect(text).toContain("2"); // migrations found
    expect(text).not.toContain("gap");
  });

  it("detects gaps in Room migration versions", async () => {
    writeRoomMigration(
      "core/storage",
      "Migration_1_2.kt",
      [
        "package com.example.db",
        "",
        "val MIGRATION_1_2 = Migration(1, 2) {",
        '    it.execSQL("ALTER TABLE users ADD COLUMN email TEXT")',
        "}",
      ].join("\n"),
    );

    writeRoomMigration(
      "core/storage",
      "Migration_3_4.kt",
      [
        "package com.example.db",
        "",
        "val MIGRATION_3_4 = Migration(3, 4) {",
        '    it.execSQL("ALTER TABLE users ADD COLUMN phone TEXT")',
        "}",
      ].join("\n"),
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "room",
    });

    const text = extractText(result);
    expect(text).toContain("ISSUES FOUND");
    expect(text).toContain("Missing migration from version 2 to 3");
    expect(text).toContain("MEDIUM");
  });

  it("flags destructive operations without backup in Room", async () => {
    writeRoomMigration(
      "core/storage",
      "Migration_1_2.kt",
      [
        "package com.example.db",
        "",
        "val MIGRATION_1_2 = Migration(1, 2) {",
        '    it.execSQL("DROP TABLE old_users")',
        '    it.execSQL("CREATE TABLE users (id INTEGER PRIMARY KEY)")',
        "}",
      ].join("\n"),
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "room",
    });

    const text = extractText(result);
    expect(text).toContain("Destructive operation");
    expect(text).toContain("HIGH");
    expect(text).toContain("DROP");
  });

  it("does not flag destructive operations when backup exists", async () => {
    writeRoomMigration(
      "core/storage",
      "Migration_1_2.kt",
      [
        "package com.example.db",
        "",
        "val MIGRATION_1_2 = Migration(1, 2) {",
        '    it.execSQL("CREATE TABLE users_backup AS SELECT * FROM users")',
        '    it.execSQL("DROP TABLE users")',
        '    it.execSQL("ALTER TABLE users_backup RENAME TO users")',
        "}",
      ].join("\n"),
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "room",
    });

    const text = extractText(result);
    expect(text).toContain("PASS");
    expect(text).not.toContain("Destructive operation");
  });

  // ── SQLDelight tests ───────────────────────────────────────────────────────

  it("validates sequential SQLDelight migrations as passing", async () => {
    writeSqmFile(
      "core/storage",
      1,
      "ALTER TABLE users ADD COLUMN email TEXT;",
    );
    writeSqmFile(
      "core/storage",
      2,
      "ALTER TABLE users ADD COLUMN age INTEGER DEFAULT 0;",
    );
    writeSqmFile(
      "core/storage",
      3,
      "CREATE INDEX idx_users_email ON users(email);",
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "sqldelight",
    });

    const text = extractText(result);
    expect(text).toContain("PASS");
    expect(text).toContain("3"); // migrations found
  });

  it("detects gaps in SQLDelight migration numbering", async () => {
    writeSqmFile("core/storage", 1, "ALTER TABLE users ADD COLUMN email TEXT;");
    writeSqmFile("core/storage", 3, "ALTER TABLE users ADD COLUMN phone TEXT;");

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "sqldelight",
    });

    const text = extractText(result);
    expect(text).toContain("ISSUES FOUND");
    expect(text).toContain("Gap");
    expect(text).toContain("missing 2.sqm");
  });

  it("flags destructive SQLDelight migrations without backup", async () => {
    writeSqmFile("core/storage", 1, "DROP TABLE old_data;");

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "sqldelight",
    });

    const text = extractText(result);
    expect(text).toContain("Destructive operation");
    expect(text).toContain("HIGH");
  });

  // ── Auto-detect tests ─────────────────────────────────────────────────────

  it("auto-detects Room when Migration*.kt files exist", async () => {
    writeRoomMigration(
      "core/storage",
      "Migration_1_2.kt",
      [
        "package com.example.db",
        "val MIGRATION_1_2 = Migration(1, 2) {",
        '    it.execSQL("ALTER TABLE users ADD COLUMN email TEXT")',
        "}",
      ].join("\n"),
    );

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "auto",
    });

    const text = extractText(result);
    expect(text).toContain("room");
  });

  it("auto-detects SQLDelight when .sqm files exist", async () => {
    writeSqmFile("core/storage", 1, "ALTER TABLE users ADD COLUMN email TEXT;");

    const result = await callTool({
      project_root: PROJECT_ROOT,
      db_type: "auto",
    });

    const text = extractText(result);
    expect(text).toContain("sqldelight");
  });
});
