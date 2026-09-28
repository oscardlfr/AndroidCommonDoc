---
name: test-full-parallel
description: "Run all tests in parallel with coverage. Use when asked to run the full test suite fast or with parallel execution."
intent: [test, parallel, coverage, fast, suite]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Reproducible evidence

For any result consumed by a quality gate, wrap execution with `scripts/tools/evidence-run.cjs`: create a start record before the command, finish it with the real artifact and counts, and retain its HEAD/PLAN/wave/target/environment/tool-version binding. Security-critical mint evidence requires two distinct agreeing records; newest-wins discovery and reused run IDs are rejected.

## Usage Examples

```
/test-full-parallel
/test-full-parallel --include-shared
/test-full-parallel --module-filter "core:data"
/test-full-parallel --fresh-daemon
/test-full-parallel --skip-tests --min-lines 5
/test-full-parallel --coverage-only
/test-full-parallel --max-workers 4
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include the shared library project in test execution and report.
- `test-type` -- Test type: `common`, `desktop`, `androidUnit`, `all` (default: auto-detect).
- `module-filter` -- Filter modules by pattern (wildcards supported).
- `max-workers` -- Override Gradle worker count (default: auto based on CPU).
- `min-missed-lines` -- Only show classes with >= N missed lines (default: 0).
- `skip-tests` -- Skip test execution, regenerate report from existing data.
- `fresh-daemon` -- Stop existing Gradle daemons before starting.
- `coverage-only` -- Only run modules specified by `coverage-modules`.
- `coverage-modules` -- Comma-separated module patterns for coverage-only mode.
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `project-root` -- Path to the project root directory.

## Behavior

1. Auto-detect project type (KMP vs Android) for test task selection.
2. Discover all modules in the project (and the shared library if `--include-shared`).
3. Optionally stop existing Gradle daemons (`--fresh-daemon`).
4. Run tests using a SINGLE Gradle invocation with `--parallel` flag.
5. Reuse Gradle daemon across all modules (no per-module JVM cold starts).
6. Generate coverage report per module.
7. Produce consolidated coverage summary and gap analysis.
8. Save comprehensive Markdown report to `coverage-full-report.md`.

**Key difference vs /test-full:** Uses 1 Gradle invocation instead of N, achieving ~2-3x speedup.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

> **Claude Code agents**: Always use the `macOS / Linux` path below, regardless of host OS.
> Claude Code agents run in bash (`/usr/bin/bash`) on all platforms including Windows.

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows

Claude Code runs the POSIX command above from Bash on Windows as well. Do not resolve the toolkit through `ANDROID_COMMON_DOC` or call its PowerShell scripts directly; the consumer-local launcher resolves and verifies the pinned L0 source from `l0-manifest.json`.
## Expected Output

**On success:**
- Console: Live progress with pass/fail/coverage per module
- Console: Module coverage summary table and coverage gaps
- File: `coverage-full-report.md` with complete breakdown

**On failure:**
- Test failure details
- Gradle build output for diagnosis

## Runner

This skill delegates to `run-parallel-coverage-suite.sh`/`run-parallel-coverage-suite.ps1`, which is a thin wrapper around `kmp-test-runner` v0.14.0. The runner handles module discovery, Gradle invocation, daemon management, and Kover/JaCoCo fallback retry. See [oscardlfr/kmp-test-runner](https://github.com/oscardlfr/kmp-test-runner#readme) for runner internals.

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-parallel-coverage-suite.sh`, `scripts/ps1/run-parallel-coverage-suite.ps1`
- Related: `/test-full` (sequential), `/coverage-full` (report only)
