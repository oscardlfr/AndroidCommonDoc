import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = fs.realpathSync(path.resolve(__dirname, "../../.."));
const req = createRequire(import.meta.url);
const runtimeContext = req(path.join(ROOT, "scripts/lib/runtime-project-context.cjs"));
const SOURCE_REFERENCED = new Set([
  "agent-spawn-execution-gate.js", "bash-cli-spawn-gate.js", "context-provider-gate.js",
  "premature-execution-gate.js", "runtime-consultation-target-gate.js",
  "plan-md-write-gate.js",
  "runtime-host-boundary.js", "runtime-host-session-start.js", "subagent-start-context-bundle.js",
]);

function installConsumer(layer: "L1" | "L2", suppliedRoot?: string, sourceBase?: string) {
  const rawRoot = suppliedRoot || fs.mkdtempSync(path.join(os.tmpdir(), "acd launcher consumer "));
  const consumerRoot = fs.realpathSync(rawRoot);
  if (layer === "L1") {
    fs.mkdirSync(path.join(consumerRoot, "skills"), { recursive: true });
    fs.writeFileSync(path.join(consumerRoot, "skills/registry.json"), "{}\n");
  }
  const launcher = path.join(consumerRoot, ".claude/runtime/l0-entrypoint-launcher.cjs");
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.copyFileSync(path.join(ROOT, ".claude/runtime/l0-entrypoint-launcher.cjs"), launcher);
  const topology = path.join(consumerRoot, ".claude/registry/wave-topology.yaml");
  fs.mkdirSync(path.dirname(topology), { recursive: true });
  fs.copyFileSync(path.join(ROOT, ".claude/registry/wave-topology.yaml"), topology);
  const hookLauncher = path.join(consumerRoot, ".claude/hooks/l0-source-hook-launcher.js");
  fs.mkdirSync(path.dirname(hookLauncher), { recursive: true });
  fs.copyFileSync(path.join(ROOT, ".claude/hooks/l0-source-hook-launcher.js"), hookLauncher);
  for (const relative of [
    ".claude/hooks/context-provider-write-gate.js",
    ".claude/hooks/tool-use-logger.js",
    "scripts/sh/write-bundle.sh",
    "scripts/sh/lib/wave-slug.sh",
  ]) {
    const destination = path.join(consumerRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relative), destination);
  }
  for (const shellHook of ["detekt-post-write.sh", "detekt-pre-commit.sh"]) {
    const destination = path.join(consumerRoot, ".claude/hooks", shellHook);
    fs.copyFileSync(path.join(ROOT, ".claude/hooks", shellHook), destination);
    fs.chmodSync(destination, 0o755);
  }
  for (const role of runtimeContext.ROLE_TEMPLATES) {
    const destination = path.join(consumerRoot, ".claude/agents", `${role}.md`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ".claude/agents", `${role}.md`), destination);
  }
  const hooks: Record<string, Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>> = {};
  for (const [event, matcher, file, timeout] of runtimeContext.HOOK_MATRIX) {
    hooks[event] ||= [];
    let block = hooks[event].find((candidate) => candidate.matcher === matcher);
    if (!block) {
      block = { matcher, hooks: [] };
      hooks[event].push(block);
    }
    block.hooks.push({
      type: "command",
      command: SOURCE_REFERENCED.has(file)
        ? `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/l0-source-hook-launcher.js ${file}`
        : file.endsWith(".sh")
          ? `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`
          : `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/${file}`,
      timeout,
    });
  }
  fs.writeFileSync(path.join(consumerRoot, ".claude/settings.json"), JSON.stringify({ hooks }, null, 2));
  const inventory = runtimeContext.computeRuntimeToolkitInventory(ROOT);
  expect(inventory.ok).toBe(true);
  const manifest = {
    version: 2,
    sources: [{ layer: "L0", path: path.relative(sourceBase || consumerRoot, ROOT), role: "tooling" }],
    topology: "flat",
    last_synced: "2026-09-27T00:00:00.000Z",
    selection: { mode: "include-all", exclude_skills: [], exclude_agents: [], exclude_commands: [], exclude_categories: [], exclude_hooks: [] },
    checksums: {},
    l2_specific: { commands: [], agents: [], skills: [] },
    migrations_applied: [],
    runtime: {
      schema: "runtime-consumer/v1", enabled: true, consumer_layer: layer,
      toolkit_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      toolkit_content_sha256: inventory.digest,
    },
  };
  fs.writeFileSync(path.join(consumerRoot, "l0-manifest.json"), JSON.stringify(manifest));
  return { consumerRoot, launcher, manifest };
}

