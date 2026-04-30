/**
 * CLI subprocess tests for validate-manifest-abi (BL-W31.7-11).
 *
 * Exercises validate-manifest-abi.js exit-code matrix and output format via
 * spawnSync -- identical pattern to manifest-validator.test.ts:600-613.
 *
 * Inline teardown only (NOT afterEach).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import path from "node:path";
import type { AbiDiffResult } from "../../src/registry/manifest-abi-validator.js";

// -- Paths --------------------------------------------------------------------

const CLI_PATH = path.resolve(__dirname, "../../build/cli/validate-manifest-abi.js");
const MANIFEST_REL = ".claude/registry/agents.manifest.yaml";

// -- Helpers ------------------------------------------------------------------

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[]): CliResult {
  const opts: SpawnSyncOptions = {
    env: { ...process.env, NODE_OPTIONS: "" },
    timeout: 30000,
    encoding: "utf-8",
  };
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], opts);
  return {
    stdout: (result.stdout as string) ?? "",
    stderr: (result.stderr as string) ?? "",
    exitCode: result.status ?? 2,
  };
}

function makeGitRepoWithBreakingChange(): string {
  const tmpRepo = mkdtempSync(join(tmpdir(), "abi-cli-"));
  execFileSync("git", ["-C", tmpRepo, "init"], { stdio: "pipe" });
  execFileSync("git", ["-C", tmpRepo, "config", "user.email", "test@test.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", tmpRepo, "config", "user.name", "test"], { stdio: "pipe" });
  mkdirSync(join(tmpRepo, ".claude/registry"), { recursive: true });

  const baseline = [
    "manifest:",
    "  version: 1",
    '  generated_at: "2026-04-30"',
    "invariants: []",
    "agents:",
    "  test-specialist:",
    "    canonical_name: test-specialist",
    "    subagent_type: test-specialist",
    '    template_version: "1.0.0"',
    "    category: core-specialist",
    "    lifecycle: ephemeral",
    '    description: "test-specialist description"',
    "    runtime:",
    "      model: sonnet",
    "      token_budget: 4000",
    "    tools:",
    "      allowed:",
    "        - Read",
    "        - Write",
    "    dispatch:",
    "      spawn_method: Agent",
    "      dispatched_by:",
    "        - team-lead",
    "      can_send_to:",
    "        - arch-testing",
    "",
  ].join("\n");

  writeFileSync(join(tmpRepo, MANIFEST_REL), baseline);
  execFileSync("git", ["-C", tmpRepo, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", tmpRepo, "commit", "-m", "baseline"], { stdio: "pipe" });

  // Remove a tool -- BREAKING change on HEAD
  const head = baseline.replace("        - Write\n", "");
  writeFileSync(join(tmpRepo, MANIFEST_REL), head);

  return tmpRepo;
}

// -- CLI tests ----------------------------------------------------------------

describe("validate-manifest-abi CLI", () => {
  it("1. --strict flag + manifest with BREAKING change -> exit code 1", () => {
    const tmpRepo = makeGitRepoWithBreakingChange();
    try {
      const r = runCli([tmpRepo, "--baseline-ref", "HEAD", "--strict"]);
      expect(r.exitCode).toBe(1);
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("2. --format json -> stdout is valid JSON matching AbiDiffResult shape", () => {
    const tmpRepo = makeGitRepoWithBreakingChange();
    try {
      const r = runCli([tmpRepo, "--baseline-ref", "HEAD", "--format", "json"]);
      expect(r.exitCode).not.toBe(2);

      const parsed = JSON.parse(r.stdout) as AbiDiffResult;
      expect(parsed.status).toMatch(/^(PASS|FAIL)$/);
      expect(parsed.totalsBySeverity).toBeDefined();
      expect(typeof parsed.totalsBySeverity.BREAKING).toBe("number");
      expect(typeof parsed.totalsBySeverity.ADDITIVE).toBe("number");
      expect(typeof parsed.totalsBySeverity.NEUTRAL).toBe("number");
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  it("3. --help -> exit code 0, usage text on stdout", () => {
    const r = runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage");
  });
});
