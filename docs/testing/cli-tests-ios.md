---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-tests-ios
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "iOS test execution via kmp-test-runner CLI — iosSimulatorArm64Test precedence, macOS-only requirement"
---

# iOS Tests

iOS test execution via kmp-test-runner v0.10.1. **Requires macOS host.**

## CLI Usage

```bash
# iOS tests (auto-selects best available simulator target)
kmp-test parallel --test-type ios

# Single module
kmp-test parallel --test-type ios --module shared:core
```

## Simulator Target Precedence

The CLI auto-selects the iOS test task in this order:

1. `iosSimulatorArm64Test` — Apple Silicon Mac (preferred)
2. `iosX64Test` — Intel Mac (fallback)
3. `iosArm64Test` — Physical iOS device (rare in CI)
4. `iosTest` — Generic alias (older single-target projects)

## Gradle Task Reference (BLOCKED — use CLI instead)

| Gradle Task | Notes | Gate Status |
|-------------|-------|-------------|
| `iosSimulatorArm64Test` | M-chip simulator (most common) | BLOCKED |
| `iosX64Test` | Intel simulator (legacy) | BLOCKED |
| `iosArm64Test` | Physical device | BLOCKED |
| `iosTest` | Generic alias | BLOCKED |

> **Note**: `appleTest` is not a standard KMP task — it may not exist in all projects.

## macOS-Only Constraint

iOS tests require a macOS host. They cannot run on Linux or Windows CI agents. Configure CI to route iOS test jobs to macOS runners:

```yaml
# GitHub Actions example
jobs:
  ios-tests:
    runs-on: macos-latest
    steps:
      - run: kmp-test parallel --test-type ios
```

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-tests-macos](cli-tests-macos.md) — macOS native tests
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID
- [cli-troubleshooting](cli-troubleshooting.md) — simulator errors
