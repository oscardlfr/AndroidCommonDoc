import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod, stat, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { syncHooks, installRuntimeConsumer, syncL0 } from "../../../src/sync/sync-engine.js";

const REAL_L0_ROOT = resolve(import.meta.dirname, "../../../..");
const localRequire = createRequire(import.meta.url);
const runtimeContext = localRequire(join(REAL_L0_ROOT, "scripts", "lib", "runtime-project-context.cjs"));
const waveControl = localRequire(join(REAL_L0_ROOT, "scripts", "lib", "wave-control-plane.cjs"));

async function writeRuntimeManifest(projectRoot: string): Promise<void> {
  await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify({
    version: 2,
    sources: [{ layer: "L0", path: relative(projectRoot, REAL_L0_ROOT), role: "tooling" }],
    topology: "flat", last_synced: "2026-09-05T00:00:00.000Z",
    selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [], exclude_hooks: [] },
    checksums: {}, l2_specific: { commands: [], agents: [], skills: [] }, migrations_applied: [],
  }, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Helper: create a minimal L0 hooks directory with test files
// ---------------------------------------------------------------------------

async function createL0Root(dir: string, hooks: string[]): Promise<void> {
  const hooksDir = join(dir, ".claude", "hooks");
  await mkdir(hooksDir, { recursive: true });
  for (const name of hooks) {
    await writeFile(join(hooksDir, name), `// hook: ${name}\n`, "utf-8");
  }
}

async function createProjectRoot(dir: string): Promise<void> {
  await mkdir(join(dir, ".claude", "hooks"), { recursive: true });
}

async function legacyDetektHookBytes(filename: "detekt-pre-commit.sh" | "detekt-post-write.sh"): Promise<Buffer> {
  const current = await readFile(join(REAL_L0_ROOT, ".claude", "hooks", filename));
  const legacy = Buffer.from(current.toString("utf8").replace("INPUT=$(cat)\n", "INPUT=$(cat /dev/stdin)\n"));
  const expected = filename === "detekt-pre-commit.sh"
    ? "fd79f0f45adf279d9b0cd41240cb89e96786b3e1c994f68b138781d3e0d22312"
    : "a263152549291c949e77a9f76dfdbeedcabec50c07a5f1cc3e5305ed331cc8d4";
  expect(createHash("sha256").update(legacy).digest("hex")).toBe(expected);
  return legacy;
}

describe("syncHooks", () => {
  let tmpDir: string;
  let l0Root: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sync-hooks-test-"));
    l0Root = join(tmpDir, "l0");
    projectRoot = join(tmpDir, "project");
    await mkdir(l0Root, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("copies all hook files from L0 when no excludes", async () => {
    await createL0Root(l0Root, ["gate-a.js", "gate-b.js"]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, []);

    expect(result.copied).toEqual(expect.arrayContaining(["gate-a.js", "gate-b.js"]));
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);

    const destA = await readFile(join(projectRoot, ".claude", "hooks", "gate-a.js"), "utf-8");
    expect(destA).toContain("gate-a.js");
  });

  it("skips hooks listed in exclude_hooks", async () => {
    await createL0Root(l0Root, ["gate-a.js", "project-local.js", "gate-b.js"]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, ["project-local.js"]);

    expect(result.copied).toEqual(expect.arrayContaining(["gate-a.js", "gate-b.js"]));
    expect(result.skipped).toContain("project-local.js");
    expect(result.errors).toHaveLength(0);
  });

  it("handles missing L0 hooks dir gracefully", async () => {
    // No .claude/hooks in l0Root
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, []);

    expect(result.copied).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("dry run reports copies without writing files", async () => {
    await createL0Root(l0Root, ["gate-a.js"]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, [], true);

    expect(result.copied).toContain("gate-a.js");

    // File should NOT exist in dest — dry run
    await expect(
      readFile(join(projectRoot, ".claude", "hooks", "gate-a.js"), "utf-8"),
    ).rejects.toThrow();
  });

  it("keeps hooks with L0-relative imports source-referenced", async () => {
    await createL0Root(l0Root, [
      "push-authorization-gate.js",
      "bash-cli-spawn-gate.js",
      "hook-control-plane-utils.js",
      "plan-md-write-gate.js",
      "standalone.js",
    ]);
    await createProjectRoot(projectRoot);

    const result = await syncHooks(l0Root, projectRoot, []);

    expect(result.skipped).toContain("push-authorization-gate.js");
    expect(result.skipped).toContain("bash-cli-spawn-gate.js");
    expect(result.skipped).toContain("hook-control-plane-utils.js");
    expect(result.skipped).toContain("plan-md-write-gate.js");
    expect(result.copied).toContain("standalone.js");
    await expect(readFile(join(projectRoot, ".claude", "hooks", "push-authorization-gate.js"), "utf8"))
      .rejects.toThrow();
  });

  it("manages the two Detekt shell hooks by exact bytes and repairs POSIX mode without overwriting conflicts", async () => {
    await createL0Root(l0Root, ["detekt-post-write.sh", "detekt-pre-commit.sh"]);
    await createProjectRoot(projectRoot);
    const post = join(projectRoot, ".claude", "hooks", "detekt-post-write.sh");
    const pre = join(projectRoot, ".claude", "hooks", "detekt-pre-commit.sh");
    await writeFile(post, "// hook: detekt-post-write.sh\n", "utf8");
    await writeFile(pre, "consumer-owned\n", "utf8");
    await chmod(post, 0o644);
    await chmod(pre, 0o644);

    const result = await syncHooks(l0Root, projectRoot);

    if (process.platform !== "win32") {
      expect(result.repaired).toContain("detekt-post-write.sh");
      expect((await stat(post)).mode & 0o777).toBe(0o755);
    }
    expect(result.conflicts).toContain("detekt-pre-commit.sh");
    expect(await readFile(pre, "utf8")).toBe("consumer-owned\n");
    if (process.platform !== "win32") expect((await stat(pre)).mode & 0o777).toBe(0o644);
  });

  it("reports Detekt mode repair in dry-run without changing bytes or mode", async () => {
    await createL0Root(l0Root, ["detekt-post-write.sh"]);
    await createProjectRoot(projectRoot);
    const destination = join(projectRoot, ".claude", "hooks", "detekt-post-write.sh");
    await writeFile(destination, "// hook: detekt-post-write.sh\n", "utf8");
    await chmod(destination, 0o644);

    const result = await syncHooks(l0Root, projectRoot, [], true);
    if (process.platform !== "win32") {
      expect(result.repaired).toEqual(["detekt-post-write.sh"]);
      expect((await stat(destination)).mode & 0o777).toBe(0o644);
    }
    expect(await readFile(destination, "utf8")).toBe("// hook: detekt-post-write.sh\n");
  });

  it("upgrades only the exact historical Detekt hooks and repairs their executable mode", async () => {
    await createProjectRoot(projectRoot);
    for (const filename of ["detekt-pre-commit.sh", "detekt-post-write.sh"] as const) {
      const destination = join(projectRoot, ".claude", "hooks", filename);
      await writeFile(destination, await legacyDetektHookBytes(filename));
      await chmod(destination, 0o644);
    }

    const result = await syncHooks(REAL_L0_ROOT, projectRoot);

    expect(result.errors).toEqual([]);
    expect(result.conflicts).toEqual([]);
    for (const filename of ["detekt-pre-commit.sh", "detekt-post-write.sh"] as const) {
      const destination = join(projectRoot, ".claude", "hooks", filename);
      expect(await readFile(destination)).toEqual(await readFile(join(REAL_L0_ROOT, ".claude", "hooks", filename)));
      if (process.platform !== "win32") expect((await stat(destination)).mode & 0o777).toBe(0o755);
    }
  });

  it("does not partially migrate a known legacy hook when its sibling is customized", async () => {
    await createProjectRoot(projectRoot);
    const pre = join(projectRoot, ".claude", "hooks", "detekt-pre-commit.sh");
    const post = join(projectRoot, ".claude", "hooks", "detekt-post-write.sh");
    const legacyPre = await legacyDetektHookBytes("detekt-pre-commit.sh");
    await writeFile(pre, legacyPre);
    await writeFile(post, "consumer-owned\n", "utf8");
    await chmod(pre, 0o644);
    await chmod(post, 0o644);

    const result = await syncHooks(REAL_L0_ROOT, projectRoot);

    expect(result.conflicts).toContain("detekt-post-write.sh");
    expect(await readFile(pre)).toEqual(legacyPre);
    expect(await readFile(post, "utf8")).toBe("consumer-owned\n");
    if (process.platform !== "win32") {
      expect((await stat(pre)).mode & 0o777).toBe(0o644);
      expect((await stat(post)).mode & 0o777).toBe(0o644);
    }
  });

  it("does not authorize a historical Detekt digest on the wrong hook path", async () => {
    await createProjectRoot(projectRoot);
    const pre = join(projectRoot, ".claude", "hooks", "detekt-pre-commit.sh");
    const post = join(projectRoot, ".claude", "hooks", "detekt-post-write.sh");
    const legacyPre = await legacyDetektHookBytes("detekt-pre-commit.sh");
    const legacyPost = await legacyDetektHookBytes("detekt-post-write.sh");
    await writeFile(pre, legacyPost);
    await writeFile(post, legacyPre);

    const result = await syncHooks(REAL_L0_ROOT, projectRoot);

    expect(result.conflicts).toEqual(expect.arrayContaining(["detekt-pre-commit.sh", "detekt-post-write.sh"]));
    expect(await readFile(pre)).toEqual(legacyPost);
    expect(await readFile(post)).toEqual(legacyPre);
  });

  it("keeps every hook with an external relative dependency source-referenced", async () => {
    await createProjectRoot(projectRoot);
    const hookDir = join(REAL_L0_ROOT, ".claude", "hooks");
    const externallyCoupled: string[] = [];
    for (const filename of (await readdir(hookDir)).filter((name) => name.endsWith(".js"))) {
      const source = await readFile(join(hookDir, filename), "utf8");
      if (/require\(["']\.\.\/\.\.\//.test(source) || /from\s+["']\.\.\/\.\.\//.test(source) ||
          /path\.join\(__dirname,\s*["']\.\.["'],\s*["']\.\.["']/.test(source)) {
        externallyCoupled.push(filename);
      }
    }
    expect(externallyCoupled).toContain("bash-cli-spawn-gate.js");

    const result = await syncHooks(REAL_L0_ROOT, projectRoot);
    for (const filename of externallyCoupled) {
      expect(result.skipped, filename).toContain(filename);
      await expect(readFile(join(projectRoot, ".claude", "hooks", filename))).rejects.toThrow();
    }
  });
});

describe("source-referenced runtime installation", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "runtime-install-test-"));
    await writeRuntimeManifest(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("upgrades a checksum-less historical L1 hook install before runtime and stays idempotent", async () => {
    await mkdir(join(projectRoot, ".claude", "hooks"), { recursive: true });
    for (const filename of ["detekt-pre-commit.sh", "detekt-post-write.sh"] as const) {
      const destination = join(projectRoot, ".claude", "hooks", filename);
      await writeFile(destination, await legacyDetektHookBytes(filename));
      await chmod(destination, 0o644);
    }

    const ordinary = await syncL0(projectRoot, REAL_L0_ROOT);
    expect(ordinary.errors).toEqual([]);
    const runtime = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(runtime.ok).toBe(true);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const stableManifest = await readFile(manifestPath, "utf8");

    for (const filename of ["detekt-pre-commit.sh", "detekt-post-write.sh"] as const) {
      const relative = `.claude/hooks/${filename}`;
      const destination = join(projectRoot, relative);
      const current = await readFile(join(REAL_L0_ROOT, relative));
      expect(await readFile(destination)).toEqual(current);
      const manifest = JSON.parse(stableManifest);
      expect(manifest.checksums[relative]).toBe(`sha256:${createHash("sha256").update(current).digest("hex")}`);
      if (process.platform !== "win32") expect((await stat(destination)).mode & 0o777).toBe(0o755);
    }

    expect((await syncL0(projectRoot, REAL_L0_ROOT)).errors).toEqual([]);
    expect((await installRuntimeConsumer(projectRoot, REAL_L0_ROOT)).ok).toBe(true);
    expect(await readFile(manifestPath, "utf8")).toBe(stableManifest);
  });

  it("direct runtime install claims both exact checksum-less historical Detekt hooks atomically", async () => {
    await mkdir(join(projectRoot, ".claude", "hooks"), { recursive: true });
    for (const filename of ["detekt-pre-commit.sh", "detekt-post-write.sh"] as const) {
      const destination = join(projectRoot, ".claude", "hooks", filename);
      await writeFile(destination, await legacyDetektHookBytes(filename));
      await chmod(destination, 0o644);
    }

    const installed = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);

    expect(installed.ok).toBe(true);
    const manifest = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf8"));
    for (const filename of ["detekt-pre-commit.sh", "detekt-post-write.sh"] as const) {
      const relative = `.claude/hooks/${filename}`;
      const current = await readFile(join(REAL_L0_ROOT, relative));
      const destination = join(projectRoot, relative);
      expect(await readFile(destination)).toEqual(current);
      expect(manifest.checksums[relative]).toBe(
        `sha256:${createHash("sha256").update(current).digest("hex")}`,
      );
      if (process.platform !== "win32") expect((await stat(destination)).mode & 0o777).toBe(0o755);
    }
  });

  it("direct runtime install rejects cross-path historical Detekt bytes without partial writes", async () => {
    await mkdir(join(projectRoot, ".claude", "hooks"), { recursive: true });
    const pre = join(projectRoot, ".claude", "hooks", "detekt-pre-commit.sh");
    const post = join(projectRoot, ".claude", "hooks", "detekt-post-write.sh");
    const legacyPre = await legacyDetektHookBytes("detekt-pre-commit.sh");
    const legacyPost = await legacyDetektHookBytes("detekt-post-write.sh");
    await writeFile(pre, legacyPost);
    await writeFile(post, legacyPre);

    const installed = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);

    expect(installed.ok).toBe(false);
    expect(installed.reason).toBe("runtime-consumer-file-conflict:.claude/hooks/detekt-post-write.sh");
    expect(await readFile(pre)).toEqual(legacyPost);
    expect(await readFile(post)).toEqual(legacyPre);
    await expect(readFile(join(projectRoot, ".claude", "settings.json"), "utf8")).rejects.toThrow();
  });

  it("preflights without writes, then installs exact roles and portable owned hook registrations idempotently", async () => {
    const dry = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT, { dryRun: true });
    expect(dry.ok).toBe(true);
    await expect(readFile(join(projectRoot, ".claude", "settings.json"), "utf8")).rejects.toThrow();

    const first = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(first.ok).toBe(true);
    expect(first.consumerLayer).toBe("L2");
    expect(first.registrations).toBe(17);
    expect(first.toolkitContentDigest).toMatch(/^[0-9a-f]{64}$/);
    const inventoryPaths = new Set(first.inventory?.map((entry) => entry.relative_path));
    expect(inventoryPaths.has("scripts/lib/runtime-consultation.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/primitives.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/cli-argv.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/git-identity.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/coordination-paths.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-role-lifecycle/claude-id01-startup.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-bridge-codex/process-identity.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/wave-control-plane.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/verdict-evidence-contract-cli.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/verdict-evidence-contract.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/verdict-artifact-confinement.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/verdict-artifact-store.cjs")).toBe(true);
    expect(inventoryPaths.has(".claude/registry/wave-topology.yaml")).toBe(true);
    expect(inventoryPaths.has(".claude/hooks/l0-source-hook-launcher.js")).toBe(true);
    expect(inventoryPaths.has(".claude/hooks/plan-md-write-gate.js")).toBe(true);
    expect(inventoryPaths.has(".claude/hooks/hook-control-plane-utils.js")).toBe(true);
    expect(first.inventory?.find((entry) => entry.relative_path === ".claude/hooks/detekt-pre-commit.sh")?.mode)
      .toBe(0o755);
    expect(first.inventory?.find((entry) => entry.relative_path === ".claude/hooks/l0-source-hook-launcher.js")?.mode)
      .toBeUndefined();
    const verifierInventory = runtimeContext.computeRuntimeToolkitInventory(REAL_L0_ROOT);
    expect(verifierInventory.ok).toBe(true);
    expect(first.inventory).toEqual(verifierInventory.entries);
    expect(first.toolkitContentDigest).toBe(verifierInventory.digest);
    const role = await readFile(join(projectRoot, ".claude", "agents", "arch-platform.md"), "utf8");
    expect(role).toBe(await readFile(join(REAL_L0_ROOT, ".claude", "agents", "arch-platform.md"), "utf8"));
    const settings = JSON.parse(await readFile(join(projectRoot, ".claude", "settings.json"), "utf8"));
    const installedHooks = Object.values(settings.hooks).flatMap((blocks: any) =>
      blocks.flatMap((block: any) => block.hooks));
    const commands = Object.values(settings.hooks).flatMap((blocks: any) =>
      blocks.flatMap((block: any) => block.hooks.map((hook: any) => hook.command)));
    expect(commands.filter((command: string) => command.includes("agent-spawn-execution-gate.js"))).toHaveLength(1);
    expect(commands.find((command: string) => command.includes("agent-spawn-execution-gate.js"))).toBe(
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js agent-spawn-execution-gate.js',
    );
    expect(commands.filter((command: string) => command.includes("plan-md-write-gate.js"))).toHaveLength(1);
    expect(commands.find((command: string) => command.includes("plan-md-write-gate.js"))).toBe(
      'node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js plan-md-write-gate.js',
    );
    expect(installedHooks.find((hook: any) => hook.command.includes("plan-md-write-gate.js"))?.timeout)
      .toBe(10);
    expect(installedHooks.find((hook: any) => hook.command.includes("agent-spawn-execution-gate.js"))?.timeout)
      .toBeGreaterThanOrEqual(30);
    expect(commands.every((command: string) => !command.includes(REAL_L0_ROOT.replace(/\\/g, "/")))).toBe(true);
    expect(commands.every((command: string) => !command.includes(process.execPath.replace(/\\/g, "/")))).toBe(true);
    expect(await readFile(join(projectRoot, ".claude", "hooks", "l0-source-hook-launcher.js"), "utf8"))
      .toBe(await readFile(join(REAL_L0_ROOT, ".claude", "hooks", "l0-source-hook-launcher.js"), "utf8"));
    await expect(readFile(join(projectRoot, ".claude", "hooks", "plan-md-write-gate.js"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(projectRoot, ".claude", "hooks", "hook-control-plane-utils.js"), "utf8"))
      .rejects.toThrow();
    const consumerLauncher = join(projectRoot, ".claude", "hooks", "l0-source-hook-launcher.js");
    const hookEnvironment = {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectRoot,
      CLAUDE_WAVE_SLUG: "consumer-fixture",
    };
    const allowedPlannerWrite = spawnSync(
      process.execPath,
      [consumerLauncher, "plan-md-write-gate.js"],
      {
        encoding: "utf8",
        env: hookEnvironment,
        input: JSON.stringify({
          tool_name: "Write",
          agent_type: "planner",
          tool_input: { file_path: join(projectRoot, ".planning", "wave-consumer-fixture", "PLAN.md") },
        }),
      },
    );
    expect(allowedPlannerWrite.status, allowedPlannerWrite.stderr || allowedPlannerWrite.stdout).toBe(0);
    const deniedPlannerWrite = spawnSync(
      process.execPath,
      [consumerLauncher, "plan-md-write-gate.js"],
      {
        encoding: "utf8",
        env: hookEnvironment,
        input: JSON.stringify({
          tool_name: "Write",
          agent_type: "planner",
          tool_input: { file_path: join(tmpdir(), "claude-project-memory", "MEMORY.md") },
        }),
      },
    );
    expect(deniedPlannerWrite.status).toBe(2);
    expect(deniedPlannerWrite.stdout).toContain("planner writes are confined");
    const manifest = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf8"));
    expect(manifest.runtime.consumer_layer).toBe("L2");
    expect(manifest.runtime.toolkit_content_sha256).toBe(first.toolkitContentDigest);
    expect(await readFile(join(projectRoot, ".claude", "registry", "wave-topology.yaml"), "utf8"))
      .toBe(await readFile(join(REAL_L0_ROOT, ".claude", "registry", "wave-topology.yaml"), "utf8"));
    expect(manifest.checksums[".claude/registry/wave-topology.yaml"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(manifest.checksums[".claude/hooks/l0-source-hook-launcher.js"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const file of ["detekt-post-write.sh", "detekt-pre-commit.sh"]) {
      const relative = `.claude/hooks/${file}`;
      expect(await readFile(join(projectRoot, relative), "utf8")).toBe(await readFile(join(REAL_L0_ROOT, relative), "utf8"));
      expect(manifest.checksums[relative]).toMatch(/^sha256:[0-9a-f]{64}$/);
      if (process.platform !== "win32") expect((await stat(join(projectRoot, relative))).mode & 0o777).toBe(0o755);
    }

    const bytesBefore = await readFile(join(projectRoot, ".claude", "settings.json"), "utf8");
    const manifestBytesBefore = await readFile(join(projectRoot, "l0-manifest.json"), "utf8");
    const second = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(second.ok).toBe(true);
    expect(second.addedRoles).toEqual([]);
    expect(second.migratedRoles).toEqual([]);
    expect(second.manifestChanged).toBe(false);
    expect(await readFile(join(projectRoot, ".claude", "settings.json"), "utf8")).toBe(bytesBefore);
    expect(await readFile(join(projectRoot, "l0-manifest.json"), "utf8")).toBe(manifestBytesBefore);
  });

  it("reports a runtime mode-only repair without rewriting the manifest", async () => {
    const installed = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(installed.ok).toBe(true);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const hookPath = join(projectRoot, ".claude", "hooks", "detekt-pre-commit.sh");
    const manifestBefore = await readFile(manifestPath, "utf8");
    await chmod(hookPath, 0o644);

    const dryRun = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT, { dryRun: true });
    expect(dryRun.ok).toBe(true);
    expect(dryRun.manifestChanged).toBe(false);
    if (process.platform !== "win32") {
      expect(dryRun.repairedExecutables).toEqual([".claude/hooks/detekt-pre-commit.sh"]);
      expect((await stat(hookPath)).mode & 0o777).toBe(0o644);
    }

    const repaired = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);

    expect(repaired.ok).toBe(true);
    expect(repaired.manifestChanged).toBe(false);
    if (process.platform !== "win32") {
      expect(repaired.repairedExecutables).toEqual([".claude/hooks/detekt-pre-commit.sh"]);
      expect((await stat(hookPath)).mode & 0o777).toBe(0o755);
    }
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
  });

  it("keeps ordinary-runtime-ordinary-runtime manifest bytes stable", async () => {
    const firstOrdinary = await syncL0(projectRoot, REAL_L0_ROOT);
    expect(firstOrdinary.errors).toEqual([]);
    const registrationWarning = firstOrdinary.warnings.find((warning) =>
      warning.startsWith("Hook registrations added to settings.json:"));
    expect(registrationWarning).toContain("SubagentStart/.*:subagent-start-context-bundle.js");
    expect(registrationWarning).toContain("SubagentStop/.*:subagent-start-context-bundle.js");
    expect((await syncL0(projectRoot, REAL_L0_ROOT, { runtime: true })).errors).toEqual([]);
    const firstRuntime = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(firstRuntime.ok).toBe(true);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const settingsPath = join(projectRoot, ".claude", "settings.json");
    const stableBytes = await readFile(manifestPath, "utf8");
    const stableSettings = await readFile(settingsPath, "utf8");

    const secondOrdinary = await syncL0(projectRoot, REAL_L0_ROOT);
    expect(secondOrdinary.errors).toEqual([]);
    expect(secondOrdinary.manifestChanged).toBe(false);
    expect(secondOrdinary.warnings).not.toContainEqual(expect.stringContaining("Hook registrations added"));
    expect(await readFile(manifestPath, "utf8")).toBe(stableBytes);
    expect(await readFile(settingsPath, "utf8")).toBe(stableSettings);

    expect((await syncL0(projectRoot, REAL_L0_ROOT, { runtime: true })).errors).toEqual([]);
    const secondRuntime = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(secondRuntime.ok).toBe(true);
    expect(secondRuntime.manifestChanged).toBe(false);
    expect(await readFile(manifestPath, "utf8")).toBe(stableBytes);
  });

  it("does not preserve unknown or forged runtime-owned checksums", async () => {
    expect((await installRuntimeConsumer(projectRoot, REAL_L0_ROOT)).ok).toBe(true);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.checksums[".claude/registry/wave-topology.yaml"] = `sha256:${"0".repeat(64)}`;
    manifest.checksums[".claude/runtime/foreign.bin"] = `sha256:${"1".repeat(64)}`;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const ordinary = await syncL0(projectRoot, REAL_L0_ROOT);
    expect(ordinary.errors).toEqual([]);
    const reconciled = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(reconciled.checksums[".claude/registry/wave-topology.yaml"]).toBeUndefined();
    expect(reconciled.checksums[".claude/runtime/foreign.bin"]).toBeUndefined();
  });

  it("preserves a verified previous runtime asset through ordinary sync so runtime can upgrade it", async () => {
    expect((await installRuntimeConsumer(projectRoot, REAL_L0_ROOT)).ok).toBe(true);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const relativeAsset = ".claude/runtime/l0-entrypoint-launcher.cjs";
    const assetPath = join(projectRoot, relativeAsset);
    const previousBytes = "// previous qualified runtime launcher\n";
    await writeFile(assetPath, previousBytes, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const previousChecksum = `sha256:${createHash("sha256").update(previousBytes).digest("hex")}`;
    manifest.checksums[relativeAsset] = previousChecksum;
    manifest.runtime.toolkit_commit = "0".repeat(40);
    manifest.runtime.toolkit_content_sha256 = "1".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    const ordinary = await syncL0(projectRoot, REAL_L0_ROOT);
    expect(ordinary.errors).toEqual([]);
    const afterOrdinary = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(afterOrdinary.checksums[relativeAsset]).toBe(previousChecksum);
    expect(await readFile(assetPath, "utf8")).toBe(previousBytes);

    const upgraded = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(upgraded.ok).toBe(true);
    expect(await readFile(assetPath, "utf8")).toBe(
      await readFile(join(REAL_L0_ROOT, relativeAsset), "utf8"),
    );
    const upgradedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(upgradedManifest.checksums[relativeAsset]).not.toBe(previousChecksum);
    expect(upgradedManifest.runtime.toolkit_commit).not.toBe("0".repeat(40));
    expect(upgradedManifest.runtime.toolkit_content_sha256).not.toBe("1".repeat(64));
  });

  it("drops missing and drifted assets but preserves content ownership across mode drift", async () => {
    expect((await installRuntimeConsumer(projectRoot, REAL_L0_ROOT)).ok).toBe(true);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const missing = ".claude/runtime/l0-entrypoint-launcher.cjs";
    const drifted = ".claude/hooks/detekt-pre-commit.sh";
    const wrongMode = ".claude/hooks/detekt-post-write.sh";
    await rm(join(projectRoot, missing));
    await writeFile(join(projectRoot, drifted), "#!/bin/sh\necho drift\n", "utf8");
    await chmod(join(projectRoot, drifted), 0o755);
    await chmod(join(projectRoot, wrongMode), 0o644);

    const ordinaryRuntimePhase = await syncL0(projectRoot, REAL_L0_ROOT, { runtime: true });
    expect(ordinaryRuntimePhase.errors).toEqual([]);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.checksums[missing]).toBeUndefined();
    expect(manifest.checksums[drifted]).toBeUndefined();
    expect(manifest.checksums[wrongMode]).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("CLI runtime mode repairs 0644 without rewriting a content-stable manifest", async () => {
    const cli = join(REAL_L0_ROOT, "mcp-server", "build", "sync", "sync-l0-cli.js");
    const args = [cli, "--project-root", projectRoot, "--l0-root", REAL_L0_ROOT, "--runtime"];
    const initial = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 60000 });
    expect(initial.status, initial.stderr || initial.stdout).toBe(0);
    const manifestPath = join(projectRoot, "l0-manifest.json");
    const hookPath = join(projectRoot, ".claude", "hooks", "detekt-pre-commit.sh");
    const manifestBefore = await readFile(manifestPath, "utf8");
    await chmod(hookPath, 0o644);

    const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 60000 });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    if (process.platform !== "win32") {
      expect(result.stdout).toContain("Runtime executable mode repaired: .claude/hooks/detekt-pre-commit.sh");
      expect((await stat(hookPath)).mode & 0o777).toBe(0o755);
    }
    expect(result.stdout).toContain("Manifest unchanged: l0-manifest.json (no effective changes)");
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
  });

  it("runs the wave control plane from a clean consumer with no consumer mcp-server", async () => {
    const installed = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(installed.ok).toBe(true);
    await mkdir(join(projectRoot, ".planning", "wave-consumer-fixture"), { recursive: true });
    await writeFile(
      join(projectRoot, ".planning", "wave-consumer-fixture", "PLAN.md"),
      "### Wave Class\n\n**Class**: HARNESS\n",
      "utf8",
    );
    for (const args of [
      ["init", "-q"],
      ["config", "user.email", "test@example.invalid"],
      ["config", "user.name", "Test"],
      ["add", "."],
      ["commit", "-qm", "fixture"],
    ]) {
      const git = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
      expect(git.status, git.stderr).toBe(0);
    }

    const state = waveControl.initialize(projectRoot, "consumer-fixture");
    expect(state.phase).toBe("PREP");
    await expect(readFile(join(projectRoot, "mcp-server", "node_modules", "yaml"), "utf8"))
      .rejects.toThrow();
  });

  it("leaves malformed settings and customized role bytes untouched", async () => {
    await mkdir(join(projectRoot, ".claude", "agents"), { recursive: true });
    await writeFile(join(projectRoot, ".claude", "settings.json"), "{broken", "utf8");
    const malformedBefore = await readFile(join(projectRoot, ".claude", "settings.json"), "utf8");
    const malformed = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(malformed.ok).toBe(false);
    expect(await readFile(join(projectRoot, ".claude", "settings.json"), "utf8")).toBe(malformedBefore);

    await writeFile(join(projectRoot, ".claude", "settings.json"), "{}\n", "utf8");
    await writeFile(join(projectRoot, ".claude", "agents", "arch-platform.md"), "custom role\n", "utf8");
    const roleBefore = await readFile(join(projectRoot, ".claude", "agents", "arch-platform.md"), "utf8");
    const conflict = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe("runtime-role-conflict:arch-platform");
    expect(await readFile(join(projectRoot, ".claude", "agents", "arch-platform.md"), "utf8")).toBe(roleBefore);
  });

  it("preserves arbitrary commands that only mention an owned hook basename", async () => {
    const arbitrary = 'node -e "console.log(\'bash-cli-spawn-gate.js\')"';
    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(join(projectRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: arbitrary, timeout: 9 }] }] },
    }, null, 2) + "\n");

    const installed = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(installed.ok).toBe(true);
    const settings = JSON.parse(await readFile(join(projectRoot, ".claude", "settings.json"), "utf8"));
    const commands = Object.values(settings.hooks).flatMap((blocks: any) =>
      blocks.flatMap((block: any) => block.hooks.map((hook: any) => hook.command)));
    expect(commands.filter((command: string) => command === arbitrary)).toHaveLength(1);
    expect(runtimeContext.verifyRuntimeConsumerInstallation(projectRoot).ok).toBe(true);
  });

  it("wires --runtime through the built CLI, keeps dry-run write-free, and qualifies a second idempotent sync", async () => {
    const cliRoot = await mkdtemp(join(tmpdir(), "runtime cli consumer "));
    try {
      await writeRuntimeManifest(cliRoot);
      const manifestBefore = await readFile(join(cliRoot, "l0-manifest.json"), "utf8");
      const cli = join(REAL_L0_ROOT, "mcp-server", "build", "sync", "sync-l0-cli.js");
      const args = [cli, "--project-root", cliRoot, "--l0-root", REAL_L0_ROOT, "--runtime"];
      const dry = spawnSync(process.execPath, [...args, "--dry-run"], { encoding: "utf8" });
      expect(dry.status, dry.stderr || dry.stdout).toBe(0);
      expect(await readFile(join(cliRoot, "l0-manifest.json"), "utf8")).toBe(manifestBefore);
      await expect(readFile(join(cliRoot, ".claude", "settings.json"), "utf8")).rejects.toThrow();

      const first = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(first.status, first.stderr || first.stdout).toBe(0);
      expect(first.stdout).toContain(`Required Claude launch: claude --add-dir ${JSON.stringify(REAL_L0_ROOT)} --effort high`);
      expect(runtimeContext.verifyRuntimeConsumerInstallation(cliRoot, { verifyContent: true }).ok).toBe(true);
      const settingsBefore = await readFile(join(cliRoot, ".claude", "settings.json"), "utf8");
      const second = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(second.status, second.stderr || second.stdout).toBe(0);
      expect(await readFile(join(cliRoot, ".claude", "settings.json"), "utf8")).toBe(settingsBefore);
    } finally {
      await rm(cliRoot, { recursive: true, force: true });
    }
  });

  it("installs and verifies the runtime from a real linked consumer worktree", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "runtime-worktree-fixture-"));
    const mainRoot = join(fixture, "consumer-main");
    const linkedRoot = join(fixture, "linked", "deep", "consumer-worktree");
    try {
      await mkdir(mainRoot, { recursive: true });
      await writeRuntimeManifest(mainRoot);
      for (const args of [
        ["init", "-q"],
        ["config", "user.email", "test@example.invalid"],
        ["config", "user.name", "Test"],
        ["add", "."],
        ["commit", "-qm", "fixture"],
      ]) {
        const git = spawnSync("git", args, { cwd: mainRoot, encoding: "utf8" });
        expect(git.status, git.stderr).toBe(0);
      }
      await mkdir(join(fixture, "linked", "deep"), { recursive: true });
      const worktree = spawnSync("git", ["worktree", "add", "-q", "-b", "runtime-fixture", linkedRoot], {
        cwd: mainRoot, encoding: "utf8",
      });
      expect(worktree.status, worktree.stderr).toBe(0);

      const cli = join(REAL_L0_ROOT, "mcp-server", "build", "sync", "sync-l0-cli.js");
      const installed = spawnSync(process.execPath, [cli, "--project-root", linkedRoot, "--runtime"], {
        encoding: "utf8", timeout: 60000,
      });
      expect(installed.status, installed.stderr || installed.stdout).toBe(0);
      expect(runtimeContext.verifyRuntimeConsumerInstallation(linkedRoot, { verifyContent: true }).ok).toBe(true);
      expect(await readFile(join(linkedRoot, ".claude", "registry", "wave-topology.yaml"), "utf8"))
        .toBe(await readFile(join(REAL_L0_ROOT, ".claude", "registry", "wave-topology.yaml"), "utf8"));
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("fails closed before writes when runtime metadata is absent or destructive sync flags are requested", async () => {
    const cli = join(REAL_L0_ROOT, "mcp-server", "build", "sync", "sync-l0-cli.js");
    const missingManifestRoot = await mkdtemp(join(tmpdir(), "runtime missing manifest "));
    const guardedRoot = await mkdtemp(join(tmpdir(), "runtime guarded flags "));
    try {
      const missing = spawnSync(process.execPath, [cli, "--project-root", missingManifestRoot, "--runtime", "--dry-run"], { encoding: "utf8" });
      expect(missing.status).toBe(1);
      await expect(readFile(join(missingManifestRoot, "l0-manifest.json"), "utf8")).rejects.toThrow();
      await expect(readFile(join(missingManifestRoot, ".claude", "settings.json"), "utf8")).rejects.toThrow();

      await writeRuntimeManifest(guardedRoot);
      const manifestBefore = await readFile(join(guardedRoot, "l0-manifest.json"), "utf8");
      for (const flag of ["--prune", "--force", "--force-l0-managed", "--auto-migrate"]) {
        const denied = spawnSync(process.execPath, [cli, "--project-root", guardedRoot, "--runtime", flag], { encoding: "utf8" });
        expect(denied.status, `${flag}: ${denied.stderr || denied.stdout}`).toBe(1);
        expect(await readFile(join(guardedRoot, "l0-manifest.json"), "utf8")).toBe(manifestBefore);
        await expect(readFile(join(guardedRoot, ".claude", "settings.json"), "utf8")).rejects.toThrow();
      }
    } finally {
      await rm(missingManifestRoot, { recursive: true, force: true });
      await rm(guardedRoot, { recursive: true, force: true });
    }
  });
});

