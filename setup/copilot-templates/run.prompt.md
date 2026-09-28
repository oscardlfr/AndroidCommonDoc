<!-- GENERATED from skills/run/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Build, install, and run app with debug logging. Use when asked to launch, run, or deploy the app on a device or desktop."
---

Build, install, and run app with debug logging. Use when asked to launch, run, or deploy the app on a device or desktop.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run run-app --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run run-app --project-root (Get-Location).Path -- $ARGUMENTS
```
