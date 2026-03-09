<!-- GENERATED from skills/sync-versions/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Check version catalog alignment between KMP projects. Use when asked to verify dependency versions match the source of truth."
---

Check version catalog alignment between KMP projects. Use when asked to verify dependency versions match the source of truth.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/check-version-sync.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\check-version-sync.ps1" -ProjectRoot (Get-Location).Path -SourceOfTruth "$SOURCE" -Projects @($PROJECTS) -OutputFormat $FORMAT
```