// F-19/F-21: darwin path canonicalisation at the manifest boundary.
//
// The manifest's L0 `path` is authored LEXICALLY relative to the consumer root
// as given. Production resolved it against realpath(projectRoot) instead. On
// macOS /var -> /private/var adds one segment, so the relative `..` traversal
// landed one level high and produced paths like /private/Users/... which never
// exist. Linux has no such symlink, and the mcp-server CI matrix is
// [ubuntu-latest, windows-latest] only, so no runner ever exercised this.
describe("darwin manifest path canonicalisation (F-21)", () => {
  let projectRoot: string;

  beforeEach(async () => {
    // tmpdir() on macOS is /var/... whose realpath is /private/var/... -- the
    // exact shape that exposes the defect. On Linux the two coincide and this
    // test simply keeps passing, which is the intended cross-platform contract.
    projectRoot = await mkdtemp(join(tmpdir(), "f21-consumer-"));
    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeRuntimeManifest(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("resolves a relative L0 source against the root as given, never by prepending /private", async () => {
    const result = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT, { dryRun: true });
    // The precise defect signature: an ENOENT naming a /private-prefixed path.
    const reason = String((result as { reason?: string }).reason ?? "");
    expect(reason).not.toMatch(/\/private\/Users/);
    expect(reason).not.toMatch(/ENOENT/);
    // And it must not be rejected as an invalid L0 source, which is how the
    // mis-resolved path surfaced when realpath happened to succeed.
    expect(reason).not.toBe("runtime-l0-source-invalid");
  });

  it("still rejects a genuinely wrong L0 source path", async () => {
    await writeFile(join(projectRoot, "l0-manifest.json"), JSON.stringify({
      version: 2,
      sources: [{ layer: "L0", path: "definitely/not/the/toolkit", role: "tooling" }],
      topology: "flat", last_synced: "2026-09-05T00:00:00.000Z",
      selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [], exclude_hooks: [] },
      checksums: {}, l2_specific: { commands: [], agents: [], skills: [] }, migrations_applied: [],
    }, null, 2) + "\n");
    const result = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT, { dryRun: true });
    expect(result.ok).toBe(false);
    expect((result as { reason?: string }).reason).toBe("runtime-l0-source-invalid");
  });
});
