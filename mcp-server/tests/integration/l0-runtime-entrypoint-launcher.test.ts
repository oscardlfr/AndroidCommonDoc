import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = fs.realpathSync(path.resolve(__dirname, "../../.."));
const req = createRequire(import.meta.url);
const runtimeContext = req(path.join(ROOT, "scripts/lib/runtime-project-context.cjs"));
const toolkitLauncherModule = req(path.join(ROOT, ".claude/runtime/l0-toolkit-launcher.cjs"));
const SOURCE_REFERENCED = new Set([
  "agent-spawn-execution-gate.js", "bash-cli-spawn-gate.js", "context-provider-consulted.js", "context-provider-gate.js",
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
  const toolkitLauncher = path.join(consumerRoot, ".claude/runtime/l0-toolkit-launcher.cjs");
  fs.copyFileSync(path.join(ROOT, ".claude/runtime/l0-toolkit-launcher.cjs"), toolkitLauncher);
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
  return { consumerRoot, launcher, toolkitLauncher, manifest };
}

function runLauncher(launcher: string, projectRoot: string, extra: string[] = []) {
  const intent = Buffer.from(JSON.stringify({ scope: "all" }), "utf8").toString("base64url");
  return spawnSync(process.execPath, [launcher, "execute", "--entrypoint", "monitor-docs", "--project-root", projectRoot, "--intent", intent, ...extra], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function detektHookEnvironment(consumerRoot: string) {
  const bin = path.join(consumerRoot, "fixture-bin");
  const argsFile = path.join(consumerRoot, "detekt-java-args.txt");
  fs.mkdirSync(bin, { recursive: true });
  const java = path.join(bin, "java");
  fs.writeFileSync(java, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$DETEKT_ARGS_FILE\"\n");
  fs.chmodSync(java, 0o755);
  const cli = path.join(consumerRoot, ".androidcommondoc/cache/detekt/detekt-cli-2.0.0-alpha.2-all.jar");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "fixture-cli\n");
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}`, DETEKT_ARGS_FILE: argsFile };
  delete env.ANDROID_COMMON_DOC;
  return { argsFile, cli, env };
}

describe("L0 runtime entrypoint launcher", () => {
  it("maps every declared operation to checked-in POSIX and Windows targets", () => {
    for (const [id, spec] of Object.entries(toolkitLauncherModule.TOOL_SPECS) as Array<[
      string, { relative: string; windowsRelative?: string }
    ]>) {
      expect(fs.statSync(path.join(ROOT, spec.relative)).isFile(), `${id} POSIX target`).toBe(true);
      if (spec.windowsRelative) {
        expect(fs.statSync(path.join(ROOT, spec.windowsRelative)).isFile(), `${id} Windows target`).toBe(true);
      }
    }
  });

  it("adapts consumer arguments for native Windows wrappers without exposing toolkit paths", () => {
    expect(toolkitLauncherModule.adaptWindowsArgs(
      { windowsPositionalFlag: "-Module" }, ["core:data", "--all", "--project-root", "C:\\work"],
    )).toEqual(["-Module", "core:data", "-All", "-ProjectRoot", "C:\\work"]);
    expect(toolkitLauncherModule.adaptWindowsArgs(
      { windowsPackArguments: true }, ["android", "--clean"],
    )).toEqual(["-Arguments", "android --clean"]);
  });

  it("preserves GNU root flags for PowerShell bridges that forward to Bash", () => {
    expect(toolkitLauncherModule.injectedRootFlag(
      { windowsArgumentStyle: "gnu" }, { windows: true }, "--project-root", "-ProjectRoot",
    )).toBe("--project-root");
    expect(toolkitLauncherModule.injectedRootFlag(
      {}, { windows: true }, "--project-root", "-ProjectRoot",
    )).toBe("-ProjectRoot");
    expect(toolkitLauncherModule.injectedRootFlag(
      {}, { windows: false }, "--project-root", "-ProjectRoot",
    )).toBe("--project-root");
  });

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

  it("lets an enabled runtime manifest win when an L1 consumer has its own MCP server", () => {
    const fixture = installConsumer("L1");
    try {
      fs.mkdirSync(path.join(fixture.consumerRoot, "mcp-server"), { recursive: true });
      fs.writeFileSync(path.join(fixture.consumerRoot, "mcp-server/package.json"), "{}\n");
      const result = spawnSync(process.execPath, [fixture.toolkitLauncher, "describe", "layer",
        "--project-root", fixture.consumerRoot], { cwd: fixture.consumerRoot, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("L1");
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
    }
  });

  it.each(["L1", "L2"] as const)("describes the manifest-qualified toolkit root for a %s consumer", (layer) => {
    const fixture = installConsumer(layer);
    try {
      const result = spawnSync(process.execPath, [fixture.toolkitLauncher, "describe", "toolkit-root",
        "--project-root", fixture.consumerRoot], { cwd: fixture.consumerRoot, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(ROOT);
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("runs both materialized Detekt hooks against the qualified toolkit without an ambient root", () => {
    const fixture = installConsumer("L2");
    try {
      const kotlin = path.join(fixture.consumerRoot, "Sample.kt");
      fs.writeFileSync(kotlin, "class Sample\n");
      const fake = detektHookEnvironment(fixture.consumerRoot);
      const post = spawnSync("bash", [path.join(fixture.consumerRoot, ".claude/hooks/detekt-post-write.sh")], {
        cwd: fixture.consumerRoot,
        env: fake.env,
        input: JSON.stringify({ tool_input: { file_path: kotlin } }),
        encoding: "utf8",
      });
      expect(post.status, post.stderr).toBe(0);
      const rulesJar = path.join(ROOT, "detekt-rules/build/libs/detekt-rules-1.0.0.jar");
      if (fs.existsSync(rulesJar)) {
        expect(fs.readFileSync(fake.argsFile, "utf8")).toContain(rulesJar);
        expect(fs.readFileSync(fake.argsFile, "utf8")).toContain(fake.cli);
        fs.rmSync(fake.argsFile);
      } else {
        expect(post.stderr).toContain(`Rules JAR not found at ${rulesJar}`);
        expect(fs.existsSync(fake.argsFile)).toBe(false);
      }

      expect(spawnSync("git", ["init", "--quiet"], { cwd: fixture.consumerRoot }).status).toBe(0);
      expect(spawnSync("git", ["add", "Sample.kt"], { cwd: fixture.consumerRoot }).status).toBe(0);
      const pre = spawnSync("bash", [path.join(fixture.consumerRoot, ".claude/hooks/detekt-pre-commit.sh")], {
        cwd: fixture.consumerRoot,
        env: fake.env,
        input: JSON.stringify({ tool_input: { command: "git commit -m fixture" } }),
        encoding: "utf8",
      });
      expect(pre.status, pre.stderr).toBe(0);
      if (fs.existsSync(rulesJar)) {
        expect(fs.readFileSync(fake.argsFile, "utf8")).toContain(path.join(ROOT, "detekt-rules/src/main/resources/config/config.yml"));
        expect(fs.readFileSync(fake.argsFile, "utf8")).toContain(fake.cli);
      } else {
        expect(pre.stderr).toContain(`Rules JAR not found at ${rulesJar}`);
        expect(fs.existsSync(fake.argsFile)).toBe(false);
      }

      for (const name of ["detekt-post-write.sh", "detekt-pre-commit.sh"]) {
        const source = fs.readFileSync(path.join(fixture.consumerRoot, ".claude/hooks", name), "utf8");
        expect(source).not.toContain("${ANDROID_COMMON_DOC:-}");
      }
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("fails a Detekt hook closed when the consumer runtime can no longer qualify L0", () => {
    const fixture = installConsumer("L2");
    try {
      const kotlin = path.join(fixture.consumerRoot, "Sample.kt");
      fs.writeFileSync(kotlin, "class Sample\n");
      fixture.manifest.runtime.toolkit_content_sha256 = "0".repeat(64);
      fs.writeFileSync(path.join(fixture.consumerRoot, "l0-manifest.json"), JSON.stringify(fixture.manifest));
      const fake = detektHookEnvironment(fixture.consumerRoot);
      const result = spawnSync("bash", [path.join(fixture.consumerRoot, ".claude/hooks/detekt-post-write.sh")], {
        cwd: fixture.consumerRoot,
        env: fake.env,
        input: JSON.stringify({ tool_input: { file_path: kotlin } }),
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("L0 toolkit source could not be qualified for Detekt post-write");
      expect(fs.existsSync(fake.argsFile)).toBe(false);
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
    }
  });

  it("resolves commit types from L0 and scopes from an L1 consumer", () => {
    const fixture = installConsumer("L1");
    try {
      fs.writeFileSync(path.join(fixture.consumerRoot, ".commitlintrc.json"), JSON.stringify({
        valid_scopes: ["consumer-scope"],
      }));
      const result = spawnSync(process.execPath, [fixture.toolkitLauncher, "run", "commit-tokens",
        "--project-root", fixture.consumerRoot, "--", "--format", "json"], {
        cwd: fixture.consumerRoot,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        valid_types: expect.arrayContaining(["feat", "fix"]),
        valid_scopes: ["consumer-scope"],
        types_source: ".github/workflows/reusable-commit-lint.yml",
        scopes_source: ".commitlintrc.json",
      });
    } finally {
      fs.rmSync(fixture.consumerRoot, { recursive: true, force: true });
    }
  });

  it("does not fall back to L0 shape heuristics when a present runtime manifest is disabled", () => {
    const fixture = installConsumer("L1");
    try {
      fs.mkdirSync(path.join(fixture.consumerRoot, "mcp-server"), { recursive: true });
      fs.writeFileSync(path.join(fixture.consumerRoot, "mcp-server/package.json"), "{}\n");
      fixture.manifest.runtime.enabled = false;
      fs.writeFileSync(path.join(fixture.consumerRoot, "l0-manifest.json"), JSON.stringify(fixture.manifest));
      const result = spawnSync(process.execPath, [fixture.toolkitLauncher, "describe", "layer",
        "--project-root", fixture.consumerRoot], { cwd: fixture.consumerRoot, encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("runtime consumer manifest is not enabled or is unsafe");
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
