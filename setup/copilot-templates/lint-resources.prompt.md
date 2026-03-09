<!-- GENERATED from skills/lint-resources/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Validate string resource naming conventions (snake_case, prefixes, duplicates, Swift sync). Use when checking resource files or before merging UI changes."
---

Validate string resource naming conventions (snake_case, prefixes, duplicates, Swift sync). Use when checking resource files or before merging UI changes.

## Implementation

### macOS / Linux
```bash
bash scripts/sh/lint-resources.sh \
  --project-root "$PROJECT_ROOT" \
  --module-path "$MODULE_PATH" \
  --strict \
  --show-details \
  --check-swift-sync \
  --output-format human
```

### Windows (PowerShell)
```powershell
pwsh scripts/ps1/lint-resources.ps1 `
  -ProjectRoot "$ProjectRoot" `
  -ModulePath "$ModulePath" `
  -StrictMode `
  -ShowDetails `
  -CheckSwiftSync `
  -OutputFormat human
```
