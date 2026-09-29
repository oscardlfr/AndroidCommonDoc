---
name: sbom-analyze
description: "Analyze SBOM for dependency statistics, licenses, and concerns. Use when asked to review dependency licenses or SBOM contents."
intent: [sbom, analyze, licenses, dependencies, statistics]
allowed-tools: [Bash, Read, Grep, Glob]
disable-model-invocation: true
copilot: true
---

## Usage Examples

```
/sbom-analyze
/sbom-analyze androidApp
/sbom-analyze desktopApp
```

## Parameters

Uses parameters from `params.json`:
- `module` -- Module to analyze (e.g., `androidApp`, `desktopApp`). Analyzes first SBOM found if omitted.
- `sbom-path` -- Direct path to a specific SBOM file (overrides module-based discovery).
- `project-root` -- Path to the project root directory.

## Behavior

1. Parse CycloneDX JSON SBOM file.
2. Extract metadata (timestamp, format version, component name, serial number).
3. Count and categorize dependencies by type (library, framework, etc.).
4. Identify top publishers (organizations with most dependencies).
5. Identify top dependency groups (Maven group IDs with most artifacts).
6. Analyze license distribution (Apache-2.0, MIT, etc.).
7. Flag potential concerns:
   - GPL licenses (copyleft implications).
   - Missing versions (unspecified or floating).
   - Deprecated components.

## Implementation

```bash
node .claude/runtime/l0-toolkit-launcher.cjs run sbom-analyze --project-root "$PWD" -- $ARGUMENTS
```

### Windows
Claude Code runs the POSIX command above from Bash on Windows as well. The
launcher selects the platform implementation and injects the project root.

## Expected Output

**Metadata:**
- Generation timestamp, format version (CycloneDX), component name, serial number

**Dependencies:**
- Total component count
- Breakdown by type (library, framework, etc.)

**Top Publishers:**
- Organizations with most dependencies

**Top Dependency Groups:**
- Maven group IDs with most artifacts

**Licenses:**
- Count of components with/without license info
- Most common licenses (Apache-2.0, MIT, etc.)

**Potential Concerns:**
- GPL licenses: components with copyleft implications
- Missing versions: dependencies without version specification
- Deprecated: components marked as deprecated

## Cross-References

- Script: `scripts/sh/analyze-sbom.sh`, `scripts/ps1/analyze-sbom.ps1`
- Related: `/sbom` (generate SBOM first), `/sbom-scan` (vulnerability scanning)
