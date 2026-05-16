---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-tests-jvm
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "JVM and Desktop test execution via kmp-test-runner CLI — jvmTest, desktopTest, allTests, check"
---

# JVM / Desktop / Common Tests

JVM, Desktop, and cross-platform test execution patterns via kmp-test-runner v0.9.1.

## CLI Usage

```bash
# JVM target (commonMain + jvmMain)
kmp-test parallel --test-type common

# Desktop Compose target
kmp-test parallel --test-type desktop

# All configured platforms
kmp-test parallel --test-type all

# Single module
kmp-test parallel --test-type common --module core:domain
```

## Gradle Task Reference (BLOCKED — use CLI instead)

| Gradle Task | What It Runs | Gate Status |
|-------------|-------------|-------------|
| `test` | Base JVM test task (Java plugin default) | BLOCKED |
| `jvmTest` | KMP JVM target tests | BLOCKED |
| `desktopTest` | Compose Multiplatform desktop target | BLOCKED |
| `allTests` | KMP umbrella: all configured platform tests | BLOCKED |
| `check` | Lifecycle: depends on test/allTests/lint | BLOCKED (global, per user direction) |
| `commonTest` | NOT a runnable task — source set name only | N/A |

## `check` Task Policy

`./gradlew check` is a lifecycle task that runs ALL tests plus lint and static analysis. Per user direction, it is **blocked globally** by the gate — even in lint-only contexts. Use targeted CLI invocations instead:

```bash
# Instead of: ./gradlew check
kmp-test parallel --test-type all   # for tests
# Run lint/static analysis separately via dedicated tooling
```

## `allTests` Task Policy

`./gradlew allTests` runs all KMP platform tests in sequence. Blocked because it bypasses CLI retry semantics, daemon management, and envelope output.

```bash
# Instead of: ./gradlew allTests
kmp-test parallel --test-type all
```

## Windows Behavior

On Windows, `desktopTest` and `jvmTest` run sequentially (`maxParallelForks = 1`) to avoid file-locking conflicts on `build/` outputs. The CLI handles this automatically via `--isolated` when needed.

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID
- [cli-troubleshooting](cli-troubleshooting.md) — exit codes and errors
