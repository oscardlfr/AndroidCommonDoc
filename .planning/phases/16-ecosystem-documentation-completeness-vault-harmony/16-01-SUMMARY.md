---
phase: 16-ecosystem-documentation-completeness-vault-harmony
plan: 01
subsystem: tooling
tags: [mcp, validation, frontmatter, vault-sync, module-readme]

# Dependency graph
requires:
  - phase: 14.2
    provides: frontmatterCompleteness scoring, validate-doc-structure tool
provides:
  - validateModuleReadme function for module README frontmatter/l0_refs/size validation
  - vault-config.json collectGlobs with core-*/README.md for shared-kmp-libs
affects: [16-03, 16-04, 16-05, 16-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [module-readme-validation, collectGlobs-override]

key-files:
  created: []
  modified:
    - mcp-server/src/tools/validate-doc-structure.ts
    - mcp-server/tests/unit/tools/validate-doc-structure.test.ts
    - ~/.androidcommondoc/vault-config.json

key-decisions:
  - "Required fields for module READMEs: category, slug, layer, status (error if missing); description, version, last_updated (warning if missing)"
  - "l0_refs warning only for L1 project modules (not L0 docs)"
  - "300-line limit for module READMEs (sub-doc limit from QUAL-02)"
  - "Layer mismatch check: L1 module README with non-L1 layer field is an error"

patterns-established:
  - "Module README validation separate from docs/ directory validation"
  - "collectGlobs must include ALL default globs when overriding (explicit replaces defaults)"

requirements-completed: [P16-VALIDATE, P16-VAULT]

# Metrics
duration: 3min
completed: 2026-03-16
---

# Phase 16 Plan 01: Validate-Doc-Structure Extension & Vault Config Summary

**Module README validation function with frontmatter completeness, l0_refs, 300-line limit, and vault collectGlobs for core-*/README.md collection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-16T14:02:26Z
- **Completed:** 2026-03-16T14:05:23Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended validate-doc-structure with validateModuleReadme() covering 10-field frontmatter, l0_refs, 300-line limit, and layer checks
- 7 new tests (TDD red-green) covering all module README validation scenarios
- vault-config.json updated with collectGlobs for shared-kmp-libs including core-*/README.md while preserving all default L1 globs
- Full MCP test suite: 574/574 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend validate-doc-structure for module README validation (RED)** - `65136d4` (test)
2. **Task 1: Implement module README validation (GREEN)** - `0c3872a` (feat)
3. **Task 2: Update vault-config.json with module README collectGlobs** - no commit (file is outside git repo at ~/.androidcommondoc/)

_Note: TDD task has two commits (test then feat). vault-config.json is a user-level config not tracked in this repo._

## Files Created/Modified
- `mcp-server/src/tools/validate-doc-structure.ts` - Added ModuleReadmeResult interface, validateModuleReadme function, MODULE_REQUIRED_FIELDS/MODULE_OPTIONAL_FIELDS constants
- `mcp-server/tests/unit/tools/validate-doc-structure.test.ts` - Added 7 tests for module README validation
- `~/.androidcommondoc/vault-config.json` - Added collectGlobs with 8 globs including core-*/README.md for shared-kmp-libs

## Decisions Made
- Required fields for module READMEs: category, slug, layer, status (error if missing); description, version, last_updated (warning if missing)
- l0_refs warning only for L1 project modules (not L0 docs) -- L0 docs are the reference, they don't need to reference themselves
- 300-line limit for module READMEs aligns with sub-doc limit from QUAL-02
- Layer mismatch check: L1 module README with non-L1 layer field produces error (catches misconfigured frontmatter)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- validateModuleReadme() ready for Plans 03-05 to use for quality checks on new/upgraded module READMEs
- vault-config.json ready for Plan 06 vault resync to collect all 52 module READMEs
- MCP tool registration (--include-modules flag) deferred to when Plans 03-05 create actual module READMEs to validate

## Self-Check: PASSED

- FOUND: mcp-server/src/tools/validate-doc-structure.ts
- FOUND: mcp-server/tests/unit/tools/validate-doc-structure.test.ts
- FOUND: ~/.androidcommondoc/vault-config.json
- FOUND: 16-01-SUMMARY.md
- FOUND: commit 65136d4
- FOUND: commit 0c3872a

---
*Phase: 16-ecosystem-documentation-completeness-vault-harmony*
*Completed: 2026-03-16*
