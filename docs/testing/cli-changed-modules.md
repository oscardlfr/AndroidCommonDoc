---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-changed-modules
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "Changed-modules test mode via kmp-test-runner CLI — git-diff-based module detection, CI optimization"
---

# Changed Modules Tests

Incremental test execution via kmp-test-runner v0.9.1 `changed` subcommand — tests only the modules affected by git changes.

## CLI Usage

```bash
# Test modules changed since last commit
kmp-test changed

# Dry-run (show which modules would run, no execution)
kmp-test changed --dry-run

# Filter to specific module pattern
kmp-test changed --module-filter "core:*"

# Against a specific base ref
kmp-test changed --base-ref origin/develop
```

## How Module Detection Works

1. Run `git diff --name-only <base-ref>..HEAD`
2. Map changed files to Gradle module paths (`:core-domain`, `:app:android`, etc.)
3. Include transitive dependents (if `:core-domain` changes, `:app` tests also run if it depends on `:core-domain`)
4. Run `kmp-test parallel` scoped to the detected module set

## Key Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Show detected modules without running tests |
| `--module-filter <glob>` | Limit detection to matching module paths |
| `--base-ref <ref>` | Git ref to diff against (default: HEAD~1) |
| `--json` | Structured envelope output |

## CI Optimization Pattern

```yaml
# GitHub Actions — changed-only on PRs, full run on main
jobs:
  test:
    steps:
      - name: Run changed tests (PR)
        if: github.event_name == 'pull_request'
        run: kmp-test changed --base-ref origin/${{ github.base_ref }}

      - name: Run full tests (main)
        if: github.ref == 'refs/heads/main'
        run: kmp-test parallel --test-type all
```

## Skill Integration

`/test-changed` → wraps `run-changed-modules-tests.sh/.ps1` → delegates to `kmp-test changed`.

```bash
# Equivalent to /test-changed skill
kmp-test changed
```

## Gradle Task Reference (BLOCKED — use CLI instead)

No direct Gradle equivalent — module detection and selective execution are CLI-only features.

## Cross-References

- [cli-hub](cli-hub.md) — platform overview and skill mapping
- [cli-tests-jvm](cli-tests-jvm.md) — full JVM test run reference
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID
