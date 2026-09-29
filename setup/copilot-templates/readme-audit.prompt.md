<!-- GENERATED from skills/readme-audit/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Audit README.md and AGENTS.md against the current state of the repo. Surfaces stale counts, missing table entries, phantom references, project tree drift, guide hub gaps, and prose number claims. Use --fix to auto-correct count headers, add missing rows, and remove phantom rows. Use before closing a milestone or when documentation feels stale."
---

Audit README.md and AGENTS.md against the current state of the repo. Surfaces stale counts, missing table entries, phantom references, project tree drift, guide hub gaps, and prose number claims. Use --fix to auto-correct count headers, add missing rows, and remove phantom rows. Use before closing a milestone or when documentation feels stale.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run readme-audit --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run readme-audit --project-root (Get-Location).Path -- $ARGUMENTS
```
