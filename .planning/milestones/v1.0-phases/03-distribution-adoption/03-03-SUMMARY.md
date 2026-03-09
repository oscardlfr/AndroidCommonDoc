---
phase: 03-distribution-adoption
plan: 03
subsystem: infra
tags: [setup-scripts, bash, powershell, install-hooks, setup-toolkit, composite-build, convention-plugin-wiring]

# Dependency graph
requires:
  - phase: 03-distribution-adoption
    plan: 01
    provides: "Convention plugin (build-logic/) with precompiled script plugin androidcommondoc.toolkit"
  - phase: 03-distribution-adoption
    plan: 02
    provides: "Claude Code hook scripts (.claude/hooks/) and copilot-instructions adapter"
provides:
  - "install-hooks.sh / Install-Hooks.ps1 for distributing Claude Code hooks to consuming projects"
  - "setup-toolkit.sh / setup-toolkit.ps1 unified orchestrator for full toolkit adoption in one command"
  - "Auto-modification of consuming project build files (settings.gradle.kts, module build.gradle.kts) with marker comments and .bak backups"
affects: [consuming-projects]

# Tech tracking
tech-stack:
  added: [python3-json-merging, python3-file-manipulation]
  patterns: [marker-comment-idempotency, bak-backup-before-modification, unified-orchestrator-with-skip-flags, sub-script-delegation]

key-files:
  created:
    - "setup/install-hooks.sh"
    - "setup/Install-Hooks.ps1"
    - "setup/setup-toolkit.sh"
    - "setup/setup-toolkit.ps1"
  modified: []

key-decisions:
  - "python3 used for JSON merging in install-hooks (settings.json) and file manipulation in setup-toolkit (build.gradle.kts) -- consistent with Phase 1 adapter pattern"
  - "Marker comments (// AndroidCommonDoc toolkit -- managed by setup script) for idempotency -- running setup twice produces same result"
  - ".bak backups created before any file modification per user decision"
  - "Sub-script exit codes wrapped with if/else to prevent toolkit abort on individual installer failure"
  - "Worktree directories (.claude/worktrees/) excluded from module discovery find command"

patterns-established:
  - "Unified orchestrator pattern: setup-toolkit.sh delegates to individual install-*.sh scripts with --projects and --force flags"
  - "Skip flags (--skip-skills, --skip-copilot, --skip-hooks, --skip-gradle) for selective orchestration"
  - "Marker comment idempotency: check for marker before inserting, skip if present"
  - "build file auto-modification with python3: read file, find insertion point, insert line, write back"

requirements-completed: [LINT-02, TOOL-03]

# Metrics
duration: 10min
completed: 2026-03-13
---

# Phase 3 Plan 03: Setup Scripts and Distribution Wiring Summary

**Unified setup-toolkit orchestrator and install-hooks scripts (SH/PS1 pairs) enabling single-command adoption of convention plugin, Claude Code hooks, skills, and Copilot instructions in consuming projects**

## Performance

- **Duration:** ~10 min (across multiple sessions including checkpoint)
- **Started:** 2026-03-13T09:00:00Z
- **Completed:** 2026-03-13T09:26:12Z
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files created:** 4

## Accomplishments
- install-hooks.sh and Install-Hooks.ps1 copy hook scripts to consuming projects and merge hook configuration into .claude/settings.json with backup and idempotency
- setup-toolkit.sh and setup-toolkit.ps1 orchestrate 6 steps: settings.gradle.kts modification (includeBuild), module build.gradle.kts modification (plugin ID), Claude skills installation, Copilot prompts installation, hooks installation, and summary with next steps
- All build file modifications use marker comments for idempotency and create .bak backups before any changes
- Dry-run mode (--dry-run) shows planned modifications without writing any files
- User verified the complete Phase 3 delivery end-to-end with dry-run against DawSync

## Task Commits

Each task was committed atomically:

1. **Task 1: Create install-hooks scripts (SH/PS1 pair)** - `bd41c80` (feat)
2. **Task 2: Create unified setup-toolkit scripts (SH/PS1 pair)** - `c5b3ee1` (feat)
3. **Task 3: Verify complete Phase 3 toolkit distribution** - checkpoint approved (no separate commit)

**Fix commit:** `f9ae682` (fix) -- exclude worktrees from module discovery and handle sub-script exit codes

## Files Created/Modified
- `setup/install-hooks.sh` (276 lines) - Copies hook scripts and merges .claude/settings.json in consuming projects with python3 JSON merging
- `setup/Install-Hooks.ps1` (323 lines) - PowerShell equivalent using ConvertFrom-Json/ConvertTo-Json for settings.json merging
- `setup/setup-toolkit.sh` (439 lines) - Unified orchestrator: 6-step installation with --project-root, --dry-run, --skip-* flags
- `setup/setup-toolkit.ps1` (428 lines) - PowerShell equivalent with -ProjectRoot, -DryRun, -Skip* parameters

## Decisions Made
- **python3 for file manipulation:** Consistent with Phase 1 adapter pattern. Used for JSON merging (settings.json) and build file insertion (gradle.kts). Avoids fragile sed/awk on complex file formats.
- **Marker comment idempotency:** All build file modifications use `// AndroidCommonDoc toolkit -- managed by setup script` as a marker. Check before inserting, skip if present. Running setup twice produces identical results.
- **.bak backups:** Every file modified by the toolkit gets a .bak backup first, per user decision carried from PROJECT.md.
- **Sub-script error isolation:** Individual installer failures (install-hooks.sh, install-claude-skills.sh, install-copilot-prompts.sh) are caught and reported but do not abort the full toolkit setup. Fixed after user testing discovered exit code propagation issue.
- **Worktree exclusion:** Module discovery find command excludes `.claude/worktrees/` to avoid false positives in projects using Git worktrees.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exclude worktree directories from module discovery**
- **Found during:** Task 3 checkpoint (user dry-run testing)
- **Issue:** find command in Step 2 (module build.gradle.kts discovery) was descending into .claude/worktrees/ directories, finding build files from worktree clones
- **Fix:** Added `-not -path '*/.claude/worktrees/*'` to the find command
- **Files modified:** setup/setup-toolkit.sh, setup/setup-toolkit.ps1
- **Committed in:** f9ae682

**2. [Rule 1 - Bug] Handle sub-script exit codes gracefully**
- **Found during:** Task 3 checkpoint (user dry-run testing)
- **Issue:** When individual installer scripts (install-hooks.sh, etc.) exited with non-zero status (e.g., nothing to install), `set -euo pipefail` in the parent toolkit script caused immediate abort
- **Fix:** Wrapped sub-script calls with if/else to capture exit codes and report without aborting
- **Files modified:** setup/setup-toolkit.sh, setup/setup-toolkit.ps1
- **Committed in:** f9ae682

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes essential for real-world usage. No scope creep.

## Issues Encountered
None beyond the two issues caught during user checkpoint verification (documented as deviations above).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 complete: all 3 plans delivered
- Full adoption path for consuming projects: `setup-toolkit.sh --project-root ../MyApp` configures everything
- Selective adoption available via individual scripts (install-hooks, install-claude-skills, install-copilot-prompts)
- Consuming project next steps documented in setup-toolkit summary output: build detekt-rules JAR, sync Gradle, restart Claude Code

## Self-Check: PASSED

All 4 created files verified present on disk. All 3 commits (bd41c80, c5b3ee1, f9ae682) confirmed in git log.

---
*Phase: 03-distribution-adoption*
*Completed: 2026-03-13*
