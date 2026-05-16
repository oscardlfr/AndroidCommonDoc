---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-tests-macos
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "macOS native test execution via kmp-test-runner CLI — macosArm64Test, macosX64Test"
---

# macOS Native Tests

macOS native test execution via kmp-test-runner v0.9.1. **Requires macOS host.**

## CLI Usage

```bash
# macOS tests (auto-selects best available native target)
kmp-test parallel --test-type macos

# Single module
kmp-test parallel --test-type macos --module shared:core
```

## Native Target Precedence

The CLI auto-selects the macOS test task in this order:

1. `macosArm64Test` — Apple Silicon (preferred on M-chip Macs)
2. `macosX64Test` — Intel (fallback)
3. `macosTest` — Generic alias (single macOS target projects)

## Gradle Task Reference (BLOCKED — use CLI instead)

| Gradle Task | Notes | Gate Status |
|-------------|-------|-------------|
| `macosArm64Test` | M-chip native (preferred) | BLOCKED |
| `macosX64Test` | Intel native (legacy) | BLOCKED |
| `macosTest` | Generic alias | BLOCKED |

## macOS vs iOS Distinction

| Concern | macOS | iOS |
|---------|-------|-----|
| Gradle task prefix | `macos*` | `ios*` |
| Target type | Host-native (no simulator) | Simulator or device |
| `--test-type` | `macos` | `ios` |

Both require macOS host. macOS tests run directly on the host without a simulator.

## Kotlin/Native Cache Note

After a Kotlin toolchain upgrade, the `~/.konan/cache/` directory can become inconsistent. Run:

```bash
# Force clean Kotlin/Native cache
rm -rf ~/.konan/cache/
kmp-test parallel --test-type macos --fresh-daemon
```

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-tests-ios](cli-tests-ios.md) — iOS simulator tests
- [cli-cache-management](cli-cache-management.md) — Kotlin/Native cache issues
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID
