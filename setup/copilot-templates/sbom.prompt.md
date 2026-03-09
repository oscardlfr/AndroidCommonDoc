<!-- GENERATED from skills/sbom/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Generate CycloneDX SBOM for project modules. Use when asked to produce a software bill of materials."
---

Generate CycloneDX SBOM for project modules. Use when asked to produce a software bill of materials.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/generate-sbom.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$module = ""
$all = $false

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--all") { $all = $true }
    elseif (-not $arg.StartsWith("-") -and -not $module) { $module = $arg }
}

$params = @{ ProjectRoot = (Get-Location).Path }
if ($module) { $params.Module = $module }
if ($all) { $params.All = $true }

& "$commonDoc\scripts\ps1\generate-sbom.ps1" @params
```