function runLauncher(launcher: string, projectRoot: string, extra: string[] = []) {
  const intent = Buffer.from(JSON.stringify({ scope: "all" }), "utf8").toString("base64url");
  return spawnSync(process.execPath, [launcher, "execute", "--entrypoint", "monitor-docs", "--project-root", projectRoot, "--intent", intent, ...extra], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("L0 runtime entrypoint launcher", () => {
  it("retains canonical L0 self-use when the launcher and L0 markers share the project root", () => {
    const launcher = path.join(ROOT, ".claude/runtime/l0-entrypoint-launcher.cjs");
    const result = runLauncher(launcher, ROOT);
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 6, stderr: "" });
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      schema: "runtime/collaboration-entrypoint-result/v1",
      entrypoint: "monitor-docs",
      status: "UNAVAILABLE",
    });
  });

  it.each(["L1", "L2"] as const)("qualifies a clean %s installation and reaches the canonical entrypoint", (layer) => {
    const fixture = installConsumer(layer);
    try {
      const result = runLauncher(fixture.launcher, fixture.consumerRoot);
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 6, stderr: "" });
      const envelope = JSON.parse(result.stdout.trim());
      expect(envelope).toMatchObject({
        schema: "runtime/collaboration-entrypoint-result/v1",
        entrypoint: "monitor-docs",
        status: "UNAVAILABLE",
        detail: "host-composition-unavailable",
      });
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
    }
  });

  it("resolves a main-checkout-relative L0 source from a consumer Git worktree", () => {
    const fixtureBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "acd launcher worktree ")));
    const mainRoot = path.join(fixtureBase, "main");
    const consumerRoot = path.join(fixtureBase, "consumer");
    fs.mkdirSync(mainRoot);
    expect(spawnSync("git", ["init", "--quiet"], { cwd: mainRoot }).status).toBe(0);
    expect(spawnSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: mainRoot }).status).toBe(0);
    expect(spawnSync("git", ["config", "user.name", "Fixture"], { cwd: mainRoot }).status).toBe(0);
    fs.writeFileSync(path.join(mainRoot, ".gitkeep"), "");
    expect(spawnSync("git", ["add", ".gitkeep"], { cwd: mainRoot }).status).toBe(0);
    expect(spawnSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: mainRoot }).status).toBe(0);
    expect(spawnSync("git", ["worktree", "add", "--quiet", "-b", "consumer-test", consumerRoot], { cwd: mainRoot }).status).toBe(0);
    try {
      const fixture = installConsumer("L2", consumerRoot, mainRoot);
      const result = runLauncher(fixture.launcher, fixture.consumerRoot);
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 6, stderr: "" });
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        entrypoint: "monitor-docs", status: "UNAVAILABLE", detail: "host-composition-unavailable",
      });
    } finally {
      fs.rmSync(fixtureBase, { recursive: true, force: true });
    }
  });

  it("fails closed on extra argv, a foreign project root, content-pin drift, and a symlinked launcher", () => {
    const fixture = installConsumer("L2");
    const foreignRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "acd launcher foreign ")));
    try {
      expect(runLauncher(fixture.launcher, fixture.consumerRoot, ["--extra", "value"]).status).toBe(1);
      expect(runLauncher(fixture.launcher, foreignRoot).status).toBe(1);

      const drifted = { ...fixture.manifest, runtime: { ...fixture.manifest.runtime, toolkit_content_sha256: "0".repeat(64) } };
      fs.writeFileSync(path.join(fixture.consumerRoot, "l0-manifest.json"), JSON.stringify(drifted));
      expect(runLauncher(fixture.launcher, fixture.consumerRoot).status).toBe(1);

      const realLauncher = `${fixture.launcher}.real`;
      fs.renameSync(fixture.launcher, realLauncher);
      fs.symlinkSync(realLauncher, fixture.launcher);
      expect(runLauncher(fixture.launcher, fixture.consumerRoot).status).toBe(1);
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
      fs.rmSync(foreignRoot, { recursive: true, force: true });
    }
  });
});
