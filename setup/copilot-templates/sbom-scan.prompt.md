<!-- GENERATED from skills/sbom-scan/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Scan SBOM for known CVE vulnerabilities using Trivy. Use when asked to check for security vulnerabilities in dependencies."
---

Scan SBOM for known CVE vulnerabilities using Trivy. Use when asked to check for security vulnerabilities in dependencies.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/scan-sbom.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows (PowerShell)
```powershell
$commonDoc = if ($env:ANDROID_COMMON_DOC) { $env:ANDROID_COMMON_DOC } else { throw "ANDROID_COMMON_DOC is not set. See README.md" }

$argList = "$ARGUMENTS" -split '\s+' | Where-Object { $_ }
$module = ""
$severity = "HIGH,CRITICAL"

for ($i = 0; $i -lt $argList.Count; $i++) {
    $arg = $argList[$i]
    if ($arg -eq "--severity" -and $i + 1 -lt $argList.Count) {
        $severity = $argList[$i + 1]; $i++
    } elseif (-not $arg.StartsWith("-") -and -not $module) {
        $module = $arg
    }
}

& "$commonDoc\scripts\ps1\scan-sbom.ps1" -ProjectRoot (Get-Location).Path -Module $module -Severity $severity
```
