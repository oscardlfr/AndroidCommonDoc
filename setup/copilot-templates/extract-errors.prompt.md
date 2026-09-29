<!-- GENERATED from skills/extract-errors/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Extract structured build and test errors from Gradle output. Use when a build or test fails and you need actionable error details."
---

Extract structured build and test errors from Gradle output. Use when a build or test fails and you need actionable error details.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run extract-errors --project-root "$(pwd)" -- --module "$MODULE" $ARGUMENTS
```

### Windows (PowerShell)
```powershell

```
