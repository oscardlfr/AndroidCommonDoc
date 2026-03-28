<!-- GENERATED from skills/readme-audit/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Audit README.md and AGENTS.md against the current state of the repo. Surfaces stale counts, missing table entries, phantom references, project tree drift, guide hub gaps, and prose number claims. Use before closing a milestone or when documentation feels stale."
---

Audit README.md and AGENTS.md against the current state of the repo. Surfaces stale counts, missing table entries, phantom references, project tree drift, guide hub gaps, and prose number claims. Use before closing a milestone or when documentation feels stale.

## Implementation

### macOS / Linux
```bash
COMMON_DOC="${ANDROID_COMMON_DOC:?ANDROID_COMMON_DOC is not set}"
bash "$COMMON_DOC/scripts/sh/readme-audit.sh" --project-root "$(pwd)"
```

### Windows (PowerShell)
```powershell

```
