<!-- GENERATED from skills/benchmark/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run benchmarks across modules and show agent-friendly results summary. Detects available platforms and devices."
---

Run benchmarks across modules and show agent-friendly results summary. Detects available platforms and devices.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run benchmark --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell

```
