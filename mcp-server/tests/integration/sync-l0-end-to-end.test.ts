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
import { writeFile, mkdir, rm, readdir, access, mkdtemp, readFile, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

function runGit(cwd: string, args: string[]): ReturnType<typeof spawnSync> {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30000 });
  expect(result.status, `git ${args.join(" ")} failed: ${result.stderr}`).toBe(0);
  return result;
}

function runSyncCli(projectRoot: string, runtime = false): ReturnType<typeof spawnSync> {
  const args = [CLI_PATH, "--project-root", projectRoot];
  if (runtime) args.push("--runtime");
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120000 });
  expect(result.status, `sync CLI failed: ${result.stdout}\n${result.stderr}`).toBe(0);
  return result;
}

function hookPayload(event: string, matcher: string, projectRoot: string): string {
  let toolName = "Bash";
  let toolInput: Record<string, unknown> = { command: "echo hook-smoke" };
  if (!matcher.split("|").includes("Bash")) {
    toolName = matcher.split("|").find((candidate) => candidate !== ".*") ?? "Write";
    toolInput = toolName === "Write" || toolName === "Edit"
      ? { file_path: join(projectRoot, "README.md"), content: "hook smoke" }
      : toolName === "Grep"
        ? { pattern: "hook-smoke", path: projectRoot }
        : { taskId: "hook-smoke", status: "in_progress" };
  }
  return JSON.stringify({
    hook_event_name: event,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {},
    session_id: "sync-e2e-hook-smoke",
    agent_type: "",
    agent_id: "",
    cwd: projectRoot,
  });
}

/**
 * Execute every emitted hook registration through the POSIX shell surface
 * Claude uses, resolving Bash from PATH so the smoke also runs under Git for
 * Windows. Policy denials may legitimately return a non-zero status for a
 * synthetic event with no authority, so status alone is not asserted. Missing
 * scripts, Node module-loader failures, syntax failures and signals are always
 * installation failures and must fail this smoke.
 */
