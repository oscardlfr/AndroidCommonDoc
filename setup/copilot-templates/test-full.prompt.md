<!-- GENERATED from skills/test-full/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run all tests sequentially with full coverage report. Use when asked to run the complete test suite or generate a full coverage report."
---

Run all tests sequentially with full coverage report. Use when asked to run the complete test suite or generate a full coverage report.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root (Get-Location).Path -- $ARGUMENTS
```
