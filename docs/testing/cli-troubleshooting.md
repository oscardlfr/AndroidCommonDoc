---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-troubleshooting
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "kmp-test-runner troubleshooting — exit codes, envelope schema v2 changes, common errors"
---

# Troubleshooting

Exit codes, envelope schema v2 changes, and common error remediation for kmp-test-runner v0.14.0.

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| `0` | All tests passed | — |
| `1` | Test failures detected | Check `errors[]` in envelope |
| `2` | CONFIG_ERROR — invalid configuration | Check flags and module names |
| `3` | ENV_ERROR — environment issue (JDK, ADB, etc.) | Run `kmp-test doctor` |
| `4` | TIMEOUT — test run exceeded limit | Increase timeout or split modules |
| `5` | DAEMON_ERROR — Gradle daemon issue | Run with `--fresh-daemon` |

## Schema v2 Changes (v0.9.0 Breaking)

| Change | v1 Behavior | v2 Behavior |
|--------|-------------|-------------|
| `no_test_modules` | Always `ENV_ERROR (3)` | `CONFIG_ERROR (2)` when caused by filter mismatch (`caused_by_filter: true`) |
| `flavor_unused` | Warning in `warnings[]` | Promoted to `errors[]` + `CONFIG_ERROR (2)` |
| `isolated_runtime_race` | Not detected pre-Gradle | New: `--isolated + --test-type ios/all/androidInstrumented` without `--device` → exit 2 |
| `plan.modules[]` | Empty in dry-run | Populated in dry-run mode |
| `plan.skipped[]` | Empty in dry-run | Populated in dry-run mode |

> **Note**: L0 wrappers do not parse the JSON envelope — schema v2 changes do not require wrapper adaptation (verified GREEN pre-flight in PR #167).

## Common Errors

**`CONFIG_ERROR (2)` — no_test_modules with filter**
```
Cause: --module-filter matched zero modules
Fix: verify module name with kmp-test describe --json | jq '.modules[]'
```

**`CONFIG_ERROR (2)` — flavor_unused**
```
Cause: --flavor specified but no flavored test tasks exist in the module
Fix: remove --flavor or check module's productFlavors config
```

**`CONFIG_ERROR (2)` — isolated_runtime_race**
```
Cause: --isolated used with --test-type that requires a device, but no --device specified
Fix: add --device <serial> or remove --isolated
```

**`ENV_ERROR (3)` — JDK not found**
```
Cause: JAVA_HOME not set or JDK version mismatch
Fix: kmp-test doctor → follow JDK path instructions
```

**`ENV_ERROR (3)` — ADB not found (Android)**
```
Cause: ADB not in PATH
Fix: kmp-test doctor → check adb.path in output
```

## Diagnostics

```bash
# Full environment check
kmp-test doctor

# Environment info as JSON
kmp-test info --json

# Module graph + available tasks
kmp-test describe --json

# Force fresh model (after module restructure)
kmp-test describe --no-cache --json
```

## Windows-Specific

- PowerShell 5.1+ required
- Advisory lockfile `.kmp-test-runner.lock` — delete if stale (no process running)
- JDK catalogue: Adoptium / Zulu / Microsoft / Semeru / BellSoft

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-cache-management](cli-cache-management.md) — daemon and cache issues
- [cli-agent-mandate](cli-agent-mandate.md) — MANDATE/FORBID
