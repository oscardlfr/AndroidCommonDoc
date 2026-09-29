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
node .claude/runtime/l0-toolkit-launcher.cjs run sbom-analyze --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run sbom-analyze --project-root (Get-Location).Path -- $ARGUMENTS
```
