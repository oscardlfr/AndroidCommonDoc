---
phase: 01-stabilize-foundation
plan: 02
subsystem: infra
tags: [json, parameter-manifest, script-consistency, cross-platform]

# Dependency graph
requires: []
provides:
  - "skills/params.json -- canonical parameter manifest with 45 parameters across all 12 script pairs"
  - "skills/params.schema.json -- JSON Schema for parameter manifest validation"
  - "Zero parameter naming drift across PS1, SH, Makefile, and Copilot prompt files"
affects: [01-03, 01-04]

# Tech tracking
tech-stack:
  added: [json-schema]
  patterns: [parameter-manifest, canonical-naming]

key-files:
  created:
    - skills/params.json
    - skills/params.schema.json
  modified:
    - scripts/ps1/run-parallel-coverage-suite.ps1
    - scripts/ps1/run-changed-modules-tests.ps1
    - scripts/sh/run-parallel-coverage-suite.sh
    - scripts/sh/run-changed-modules-tests.sh
    - Makefile
    - setup/copilot-templates/test.prompt.md
    - setup/copilot-templates/android-test.prompt.md
    - setup/copilot-templates/auto-cover.prompt.md
    - setup/copilot-templates/coverage.prompt.md
    - setup/copilot-templates/coverage-full.prompt.md
    - setup/copilot-templates/extract-errors.prompt.md
    - setup/copilot-templates/run.prompt.md
    - setup/copilot-templates/sbom.prompt.md
    - setup/copilot-templates/sbom-analyze.prompt.md
    - setup/copilot-templates/sbom-scan.prompt.md
    - setup/copilot-templates/sync-versions.prompt.md
    - setup/copilot-templates/test-changed.prompt.md
    - setup/copilot-templates/test-full.prompt.md
    - setup/copilot-templates/test-full-parallel.prompt.md
    - setup/copilot-templates/verify-kmp.prompt.md

key-decisions:
  - "Audited all 12 PS1 + 12 SH scripts to discover 45 unique parameters for the manifest"
  - "Internal function parameters and PSCustomObject properties renamed alongside CLI parameters for full consistency"

patterns-established:
  - "Parameter manifest at skills/params.json is the single source of truth for all script interfaces"
  - "Canonical case is kebab-case in manifest; mapping field provides per-tool name variants"

requirements-completed: [SCRP-01, SCRP-02]

# Metrics
duration: 8min
completed: 2026-03-12
---

# Phase 1 Plan 2: Parameter Manifest and Drift Fix Summary

**JSON parameter manifest with 45 parameters from all 12 script pairs, plus zero-drift normalization across PS1, SH, Makefile, and 14 Copilot prompt files**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-12T22:32:37Z
- **Completed:** 2026-03-12T22:40:34Z
- **Tasks:** 2
- **Files modified:** 21

## Accomplishments
- Created skills/params.json with 45 parameters covering every parameter from all 12 script pairs
- Created skills/params.schema.json for manifest structure validation
- Eliminated all --project-path / -ProjectPath naming drift across 19 files
- Verified zero remaining drift with global search

## Task Commits

Each task was committed atomically:

1. **Task 1: Create parameter manifest and JSON schema** - `5fe93be` (feat)
2. **Task 2: Fix all parameter naming drift** - `3af5e4a` (fix)

## Files Created/Modified
- `skills/params.json` - Canonical parameter manifest with 45 parameters, type/description/mapping fields
- `skills/params.schema.json` - JSON Schema for validating the manifest structure
- `scripts/ps1/run-parallel-coverage-suite.ps1` - ProjectPath -> ProjectRoot (param declaration, usages, function params)
- `scripts/ps1/run-changed-modules-tests.ps1` - ProjectPath -> ProjectRoot (param declaration, usages, function params)
- `scripts/sh/run-parallel-coverage-suite.sh` - --project-path -> --project-root (CLI arg, usage, variable name)
- `scripts/sh/run-changed-modules-tests.sh` - --project-path -> --project-root (CLI arg, usage, variable name)
- `Makefile` - coverage and coverage-report targets fixed to use --project-root
- 14 Copilot prompt files - --project-path / -ProjectPath -> --project-root / -ProjectRoot

## Decisions Made
- Audited all 12 PS1 scripts and 12 SH scripts (not just the 2 identified in research) to discover the complete set of 45 unique parameters
- Renamed internal function parameters and PSCustomObject properties (not just CLI-facing parameters) for full consistency
- coverage-full.prompt.md is gitignored but was still fixed locally for correctness

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Fixed 12 additional Copilot prompt files beyond plan scope**
- **Found during:** Task 2 (parameter drift fix)
- **Issue:** Plan only listed test.prompt.md for Copilot fixes, but global search revealed 13 more prompt files using --project-path / -ProjectPath
- **Fix:** Fixed all 14 Copilot prompt files (android-test, auto-cover, coverage, extract-errors, run, sbom, sbom-analyze, sbom-scan, sync-versions, test-changed, test-full, test-full-parallel, verify-kmp)
- **Files modified:** 14 additional Copilot prompt files
- **Verification:** grep -rn "project-path|ProjectPath" returns zero results
- **Committed in:** 3af5e4a (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (missing critical -- additional drift instances not identified in research)
**Impact on plan:** Essential for the "zero drift" success criteria. No scope creep -- same parameter fix, just more files.

## Issues Encountered
- coverage-full.prompt.md is gitignored -- fixed locally but could not be committed. This file will need gitignore attention in a future plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Parameter manifest ready for adapters (Plan 03-04) to consume
- All script interfaces consistently use --project-root / -ProjectRoot
- Schema available for validation tooling

## Self-Check: PASSED

- skills/params.json: FOUND
- skills/params.schema.json: FOUND
- Commit 5fe93be (Task 1): FOUND
- Commit 3af5e4a (Task 2): FOUND

---
*Phase: 01-stabilize-foundation*
*Completed: 2026-03-12*
