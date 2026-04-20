---
name: test-changed
description: "Run tests only on modules with uncommitted changes. Use when asked to test changed files or run a quick pre-commit check."
intent: [test, changed, uncommitted, pre-commit, fast]
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
copilot: true
---

## Usage Examples

```
/test-changed
/test-changed --show-modules
/test-changed --staged-only
/test-changed --include-shared
/test-changed --test-type common
```

## Parameters

Uses parameters from `params.json`:
- `include-shared` -- Include changes in the shared library project.
- `test-type` -- Test type: `common`, `desktop`, `androidUnit`, `androidInstrumented`, `all`.
- `staged-only` -- Only consider staged files (after `git add`).
- `show-modules-only` -- Show detected modules without running tests (dry run).
- `max-failures` -- Stop after N test failures (default: 0 = run all).
- `min-missed-lines` -- Only show classes with >= N missed lines.
- `coverage-tool` -- Coverage tool: `jacoco`, `kover`, `auto`, `none`.
- `project-root` -- Path to the project root directory.

## Behavior

1. Detect changed files via `git status`:
   - Staged files (M/A in index).
   - Unstaged modifications (M in worktree).
   - Untracked files (?).
2. Map file paths to Gradle modules:
   - `core/domain/src/...` -> `:core:domain`
   - `feature/home/src/...` -> `:feature:home`
   - `core-oauth/src/...` -> `:core-oauth`
3. Optionally show detected modules without running tests (`--show-modules`).
4. Run tests only on the detected changed modules.
5. Generate coverage report for tested modules.
6. Save report to `coverage-full-report.md`.

**CRITICAL:** Do NOT read XML coverage files directly. Trust the script output.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/run-changed-modules-tests.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$includeShared = $false
$testType = ""
$stagedOnly = $false
$showModulesOnly = $false
$maxFailures = 0
$minLines = 0
$coverageTool = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--include-shared") {
        $includeShared = $true
    } elseif ($arg -eq "--test-type" -and $i + 1 -lt $argList.Count) {
        $testType = $argList[$i + 1]; $i++
    } elseif ($arg -eq "--staged-only") {
        $stagedOnly = $true
    } elseif ($arg -eq "--show-modules") {
        $showModulesOnly = $true
    } elseif ($arg -eq "--max-failures" -and $i + 1 -lt $argList.Count) {
        $maxFailures = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--min-lines" -and $i + 1 -lt $argList.Count) {
        $minLines = [int]$argList[$i + 1]; $i++
    } elseif ($arg -eq "--coverage-tool" -and $i + 1 -lt $argList.Count) {
        $coverageTool = $argList[$i + 1]; $i++
    }
}

$params = @{
    ProjectRoot = (Get-Location).Path
    MaxFailures = $maxFailures
    MinMissedLines = $minLines
}

if ($testType -ne "") { $params.TestType = $testType }
if ($includeShared) { $params.IncludeShared = $true }
if ($stagedOnly) { $params.StagedOnly = $true }
if ($showModulesOnly) { $params.ShowModulesOnly = $true }
if ($coverageTool -ne "") { $params.CoverageTool = $coverageTool }

& "$commonDoc\scripts\ps1\run-changed-modules-tests.ps1" @params
```

## Expected Output

**On success:**
- Detected modules with file change counts
- Test results per module (pass/fail)
- Coverage report for tested modules
- File: `coverage-full-report.md`

**On no changes:**
- "No changed modules detected" message

## Cross-References

- Pattern: `docs/testing-patterns.md`
- Script: `scripts/sh/run-changed-modules-tests.sh`, `scripts/ps1/run-changed-modules-tests.ps1`
- Related: `/test` (single module), `/test-full` (all modules)
