<!-- GENERATED from skills/test-changed/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run tests only on modules with uncommitted changes. Use when asked to test changed files or run a quick pre-commit check."
---

Run tests only on modules with uncommitted changes. Use when asked to test changed files or run a quick pre-commit check.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-changed --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell

```
