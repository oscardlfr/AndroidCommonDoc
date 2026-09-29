<!-- GENERATED from skills/sync-versions/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Check version catalog alignment between KMP projects. Use when asked to verify dependency versions match the source of truth."
---

Check version catalog alignment between KMP projects. Use when asked to verify dependency versions match the source of truth.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run version-sync --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run version-sync --project-root (Get-Location).Path -- $ARGUMENTS
```
