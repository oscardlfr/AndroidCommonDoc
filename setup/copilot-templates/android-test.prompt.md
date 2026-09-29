<!-- GENERATED from skills/android-test/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run Android instrumented tests with logcat capture. Use when asked to run device/emulator tests or connectedAndroidTest."
---

Run Android instrumented tests with logcat capture. Use when asked to run device/emulator tests or connectedAndroidTest.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run android-test --project-root "$PWD" -- $ARGUMENTS
```

### Windows (PowerShell)
```powershell
node .claude/runtime/l0-toolkit-launcher.cjs run android-test --project-root (Get-Location).Path -- $ARGUMENTS
```
