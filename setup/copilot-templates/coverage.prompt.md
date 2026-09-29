<!-- GENERATED from skills/coverage/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Analyze test coverage gaps from existing data without running tests. Use when asked to check coverage or find untested code."
---

Analyze test coverage gaps from existing data without running tests. Use when asked to check coverage or find untested code.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root "$(pwd)" -- --skip-tests --min-lines "${MIN_LINES:-5}" $ARGUMENTS
```

### Windows (PowerShell)
```powershell

```
