<!-- GENERATED from skills/coverage-full/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Generate comprehensive coverage report across all modules. Use when asked for full project coverage overview or metrics."
---

Generate comprehensive coverage report across all modules. Use when asked for full project coverage overview or metrics.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root "$PWD" -- --skip-tests $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root (Get-Location).Path -- --skip-tests $ARGUMENTS
```
