---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-agent-mandate
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "MANDATE/FORBID block for kmp-test-runner CLI — referenced by test-specialist and arch-testing templates"
---

# CLI Mandate — kmp-test-runner (v0.9.0+)

> This doc is the canonical MANDATE/FORBID reference. Agent templates link here — do not inline this content into templates.

## MANDATE

- ALWAYS use `kmp-test <subcommand>` for ALL test execution
- Use `kmp-test parallel` for full test runs with coverage
- Use `kmp-test changed` for PR-scoped incremental runs
- Use `kmp-test android` for instrumented device/emulator tests
- Use `kmp-test parallel --json` in agentic/CI contexts (structured envelope output)
- Use `kmp-test info` or `kmp-test describe` for environment diagnostics (read-only, non-blocking)

## FORBID

- NEVER invoke `./gradlew test`, `./gradlew jvmTest`, `./gradlew allTests`
- NEVER invoke `./gradlew check` (runs all tests; use CLI instead — blocked globally per user direction)
- NEVER invoke `./gradlew testDebugUnitTest` or any `*Test` Gradle task directly
- NEVER invoke `./gradlew connectedAndroidTest` or `connectedDebugAndroidTest`
- NEVER invoke `./gradlew iosSimulatorArm64Test`, `macosArm64Test`, `jsTest`, `wasmJsTest`
- NEVER invoke `:module:jvmTest` or any module-qualified Gradle test task

## Examples

```bash
# WRONG
./gradlew :core-audio:jvmTest
./gradlew allTests
./gradlew connectedDebugAndroidTest
./gradlew check

# CORRECT
kmp-test parallel --test-type common
kmp-test parallel --test-type all
kmp-test android --device emulator-5554
```

## Bypass

Only with explicit user authorization:

```bash
KMP_TEST_RUNNER_BYPASS=1 ./gradlew ...
# or inline:
[KMP_TEST_RUNNER_BYPASS] ./gradlew ...
```

## Allowlisted patterns (gate does NOT block)

| Pattern | Reason |
|---------|--------|
| `assembleAndroidTest` | Compiles test APK only — no execution |
| `koverXmlReport` / `koverHtmlReport` | Coverage report generation, not test execution |
| `createDebugCoverageReport` | AGP coverage aggregation task |
| `dependencyInsight` | Dependency resolution report |
| `testRuntimeClasspath` | Configuration reference, not a task |
| `kmp-test info` / `kmp-test describe` | Read-only diagnostics |
| `KMP_TEST_RUNNER_BYPASS=1` | Explicit bypass with user authorization |
| `[KMP_TEST_RUNNER_BYPASS]` | Inline bypass marker |

## JS/Wasm note

`jsTest`, `jsBrowserTest`, `jsNodeTest`, `wasmJsTest` are blocked by the gate with a special message: _"kmp-test-runner v0.9.0 CLI does not yet fully support JS/Wasm targets — track https://github.com/oscardlfr/kmp-test-runner/releases for v0.10+ support."_ Do not invoke these directly.

## Reference docs

- Platform-specific guides: [cli-hub.md](cli-hub.md)
- Cache and isolation: [cli-cache-management.md](cli-cache-management.md)
- Error codes and troubleshooting: [cli-troubleshooting.md](cli-troubleshooting.md)
- Changed-only mode: [cli-changed-modules.md](cli-changed-modules.md)
