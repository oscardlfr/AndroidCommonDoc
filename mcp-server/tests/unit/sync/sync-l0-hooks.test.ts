import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { syncHooks, installRuntimeConsumer } from "../../../src/sync/sync-engine.js";

const REAL_L0_ROOT = resolve(import.meta.dirname, "../../../..");
const localRequire = createRequire(import.meta.url);
const runtimeContext = localRequire(join(REAL_L0_ROOT, "scripts", "lib", "runtime-project-context.cjs"));

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

  it("preflights without writes, then installs exact roles and absolute owned hook registrations idempotently", async () => {
    const dry = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT, { dryRun: true });
    expect(dry.ok).toBe(true);
    await expect(readFile(join(projectRoot, ".claude", "settings.json"), "utf8")).rejects.toThrow();

    const first = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(first.ok).toBe(true);
    expect(first.consumerLayer).toBe("L2");
    expect(first.registrations).toBe(14);
    expect(first.toolkitContentDigest).toMatch(/^[0-9a-f]{64}$/);
    const inventoryPaths = new Set(first.inventory?.map((entry) => entry.relative_path));
    expect(inventoryPaths.has("scripts/lib/runtime-consultation.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/primitives.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/cli-argv.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/git-identity.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-consultation/coordination-paths.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-role-lifecycle/claude-id01-startup.cjs")).toBe(true);
    expect(inventoryPaths.has("scripts/lib/runtime-bridge-codex/process-identity.cjs")).toBe(true);
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
    expect(commands.find((command: string) => command.includes("agent-spawn-execution-gate.js"))).toContain(REAL_L0_ROOT.replace(/\\/g, "/"));
    expect(installedHooks.find((hook: any) => hook.command.includes("agent-spawn-execution-gate.js"))?.timeout)
      .toBeGreaterThanOrEqual(30);
    expect(commands.some((command: string) => command.includes("$CLAUDE_PROJECT_DIR") && command.includes("agent-spawn"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(projectRoot, "l0-manifest.json"), "utf8"));
    expect(manifest.runtime.consumer_layer).toBe("L2");
    expect(manifest.runtime.toolkit_content_sha256).toBe(first.toolkitContentDigest);

    const bytesBefore = await readFile(join(projectRoot, ".claude", "settings.json"), "utf8");
    const second = await installRuntimeConsumer(projectRoot, REAL_L0_ROOT);
    expect(second.ok).toBe(true);
    expect(second.addedRoles).toEqual([]);
    expect(second.migratedRoles).toEqual([]);
    expect(await readFile(join(projectRoot, ".claude", "settings.json"), "utf8")).toBe(bytesBefore);
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
      expect(runtimeContext.verifyRuntimeConsumerInstallation(cliRoot, { verifyContent: true }).ok).toBe(true);
      const settingsBefore = await readFile(join(cliRoot, ".claude", "settings.json"), "utf8");
      const second = spawnSync(process.execPath, args, { encoding: "utf8" });
      expect(second.status, second.stderr || second.stdout).toBe(0);
      expect(await readFile(join(cliRoot, ".claude", "settings.json"), "utf8")).toBe(settingsBefore);
    } finally {
      await rm(cliRoot, { recursive: true, force: true });
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
