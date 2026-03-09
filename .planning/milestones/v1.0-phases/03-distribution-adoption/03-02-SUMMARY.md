---
phase: 03-distribution-adoption
plan: 02
subsystem: tooling
tags: [claude-code-hooks, copilot-instructions, detekt, adapter-pipeline, bash]

# Dependency graph
requires:
  - phase: 02-quality-gates
    provides: "Custom Detekt rules JAR (5 AST-only architecture rules) and config.yml"
  - phase: 01-stabilize-foundation
    provides: "Adapter pipeline pattern (generate-all.sh, claude-adapter.sh, copilot-adapter.sh) and canonical docs/*.md pattern files"
provides:
  - "PostToolUse hook script for real-time Detekt enforcement on Write|Edit operations"
  - "PreToolUse hook script intercepting git commit to validate staged Kotlin files"
  - "Copilot instructions adapter pair (SH/PS1) generating copilot-instructions.md"
  - "Generated copilot-instructions-generated.md with DO/DON'T patterns from all 8 pattern docs"
affects: [03-distribution-adoption]

# Tech tracking
tech-stack:
  added: [claude-code-hooks, jq, detekt-cli-2.0.0-alpha.2]
  patterns: [PostToolUse-blocking-json, PreToolUse-deny-allow, detekt-cli-caching, adapter-pipeline-extension]

key-files:
  created:
    - ".claude/hooks/detekt-post-write.sh"
    - ".claude/hooks/detekt-pre-commit.sh"
    - "adapters/copilot-instructions-adapter.sh"
    - "adapters/Copilot-Instructions-Adapter.ps1"
    - "setup/copilot-templates/copilot-instructions-generated.md"
  modified:
    - "adapters/generate-all.sh"

key-decisions:
  - "Detekt CLI JAR resolved via download+cache pattern: check local build dir, then .cache/ dir, then download from Maven Central on first use"
  - "PostToolUse hook skips files >500 lines to avoid hook timeout (Pitfall #4 from research)"
  - "PS1 adapter uses identical python3 logic as SH counterpart for byte-identical output rather than native PowerShell parsing"

patterns-established:
  - "Claude Code hook JSON I/O: all debug to stderr, only valid JSON or nothing to stdout"
  - "Detekt CLI caching: download once to .cache/ directory, reuse on subsequent invocations"
  - "Copilot instructions generation: extract DO/DON'T and Key insight lines from canonical docs"

requirements-completed: [TOOL-03]

# Metrics
duration: 5min
completed: 2026-03-13
---

# Phase 3 Plan 02: Claude Code Hooks and Copilot Instructions Adapter Summary

**Two-hook Detekt enforcement strategy (post-write + pre-commit) with Copilot instructions adapter generating pattern guidance from 8 canonical docs**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T08:48:08Z
- **Completed:** 2026-03-13T08:53:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- PostToolUse hook detects Detekt violations in Kotlin files immediately after Write|Edit and returns blocking JSON feedback
- PreToolUse hook intercepts git commit commands and validates staged Kotlin files with configurable severity (block/warn via ANDROID_COMMON_DOC_MODE env var)
- Copilot instructions adapter pair (SH + PS1) generates comprehensive pattern guidance from canonical docs/*.md pattern files
- Generated copilot-instructions-generated.md with 9 sections covering all 8 pattern docs plus Detekt rules
- Adapter pipeline extended: generate-all.sh now runs all three adapters (Claude commands, Copilot prompts, Copilot instructions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Claude Code hook scripts (post-write and pre-commit)** - `74b4e58` (feat)
2. **Task 2: Create Copilot instructions adapter pair (SH/PS1) and generate output** - `f24b352` (feat)

## Files Created/Modified
- `.claude/hooks/detekt-post-write.sh` - PostToolUse hook: reads JSON stdin, runs Detekt on .kt files, emits blocking decision
- `.claude/hooks/detekt-pre-commit.sh` - PreToolUse hook: intercepts git commit, validates staged .kt files, supports block/warn mode
- `adapters/copilot-instructions-adapter.sh` - SH adapter generating copilot-instructions.md from docs/*.md
- `adapters/Copilot-Instructions-Adapter.ps1` - PS1 counterpart using identical python3 extraction logic
- `setup/copilot-templates/copilot-instructions-generated.md` - Generated Copilot instructions with DO/DON'T patterns from 8 docs + Detekt rules
- `adapters/generate-all.sh` - Updated to include copilot-instructions-adapter call

## Decisions Made
- Detekt CLI resolved via download+cache pattern (check build dir, then .cache/, then Maven Central) rather than requiring pre-installed CLI -- enables graceful first-use experience
- Files >500 lines skipped in post-write hook to avoid timeout per RESEARCH.md Pitfall #4
- PS1 adapter delegates to identical python3 logic rather than native PowerShell parsing -- ensures byte-identical output between SH and PS1 counterparts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Hook scripts ready for distribution via setup scripts (Plan 03)
- Copilot instructions file ready for installation into consuming projects
- Both hooks handle missing dependencies gracefully (exit 0) -- safe for immediate use even before Detekt rules JAR is built

## Self-Check: PASSED

All 5 created files verified on disk. Both task commits (74b4e58, f24b352) verified in git history.

---
*Phase: 03-distribution-adoption*
*Completed: 2026-03-13*
