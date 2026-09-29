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
node .claude/runtime/l0-toolkit-launcher.cjs run sbom-scan --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run sbom-scan --project-root (Get-Location).Path -- $ARGUMENTS
```
