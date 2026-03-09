---
name: sbom
description: "Generate CycloneDX SBOM for project modules. Use when asked to produce a software bill of materials."
allowed-tools: [Bash, Read, Grep, Glob]
l0_requires: ANDROID_COMMON_DOC
disable-model-invocation: true
---

## Usage Examples

```
/sbom
/sbom androidApp
/sbom desktopApp
/sbom --all
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Specific module to generate SBOM for (e.g., `androidApp`, `desktopApp`). Optional.
- `all` -- Generate SBOM for all configured modules.
- `project-root` -- Path to the project root directory.

## Behavior

1. Detect modules with CycloneDX plugin configured (looks for `cyclonedx` in `build.gradle.kts`).
2. Run `cyclonedxDirectBom` Gradle task for each target module.
3. List generated SBOM files with sizes.
4. Report success/failure summary.

**Prerequisite:** Projects must have CycloneDX plugin configured:
```kotlin
plugins {
    alias(libs.plugins.cyclonedx.bom)
}

tasks.cyclonedxDirectBom {
    includeConfigs.set(listOf("releaseRuntimeClasspath"))
    skipConfigs.set(listOf(".*test.*", ".*Test.*"))
    projectType.set(org.cyclonedx.model.Component.Type.APPLICATION)
    componentName.set("my-app")
    includeBomSerialNumber.set(true)
    jsonOutput.set(file("build/reports/bom-myapp.json"))
}
```

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set. See README.md}"

"$COMMON_DOC/scripts/sh/generate-sbom.sh" --project-root "$(pwd)" $ARGUMENTS
```

### Windows
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

## Expected Output

**On success:**
- List of generated SBOM JSON files with sizes
- Files located at `<module>/build/reports/bom-*.json`
- Success summary

**On failure:**
- CycloneDX plugin not configured error
- Gradle build failure details

## Cross-References

- Script: `scripts/sh/generate-sbom.sh`, `scripts/ps1/generate-sbom.ps1`
- Related: `/sbom-scan` (scan for vulnerabilities), `/sbom-analyze` (dependency analysis)
