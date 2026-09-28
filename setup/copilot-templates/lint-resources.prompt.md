<!-- GENERATED from skills/lint-resources/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Validate string resource naming conventions (snake_case, prefixes, duplicates, Swift sync). Use when checking resource files or before merging UI changes."
---

Validate string resource naming conventions (snake_case, prefixes, duplicates, Swift sync). Use when checking resource files or before merging UI changes.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run lint-resources --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run lint-resources --project-root (Get-Location).Path -- $ARGUMENTS
```
