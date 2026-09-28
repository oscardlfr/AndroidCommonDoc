---
name: sbom-scan
description: "Scan SBOM for known CVE vulnerabilities using Trivy. Use when asked to check for security vulnerabilities in dependencies."
intent: [sbom, cve, vulnerabilities, trivy, security, scan]
allowed-tools: [Bash, Read, Grep, Glob]
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

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run sbom-scan --project-root "$PWD" -- $ARGUMENTS
```

### Windows
Claude Code runs the POSIX command above from Bash on Windows as well. The
launcher selects the platform implementation and injects the project root.

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
