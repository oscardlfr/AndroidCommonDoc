---
phase: 01-stabilize-foundation
plan: 03
subsystem: tooling
tags: [skills, agent-skills, canonical-definitions, adapter-pattern, claude-commands, copilot-prompts]

# Dependency graph
requires:
  - phase: 01-stabilize-foundation/plan-02
    provides: skills/params.json parameter manifest with 45 canonical parameters
provides:
  - 16 canonical SKILL.md files in skills/<name>/SKILL.md
  - Agent Skills format template (test/SKILL.md as reference)
  - Behavioral specifications extracted from Claude commands and Copilot prompts
affects: [01-stabilize-foundation/plan-04, adapter-generation, copilot-instructions]

# Tech tracking
tech-stack:
  added: []
  patterns: [agent-skills-format, canonical-skill-definitions]

key-files:
  created:
    - skills/test/SKILL.md
    - skills/test-full/SKILL.md
    - skills/test-full-parallel/SKILL.md
    - skills/test-changed/SKILL.md
    - skills/coverage/SKILL.md
    - skills/coverage-full/SKILL.md
    - skills/auto-cover/SKILL.md
    - skills/extract-errors/SKILL.md
    - skills/run/SKILL.md
    - skills/android-test/SKILL.md
    - skills/verify-kmp/SKILL.md
    - skills/sync-versions/SKILL.md
    - skills/validate-patterns/SKILL.md
    - skills/sbom/SKILL.md
    - skills/sbom-scan/SKILL.md
    - skills/sbom-analyze/SKILL.md
  modified: []

key-decisions:
  - "Agent Skills format: YAML frontmatter (name, description, metadata.params) + 6 required sections (Usage Examples, Parameters, Behavior, Implementation, Expected Output, Cross-References)"
  - "Claude command used as authoritative source over Copilot prompt when behavior drifted between surfaces"
  - "auto-cover and validate-patterns defined as orchestration workflows (no external script) using agent built-in tools"

patterns-established:
  - "Agent Skills format: frontmatter with name/description/metadata.params, then 6 sections -- the canonical structure all adapters consume"
  - "Parameter references: skill params list references only canonical kebab-case names from params.json, never tool-specific syntax"
  - "Implementation sections: macOS/Linux uses --project-root, Windows uses -ProjectRoot -- no --project-path"

requirements-completed: [TOOL-01]

# Metrics
duration: 6min
completed: 2026-03-12
---

# Phase 1 Plan 3: Canonical Skill Definitions Summary

**16 canonical SKILL.md files capturing behavioral specs for all skills, using Agent Skills format with params.json references for adapter-driven generation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-12T22:44:41Z
- **Completed:** 2026-03-12T22:51:09Z
- **Tasks:** 2
- **Files created:** 16

## Accomplishments
- Created 4 reference SKILL.md files (test, coverage, verify-kmp, run) establishing the canonical format
- Created 12 remaining SKILL.md files following the reference template across testing, coverage, utility, and SBOM groups
- Eliminated all --project-path drift (canonical definitions all use --project-root)
- All 16 skills reference only valid parameter names from params.json

## Task Commits

Each task was committed atomically:

1. **Task 1: Create reference SKILL.md template and first 4 skills** - `9f394b2` (feat)
2. **Task 2: Create remaining 12 SKILL.md files** - `c125c31` (feat)

## Files Created/Modified
- `skills/test/SKILL.md` -- Reference template; module testing with smart retry and error extraction
- `skills/test-full/SKILL.md` -- Full test suite with sequential per-module execution
- `skills/test-full-parallel/SKILL.md` -- Parallel test execution using single Gradle invocation
- `skills/test-changed/SKILL.md` -- Git-diff-based module testing for changed code
- `skills/coverage/SKILL.md` -- Coverage gap analysis from existing data
- `skills/coverage-full/SKILL.md` -- Comprehensive coverage report with multi-project support
- `skills/auto-cover/SKILL.md` -- AI-driven test generation for coverage gaps (orchestration workflow)
- `skills/extract-errors/SKILL.md` -- Structured error extraction from Gradle builds
- `skills/run/SKILL.md` -- Build-install-run with debug log capture
- `skills/android-test/SKILL.md` -- Android instrumented tests with logcat and error JSON
- `skills/verify-kmp/SKILL.md` -- KMP architecture validation (imports, source sets, expect/actual)
- `skills/sync-versions/SKILL.md` -- Version catalog alignment checker
- `skills/validate-patterns/SKILL.md` -- Code pattern validation against doc standards (orchestration workflow)
- `skills/sbom/SKILL.md` -- CycloneDX SBOM generation
- `skills/sbom-scan/SKILL.md` -- Trivy vulnerability scanning of SBOMs
- `skills/sbom-analyze/SKILL.md` -- SBOM dependency statistics and license analysis

## Decisions Made
- **Agent Skills format:** YAML frontmatter (name, description, metadata.params) + 6 required sections. This format captures the union of behavior from both Claude commands and Copilot prompts.
- **Authoritative source:** Claude commands used as authoritative source over Copilot prompts when behavior drifted, as they contain more detailed behavioral specifications.
- **Orchestration skills:** `auto-cover` and `validate-patterns` are defined as orchestration workflows using agent built-in tools (Read, Grep, Edit) rather than wrapping external scripts, as they are inherently AI-agent-driven.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None -- no external service configuration required.

## Next Phase Readiness
- All 16 canonical SKILL.md files ready for Plan 04 (adapter generation)
- Adapters can read these files to generate Claude commands and Copilot prompts from a single source
- Format is extensible for future AI tool adapters (Codex, Cursor, Windsurf)

## Self-Check: PASSED

- All 16 SKILL.md files verified present on disk
- Commit `9f394b2` verified in git log
- Commit `c125c31` verified in git log
- SUMMARY.md verified present

---
*Phase: 01-stabilize-foundation*
*Completed: 2026-03-12*
