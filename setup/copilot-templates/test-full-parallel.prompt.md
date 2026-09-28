<!-- GENERATED from skills/test-full-parallel/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run all tests in parallel with coverage. Use when asked to run the full test suite fast or with parallel execution."
---

Run all tests in parallel with coverage. Use when asked to run the full test suite fast or with parallel execution.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run test-full --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell

```
