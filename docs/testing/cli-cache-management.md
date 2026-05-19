---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-cache-management
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "Cache management for kmp-test-runner — locations, --isolated, --fresh-daemon, pollution scenarios"
---

# Cache Management

Cache locations, isolation flags, and pollution scenario remediation for kmp-test-runner v0.10.1.

## Cache Locations by OS

| Cache Type | Windows | macOS / Linux |
|-----------|---------|--------------|
| Gradle daemon | `%USERPROFILE%\.gradle\daemon\` | `~/.gradle/daemon/` |
| Gradle module cache | `%USERPROFILE%\.gradle\caches\modules-2\` | `~/.gradle/caches/modules-2/` |
| Gradle project cache | `<project>/.gradle/` | same |
| kmp-test model cache | `<project>/.kmp-test-runner/cache/` | same |
| kmp-test reports | `<project>/.kmp-test-runner/reports/` | same |
| Kover reports | `<module>/build/reports/kover/` | same |
| AGP test results | `<module>/build/outputs/androidTest-results/` | same |

## Isolation Flags

| Flag | Effect |
|------|--------|
| `--isolated` | Per-run temp `--project-cache-dir` (tier-3 isolation) — Windows-safe for re-enabling parallel tests |
| `--isolated-cache-dir <path>` | Override temp location |
| `--isolated-no-lock` | Skip OS-level cache lockfile |
| `--fresh-daemon` | Stop existing daemons before run |

```bash
# Windows-safe parallel run with cache isolation
kmp-test parallel --test-type all --isolated

# Fresh daemon start
kmp-test parallel --fresh-daemon

# Force fresh project model (after module restructure)
kmp-test describe --no-cache
```

## Common Pollution Scenarios

**Stale AGP test results** — AGP 9 `connectedAndroidTest` writes to `build/outputs/androidTest-results/`; old files persist across failed runs.
```bash
./gradlew clean  # before retry
```

**Frozen Kotlin/Native cache** — after toolchain update.
```bash
rm -rf ~/.konan/cache/
```

**Daemon zombies** — accumulate across JDK switches.
```bash
./gradlew --stop
# or via CLI:
kmp-test parallel --fresh-daemon
```

**`--isolated` temp dir accumulation on Windows** — temp dirs may not clean due to file locking. Manual cleanup:
```powershell
Remove-Item -Recurse -Force "$env:TEMP\kmp-test-*"
```

**Stale model snapshot** — after module restructure.
```bash
kmp-test describe --no-cache
```

**Windows file locking on Kover output** — `build/reports/kover/` locked by dangling Gradle process.
```bash
./gradlew --stop
```

## Windows Advisory Lockfile

kmp-test-runner creates `.kmp-test-runner.lock` in the project root on Windows. If a run is interrupted, this file may persist. Safe to delete manually if no kmp-test process is running.

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-troubleshooting](cli-troubleshooting.md) — exit codes and error recovery
- [cli-tests-android-instrumented](cli-tests-android-instrumented.md) — AGP test result cleanup
