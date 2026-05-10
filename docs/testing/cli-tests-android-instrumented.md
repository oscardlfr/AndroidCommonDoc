---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-tests-android-instrumented
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "Android instrumented test execution via kmp-test-runner CLI — connectedAndroidTest, emulator, device flags"
---

# Android Instrumented Tests

Android instrumented test execution (real device or emulator required) via kmp-test-runner v0.9.0.

## CLI Usage

```bash
# Instrumented tests on connected emulator
kmp-test android --device emulator-5554

# With auto-retry on flaky tests
kmp-test android --device emulator-5554 --auto-retry 2

# Specific flavor
kmp-test android --device emulator-5554 --flavor staging

# Clear app data before run
kmp-test android --device emulator-5554 --clear-data
```

## Key Flags

| Flag | Purpose |
|------|---------|
| `--device <serial>` | Target device serial (required) |
| `--auto-retry <n>` | Retry failed tests up to n times |
| `--clear-data` | Clear app data before run |
| `--flavor <name>` | Build flavor (e.g., staging, production) |
| `--device-task <task>` | Override default device task |

## Gradle Task Reference (BLOCKED — use CLI instead)

| Gradle Task | What It Runs | Gate Status |
|-------------|-------------|-------------|
| `connectedAndroidTest` | All connected device tests (all variants) | BLOCKED (HIGH risk) |
| `connectedDebugAndroidTest` | Debug variant connected tests | BLOCKED |
| `connectedReleaseAndroidTest` | Release variant connected tests | BLOCKED |
| `managedDeviceAndroidTest` | Gradle-managed device tests | BLOCKED |
| `assembleAndroidTest` | Compiles test APK only — no execution | **ALLOWLISTED** |
| `createDebugCoverageReport` | AGP coverage aggregation — not a runner | **ALLOWLISTED** |

## `assembleAndroidTest` — Compile-Only (Allowlisted)

`assembleAndroidTest` **compiles** the test APK without running tests. It is in the gate allowlist and will NOT be blocked. Use it to verify test compilation independently:

```bash
# Safe — only compiles, does not run
KMP_TEST_RUNNER_BYPASS=1 ./gradlew assembleAndroidTest
```

## Device Discovery

```bash
# List connected devices
kmp-test info --json | jq '.adb.devices'

# Check ADB environment
kmp-test doctor
```

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-tests-android-unit](cli-tests-android-unit.md) — unit tests (no device)
- [cli-cache-management](cli-cache-management.md) — stale AGP test results cleanup
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID
