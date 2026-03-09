<!-- GENERATED from skills/extract-errors/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Extract structured build and test errors from Gradle output. Use when a build or test fails and you need actionable error details."
---

Extract structured build and test errors from Gradle output. Use when a build or test fails and you need actionable error details.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/ai-error-extractor.sh" --project-root "$(pwd)" --module "$MODULE" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\ai-error-extractor.ps1" -ProjectRoot (Get-Location).Path -Module "$MODULE" -Platform $PLATFORM -JsonOutput:$JSON -IncludeStackTrace:$INCLUDE_STACK
```
