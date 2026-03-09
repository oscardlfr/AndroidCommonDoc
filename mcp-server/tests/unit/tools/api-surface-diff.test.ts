/**
 * Tests for the api-surface-diff MCP tool.
 *
 * Uses in-memory MCP transport with real tool registration.
 * Creates a temporary git repo with branches and commits to test
 * diff parsing and API change classification.
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
import { registerApiSurfaceDiffTool } from "../../../src/tools/api-surface-diff.js";
import { RateLimiter } from "../../../src/utils/rate-limiter.js";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

// ── Test fixture management ──────────────────────────────────────────────────

const TEST_ROOT = path.join(
  os.tmpdir(),
  "api-surface-diff-test-" + process.pid,
);

function ensureClean(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
  mkdirSync(TEST_ROOT, { recursive: true });
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });
}

function setupGitRepo(): string {
  const repoDir = path.join(TEST_ROOT, "repo");
  mkdirSync(repoDir, { recursive: true });

  git(["init"], repoDir);
  git(["checkout", "-b", "main"], repoDir);

  // Create initial commit with a Kotlin file in commonMain
  const srcDir = path.join(repoDir, "core", "src", "commonMain", "kotlin");
  mkdirSync(srcDir, { recursive: true });

  writeFileSync(
    path.join(srcDir, "Api.kt"),
    [
      "package com.example",
      "",
      "public fun greet(name: String): String {",
      '    return "Hello, $name"',
      "}",
      "",
      "public class UserManager {",
      "    public val users = mutableListOf<String>()",
      "",
      "    public fun addUser(name: String) {",
      "        users.add(name)",
      "    }",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );

  git(["add", "-A"], repoDir);
  git(["commit", "-m", "initial"], repoDir);

  return repoDir;
}

// ── MCP client/server lifecycle ──────────────────────────────────────────────

let client: Client;
let server: McpServer;

beforeAll(async () => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  const limiter = new RateLimiter(100, 60000);
  registerApiSurfaceDiffTool(server, limiter);

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
    name: "api-surface-diff",
    arguments: args,
  });
}

function extractText(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content[0] as { type: "text"; text: string }).text;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("api-surface-diff tool", () => {
  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "api-surface-diff");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("API");
  });

  it("detects breaking changes when public API is removed", async () => {
    const repoDir = setupGitRepo();

    // Create a feature branch that removes a public function
    git(["checkout", "-b", "feature"], repoDir);

    const srcDir = path.join(repoDir, "core", "src", "commonMain", "kotlin");
    writeFileSync(
      path.join(srcDir, "Api.kt"),
      [
        "package com.example",
        "",
        "public class UserManager {",
        "    public val users = mutableListOf<String>()",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    git(["add", "-A"], repoDir);
    git(["commit", "-m", "remove greet and addUser"], repoDir);

    const result = await callTool({
      project_root: repoDir,
      base_branch: "main",
      head_branch: "feature",
      scope: "commonMain",
    });

    const text = extractText(result);
    expect(text).toContain("Breaking");
    expect(text).toContain("fun greet");
    expect(text).toContain("fun addUser");
  });

  it("detects additive changes when new public API is added", async () => {
    const repoDir = setupGitRepo();

    git(["checkout", "-b", "add-api"], repoDir);

    const srcDir = path.join(repoDir, "core", "src", "commonMain", "kotlin");
    writeFileSync(
      path.join(srcDir, "NewApi.kt"),
      [
        "package com.example",
        "",
        "public interface Repository {",
        "    fun getAll(): List<String>",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    git(["add", "-A"], repoDir);
    git(["commit", "-m", "add new interface"], repoDir);

    const result = await callTool({
      project_root: repoDir,
      base_branch: "main",
      head_branch: "add-api",
      scope: "commonMain",
    });

    const text = extractText(result);
    expect(text).toContain("Additive");
    expect(text).toContain("interface Repository");
  });

  it("handles non-git directories gracefully", async () => {
    const nonGitDir = path.join(TEST_ROOT, "not-a-repo");
    mkdirSync(nonGitDir, { recursive: true });

    const result = await callTool({
      project_root: nonGitDir,
      base_branch: "main",
    });

    const text = extractText(result);
    expect(text).toContain("Failed to run git diff");
  });

  it("returns no differences message when branches are identical", async () => {
    const repoDir = setupGitRepo();

    const result = await callTool({
      project_root: repoDir,
      base_branch: "main",
      head_branch: "main",
      scope: "commonMain",
    });

    const text = extractText(result);
    expect(text).toContain("No differences found");
  });

  it("includes JSON output with findings", async () => {
    const repoDir = setupGitRepo();

    git(["checkout", "-b", "json-test"], repoDir);

    const srcDir = path.join(repoDir, "core", "src", "commonMain", "kotlin");
    writeFileSync(
      path.join(srcDir, "Extra.kt"),
      [
        "package com.example",
        "",
        "public data class Config(val timeout: Int)",
        "",
      ].join("\n"),
      "utf-8",
    );

    git(["add", "-A"], repoDir);
    git(["commit", "-m", "add config"], repoDir);

    const result = await callTool({
      project_root: repoDir,
      base_branch: "main",
      head_branch: "json-test",
      scope: "commonMain",
    });

    const text = extractText(result);
    expect(text).toContain("```json");
    expect(text).toContain("api-surface-diff");
    expect(text).toContain("additive");
  });
});
