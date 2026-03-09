<!-- GENERATED from skills/verify-kmp/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Validate KMP source set organization and forbidden imports. Use when asked to check architecture or source set correctness."
---

Validate KMP source set organization and forbidden imports. Use when asked to check architecture or source set correctness.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/verify-kmp-packages.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\verify-kmp-packages.ps1" -ProjectRoot (Get-Location).Path -ModulePath "$MODULE" -ShowDetails:$VERBOSE -StrictMode:$STRICT
```
