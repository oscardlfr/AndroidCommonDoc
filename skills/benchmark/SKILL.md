---
name: benchmark
description: "Run benchmarks across modules and show agent-friendly results summary. Detects available platforms and devices."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
---

## Usage Examples

```
/benchmark
/benchmark --config smoke
/benchmark --config main --platform jvm
/benchmark --module-filter "benchmark-sdk*"
/benchmark --include-shared
```

## Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config` | Benchmark configuration: `smoke` (fast), `main` (CI), `stress` (load) | `smoke` |
| `platform` | Target platform: `jvm`, `android`, `all` | `all` |
| `module-filter` | Filter modules by pattern (wildcards supported) | `*` |
| `include-shared` | Include shared library project benchmark modules | `false` |
| `project-root` | Path to the project root directory | current directory |

## Behavior

1. Detect available platforms: JVM (always), Android (if adb + devices available).
2. Discover benchmark modules in the project (and shared library if `--include-shared`).
3. Run benchmark Gradle tasks per module and platform.
4. Parse JSON results from `build/reports/benchmarks/`.
5. Display agent-friendly summary: platform availability, per-module benchmark results.
6. Save detailed report to `benchmark-report.md`.

## Implementation

### macOS / Linux

```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-benchmarks.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows

```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$config = "smoke"
$platform = "all"
$moduleFilter = "*"
$includeShared = $false

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--config" -and $i + 1 -lt $argList.Count) {
        $config = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--platform" -and $i + 1 -lt $argList.Count) {
        $platform = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--module-filter" -and $i + 1 -lt $argList.Count) {
        $moduleFilter = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--include-shared") {
        $includeShared = $true
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    Config = $config
    Platform = $platform
    ModuleFilter = $moduleFilter
}

if ($includeShared) { $params.IncludeShared = $true }

& "$commonDoc\scripts\ps1\run-benchmarks.ps1" @params
```

## Expected Output

### On success

- Platform availability table (JVM, Android devices, macOS/iOS stubs)
- Per-module benchmark results with name, avg time, std deviation
- File: `benchmark-report.md`

### On failure

- Gradle task errors per module
- Missing platform warnings (e.g., no Android devices connected)

## Cross-References

- Pattern: `docs/testing/testing-patterns-benchmarks.md`
- Script: `scripts/sh/run-benchmarks.sh`, `scripts/ps1/run-benchmarks.ps1`
- Related: `/test-full` (full test suite with optional `--benchmark`), `/test` (single module)
