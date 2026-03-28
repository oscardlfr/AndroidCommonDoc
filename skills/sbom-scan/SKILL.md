---
name: sbom-scan
description: "Scan SBOM for known CVE vulnerabilities using Trivy. Use when asked to check for security vulnerabilities in dependencies."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
disable-model-invocation: true
copilot: true
---

## Usage Examples

```
/sbom-scan
/sbom-scan androidApp
/sbom-scan --severity CRITICAL
/sbom-scan desktopApp --severity MEDIUM
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Specific module to scan. Scans all if omitted.
- `severity` -- Minimum severity level (default: `HIGH,CRITICAL`). Options: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. Can combine: `HIGH,CRITICAL`.
- `sbom-path` -- Direct path to a specific SBOM file (overrides module-based discovery).
- `project-root` -- Path to the project root directory.

## Behavior

1. Find Trivy executable (PATH, WinGet, or Scoop location).
2. Locate SBOM files (`bom-*.json`) in the project.
3. Run `trivy sbom` on each file with the specified severity filter.
4. Display vulnerability details (CVE ID, severity, affected library).
5. Show summary with counts by severity level.

**Prerequisite:** Trivy must be installed:
```bash
# Windows (winget)
winget install aquasecurity.trivy

# macOS
brew install trivy

# Linux
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
```

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/scan-sbom.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
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

## Expected Output

**On success (no vulnerabilities, exit code 0):**
- "No vulnerabilities found" message

**On vulnerabilities found (exit code 1):**
- Vulnerability table with CVE IDs, severity, affected libraries, and fixed versions
- Summary count by severity level

**Common remediation actions:**
- Update the dependency to a patched version
- Exclude transitive vulnerable dependencies
- Add dependency exclusions in `build.gradle.kts`

## Cross-References

- Script: `scripts/sh/scan-sbom.sh`, `scripts/ps1/scan-sbom.ps1`
- Related: `/sbom` (generate SBOM first), `/sbom-analyze` (dependency analysis)
