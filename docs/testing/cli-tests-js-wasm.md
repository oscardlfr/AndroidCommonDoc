---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-tests-js-wasm
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "JS and Wasm test execution — deferred CLI support note, jsTest vs jsBrowserTest vs jsNodeTest"
---

# JS / Wasm Tests

JS and Wasm test patterns for kmp-test-runner v0.10.1.

> **DEFERRED**: kmp-test-runner v0.9.0 CLI does not yet fully support JS/Wasm targets. The gate blocks these Gradle tasks with a special message. Track [https://github.com/oscardlfr/kmp-test-runner/releases](https://github.com/oscardlfr/kmp-test-runner/releases) for v0.10+ support.

## Current Status

| Gradle Task | CLI Support | Gate Status |
|-------------|------------|-------------|
| `jsTest` | Deferred | BLOCKED + special message |
| `jsBrowserTest` | Deferred | BLOCKED + special message |
| `jsNodeTest` | Deferred | BLOCKED + special message |
| `wasmJsTest` | Deferred | BLOCKED + special message |

Gate message when blocked: _"kmp-test-runner v0.9.0 CLI does not yet fully support JS/Wasm targets — track https://github.com/oscardlfr/kmp-test-runner/releases for v0.10+ support."_

## JS Task Distinctions

| Task | What It Runs | Notes |
|------|-------------|-------|
| `jsTest` | Aggregate — runs browser + node if both configured | Default in most projects |
| `jsBrowserTest` | Browser environment via Karma + webpack | Requires browser install in CI |
| `jsNodeTest` | Node.js environment | Faster, no browser required |
| `wasmJsTest` | Wasm/JS target | Requires Wasm config in build files |

## Bypass (Temporary)

Until CLI support lands, use bypass with explicit authorization:

```bash
KMP_TEST_RUNNER_BYPASS=1 ./gradlew jsTest
KMP_TEST_RUNNER_BYPASS=1 ./gradlew jsNodeTest
```

## `jsTest` vs `jsBrowserTest` vs `jsNodeTest`

`jsTest` aggregates all configured JS test environments. If both `browser` and `nodejs` are configured, `jsTest` runs both. Prefer `jsNodeTest` for CI speed (no browser install required) and `jsBrowserTest` for browser-specific behavior tests.

## Cross-References

- [cli-hub](cli-hub.md) — platform overview and support matrix
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID including JS/Wasm special message
- [cli-troubleshooting](cli-troubleshooting.md) — error codes
