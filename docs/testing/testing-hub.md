---
scope: [testing, coroutines, fakes, coverage]
sources: [kotlinx-coroutines-test, junit5, kover, truth]
targets: [android, desktop, ios, jvm]
slug: testing-hub
status: active
layer: L0
category: testing
description: "Testing category hub: KMP testing patterns — runTest, fakes, coroutine dispatchers, coverage"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 1
  - url: "https://github.com/Kotlin/kotlinx-kover/releases"
    type: github-releases
    tier: 2
rules:
  - id: no-default-dispatcher-in-tests
    type: banned-usage
    message: "Tests must inject TestDispatcher; never use Dispatchers.Default directly"
    detect:
      in_source_set: commonTest
      banned_expression: "Dispatchers.Default"
      prefer: "injected testDispatcher parameter"
    hand_written: false
  - id: no-hardcoded-dispatchers
    type: banned-usage
    message: "Dispatchers must be injected, not hardcoded in ViewModels or UseCases"
    detect:
      in_class_extending: [ViewModel, UseCase]
      banned_call_prefix: "Dispatchers."
      banned_values: [Main, IO, Default, Unconfined]
      prefer: "injected CoroutineDispatchers interface"
    hand_written: true
    source_rule: NoHardcodedDispatchersRule.kt
  - id: no-launch-in-init
    type: banned-usage
    message: "launch {} inside init {} is dangerous � move to a named function"
    detect:
      in_init_block: true
      banned_call: launch
    hand_written: true
    source_rule: NoLaunchInInitRule.kt
  - id: no-mocks-in-common-tests
    type: banned-import
    message: "Use pure Kotlin fakes in commonTest, not Mockito or MockK"
    detect:
      in_source_set: commonTest
      banned_import_prefixes:
        - "io.mockk"
        - "org.mockito"
      prefer: "pure Kotlin fake class"
    hand_written: false

---

# Testing

Standard patterns for testing Kotlin Multiplatform projects.

> Use `StandardTestDispatcher` injected via constructor — never `Dispatchers.Default` in tests.

## Documents

| Document | Description |
|----------|-------------|
| [testing-patterns](testing-patterns.md) | Hub: core testing patterns, test structure, quick reference |
| [testing-patterns-coroutines](testing-patterns-coroutines.md) | Coroutine testing — runTest, TestScope, StateFlow |
| [testing-patterns-fakes](testing-patterns-fakes.md) | Fake patterns — FakeRepository, FakeClock, why fakes over mocks |
| [testing-patterns-coverage](testing-patterns-coverage.md) | Coverage — Kover config, thresholds, platform tests |
| [testing-patterns-schedulers](testing-patterns-schedulers.md) | Scheduler testing — advancing time, virtual clocks |

## Key Rules

- Inject `CoroutineDispatcher` in ViewModels — switch via `testDispatcher` in tests
- Use fakes not mocks — pure Kotlin, no reflection, deterministic behavior
- Coverage threshold ≥80% on `commonMain`; per-module via Kover
