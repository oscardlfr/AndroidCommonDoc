<!-- GENERATED from skills/run/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Build, install, and run app with debug logging. Use when asked to launch, run, or deploy the app on a device or desktop."
---

Build, install, and run app with debug logging. Use when asked to launch, run, or deploy the app on a device or desktop.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/build-run-app.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\build-run-app.ps1" -ProjectRoot (Get-Location).Path -Arguments "$ARGUMENTS"
```
