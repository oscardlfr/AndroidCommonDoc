---
scope: [testing, cli, kmp-test-runner]
sources: [kmp-test-runner]
targets: [android, desktop, ios, jvm]
category: testing
slug: cli-coverage
status: active
layer: L0
version: 1
last_updated: "2026-05"
monitor_urls:
  - url: "https://github.com/oscardlfr/kmp-test-runner/releases"
    type: github-releases
    tier: 1
description: "Coverage report generation via kmp-test-runner CLI — Kover/JaCoCo, thresholds, coverage subcommand"
---

# Coverage

Coverage report generation via kmp-test-runner v0.10.1.

## CLI Usage

```bash
# Full test run + coverage (auto-detect Kover or JaCoCo)
kmp-test parallel --test-type all --coverage-tool auto

# Coverage report only (tests already ran)
kmp-test coverage --coverage-tool kover

# With minimum threshold
kmp-test coverage --coverage-tool kover --min-missed-lines 0

# Custom output
kmp-test coverage --coverage-tool kover --output-file build/reports/coverage.xml
```

## Coverage Tool Selection

| Flag Value | Behavior |
|-----------|---------|
| `auto` | Checks build files, convention plugins, version catalogs — picks Kover or JaCoCo |
| `kover` | Force Kover (KMP-native, recommended) |
| `jacoco` | Force JaCoCo (Android-only projects) |

## Kover vs JaCoCo

| Concern | Kover | JaCoCo |
|---------|-------|--------|
| KMP support | Native | Android-only |
| Report format | XML + HTML | XML + HTML |
| Gradle task | `koverXmlReport` | `jacocoTestReport` |
| Recommended for | KMP modules | Android-only modules |

Both `koverXmlReport` and `koverHtmlReport` are **allowlisted** in the gate (report generation, not test execution).

## Allowlisted Coverage Tasks

These Gradle tasks are **not blocked** by the gate:

```bash
# Safe — report generation only
KMP_TEST_RUNNER_BYPASS=1 ./gradlew koverXmlReport
KMP_TEST_RUNNER_BYPASS=1 ./gradlew koverHtmlReport
KMP_TEST_RUNNER_BYPASS=1 ./gradlew createDebugCoverageReport
```

## Report Locations

| Tool | Report Path |
|------|------------|
| Kover XML | `<module>/build/reports/kover/xml/report.xml` |
| Kover HTML | `<module>/build/reports/kover/html/` |
| AGP coverage | `<module>/build/outputs/code_coverage/` |

## Skills Integration

- `/coverage` → `kmp-test coverage --skip-tests`
- `/test-full-parallel` → `kmp-test parallel --test-type all --coverage-tool auto`

## Cross-References

- [cli-hub](cli-hub.md) — platform overview
- [cli-cache-management](cli-cache-management.md) — Windows file locking on Kover output
- [testing-patterns-coverage](testing-patterns-coverage.md) — Kover config and thresholds
