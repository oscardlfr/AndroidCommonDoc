import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOOK = path.resolve(
  __dirname,
  "../../../../.claude/hooks/plan-mode-spawn-planner.js"
);

function runHook(payload: object, cwd?: string, env?: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
  // Strip CLAUDE_SKIP_PLANNER from the inherited shell env so the agent harness
  // value doesn't bleed into tests that expect sentinel writes to happen.
  // Tests that specifically want CLAUDE_SKIP_PLANNER=1 pass it explicitly via env.
  const baseEnv = { ...process.env };
  delete baseEnv.CLAUDE_SKIP_PLANNER;
  const result = spawnSync("node", [HOOK], {
    input: JSON.stringify(payload),
    cwd: cwd ?? os.tmpdir(),
    encoding: "utf8",
    timeout: 5000,
    env: { ...baseEnv, ...env },
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
    // Hygiene: explicitly unset CLAUDE_SKIP_PLANNER so the hook writes the sentinel
    // regardless of the harness shell environment (BL-W48 env-hygiene fix).
    const fakeBinDir = mkdtempSync(path.join(base, "fakebin-"));
    writeFileSync(path.join(fakeBinDir, "git"), "#!/usr/bin/env sh\nexit 128\n", { mode: 0o755 });
    const { CLAUDE_SKIP_PLANNER: _skip, ...envWithoutSkip } = process.env;
    const result = spawnSync("node", [HOOK], {
      input: JSON.stringify({ tool_name: "EnterPlanMode", cwd: subdir }),
      cwd: subdir,
      env: { ...envWithoutSkip, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}` },
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
    // Hygiene: explicitly unset CLAUDE_SKIP_PLANNER so the hook writes the sentinel
    // regardless of the harness shell environment (BL-W48 env-hygiene fix).
    const { CLAUDE_SKIP_PLANNER: _skip2, ...envWithoutSkip2 } = process.env;
    const result = spawnSync("node", [HOOK], {
      input: JSON.stringify({ tool_name: "EnterPlanMode", cwd: subdir }),
      cwd: subdir,
      env: { ...envWithoutSkip2, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}` },
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
    // Pass CLAUDE_SKIP_PLANNER=1 explicitly — runHook strips it from inherited env
    // so this test controls the env value rather than relying on harness state.
    runHook({ tool_name: "EnterPlanMode", cwd: repo }, repo, { CLAUDE_SKIP_PLANNER: "1" });
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
