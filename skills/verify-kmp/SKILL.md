---
name: verify-kmp
description: "Validate KMP source set organization and forbidden imports. Use when asked to check architecture or source set correctness."
intent: [kmp, source-sets, imports, architecture, validate]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
---

## Usage Examples

```
/verify-kmp
/verify-kmp core/domain --verbose
/verify-kmp --strict
/verify-kmp core/data --strict --verbose
```

## Parameters

Uses parameters from `params.json`:
- `module-path` -- Specific module path to check (e.g., `core/domain`). Omit to verify entire project.
- `strict-mode` -- Fail on warnings in addition to errors.
- `show-details` -- Show detailed output including matched lines.
- `project-root` -- Path to the project root directory.

## Behavior

1. Scan source sets in the target module(s) for forbidden imports.
2. Check `commonMain`/`shared` for ERRORS -- files must NOT import:
   - `android.*`, `androidx.*` (Android SDK)
   - `javax.inject`, `dagger.*` (use Koin instead)
   - `java.io.File`, `java.nio.*` (use Okio instead)
   - `javax.swing`, `java.awt` (Desktop UI)
   - `platform.Foundation`, `platform.UIKit` (iOS APIs)
3. Check platform source sets for WARNINGS -- detect pure Kotlin in platform-specific sets:
   - `androidMain` should contain Android-only APIs (`android.*`, `androidx.*`).
   - `desktopMain` should contain Desktop-only APIs (`javax.swing`, `java.awt`).
   - `iosMain` should contain iOS-only APIs (`platform.UIKit`).
   - `macosMain` should contain macOS-only APIs (`platform.AppKit`).
4. Recommend consolidation: JVM code shared by Android+Desktop should use `jvmMain`; Apple code shared by iOS+macOS should use `appleMain`.
5. Verify `expect`/`actual` consistency -- ensure expect declarations have corresponding actual implementations.
6. Report results with pass/fail status.

## Implementation

### macOS / Linux
```bash
node .claude/runtime/l0-toolkit-launcher.cjs run verify-kmp --project-root "$(pwd)" -- $ARGUMENTS
```

### Windows

Claude Code runs the POSIX command above from Bash on Windows as well. Do not resolve the toolkit through `ANDROID_COMMON_DOC` or call its PowerShell scripts directly; the consumer-local launcher resolves and verifies the pinned L0 source from `l0-manifest.json`.
## Expected Output

**On success (exit code 0):**
- Files checked per source set
- Summary with PASSED status
- Warnings listed (if any, non-strict mode)

**On failure (exit code 1):**
- ERRORS: Forbidden imports in commonMain (must fix)
- WARNINGS: Pure Kotlin in platform sets (consider moving)
- Summary with FAILED status

## Cross-References

- Pattern: `docs/kmp-architecture.md`
- Script: `scripts/sh/verify-kmp-packages.sh`, `scripts/ps1/verify-kmp-packages.ps1`
