/**
 * Integration tests for validate-wave-topology CLI.
 *
 * T.1 All-good: PLAN.md + quality-gate.md present → exit 0
 * T.2 Missing PLAN.md: warn mode exit 0; --strict exit 1; stdout contains "PLAN.md"
 * T.3 Missing quality-gate.md: warn mode exit 0; --strict exit 1; stdout contains "quality-gate.md"
 * T.4 Missing wave-topology.yaml → exit 2
 * T.5 Multiple wave dirs: 2 dirs both missing quality-gate.md → warn exit 0; --strict exit 1; both dir names in stdout
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

const WAVE_TOPOLOGY_YAML = `manifest:
  version: 1
  description: "Mandatory peer list and phase gate rules"
session_prefix: "session-*"
mandatory_peers:
  - arch-platform
  - quality-gater
phase_gates:
  plan_required_before_arch_dispatch: true
  quality_gate_required_before_push: true
`;

function buildSyntheticProject(options: {
  includeTopologyYaml?: boolean;
  waveDirs?: Array<{
    slug: string;
    includePlan?: boolean;
    includeQualityGate?: boolean;
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
      WAVE_TOPOLOGY_YAML,
      "utf-8",
    );
  }

  for (const waveDir of options.waveDirs ?? []) {
    const wavePath = path.join(root, ".planning", `wave-${waveDir.slug}`);
    mkdirSync(wavePath, { recursive: true });

    if (waveDir.includePlan !== false) {
      writeFileSync(path.join(wavePath, "PLAN.md"), `# PLAN for wave-${waveDir.slug}\n`, "utf-8");
    }
    if (waveDir.includeQualityGate !== false) {
      writeFileSync(
        path.join(wavePath, "quality-gate.md"),
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
  it("T.1 all-good: PLAN.md + quality-gate.md present → exit 0", () => {
    const root = buildSyntheticProject({
      waveDirs: [{ slug: "bl-w41-pr3", includePlan: true, includeQualityGate: true }],
    });
    const r = runCli([root]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[OK]");
  });

  it("T.2 missing PLAN.md: warn mode exit 0; --strict exit 1; stdout contains PLAN.md", () => {
    const root = buildSyntheticProject({
      waveDirs: [{ slug: "bl-w41-pr3", includePlan: false, includeQualityGate: true }],
    });

    const warnResult = runCli([root]);
    expect(warnResult.exitCode).toBe(0);
    expect(warnResult.stdout).toContain("PLAN.md");

    const strictResult = runCli(["--strict", root]);
    expect(strictResult.exitCode).toBe(1);
    expect(strictResult.stdout).toContain("PLAN.md");
  });

  it("T.3 missing quality-gate.md: warn mode exit 0; --strict exit 1; stdout contains quality-gate.md", () => {
    const root = buildSyntheticProject({
      waveDirs: [{ slug: "bl-w41-pr3", includePlan: true, includeQualityGate: false }],
    });

    const warnResult = runCli([root]);
    expect(warnResult.exitCode).toBe(0);
    expect(warnResult.stdout).toContain("quality-gate.md");

    const strictResult = runCli(["--strict", root]);
    expect(strictResult.exitCode).toBe(1);
    expect(strictResult.stdout).toContain("quality-gate.md");
  });

  it("T.4 missing wave-topology.yaml → exit 2", () => {
    const root = buildSyntheticProject({
      includeTopologyYaml: false,
      waveDirs: [{ slug: "bl-w41-pr3" }],
    });
    const r = runCli([root]);
    expect(r.exitCode).toBe(2);
  });

  it("T.5 multiple wave dirs both missing quality-gate.md: warn exit 0, --strict exit 1, both dir names in stdout", () => {
    const root = buildSyntheticProject({
      waveDirs: [
        { slug: "bl-w41-pr3", includePlan: true, includeQualityGate: false },
        { slug: "bl-w41-pr4", includePlan: true, includeQualityGate: false },
      ],
    });

    const warnResult = runCli([root]);
    expect(warnResult.exitCode).toBe(0);
    expect(warnResult.stdout).toContain("wave-bl-w41-pr3");
    expect(warnResult.stdout).toContain("wave-bl-w41-pr4");

    const strictResult = runCli(["--strict", root]);
    expect(strictResult.exitCode).toBe(1);
    expect(strictResult.stdout).toContain("wave-bl-w41-pr3");
    expect(strictResult.stdout).toContain("wave-bl-w41-pr4");
  });
});
