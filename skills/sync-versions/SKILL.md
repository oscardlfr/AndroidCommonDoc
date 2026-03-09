---
name: sync-versions
description: "Check version catalog alignment between KMP projects. Use when asked to verify dependency versions match the source of truth."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
---

## Usage Examples

```
/sync-versions
/sync-versions --source ../your-shared-libs --projects ../MyProject,../MyApp
/sync-versions --json
/sync-versions --ignore-extra
```

## Parameters

Uses parameters from `params.json`:
- `source-of-truth` -- Path to the project defining canonical versions (default: `../your-shared-libs`).
- `projects` -- Comma-separated project paths to compare against source of truth.
- `ignore-extra` -- Don't report dependencies that exist only in consumer projects.
- `json` -- Output as JSON.
- `project-root` -- Path to the project root directory.

## Behavior

1. Read `gradle/libs.versions.toml` from the source of truth project.
2. Read `gradle/libs.versions.toml` from each consumer project.
3. Compare version entries:
   - **Outdated:** Consumer has older version than source.
   - **Ahead:** Consumer has newer version (consider updating source).
   - **Different:** Versions don't match.
4. Report extra dependencies in consumer (unless `--ignore-extra`).
5. Suggest remediation actions.

**Source of truth defines canonical versions for:**
- Kotlin, AGP, Compose Multiplatform
- Koin, kotlinx.serialization, Okio, Ktor
- Navigation3, Lifecycle, Adaptive
- Testing libraries (JUnit, MockK)

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/check-version-sync.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\check-version-sync.ps1" -ProjectRoot (Get-Location).Path -SourceOfTruth "$SOURCE" -Projects @($PROJECTS) -OutputFormat $FORMAT
```

## Expected Output

**On success (exit code 0):**
```
========================================
  Version Sync Check Report
========================================

Source of Truth: your-shared-libs
Projects Checked: 2

All versions in sync.
```

**On discrepancies (exit code 1):**
```
Project: MyProject

  Version Discrepancies:
    compose-multiplatform: 1.10.0 (source: 1.9.3) [ahead]

  Extra Dependencies (not in source):
    skie: 0.10.9

Summary:
  Total Discrepancies: 1
  Projects with Issues: 1 / 2

Suggested Actions:
  1. Update project versions to match source of truth
  2. Or update source of truth if project has newer versions
```

**Exit codes:** 0 = in sync, 1 = discrepancies, 2 = configuration error.

## Cross-References

- Pattern: `docs/gradle-patterns.md`
- Script: `scripts/sh/check-version-sync.sh`, `scripts/ps1/check-version-sync.ps1`
