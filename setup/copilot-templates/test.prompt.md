<!-- GENERATED from skills/test/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run tests for a module with smart retry and error extraction. Use when asked to test a specific module or run unit tests."
---

Run tests for a module with smart retry and error extraction. Use when asked to test a specific module or run unit tests.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"
"$COMMON_DOC/scripts/sh/gradle-run.sh" --project-root "$(pwd)" $ARGUMENTS
if [ $? -ne 0 ]; then
  "$COMMON_DOC/scripts/sh/ai-error-extractor.sh" --project-root "$(pwd)" --module "$MODULE"
fi
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

& "$commonDoc\scripts\ps1\gradle-run.ps1" $ARGUMENTS

if ($LASTEXITCODE -ne 0) {
    & "$commonDoc\scripts\ps1\ai-error-extractor.ps1" -ProjectRoot (Get-Location).Path
}
```