function smokeEveryEmittedHook(projectRoot: string): void {
  const settings = JSON.parse(readFileSync(join(projectRoot, ".claude", "settings.json"), "utf8"));
  const attempts: string[] = [];
  for (const [event, blocks] of Object.entries(settings.hooks ?? {}) as Array<[string, any[]]>) {
    for (const block of blocks) {
      for (const hook of block.hooks ?? []) {
        const command = String(hook.command);
        attempts.push(`${event}:${block.matcher}:${command}`);
        const result = spawnSync("bash", ["-c", command], {
          cwd: projectRoot,
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" },
          input: hookPayload(event, String(block.matcher), projectRoot),
          encoding: "utf8",
          timeout: 30000,
        });
        const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
        expect(result.error, `hook failed to launch: ${attempts.at(-1)}\n${output}`).toBeUndefined();
        expect(result.signal, `hook terminated by signal: ${attempts.at(-1)}\n${output}`).toBeNull();
        expect([126, 127], `hook executable missing: ${attempts.at(-1)}\n${output}`).not.toContain(result.status);
        expect(output, `hook loader failure: ${attempts.at(-1)}`).not.toMatch(
          /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|SyntaxError:/,
        );
      }
    }
  }
  expect(attempts.length, "the runtime must emit a non-empty hook matrix").toBeGreaterThan(10);
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

  it("keeps l0-manifest.json byte-identical and reports unchanged on a second no-op sync", () => {
    const args = [CLI_PATH, "--project-root", fixtureDir];
    const first = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 60000 });
    expect(first.status, first.stderr).toBe(0);
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const bytesAfterFirst = readFileSync(manifestPath, "utf8");

    const second = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 60000 });
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("Manifest unchanged: l0-manifest.json (no effective changes)");
    expect(readFileSync(manifestPath, "utf8")).toBe(bytesAfterFirst);
  });

  it("does not publish the manifest when a managed shell hook conflicts", async () => {
    const manifestPath = join(fixtureDir, "l0-manifest.json");
    const before = await readFile(manifestPath, "utf8");
    await writeFile(
      join(fixtureDir, ".claude", "hooks", "detekt-pre-commit.sh"),
      "#!/usr/bin/env bash\necho consumer-owned\n",
      "utf8",
    );

    const result = spawnSync(process.execPath, [CLI_PATH, "--project-root", fixtureDir], {
      encoding: "utf8", timeout: 60000,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("detekt-pre-commit.sh differs from the toolkit");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
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

describe("clean L1/L2 consumer convergence through the real CLI", () => {
  const cases = [
    { layer: "L1" as const, linkedWorktree: false },
    { layer: "L2" as const, linkedWorktree: true },
  ];

  it.each(cases)(
    "$layer ordinary+runtime converges hooks, executable modes and a byte-idempotent manifest",
    async ({ layer, linkedWorktree }) => {
      const fixtureRoot = await mkdtemp(join(tmpdir(), `sync-l0-${layer.toLowerCase()}-matrix-`));
      const mainRoot = linkedWorktree ? join(fixtureRoot, "main-consumer") : join(fixtureRoot, "consumer");
      const projectRoot = linkedWorktree ? join(fixtureRoot, "linked-consumer") : mainRoot;
      try {
        await mkdir(mainRoot, { recursive: true });
        runGit(mainRoot, ["init", "-q"]);
        runGit(mainRoot, ["config", "user.email", "sync-e2e@example.invalid"]);
        runGit(mainRoot, ["config", "user.name", "Sync E2E"]);
        await writeFile(join(mainRoot, "README.md"), "# Consumer fixture\n", "utf8");
        runGit(mainRoot, ["add", "."]);
        runGit(mainRoot, ["commit", "-qm", "fixture: initialize consumer"]);

        if (linkedWorktree) {
          runGit(mainRoot, ["worktree", "add", "-q", "-b", "sync-e2e-linked", projectRoot]);
          const gitDir = runGit(projectRoot, ["rev-parse", "--git-dir"]).stdout.trim();
          expect(gitDir.replace(/\\/g, "/")).toContain("/.git/worktrees/");
        }

        if (layer === "L1") {
          // Runtime layer detection intentionally uses this canonical L1
          // marker, not a test-only override.
          await mkdir(join(projectRoot, "skills"), { recursive: true });
          await writeFile(join(projectRoot, "skills", "registry.json"), "{}\n", "utf8");
        }
        await mkdir(join(projectRoot, ".claude"), { recursive: true });
        await writeFile(join(projectRoot, "l0-manifest.json"), makeManifest(L0_ROOT), "utf8");

        const brokenLocalPush = 'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/push-authorization-gate.js';
        const staleAbsolutePush = `${JSON.stringify(process.execPath)} ${JSON.stringify(
          "/stale-host/AndroidCommonDoc/.claude/hooks/push-authorization-gate.js",
        )}`;
        await writeFile(join(projectRoot, ".claude", "settings.json"), JSON.stringify({
          hooks: {
            PreToolUse: [
              { matcher: "Bash", hooks: [
                { type: "command", command: brokenLocalPush, timeout: 5 },
                { type: "command", command: "printf consumer-owned", timeout: 5 },
              ] },
              { matcher: "Bash", hooks: [
                { type: "command", command: staleAbsolutePush, timeout: 5 },
              ] },
            ],
          },
        }, null, 2) + "\n", "utf8");
        runGit(projectRoot, ["add", "."]);
        runGit(projectRoot, ["commit", "-qm", `fixture: seed ${layer} contract`]);

        runSyncCli(projectRoot);
        runSyncCli(projectRoot, true);

        const manifestPath = join(projectRoot, "l0-manifest.json");
        const installedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
        expect(installedManifest.runtime.consumer_layer).toBe(layer);

        const installedSettings = JSON.parse(
          await readFile(join(projectRoot, ".claude", "settings.json"), "utf8"),
        );
        const commands = Object.values(installedSettings.hooks).flatMap((blocks: any) =>
          blocks.flatMap((block: any) => block.hooks.map((hook: any) => hook.command)));
        const portablePush =
          'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js push-authorization-gate.js';
        expect(commands.filter((command: string) => command === portablePush)).toHaveLength(1);
        expect(commands).not.toContain(brokenLocalPush);
        expect(commands).not.toContain(staleAbsolutePush);
        expect(commands).toContain("printf consumer-owned");

        const canonicalProjectRoot = realpathSync(projectRoot);
        const intent = Buffer.from(JSON.stringify({ scope: "all" }), "utf8").toString("base64url");
        const entrypoint = spawnSync(process.execPath, [
          join(canonicalProjectRoot, ".claude", "runtime", "l0-entrypoint-launcher.cjs"),
          "execute", "--entrypoint", "monitor-docs",
          "--project-root", canonicalProjectRoot,
          "--intent", intent,
        ], {
          cwd: canonicalProjectRoot,
          env: { ...process.env, CLAUDE_PROJECT_DIR: canonicalProjectRoot },
          encoding: "utf8",
          timeout: 30000,
        });
        expect(entrypoint.status, entrypoint.stderr).toBe(6);
        expect(entrypoint.stderr).not.toMatch(/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
        expect(JSON.parse(entrypoint.stdout.trim())).toMatchObject({
          schema: "runtime/collaboration-entrypoint-result/v1",
          entrypoint: "monitor-docs",
          status: "UNAVAILABLE",
          detail: "host-composition-unavailable",
        });

        smokeEveryEmittedHook(projectRoot);

        const executableHooks = ["detekt-pre-commit.sh", "detekt-post-write.sh"];
        for (const file of executableHooks) {
          await chmod(join(projectRoot, ".claude", "hooks", file), 0o644);
        }
        const repair = runSyncCli(projectRoot, true);
        expect(repair.stdout + repair.stderr).toMatch(/Runtime executable mode repaired:/);
        for (const file of executableHooks) {
          expect((await stat(join(projectRoot, ".claude", "hooks", file))).mode & 0o777).toBe(0o755);
        }

        const manifestAfterConvergence = await readFile(manifestPath, "utf8");
        runGit(projectRoot, ["add", "."]);
        runGit(projectRoot, ["commit", "-qm", "fixture: record converged runtime"]);

        runSyncCli(projectRoot);
        runSyncCli(projectRoot, true);
        expect(await readFile(manifestPath, "utf8")).toBe(manifestAfterConvergence);
        expect(runGit(projectRoot, ["status", "--porcelain"]).stdout).toBe("");
      } finally {
        if (linkedWorktree && existsSync(projectRoot)) {
          spawnSync("git", ["worktree", "remove", "--force", projectRoot], {
            cwd: mainRoot, encoding: "utf8", timeout: 30000,
          });
        }
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
    240000,
  );
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
