<!-- GENERATED from skills/sbom-analyze/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Analyze SBOM for dependency statistics, licenses, and concerns. Use when asked to review dependency licenses or SBOM contents."
---

Analyze SBOM for dependency statistics, licenses, and concerns. Use when asked to review dependency licenses or SBOM contents.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/analyze-sbom.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$module = ""

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if (-not $arg.StartsWith("-") -and -not $module) { $module = $arg }
}

& "$commonDoc\scripts\ps1\analyze-sbom.ps1" -ProjectRoot (Get-Location).Path -Module $module
```
