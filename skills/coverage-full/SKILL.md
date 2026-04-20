---
name: coverage-full
description: "Generate comprehensive coverage report across all modules. Use when asked for full project coverage overview or metrics."
intent: [coverage, report, modules, comprehensive, metrics]
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/coverage-full
/coverage-full --include-shared
/coverage-full --min-lines 5
/coverage-full --coverage-tool kover
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include the shared library project in the coverage report.
- `min-missed-lines` -- Minimum missed lines to show a class (default: 0 = all classes).
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `skip-tests` -- Always `true` for this skill; uses existing coverage data.
- `project-root` -- Path to the project root directory.

## Behavior

1. Scan the current project (and the shared library if `--include-shared`).
2. Find all coverage XML reports per module (JaCoCo or Kover).
3. Parse and aggregate coverage:
   - Coverage percentage per module.
   - All classes with covered/missed lines.
   - Exact missed line numbers.
4. Generate comprehensive Markdown report.
5. Save report to `coverage-full-report.md`.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-parallel-coverage-suite.sh" --project-root "$(pwd)" --skip-tests $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$includeShared = $false
$minLines = 0
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    SkipTests = $true
    MinMissedLines = $minLines
}

if ($includeShared) { $params.IncludeShared = $true }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-parallel-coverage-suite.ps1" @params
```

## Expected Output

**On success:**
- Summary table by module with coverage percentage
- Grand totals (covered, missed, total lines)
- Detailed class listing per module with missed line ranges
- File: `coverage-full-report.md`

**Difference from /coverage:**

| Feature | /coverage | /coverage-full |
|---------|-----------|----------------|
| Purpose | Identify gaps to fix | Complete overview |
| Filter | Only files >= 5 missed lines | All classes (configurable) |
| Multi-project | Single project | + shared library support |
| Use case | Before PR / fixing coverage | Documentation / metrics |

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-parallel-coverage-suite.sh`, `scripts/ps1/run-parallel-coverage-suite.ps1`
- Related: `/coverage` (gap analysis), `/test-full` (run tests + coverage)
