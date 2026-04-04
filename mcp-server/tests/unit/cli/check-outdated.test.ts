/**
 * Tests for the check-outdated CLI entrypoint.
 *
 * Covers: arg parsing, exit codes, output formats, cache (max-age), error paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import {
  createEmptyState,
  writeKDocState,
  updateDependencies,
} from "../../../src/utils/kdoc-state.js";

const TEST_ROOT = path.join(
  os.tmpdir(),
  "check-outdated-cli-test-" + process.pid,
);
const CLI_PATH = path.resolve(
  __dirname,
  "../../../build/cli/check-outdated.js",
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeToml(content: string): void {
  const gradleDir = path.join(TEST_ROOT, "gradle");
  mkdirSync(gradleDir, { recursive: true });
  writeFileSync(path.join(gradleDir, "libs.versions.toml"), content, "utf-8");
}

const VALID_TOML = `
[versions]
koin = "4.1.1"
coroutines = "1.10.2"

[libraries]
koin-core = { module = "io.insert-koin:koin-core", version.ref = "koin" }
kotlinx-coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
`;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(args: string[]): RunResult {
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

// ── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  if (existsSync(TEST_ROOT))
    rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  try {
    if (existsSync(TEST_ROOT))
      rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    /* Windows file locking */
  }
});

// ── Pre-check: CLI build exists ─────────────────────────────────────────────

describe("CLI build prerequisite", () => {
  it("check-outdated.js is built", () => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });
});

// ── Arg parsing ─────────────────────────────────────────────────────────────

describe("CLI arg parsing", () => {
  it("exits 2 with no arguments", () => {
    const result = runCli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 0 with --help", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("--format");
    expect(result.stderr).toContain("--max-age");
  });

  it("parses project-root argument", () => {
    // Will fail with exit 2 (no TOML), proving the project root was accepted
    const result = runCli([TEST_ROOT, "--max-age", "0"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Cannot read");
  });
});

// ── Error paths (exit code 2) ───────────────────────────────────────────────

describe("error paths", () => {
  it("exits 2 when TOML is missing", () => {
    const result = runCli([TEST_ROOT, "--max-age", "0"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Cannot read");
  });

  it("exits 2 when TOML has no libraries", () => {
    writeToml("[versions]\nkotlin = \"2.0.0\"\n\n[libraries]\n");
    const result = runCli([TEST_ROOT, "--max-age", "0"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("No libraries found");
  });
});

// ── Cache (--max-age) ───────────────────────────────────────────────────────

describe("cache / --max-age", () => {
  it("uses cached results within max-age window", () => {
    writeToml(VALID_TOML);

    // Write a fresh cache with no outdated deps
    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 0,
      outdated: [],
    });
    writeKDocState(TEST_ROOT, state);

    const result = runCli([TEST_ROOT, "--max-age", "24"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("UP_TO_DATE");
    expect(result.stdout).toContain("(from cache)");
  });

  it("uses cached results and returns exit 1 when outdated in cache", () => {
    writeToml(VALID_TOML);

    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 1,
      outdated: [
        {
          alias: "koin-core",
          group: "io.insert-koin",
          artifact: "koin-core",
          current: "4.1.1",
          latest: "5.0.0",
        },
      ],
    });
    writeKDocState(TEST_ROOT, state);

    const result = runCli([TEST_ROOT, "--max-age", "24"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("OUTDATED");
  });

  it("--max-age 0 bypasses cache", () => {
    writeToml(VALID_TOML);

    // Write a cache but set max-age to 0 (force refresh)
    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 0,
      outdated: [],
    });
    writeKDocState(TEST_ROOT, state);

    // max-age=0 forces a network call. Since we're not mocking fetch in a
    // subprocess, this will either succeed (exit 0/1) or timeout/error.
    // The key assertion is that it does NOT use cache (no "from cache" text).
    const result = runCli([TEST_ROOT, "--max-age", "0"]);
    // Network calls may fail in CI — just confirm cache was not used
    if (result.exitCode === 0 || result.exitCode === 1) {
      expect(result.stdout).not.toContain("(from cache)");
    }
    // exit 2 is acceptable if network fails
  });
});

// ── Output format ───────────────────────────────────────────────────────────

describe("--format json", () => {
  it("produces valid JSON from cache", () => {
    writeToml(VALID_TOML);

    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 1,
      outdated: [
        {
          alias: "koin-core",
          group: "io.insert-koin",
          artifact: "koin-core",
          current: "4.1.1",
          latest: "5.0.0",
        },
      ],
    });
    writeKDocState(TEST_ROOT, state);

    const result = runCli([TEST_ROOT, "--format", "json", "--max-age", "24"]);
    expect(result.exitCode).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("OUTDATED");
    expect(parsed.outdated_count).toBe(1);
    expect(parsed.total_libraries).toBe(2);
    expect(parsed.from_cache).toBe(true);
    expect(parsed.outdated[0].alias).toBe("koin-core");
  });
});

describe("--format summary", () => {
  it("produces human-readable text from cache", () => {
    writeToml(VALID_TOML);

    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 0,
      outdated: [],
    });
    writeKDocState(TEST_ROOT, state);

    const result = runCli([
      TEST_ROOT,
      "--format",
      "summary",
      "--max-age",
      "24",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Dependency check: UP_TO_DATE");
    expect(result.stdout).toContain("Up to date: 2");
  });
});

// ── Exit code validation ────────────────────────────────────────────────────

describe("exit codes", () => {
  it("exits 0 when all deps are up to date (from cache)", () => {
    writeToml(VALID_TOML);

    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 0,
      outdated: [],
    });
    writeKDocState(TEST_ROOT, state);

    const result = runCli([TEST_ROOT, "--max-age", "24"]);
    expect(result.exitCode).toBe(0);
  });

  it("exits 1 when outdated deps found (from cache)", () => {
    writeToml(VALID_TOML);

    const state = createEmptyState();
    updateDependencies(state, {
      last_checked: new Date().toISOString(),
      cache_ttl_hours: 24,
      total_libraries: 2,
      outdated_count: 1,
      outdated: [
        {
          alias: "koin-core",
          group: "io.insert-koin",
          artifact: "koin-core",
          current: "4.1.1",
          latest: "5.0.0",
        },
      ],
    });
    writeKDocState(TEST_ROOT, state);

    const result = runCli([TEST_ROOT, "--max-age", "24"]);
    expect(result.exitCode).toBe(1);
  });

  it("exits 2 on missing TOML (error)", () => {
    const result = runCli([TEST_ROOT, "--max-age", "0"]);
    expect(result.exitCode).toBe(2);
  });
});
