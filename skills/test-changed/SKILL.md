---
name: test-changed
description: "Run tests only on modules with uncommitted changes. Use when asked to test changed files or run a quick pre-commit check."
intent: [test, changed, uncommitted, pre-commit, fast]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Reproducible evidence

For any result consumed by a quality gate, wrap execution with `scripts/tools/evidence-run.cjs`: create a start record before the command, finish it with the real artifact and counts, and retain its HEAD/PLAN/wave/target/environment/tool-version binding. Security-critical mint evidence requires two distinct agreeing records; newest-wins discovery and reused run IDs are rejected.

## Usage Examples

```
/test-changed
/test-changed --show-modules
/test-changed --staged-only
/test-changed --include-shared
/test-changed --test-type common
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include changes in the shared library project.
- `test-type` -- Test type: `common`, `desktop`, `androidUnit`, `androidInstrumented`, `all`.
- `staged-only` -- Only consider staged files (after `git add`).
- `show-modules-only` -- Show detected modules without running tests (dry run).
- `max-failures` -- Stop after N test failures (default: 0 = run all).
- `min-missed-lines` -- Only show classes with >= N missed lines.
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `project-root` -- Path to the project root directory.

## Behavior

1. Detect changed files via `git status`:
   - Staged files (M/A in index).
   - Unstaged modifications (M in worktree).
   - Untracked files (?).
2. Map file paths to Gradle modules:
   - `core/domain/src/...` -> `:core:domain`
   - `feature/home/src/...` -> `:feature:home`
   - `core-oauth/src/...` -> `:core-oauth`
3. Optionally show detected modules without running tests (`--show-modules`).
4. Run tests only on the detected changed modules.
5. Generate coverage report for tested modules.
6. Save report to `coverage-full-report.md`.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-changed --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows

Claude Code runs the POSIX command above from Bash on Windows as well. Do not resolve the toolkit through `ANDROID_COMMON_DOC` or call its PowerShell scripts directly; the consumer-local launcher resolves and verifies the pinned L0 source from `l0-manifest.json`.
## Expected Output

**On success:**
- Detected modules with file change counts
- Test results per module (pass/fail)
- Coverage report for tested modules
- File: `coverage-full-report.md`

**On no changes:**
- "No changed modules detected" message

## Runner

This skill delegates to `run-changed-modules-tests.sh`/`run-changed-modules-tests.ps1`, which detects changed modules then delegates to the thin-wrapped `run-parallel-coverage-suite` backed by `kmp-test-runner` v0.14.0. See [oscardlfr/kmp-test-runner](https://github.com/oscardlfr/kmp-test-runner#readme) for runner internals.

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-changed-modules-tests.sh`, `scripts/ps1/run-changed-modules-tests.ps1`
- Related: `/test` (single module), `/test-full` (all modules)
