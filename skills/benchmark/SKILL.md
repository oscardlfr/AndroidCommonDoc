---
name: benchmark
description: "Run benchmarks across modules and show agent-friendly results summary. Detects available platforms and devices."
intent: [benchmark, performance, modules, measure]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Reproducible evidence

For any result consumed by a quality gate, wrap execution with `scripts/tools/evidence-run.cjs`: create a start record before the command, finish it with the real artifact and counts, and retain its HEAD/PLAN/wave/target/environment/tool-version binding. Security-critical mint evidence requires two distinct agreeing records; newest-wins discovery and reused run IDs are rejected.

## Usage Examples

```
/benchmark
/benchmark --config smoke
/benchmark --config main --platform jvm
/benchmark --module-filter "benchmark-sdk*"
/benchmark --include-shared
```

## Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config` | Benchmark configuration: `smoke` (fast), `main` (CI), `stress` (load) | `smoke` |
| `platform` | Target platform: `jvm`, `android`, `all` | `all` |
| `module-filter` | Filter modules by pattern (wildcards supported) | `*` |
| `include-shared` | Include shared library project benchmark modules | `false` |
| `project-root` | Path to the project root directory | current directory |

## Behavior

1. Detect available platforms: JVM (always), Android (if adb + devices available).
2. Discover benchmark modules in the project (and shared library if `--include-shared`).
3. Run benchmark Gradle tasks per module and platform.
4. Parse JSON results from `build/reports/benchmarks/`.
5. Display agent-friendly summary: platform availability, per-module benchmark results.
6. Save detailed report to `benchmark-report.md`.

## Implementation

> **Claude Code agents**: Always use the `macOS / Linux` path below, regardless of host OS.
> Claude Code agents run in bash (`/usr/bin/bash`) on all platforms including Windows.

### macOS / Linux

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run benchmark --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows

Claude Code runs the POSIX command above from Bash on Windows as well. Do not resolve the toolkit through `ANDROID_COMMON_DOC` or call its PowerShell scripts directly; the consumer-local launcher resolves and verifies the pinned L0 source from `l0-manifest.json`.
## Expected Output

### On success

- Platform availability table (JVM, Android devices, macOS/iOS stubs)
- Per-module benchmark results with name, avg time, std deviation
- File: `benchmark-report.md`

### On failure

- Gradle task errors per module
- Missing platform warnings (e.g., no Android devices connected)

## Cross-References

- Pattern: `docs/testing/testing-patterns-benchmarks.md`
- Script: `scripts/sh/run-benchmarks.sh`, `scripts/ps1/run-benchmarks.ps1`
- Related: `/test-full` (full test suite with optional `--benchmark`), `/test` (single module)
