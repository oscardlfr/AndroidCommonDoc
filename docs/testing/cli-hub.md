---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-hub
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "CLI hub: kmp-test-runner v0.10.1 navigation, glossary, and skill→CLI mapping"
---

# kmp-test-runner CLI Hub

> **Scope**: CLI/runner usage only — see [testing-hub.md](testing-hub.md) for full testing patterns (runTest, fakes, dispatchers, coverage).

Navigation for kmp-test-runner v0.10.1 usage across L0 patterns.

> **MANDATE**: Use `kmp-test <subcommand>` for all test execution. See [cli-agent-mandate.md](cli-agent-mandate.md).

## Sub-documents

| Document | Covers |
|----------|--------|
| [cli-agent-mandate](cli-agent-mandate.md) | MANDATE/FORBID blocks for agents |
| [cli-tests-jvm](cli-tests-jvm.md) | JVM, Desktop, allTests, check |
| [cli-tests-android-unit](cli-tests-android-unit.md) | Unit tests, AGP 9 variant defaults |
| [cli-tests-android-instrumented](cli-tests-android-instrumented.md) | Connected tests, emulator, device |
| [cli-tests-ios](cli-tests-ios.md) | iOS simulator + device, macOS-only |
| [cli-tests-macos](cli-tests-macos.md) | macOS native, M-chip vs Intel |
| [cli-tests-js-wasm](cli-tests-js-wasm.md) | JS browser/node, Wasm (deferred) |
| [cli-coverage](cli-coverage.md) | Kover/JaCoCo, thresholds, report |
| [cli-cache-management](cli-cache-management.md) | Cache locations, --isolated, clean |
| [cli-troubleshooting](cli-troubleshooting.md) | Error codes, lock, JDK mismatch |
| [cli-changed-modules](cli-changed-modules.md) | Changed-only mode, CI optimization |

## Skill → CLI Mapping

| L0 Skill | CLI Subcommand | Primary Flags |
|----------|---------------|---------------|
| `/test` | `kmp-test parallel` | `--test-type common` |
| `/test-full-parallel` | `kmp-test parallel` | `--test-type all --coverage-tool auto` |
| `/test-changed` | `kmp-test changed` | `--module-filter` |
| `/coverage` | `kmp-test coverage` | `--coverage-tool kover` |

## Subcommand Glossary

| Subcommand | Purpose |
|-----------|---------|
| `parallel` | All platforms in parallel + optional coverage |
| `changed` | Tests for git-diff-detected changed modules only |
| `android` | Android instrumented (device/emulator required) |
| `benchmark` | Benchmark suites with real contention |
| `coverage` | Generate coverage report only (no test execution) |
| `doctor` | Diagnose local environment (Node, JDK, ADB) |
| `info` | Print environment paths + versions as JSON (read-only) |
| `describe` | Output project module graph + task list as JSON (read-only) |
| `update` | Pull latest GitHub release (idempotent) |

## Platform Support Matrix

| Platform | `--test-type` | CLI Support |
|----------|--------------|-------------|
| JVM / Desktop | `common` or `desktop` | Stable |
| Android unit | `androidUnit` | Stable |
| Android instrumented | via `android` subcommand | Stable |
| iOS | `ios` (opt-in) | Stable |
| macOS | `macos` (opt-in) | Stable |
| JS / Wasm | partial | Deferred — see [cli-tests-js-wasm](cli-tests-js-wasm.md) |
