/**
 * End-to-end integration test for sync-l0-cli.
 *
 * Spawns the compiled CLI as a subprocess against a minimal L1 fixture
 * project and verifies that:
 *   1. Hook JS files land in fixture/.claude/hooks/
 *   2. The manifest checksums field is updated
 *   3. Exit code is 0
 *   4. --force-l0-managed overwrites specialist templates (F2 BL-W47-prep-11)
 *
 * Bats propagation is L0-LOCAL only (Amendment 1, BL-W47-prep-10) — NOT synced.
 *
 * This test catches regressions that unit tests of syncHooks() in isolation
 * cannot detect (prep-8 F7 root cause: CLI orchestration gap).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
});

// ---------------------------------------------------------------------------
// F2 — --force-l0-managed specialist template propagation (BL-W47-prep-11)
// Uses Pattern A (subprocess CLI) per arch-testing — needed for CLI flag parsing.
// ---------------------------------------------------------------------------

describe("sync-l0 --force-l0-managed specialist templates", () => {
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = await (await import("node:fs/promises")).mkdtemp(join(tmpdir(), "sync-l0-flm-"));
    await mkdir(join(fixtureDir, ".claude", "agents"), { recursive: true });
    await mkdir(join(fixtureDir, ".claude", "hooks"), { recursive: true });
    const rel = require("node:path").relative(fixtureDir, L0_ROOT).replace(/\\/g, "/");
    await writeFile(join(fixtureDir, "l0-manifest.json"), makeManifest(rel), "utf8");
  });

  afterEach(async () => {
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it("--force-l0-managed overwrites locally-modified data-layer-specialist.md", async () => {
    const agentPath = join(fixtureDir, ".claude", "agents", "data-layer-specialist.md");

    // First sync: seeds all files + manifest checksums
    const seed = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );
    expect(seed.status, `seed stderr: ${seed.stderr}`).toBe(0);

    if (!existsSync(agentPath)) {
      // Agent not in registry for this L0 — skip
      return;
    }

    const originalContent = readFileSync(agentPath, "utf8");

    // Simulate a local edit AND backdating the manifest checksum to an older value
    // so computeSyncActions sees conflict (local hash != manifest hash != registry hash)
    const localEdit = "# LOCAL EDIT — should be overwritten by --force-l0-managed\n";
    writeFileSync(agentPath, localEdit, "utf8");

    // Backdating the checksum: change the manifest checksum for this agent to a stale hash
    // so the engine sees: registry_hash != stale_manifest_hash → tries update → local file != stale → conflict
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const agentKey = ".claude/agents/data-layer-specialist.md";
    if (manifest.checksums[agentKey]) {
      manifest.checksums[agentKey] = "sha256:000000000000000000000000000000000000000000000000000000000000stale";
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    // Sync with --force-l0-managed: local edit must be discarded
    const forceResult = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir, "--force-l0-managed"],
      { encoding: "utf8", timeout: 60000 },
    );
    expect(forceResult.status, `stderr: ${forceResult.stderr}`).toBe(0);

    const afterContent = readFileSync(agentPath, "utf8");
    expect(afterContent).not.toContain("LOCAL EDIT");
    // Should be restored to L0 content (contains l0_source frontmatter from materialization)
    expect(afterContent).toContain("l0_source");
  });

  it("without --force-l0-managed, local edit is preserved when conflict detected", async () => {
    const agentPath = join(fixtureDir, ".claude", "agents", "data-layer-specialist.md");

    // First sync: seeds all files + manifest checksums
    const seed = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );
    expect(seed.status, `seed stderr: ${seed.stderr}`).toBe(0);

    if (!existsSync(agentPath)) {
      // Agent not in registry — skip
      return;
    }

    // Locally modify + backdate checksum to trigger conflict detection
    const localEdit = "# LOCAL EDIT — should be preserved without --force-l0-managed\n";
    writeFileSync(agentPath, localEdit, "utf8");

    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const agentKey = ".claude/agents/data-layer-specialist.md";
    if (manifest.checksums[agentKey]) {
      manifest.checksums[agentKey] = "sha256:000000000000000000000000000000000000000000000000000000000000stale";
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    // Sync WITHOUT --force-l0-managed: local edit must survive
    const normalResult = spawnSync(
      process.execPath,
      [CLI_PATH, "--project-root", fixtureDir],
      { encoding: "utf8", timeout: 60000 },
    );
    expect(normalResult.status, `stderr: ${normalResult.stderr}`).toBe(0);

    const afterContent = readFileSync(agentPath, "utf8");
    expect(afterContent).toBe(localEdit);
    // Conflict warning should appear in output
    expect(normalResult.stdout + normalResult.stderr).toContain("local edits");
  });
});
