import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOOK = path.resolve(
  __dirname,
  "../../../../.claude/hooks/plan-mode-spawn-planner.js"
);

function runHook(payload: object, cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    cwd: cwd ?? os.tmpdir(),
    encoding: "utf8",
    timeout: 5000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeFakeRepo(base: string): string {
  const repo = mkdtempSync(path.join(base, "fake-repo-"));
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  mkdirSync(path.join(repo, ".planning"), { recursive: true });
  mkdirSync(path.join(repo, "mcp-server"), { recursive: true });
  writeFileSync(path.join(repo, "mcp-server", "package.json"), '{"name":"test"}');
  return repo;
}

const SENTINEL_NAME = ".plan-mode-planner-required";

describe("resolveProjectRoot — via EnterPlanMode sentinel placement", () => {
  let base: string;
  let repo: string;
  let subdir: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "pmsp-test-"));
    repo = makeFakeRepo(base);
    subdir = path.join(repo, "mcp-server");
  });

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("EnterPlanMode from subdirectory writes sentinel to project root, not subdir", () => {
    const result = runHook({ tool_name: "EnterPlanMode", cwd: subdir }, subdir);
    expect(result.status).toBe(0);

    // Sentinel must be in <project-root>/.planning/, NOT mcp-server/.planning/
    const rootSentinel = path.join(repo, ".planning", SENTINEL_NAME);
    const subdirSentinel = path.join(subdir, ".planning", SENTINEL_NAME);

    expect(existsSync(rootSentinel)).toBe(true);
    expect(existsSync(subdirSentinel)).toBe(false);
  });

  it("walk-up fallback: resolves root via .git marker when git rev-parse fails", () => {
    // Provide a fake git that exits non-zero so execFileSync throws,
    // forcing the walk-up path. Keep real PATH so node itself still works.
    const fakeBinDir = mkdtempSync(path.join(base, "fakebin-"));
    writeFileSync(path.join(fakeBinDir, "git"), "#!/usr/bin/env sh\nexit 128\n", { mode: 0o755 });
    const result = spawnSync("node", [HOOK], {
      input: JSON.stringify({ tool_name: "EnterPlanMode", cwd: subdir }),
      cwd: subdir,
      env: { ...process.env, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);

    // Walk-up should find repo root via .git directory
    const rootSentinel = path.join(repo, ".planning", SENTINEL_NAME);
    expect(existsSync(rootSentinel)).toBe(true);
  });

  it("walk-up fallback: resolves root via mcp-server/package.json marker", () => {
    // Remove .git so only package.json marker is present
    rmSync(path.join(repo, ".git"), { recursive: true, force: true });

    const fakeBinDir = mkdtempSync(path.join(base, "fakebin2-"));
    writeFileSync(path.join(fakeBinDir, "git"), "#!/usr/bin/env sh\nexit 128\n", { mode: 0o755 });
    const result = spawnSync("node", [HOOK], {
      input: JSON.stringify({ tool_name: "EnterPlanMode", cwd: subdir }),
      cwd: subdir,
      env: { ...process.env, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(0);

    const rootSentinel = path.join(repo, ".planning", SENTINEL_NAME);
    expect(existsSync(rootSentinel)).toBe(true);
  });
});

describe("sentinel write — EnterPlanMode", () => {
  let base: string;
  let repo: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "pmsp-write-"));
    repo = makeFakeRepo(base);
  });

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("EnterPlanMode from project root writes sentinel", () => {
    const result = runHook({ tool_name: "EnterPlanMode", cwd: repo }, repo);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(repo, ".planning", SENTINEL_NAME))).toBe(true);
  });

  it("EnterPlanMode with CLAUDE_SKIP_PLANNER=1 does not write sentinel", () => {
    spawnSync("node", [HOOK], {
      input: JSON.stringify({ tool_name: "EnterPlanMode", cwd: repo }),
      cwd: repo,
      env: { ...process.env, CLAUDE_SKIP_PLANNER: "1" },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(existsSync(path.join(repo, ".planning", SENTINEL_NAME))).toBe(false);
  });
});

describe("sentinel cleanup — ExitPlanMode PostToolUse", () => {
  let base: string;
  let repo: string;
  let subdir: string;

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), "pmsp-exit-"));
    repo = makeFakeRepo(base);
    subdir = path.join(repo, "mcp-server");
  });

  afterEach(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("ExitPlanMode PostToolUse deletes sentinel from project root regardless of cwd", () => {
    const sentinelPath = path.join(repo, ".planning", SENTINEL_NAME);
    writeFileSync(sentinelPath, new Date().toISOString());

    const result = runHook(
      { tool_name: "ExitPlanMode", hook_event_name: "PostToolUse", cwd: subdir },
      subdir
    );
    expect(result.status).toBe(0);
    expect(existsSync(sentinelPath)).toBe(false);
  });

  it("ExitPlanMode PostToolUse is no-op when sentinel does not exist", () => {
    const sentinelPath = path.join(repo, ".planning", SENTINEL_NAME);
    // Ensure sentinel does not exist
    try { rmSync(sentinelPath); } catch { /* already absent */ }

    const result = runHook(
      { tool_name: "ExitPlanMode", hook_event_name: "PostToolUse", cwd: repo },
      repo
    );
    expect(result.status).toBe(0);
    expect(existsSync(sentinelPath)).toBe(false);
  });
});
