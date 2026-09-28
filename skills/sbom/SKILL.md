---
name: sbom
description: "Generate CycloneDX SBOM for project modules. Use when asked to produce a software bill of materials."
intent: [sbom, cyclonedx, dependencies, bill-of-materials, security]
allowed-tools: [Bash, Read, Grep, Glob]
disable-model-invocation: true
copilot: true
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

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run generate-sbom --project-root "$PWD" -- $ARGUMENTS
```

### Windows
Claude Code runs the POSIX command above from Bash on Windows as well. The
launcher selects the platform implementation and injects the project root.

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
