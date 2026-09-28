<!-- GENERATED from skills/verify-kmp/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Validate KMP source set organization and forbidden imports. Use when asked to check architecture or source set correctness."
---

Validate KMP source set organization and forbidden imports. Use when asked to check architecture or source set correctness.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run verify-kmp --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell

```
