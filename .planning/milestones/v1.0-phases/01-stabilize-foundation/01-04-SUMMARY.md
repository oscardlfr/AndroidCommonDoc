---
phase: 01-stabilize-foundation
plan: 04
subsystem: tooling
tags: [adapters, generation-pipeline, agents-md, claude-commands, copilot-prompts, open-closed-principle]

# Dependency graph
requires:
  - phase: 01-stabilize-foundation/plan-01
    provides: 8 standardized pattern docs for AGENTS.md cross-references
  - phase: 01-stabilize-foundation/plan-03
    provides: 16 canonical skills/*/SKILL.md files with Agent Skills format
provides:
  - "Adapter pipeline: SKILL.md + params.json -> tool-specific output files"
  - "16 regenerated Claude commands in .claude/commands/*.md with GENERATED header"
  - "16 regenerated Copilot prompts in setup/copilot-templates/*.prompt.md with GENERATED header"
  - "AGENTS.md universal AI tool entry point at repo root (87 lines)"
  - "Open/closed adapter pattern: new AI tools require only a new adapter file"
affects: [02-quality-gates, distribution, copilot-instructions, claude-hooks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adapter pipeline: canonical SKILL.md + params.json -> adapter script -> tool-specific output"
    - "Pre-cached param data via python3 for cross-platform path compatibility (Git Bash + Windows Python)"
    - "GENERATED header comment on all generated files: <!-- GENERATED from skills/name/SKILL.md -- DO NOT EDIT MANUALLY -->"
    - "Open/closed adapter pattern: each adapter is independent Bash script reading same inputs"

key-files:
  created:
    - adapters/claude-adapter.sh
    - adapters/copilot-adapter.sh
    - adapters/generate-all.sh
    - adapters/README.md
    - AGENTS.md
  modified:
    - .claude/commands/test.md
    - .claude/commands/test-full.md
    - .claude/commands/test-full-parallel.md
    - .claude/commands/test-changed.md
    - .claude/commands/coverage.md
    - .claude/commands/coverage-full.md
    - .claude/commands/auto-cover.md
    - .claude/commands/extract-errors.md
    - .claude/commands/run.md
    - .claude/commands/android-test.md
    - .claude/commands/verify-kmp.md
    - .claude/commands/sync-versions.md
    - .claude/commands/validate-patterns.md
    - .claude/commands/sbom.md
    - .claude/commands/sbom-scan.md
    - .claude/commands/sbom-analyze.md
    - setup/copilot-templates/test.prompt.md
    - setup/copilot-templates/test-full.prompt.md
    - setup/copilot-templates/test-full-parallel.prompt.md
    - setup/copilot-templates/test-changed.prompt.md
    - setup/copilot-templates/coverage.prompt.md
    - setup/copilot-templates/coverage-full.prompt.md
    - setup/copilot-templates/auto-cover.prompt.md
    - setup/copilot-templates/extract-errors.prompt.md
    - setup/copilot-templates/run.prompt.md
    - setup/copilot-templates/android-test.prompt.md
    - setup/copilot-templates/verify-kmp.prompt.md
    - setup/copilot-templates/sync-versions.prompt.md
    - setup/copilot-templates/validate-patterns.prompt.md
    - setup/copilot-templates/sbom.prompt.md
    - setup/copilot-templates/sbom-scan.prompt.md
    - setup/copilot-templates/sbom-analyze.prompt.md

key-decisions:
  - "Adapter scripts use python3 with relative paths (cd to repo root) to avoid Git Bash /c/ vs Windows C:/ path incompatibility"
  - "Parameter data pre-cached in single python3 call (PARAM_CACHE variable) rather than invoking python3 per-parameter per-skill"
  - "coverage-full files force-tracked with git add -f since coverage-*.md gitignore pattern incorrectly blocks them"
  - "AGENTS.md kept to 87 lines with all 6 required sections derived from actual SKILL.md and docs/ files"

patterns-established:
  - "Adapter pipeline: adapters/ directory with independent scripts reading skills/ and writing tool-specific output"
  - "Generated file convention: GENERATED header + Regenerate comment linking to generate-all.sh"
  - "AGENTS.md as universal AI entry point: architecture table, conventions, 16-skill index, 8 pattern docs, boundaries"

requirements-completed: [TOOL-01, TOOL-02]

# Metrics
duration: 7min
completed: 2026-03-12
---

# Phase 1 Plan 04: Adapter Pipeline and AGENTS.md Summary

**Adapter scripts generating 32 Claude/Copilot files from canonical SKILL.md definitions, plus AGENTS.md as 87-line universal AI entry point with architecture, conventions, skill index, and boundaries**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-12T22:54:57Z
- **Completed:** 2026-03-12T23:02:13Z
- **Tasks:** 2
- **Files created:** 5
- **Files modified:** 32

## Accomplishments
- Built adapter pipeline: `claude-adapter.sh` and `copilot-adapter.sh` read 16 canonical SKILL.md files + params.json and generate 32 tool-specific output files
- All 16 Claude commands regenerated with GENERATED header, full argument descriptions from params.json, and behavioral specs from SKILL.md
- All 16 Copilot prompts regenerated with GENERATED header, `${input:...}` variable syntax from params.json copilot mappings, and implementation sections
- AGENTS.md created at repo root (87 lines) with all 6 required sections: Commands, Architecture, Key Conventions, Available Skills (16 entries), Pattern Docs (8 entries), Boundaries
- Adapter pipeline is idempotent: running twice produces identical output
- Open/closed principle: adding a new AI tool adapter requires no modification to existing files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create adapter scripts** - `2de70f6` (feat)
2. **Task 2: Regenerate all 32 output files and create AGENTS.md** - `427200f` (feat)

## Files Created/Modified
- `adapters/claude-adapter.sh` -- Reads skills/*/SKILL.md + params.json, generates .claude/commands/*.md
- `adapters/copilot-adapter.sh` -- Reads same inputs, generates setup/copilot-templates/*.prompt.md
- `adapters/generate-all.sh` -- Runner script executing both adapters
- `adapters/README.md` -- Documents the open/closed adapter pattern
- `AGENTS.md` -- Universal AI tool entry point (87 lines, 6 sections)
- `.claude/commands/*.md` (16 files) -- Regenerated Claude commands with GENERATED headers
- `setup/copilot-templates/*.prompt.md` (16 files) -- Regenerated Copilot prompts with GENERATED headers

## Decisions Made
- **Cross-platform path handling:** Used `cd "$REPO_ROOT"` + relative paths for python3 calls because Git Bash resolves paths as `/c/Users/...` which Python on Windows cannot open. Relative paths work on all platforms.
- **Parameter caching:** Pre-cached all parameter data in a single python3 invocation (PARAM_CACHE variable) rather than invoking python3 once per parameter per skill -- reduces 45+ subprocess calls to 1.
- **Force-tracked coverage-full files:** The gitignore pattern `coverage-*.md` incorrectly catches `coverage-full.md` and `coverage-full.prompt.md` (generated tool files, not coverage reports). Used `git add -f` to track them.
- **AGENTS.md 87 lines:** Well under the 150-line target. All skill descriptions and pattern doc references extracted from actual files, not invented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed cross-platform path incompatibility in adapter scripts**
- **Found during:** Task 1 (adapter creation)
- **Issue:** Python3 on Windows cannot open Git Bash `/c/Users/...` paths. First adapter version used absolute paths that failed silently.
- **Fix:** Changed adapters to `cd "$REPO_ROOT"` and use relative paths (`skills/params.json`). Pre-cached all param data in single python3 call.
- **Files modified:** adapters/claude-adapter.sh, adapters/copilot-adapter.sh
- **Verification:** `bash adapters/generate-all.sh` runs successfully, idempotency confirmed
- **Committed in:** 2de70f6 (Task 1 commit)

**2. [Rule 3 - Blocking] Force-tracked gitignored coverage-full files**
- **Found during:** Task 2 (commit)
- **Issue:** Gitignore pattern `coverage-*.md` blocks `.claude/commands/coverage-full.md` and `setup/copilot-templates/coverage-full.prompt.md` -- these are generated tool files, not coverage reports.
- **Fix:** Used `git add -f` to force-track these specific files.
- **Files modified:** .claude/commands/coverage-full.md, setup/copilot-templates/coverage-full.prompt.md
- **Verification:** Files are tracked and committed.
- **Committed in:** 427200f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both fixes were necessary for correct cross-platform operation and complete file tracking. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- Phase 1 is now complete: all 4 plans executed
- Foundation is stable: pattern docs standardized, parameters unified, skills canonicalized, adapters generating, AGENTS.md serving as universal entry point
- Ready for Phase 2: Quality Gates and Enforcement
- Phase 2 can build on this foundation to add freshness tracking, parity tests, Detekt rules, and quality gate agents that verify the adapter pipeline output

## Self-Check: PASSED

- adapters/claude-adapter.sh: FOUND
- adapters/copilot-adapter.sh: FOUND
- adapters/generate-all.sh: FOUND
- adapters/README.md: FOUND
- AGENTS.md: FOUND
- Commit 2de70f6: VERIFIED
- Commit 427200f: VERIFIED
- 16 Claude commands with GENERATED header: VERIFIED
- 16 Copilot prompts with GENERATED header: VERIFIED
- Zero --project-path instances: VERIFIED
- AGENTS.md under 150 lines (87): VERIFIED

---
*Phase: 01-stabilize-foundation*
*Completed: 2026-03-12*
