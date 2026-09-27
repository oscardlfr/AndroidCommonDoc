import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const L0_ROOT = resolve(import.meta.dirname, "../../..");
const LAUNCHER = join(L0_ROOT, ".claude", "hooks", "l0-source-hook-launcher.js");
const roots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function writeToolkit(root: string, hookBody = "process.stdin.pipe(process.stdout);\n"): Promise<void> {
  await mkdir(join(root, "skills"), { recursive: true });
  await mkdir(join(root, ".claude", "hooks"), { recursive: true });
  await writeFile(join(root, "skills", "registry.json"), "{}\n", "utf8");
  await writeFile(join(root, ".claude", "hooks", "context-provider-gate.js"), hookBody, "utf8");
}

async function writeManifest(consumer: string, toolkit: string, extraSource: Record<string, unknown> = {}): Promise<void> {
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, "l0-manifest.json"), JSON.stringify({
    version: 2,
    sources: [{
      layer: "L0", role: "tooling",
      path: relative(consumer, toolkit),
      ...extraSource,
    }],
  }, null, 2) + "\n", "utf8");
}

function launch(consumer: string, hook = "context-provider-gate.js", input = "fixture-input"): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [LAUNCHER, hook], {
    cwd: consumer,
    env: { ...process.env, CLAUDE_PROJECT_DIR: consumer },
    input,
    encoding: "utf8",
    timeout: 10000,
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable L0 source hook launcher", () => {
  it("resolves the manifest source and preserves hook stdin, stdout, and exit status", async () => {
    const root = await temporaryRoot("l0-launcher-success-");
    const consumer = join(root, "consumer");
    const toolkit = join(root, "toolkit");
    await writeToolkit(toolkit, [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; });",
      "process.stdin.on('end', () => { process.stdout.write(input); process.exit(2); });",
      "",
    ].join("\n"));
    await writeManifest(consumer, toolkit);

    const result = launch(consumer, "context-provider-gate.js", "preserved-payload");
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe("preserved-payload");
  });

  it("fails closed for malformed, remote, unresolved, or unsupported inputs", async () => {
    const root = await temporaryRoot("l0-launcher-invalid-");
    const consumer = join(root, "consumer");
    const toolkit = join(root, "toolkit");
    await writeToolkit(toolkit);
    await writeManifest(consumer, toolkit, { remote: "https://example.invalid/toolkit.git" });
    expect(launch(consumer).status).toBe(1);

    await writeManifest(consumer, join(root, "missing"));
    expect(launch(consumer).status).toBe(1);

    await writeFile(join(consumer, "l0-manifest.json"), "{broken", "utf8");
    expect(launch(consumer).status).toBe(1);

    await writeManifest(consumer, toolkit);
    expect(launch(consumer, "../../unsafe.js").status).toBe(1);
    expect(launch(consumer, "unknown-hook.js").status).toBe(1);
  });

  it("resolves a main-checkout-relative manifest from a linked consumer worktree", async () => {
    const root = await temporaryRoot("l0-launcher-worktree-");
    const mainConsumer = join(root, "main", "consumer");
    const mainToolkit = join(root, "main", "toolkit");
    const linkedConsumer = join(root, "linked", "consumer");
    await writeToolkit(mainToolkit, "process.stdout.write('main-toolkit');\n");
    await writeManifest(mainConsumer, mainToolkit);
    for (const args of [
      ["init", "-q"], ["config", "user.email", "test@example.invalid"],
      ["config", "user.name", "Test"], ["add", "."], ["commit", "-qm", "fixture"],
    ]) {
      const result = spawnSync("git", args, { cwd: mainConsumer, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
    await mkdir(join(root, "linked"), { recursive: true });
    const worktree = spawnSync("git", ["worktree", "add", "-q", "-b", "launcher-fixture", linkedConsumer], {
      cwd: mainConsumer, encoding: "utf8",
    });
    expect(worktree.status, worktree.stderr).toBe(0);

    const result = launch(linkedConsumer);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("main-toolkit");
  });

  it("fails closed when linked and main checkout paths resolve to different L0 roots", async () => {
    const root = await temporaryRoot("l0-launcher-ambiguous-");
    const mainConsumer = join(root, "main", "consumer");
    const mainToolkit = join(root, "main", "toolkit");
    const linkedConsumer = join(root, "linked", "consumer");
    const linkedToolkit = join(root, "linked", "toolkit");
    await writeToolkit(mainToolkit);
    await writeToolkit(linkedToolkit);
    await writeManifest(mainConsumer, mainToolkit);
    for (const args of [
      ["init", "-q"], ["config", "user.email", "test@example.invalid"],
      ["config", "user.name", "Test"], ["add", "."], ["commit", "-qm", "fixture"],
    ]) {
      const result = spawnSync("git", args, { cwd: mainConsumer, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
    await mkdir(join(root, "linked"), { recursive: true });
    const worktree = spawnSync("git", ["worktree", "add", "-q", "-b", "launcher-ambiguous", linkedConsumer], {
      cwd: mainConsumer, encoding: "utf8",
    });
    expect(worktree.status, worktree.stderr).toBe(0);

    const result = launch(linkedConsumer);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ambiguous");
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked hook target", async () => {
    const root = await temporaryRoot("l0-launcher-symlink-");
    const consumer = join(root, "consumer");
    const toolkit = join(root, "toolkit");
    const outside = join(root, "outside.js");
    await mkdir(join(toolkit, "skills"), { recursive: true });
    await mkdir(join(toolkit, ".claude", "hooks"), { recursive: true });
    await writeFile(join(toolkit, "skills", "registry.json"), "{}\n", "utf8");
    await writeFile(outside, "process.exit(0);\n", "utf8");
    await symlink(outside, join(toolkit, ".claude", "hooks", "context-provider-gate.js"));
    await writeManifest(consumer, toolkit);

    const result = launch(consumer);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not a regular file");
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked toolkit source declared by the manifest", async () => {
    const root = await temporaryRoot("l0-launcher-source-symlink-");
    const consumer = join(root, "consumer");
    const toolkit = join(root, "toolkit");
    const toolkitLink = join(root, "toolkit-link");
    await writeToolkit(toolkit);
    await symlink(toolkit, toolkitLink, "dir");
    await writeManifest(consumer, toolkitLink);

    const result = launch(consumer);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("L0 tooling source is unresolved");
  });
});
