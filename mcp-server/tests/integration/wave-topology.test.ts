/**
 * Integration tests for validate-wave-topology CLI.
 *
 * Sentinel location updated (FIND-17 fix, BL-W42 PR1):
 * sentinels now live at .claude/wave-quality-gates/{slug}.md
 * (previously .planning/wave-{slug}/quality-gate.md — gitignored).
 *
 * T.1 All-good: PLAN.md + sentinel present → exit 0
 * T.2 Missing PLAN.md: warn mode exit 0; --strict exit 1; stdout contains "PLAN.md"
 * T.3 Missing sentinel: warn mode exit 0; --strict exit 1; stdout contains slug
 * T.4 Missing wave-topology.yaml → exit 2
 * T.5 Multiple wave dirs: 2 dirs both missing sentinel → warn exit 0; --strict exit 1; both dir names in stdout
 * T.6 Sentinel path uses sentinel_dir from yaml config (not hardcoded)
 * T.7 Yaml missing sentinel_dir falls back to default .claude/wave-quality-gates/
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

// ── Paths ────────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(os.tmpdir(), `wave-topology-test-${process.pid}`);
const CLI_PATH = path.resolve(__dirname, "../../build/cli/validate-wave-topology.js");

// ── CLI helper ───────────────────────────────────────────────────────────────

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[], cwd?: string): CliResult {
  const opts: SpawnSyncOptions = {
    env: { ...process.env, NODE_OPTIONS: "" },
    timeout: 30_000,
    encoding: "utf-8",
    cwd,
  };
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], opts);
  return {
    stdout: (result.stdout as string) ?? "",
    stderr: (result.stderr as string) ?? "",
    exitCode: result.status ?? 2,
  };
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

function buildTopologyYaml(overrides: {
  sentinelDir?: string;
  sentinelFilenameTemplate?: string;
  omitSentinelConfig?: boolean;
} = {}): string {
  const base = `manifest:
  version: 2
  description: "Mandatory peer list and phase gate rules"
session_prefix: "session-*"
mandatory_peers:
  - arch-platform
  - quality-gater
phase_gates:
  plan_required_before_arch_dispatch: true
  quality_gate_required_before_push: true`;

  if (overrides.omitSentinelConfig) return base + "\n";

  const sentinelDir = overrides.sentinelDir ?? ".claude/wave-quality-gates";
  const template = overrides.sentinelFilenameTemplate ?? "{slug}.md";
  return (
    base +
    `\n  sentinel_dir: "${sentinelDir}"\n  sentinel_filename_template: "${template}"\n`
  );
}

function buildSyntheticProject(options: {
  includeTopologyYaml?: boolean;
  topologyYamlOverrides?: Parameters<typeof buildTopologyYaml>[0];
  waveDirs?: Array<{
    slug: string;
    includePlan?: boolean;
    includeSentinel?: boolean;
  }>;
}): string {
  const root = path.join(
    TMP_ROOT,
    `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  mkdirSync(path.join(root, ".claude/registry"), { recursive: true });
  mkdirSync(path.join(root, ".planning"), { recursive: true });

  if (options.includeTopologyYaml !== false) {
    writeFileSync(
      path.join(root, ".claude/registry/wave-topology.yaml"),
      buildTopologyYaml(options.topologyYamlOverrides),
      "utf-8",
    );
  }

  for (const waveDir of options.waveDirs ?? []) {
    const wavePath = path.join(root, ".planning", `wave-${waveDir.slug}`);
    mkdirSync(wavePath, { recursive: true });

    if (waveDir.includePlan !== false) {
      writeFileSync(path.join(wavePath, "PLAN.md"), `# PLAN for wave-${waveDir.slug}\n`, "utf-8");
    }

    if (waveDir.includeSentinel !== false) {
      // Sentinel lives in .claude/wave-quality-gates/{slug}.md (FIND-17 fix)
      const sentinelDir = path.join(root, ".claude", "wave-quality-gates");
      mkdirSync(sentinelDir, { recursive: true });
      writeFileSync(
        path.join(sentinelDir, `${waveDir.slug}.md`),
        `# Quality gate sentinel for wave-${waveDir.slug}\n`,
        "utf-8",
      );
    }
  }

  return root;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  try {
    if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* Windows file locking */
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("validate-wave-topology CLI", () => {
  it("T.1 all-good: PLAN.md + sentinel present → exit 0", () => {
    const root = buildSyntheticProject({
      waveDirs: [{ slug: "bl-w42-pr1", includePlan: true, includeSentinel: true }],
    });
    const r = runCli([root]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[OK]");
  });

  it("T.2 missing PLAN.md: warn mode exit 0; --strict exit 1; stdout contains PLAN.md", () => {
    const root = buildSyntheticProject({
      waveDirs: [{ slug: "bl-w42-pr1", includePlan: false, includeSentinel: true }],
    });

    const warnResult = runCli([root]);
    expect(warnResult.exitCode).toBe(0);
    expect(warnResult.stdout).toContain("PLAN.md");

    const strictResult = runCli(["--strict", root]);
    expect(strictResult.exitCode).toBe(1);
    expect(strictResult.stdout).toContain("PLAN.md");
  });

  it("T.3 missing sentinel: warn mode exit 0; --strict exit 1; stdout contains wave dir name", () => {
    const root = buildSyntheticProject({
      waveDirs: [{ slug: "bl-w42-pr1", includePlan: true, includeSentinel: false }],
    });

    const warnResult = runCli([root]);
    expect(warnResult.exitCode).toBe(0);
    expect(warnResult.stdout).toContain("wave-bl-w42-pr1");

    const strictResult = runCli(["--strict", root]);
    expect(strictResult.exitCode).toBe(1);
    expect(strictResult.stdout).toContain("wave-bl-w42-pr1");
  });

  it("T.4 missing wave-topology.yaml → exit 2", () => {
    const root = buildSyntheticProject({
      includeTopologyYaml: false,
      waveDirs: [{ slug: "bl-w42-pr1" }],
    });
    const r = runCli([root]);
    expect(r.exitCode).toBe(2);
  });

  it("T.5 multiple wave dirs both missing sentinel: warn exit 0, --strict exit 1, both dir names in stdout", () => {
    const root = buildSyntheticProject({
      waveDirs: [
        { slug: "bl-w42-pr1", includePlan: true, includeSentinel: false },
        { slug: "bl-w42-pr2", includePlan: true, includeSentinel: false },
      ],
    });

    const warnResult = runCli([root]);
    expect(warnResult.exitCode).toBe(0);
    expect(warnResult.stdout).toContain("wave-bl-w42-pr1");
    expect(warnResult.stdout).toContain("wave-bl-w42-pr2");

    const strictResult = runCli(["--strict", root]);
    expect(strictResult.exitCode).toBe(1);
    expect(strictResult.stdout).toContain("wave-bl-w42-pr1");
    expect(strictResult.stdout).toContain("wave-bl-w42-pr2");
  });

  it("T.6 sentinel path uses sentinel_dir from yaml config", () => {
    const customDir = ".my-custom-gates";
    const root = buildSyntheticProject({
      topologyYamlOverrides: { sentinelDir: customDir },
      waveDirs: [{ slug: "bl-w42-pr1", includePlan: true, includeSentinel: false }],
    });

    // Manually create sentinel in custom dir
    const customSentinelDir = path.join(root, customDir);
    mkdirSync(customSentinelDir, { recursive: true });
    writeFileSync(path.join(customSentinelDir, "bl-w42-pr1.md"), "sentinel\n", "utf-8");

    const r = runCli([root]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[OK]");
  });

  it("T.7 yaml missing sentinel_dir falls back to default .claude/wave-quality-gates/", () => {
    const root = buildSyntheticProject({
      topologyYamlOverrides: { omitSentinelConfig: true },
      waveDirs: [{ slug: "bl-w42-pr1", includePlan: true, includeSentinel: true }],
    });

    const r = runCli([root]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[OK]");
  });
});
