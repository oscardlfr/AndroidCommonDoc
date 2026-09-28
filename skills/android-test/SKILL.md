---
name: android-test
description: "Run Android instrumented tests with logcat capture. Use when asked to run device/emulator tests or connectedAndroidTest."
intent: [android, test, instrumented, emulator, device, logcat]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Reproducible evidence

For any result consumed by a quality gate, wrap execution with `scripts/tools/evidence-run.cjs`: create a start record before the command, finish it with the real artifact and counts, and retain its HEAD/PLAN/wave/target/environment/tool-version binding. Security-critical mint evidence requires two distinct agreeing records; newest-wins discovery and reused run IDs are rejected.

## Usage Examples

```
/android-test
/android-test core:database
/android-test --device emulator-5554
/android-test --skip-app --flavor demo
/android-test core:data --auto-retry
/android-test --list
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Specific module to test (e.g., `core:data`, `feature:auth`). Tests all androidTest modules if omitted.
- `device` -- Target device ID. Auto-detected if omitted.
- `flavor` -- Build flavor for modules with productFlavors (e.g., `demo`, `prod`).
- `skip-app` -- Skip E2E app module tests (faster iteration).
- `verbose` -- Show detailed logcat output on failure.
- `auto-retry` -- Retry failed modules once before reporting failure.
- `clear-data` -- Clear app data before tests (useful with `--auto-retry`).
- `list-only` -- List discovered modules without running tests.
- `project-root` -- Path to the project root directory.

## Behavior

1. Detect connected devices via ADB (auto-select first available).
2. Discover modules with `src/androidTest/` directory.
3. Detect project type (KMP vs pure Android).
4. Run tests via `connectedAndroidTest` (or `connected{Flavor}DebugAndroidTest`).
5. Capture logcat filtered by package for each module.
6. Extract errors to JSON for autonomous diagnosis.
7. Generate JSON summary (`summary.json`) for machine parsing.

## Implementation

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run android-test --project-root "$PWD" -- $ARGUMENTS
```

### Windows
Claude Code runs the POSIX command above from Bash on Windows as well. The
launcher selects the platform implementation and injects the project root.

## Expected Output

**On success:**
- Test results per module (pass/fail/skip counts)
- JSON summary in `androidtest-logs/{timestamp}/summary.json`

**On failure:**
- Error details in `androidtest-logs/{timestamp}/{module}_errors.json`
- Logcat output in `androidtest-logs/{timestamp}/{module}_logcat.log`

**Output files (in `androidtest-logs/{timestamp}/`):**
- `{module}.log` -- Full Gradle output
- `{module}_logcat.log` -- Filtered logcat for module
- `{module}_errors.json` -- Extracted errors (on failure)
- `summary.json` -- Machine-readable summary

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-android-tests.sh`, `scripts/ps1/run-android-tests.ps1`
- Related: `/test` (unit tests), `/test-full` (all tests)
