/**
 * End-to-end integration test for sync-l0-cli.
 *
 * Spawns the compiled CLI as a subprocess against a minimal L1 fixture
 * project and verifies that:
 *   1. Hook JS files land in fixture/.claude/hooks/
 *   2. Gate bats files land in fixture/scripts/tests/
 *   3. The manifest checksums field is updated
 *   4. Exit code is 0
 *
 * This test catches regressions that unit tests of syncHooks() in isolation
 * cannot detect (prep-8 F7 root cause: CLI orchestration gap).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const L0_ROOT = join(import.meta.dirname, "..", "..", "..");
const CLI_PATH = join(L0_ROOT, "mcp-server", "build", "sync", "sync-l0-cli.js");

/** Create a minimal l0-manifest.json pointing at L0_ROOT */
function makeManifest(l0RelPath: string): string {
  return JSON.stringify({
    version: 2,
    sources: [{ layer: "L0", path: l0RelPath, role: "tooling" }],
    last_synced: new Date().toISOString(),
    selection: {
      mode: "include-all",
      exclude_skills: [],
      exclude_agents: [],
      exclude_commands: [],
      exclude_categories: [],
      exclude_hooks: [],
    },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("sync-l0 end-to-end CLI", () => {
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "sync-l0-e2e-"));
    // Minimal L1 fixture structure
    await mkdir(join(fixtureDir, ".claude", "hooks"), { recursive: true });
    await mkdir(join(fixtureDir, "scripts", "tests"), { recursive: true });
    // Write manifest with relative path back to L0_ROOT
    const rel = require("node:path").relative(fixtureDir, L0_ROOT).replace(/\\/g, "/");
    await writeFile(join(fixtureDir, "l0-manifest.json"), makeManifest(rel), "utf8");
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("exits 0 and hooks land in .claude/hooks/", () => {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // At least one .js hook should exist in fixture .claude/hooks/
    const hooksDir = join(fixtureDir, ".claude", "hooks");
    expect(existsSync(hooksDir), "hooks dir should exist").toBe(true);
    const hookFiles = require("node:fs").readdirSync(hooksDir).filter((f: string) => f.endsWith(".js"));
    expect(hookFiles.length, "at least one hook .js file should be synced").toBeGreaterThan(0);
  });

  it("exits 0 and gate bats files land in scripts/tests/", () => {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    // At least one *-gate.bats should exist in fixture scripts/tests/
    const batsDir = join(fixtureDir, "scripts", "tests");
    expect(existsSync(batsDir), "bats dir should exist").toBe(true);
    const batsFiles = require("node:fs").readdirSync(batsDir).filter((f: string) => f.endsWith("-gate.bats"));
    expect(batsFiles.length, "at least one *-gate.bats file should be synced").toBeGreaterThan(0);
  });

  it("exits 0 and manifest checksums are updated", () => {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const manifestPath = join(fixtureDir, "l0-manifest.json");
    expect(existsSync(manifestPath), "manifest should still exist").toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const checksumKeys = Object.keys(manifest.checksums ?? {});
    expect(checksumKeys.length, "checksums should be populated after sync").toBeGreaterThan(0);
  });

  it("exclude_hooks skips listed hook files", () => {
    // Write manifest that excludes premature-execution-gate.js
    const rel = require("node:path").relative(fixtureDir, L0_ROOT).replace(/\\/g, "/");
    const manifest = JSON.parse(makeManifest(rel));
    manifest.selection.exclude_hooks = ["premature-execution-gate.js"];
    require("node:fs").writeFileSync(
      join(fixtureDir, "l0-manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const hooksDir = join(fixtureDir, ".claude", "hooks");
    const hookFiles = existsSync(hooksDir)
      ? require("node:fs").readdirSync(hooksDir)
      : [];
    expect(hookFiles).not.toContain("premature-execution-gate.js");
  });

  it("seeds .commitlintrc.json when absent (F6)", () => {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const rcPath = join(fixtureDir, ".commitlintrc.json");
    expect(existsSync(rcPath), ".commitlintrc.json should be seeded").toBe(true);
    const rc = JSON.parse(readFileSync(rcPath, "utf8"));
    expect(Array.isArray(rc.valid_scopes), "valid_scopes should be an array").toBe(true);
    expect(rc.valid_scopes.length, "valid_scopes should have at least 18 scopes").toBeGreaterThanOrEqual(18);
  });

  it("does not overwrite existing .commitlintrc.json (F6 skip guard)", () => {
    const existingScopes = ["custom-scope-only"];
    const existingContent = JSON.stringify({ valid_scopes: existingScopes }, null, 2);
    const rcPath = join(fixtureDir, ".commitlintrc.json");
    require("node:fs").writeFileSync(rcPath, existingContent, "utf8");

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const rc = JSON.parse(readFileSync(rcPath, "utf8"));
    expect(rc.valid_scopes).toEqual(existingScopes);
  });
});
