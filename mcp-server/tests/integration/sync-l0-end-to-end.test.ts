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
import { writeFile, mkdir, rm, readdir, access, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { installRuntimeConsumer, resolveL0Source, syncL0 } from "../../src/sync/sync-engine.js";

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

  it("--help is a zero-write operation", async () => {
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const before = await readFile(manifestPath, "utf8");
    const result = spawnSync(process.execPath, [CLI_PATH, "--help"], {
      cwd: fixtureDir, encoding: "utf8", timeout: 10000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).not.toContain("Sync →");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    expect(await readdir(join(fixtureDir, ".claude", "hooks"))).toEqual([]);
  });

  it("rejects unknown options without touching the project", async () => {
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const before = await readFile(manifestPath, "utf8");
    const result = spawnSync(process.execPath, [CLI_PATH, "--definitely-unknown"], {
      cwd: fixtureDir, encoding: "utf8", timeout: 10000,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown option");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    expect(await readdir(join(fixtureDir, ".claude", "hooks"))).toEqual([]);
  });

  it("dry-run reports that the manifest is unchanged and performs no writes", async () => {
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const before = await readFile(manifestPath, "utf8");
    const result = spawnSync(process.execPath, [CLI_PATH, "--project-root", fixtureDir, "--dry-run"], {
      encoding: "utf8", timeout: 60000,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Manifest unchanged: l0-manifest.json (dry-run)");
    expect(result.stdout).not.toContain("Manifest updated:");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    expect(await readdir(join(fixtureDir, ".claude", "hooks"))).toEqual([]);
  });

  it("dry-run without a manifest fails closed and performs no writes", async () => {
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    await rm(manifestPath);
    const rootBefore = await readdir(fixtureDir);

    const result = spawnSync(process.execPath, [
      CLI_PATH,
      "--project-root", fixtureDir,
      "--l0-root", L0_ROOT,
      "--dry-run",
    ], { encoding: "utf8", timeout: 60000 });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Dry-run requires an existing l0-manifest.json");
    expect(existsSync(manifestPath)).toBe(false);
    expect(await readdir(fixtureDir)).toEqual(rootBefore);
    expect(await readdir(join(fixtureDir, ".claude", "hooks"))).toEqual([]);
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
    const settings = JSON.parse(readFileSync(join(fixtureDir, ".claude", "settings.json"), "utf8"));
    const commands = Object.values(settings.hooks).flatMap((blocks: any) =>
      blocks.flatMap((block: any) => block.hooks.map((hook: any) => hook.command)));
    expect(commands.some((command: string) => command.includes("premature-execution-gate.js"))).toBe(false);
  });

  it("registers source-coupled hooks through the portable launcher and executes the push gate", () => {
    const legacyCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(
      "/stale-host/AndroidCommonDoc/.claude/hooks/push-authorization-gate.js",
    )}`;
    writeFileSync(join(fixtureDir, ".claude", "settings.json"), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: legacyCommand }] }] },
    }, null, 2));

    const result = spawnSync(process.execPath, [CLI_PATH, "--project-root", fixtureDir], {
      encoding: "utf8", timeout: 60000,
    });
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);

    const settings = JSON.parse(readFileSync(join(fixtureDir, ".claude", "settings.json"), "utf8"));
    const commands = Object.values(settings.hooks).flatMap((blocks: any) =>
      blocks.flatMap((block: any) => block.hooks.map((hook: any) => hook.command)));
    const pushCommands = commands.filter((command: string) => command.includes("push-authorization-gate.js"));
    expect(pushCommands).toHaveLength(1);
    expect(pushCommands[0]).toBe(
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js push-authorization-gate.js',
    );
    expect(pushCommands[0]).not.toContain(L0_ROOT.replace(/\\/g, "/"));
    expect(pushCommands[0]).not.toContain(process.execPath.replace(/\\/g, "/"));
    expect(existsSync(join(fixtureDir, ".claude", "hooks", "push-authorization-gate.js"))).toBe(false);
    expect(existsSync(join(fixtureDir, ".claude", "hooks", "l0-source-hook-launcher.js"))).toBe(true);

    const hook = spawnSync(process.execPath, [
      join(fixtureDir, ".claude", "hooks", "l0-source-hook-launcher.js"),
      "push-authorization-gate.js",
    ], {
      cwd: fixtureDir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: fixtureDir },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo healthy" } }),
      encoding: "utf8",
      timeout: 10000,
    });
    expect(hook.status, hook.stderr).toBe(0);
    expect(hook.stderr).not.toContain("MODULE_NOT_FOUND");
  });
});

describe("sync source and managed runtime file boundaries", () => {
  it("fails closed when a linked worktree relative source resolves to two distinct toolkits", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-l0-ambiguous-worktree-"));
    const mainRoot = join(root, "main", "consumer");
    const linkedRoot = join(root, "linked", "consumer");
    const mainToolkit = join(root, "main", "toolkit");
    const linkedToolkit = join(root, "linked", "toolkit");
    try {
      for (const toolkit of [mainToolkit, linkedToolkit]) {
        await mkdir(join(toolkit, "skills"), { recursive: true });
        await writeFile(join(toolkit, "skills", "registry.json"), "{}\n", "utf8");
      }
      await mkdir(mainRoot, { recursive: true });
      await writeFile(join(mainRoot, "tracked.txt"), "fixture\n", "utf8");
      for (const args of [
        ["init", "-q"], ["config", "user.email", "test@example.invalid"],
        ["config", "user.name", "Test"], ["add", "."], ["commit", "-qm", "fixture"],
      ]) {
        const git = spawnSync("git", args, { cwd: mainRoot, encoding: "utf8" });
        expect(git.status, git.stderr).toBe(0);
      }
      await mkdir(join(root, "linked"), { recursive: true });
      const linked = spawnSync("git", ["worktree", "add", "-q", "-b", "ambiguous-source", linkedRoot], {
        cwd: mainRoot, encoding: "utf8",
      });
      expect(linked.status, linked.stderr).toBe(0);

      await expect(resolveL0Source("../toolkit", linkedRoot)).rejects.toThrow(
        /ambiguous across repository-owned resolution bases/,
      );
      await writeFile(join(linkedRoot, "l0-manifest.json"), makeManifest("../toolkit"), "utf8");
      const install = await installRuntimeConsumer(linkedRoot, linkedToolkit);
      expect(install.ok).toBe(false);
      expect(install.reason).toBe("runtime-l0-source-invalid");
      expect(existsSync(join(linkedRoot, ".claude"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates an unchanged managed topology and rejects consumer drift", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "runtime-topology-upgrade-"));
    const topologyRelative = ".claude/registry/wave-topology.yaml";
    const topologyPath = join(consumer, topologyRelative);
    try {
      await writeFile(join(consumer, "l0-manifest.json"), makeManifest(L0_ROOT), "utf8");
      const installed = await installRuntimeConsumer(consumer, L0_ROOT);
      expect(installed.ok).toBe(true);

      const previousManagedBytes = "schema: previous-toolkit-version\n";
      await writeFile(topologyPath, previousManagedBytes, "utf8");
      const manifestPath = join(consumer, "l0-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.checksums[topologyRelative] = `sha256:${createHash("sha256").update(previousManagedBytes).digest("hex")}`;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

      const dryRun = await installRuntimeConsumer(consumer, L0_ROOT, { dryRun: true });
      expect(dryRun.ok).toBe(true);
      expect(await readFile(topologyPath, "utf8")).toBe(previousManagedBytes);

      const updated = await installRuntimeConsumer(consumer, L0_ROOT);
      expect(updated.ok).toBe(true);
      expect(await readFile(topologyPath, "utf8"))
        .toBe(await readFile(join(L0_ROOT, topologyRelative), "utf8"));

      const consumerDrift = "schema: consumer-owned-drift\n";
      await writeFile(topologyPath, consumerDrift, "utf8");
      const conflict = await installRuntimeConsumer(consumer, L0_ROOT);
      expect(conflict.ok).toBe(false);
      expect(conflict.reason).toBe(`runtime-consumer-file-conflict:${topologyRelative}`);
      expect(await readFile(topologyPath, "utf8")).toBe(consumerDrift);
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
  });

  it("ordinary prune preserves files owned by an installed runtime", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "runtime-topology-prune-"));
    const topologyRelative = ".claude/registry/wave-topology.yaml";
    const topologyPath = join(consumer, topologyRelative);
    try {
      await writeFile(join(consumer, "l0-manifest.json"), makeManifest(L0_ROOT), "utf8");
      const installed = await installRuntimeConsumer(consumer, L0_ROOT);
      expect(installed.ok).toBe(true);
      const topologyBefore = await readFile(topologyPath, "utf8");

      const ordinary = await syncL0(consumer, L0_ROOT, { prune: true, force: true });
      expect(ordinary.removedPaths).not.toContain(topologyRelative);
      expect(await readFile(topologyPath, "utf8")).toBe(topologyBefore);
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
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
