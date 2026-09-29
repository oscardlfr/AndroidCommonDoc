<!-- GENERATED from skills/test/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run tests for a module with smart retry and error extraction. Use when asked to test a specific module or run unit tests."
---

Run tests for a module with smart retry and error extraction. Use when asked to test a specific module or run unit tests.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-module --project-root "$(pwd)" -- $ARGUMENTS
if [ $? -ne 0 ]; then
  node .claude/runtime/l0-toolkit-launcher.cjs run extract-errors --project-root "$(pwd)" -- --module "$MODULE"
fi
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run test-module --project-root (Get-Location).Path -- $ARGUMENTS

if ($LASTEXITCODE -ne 0) {
    node .claude/runtime/l0-toolkit-launcher.cjs run extract-errors --project-root (Get-Location).Path -- --module $MODULE
}
```
