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
node .claude/runtime/l0-toolkit-launcher.cjs run generate-sbom --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run generate-sbom --project-root (Get-Location).Path -- $ARGUMENTS
```
