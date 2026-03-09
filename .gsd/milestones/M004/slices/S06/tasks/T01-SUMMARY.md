---
id: T01
parent: S06
milestone: M004
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 
blocker_discovered: false
---
# T01: 15-claude-md-ecosystem-alignment 01

**# Phase 15 Plan 01: Canonical Rule Extraction & Template Design Summary**

## What Happened

# Phase 15 Plan 01: Canonical Rule Extraction & Template Design Summary

**66-rule canonical checklist from 4 CLAUDE.md files (14 categories, 3 layers, zero contradictions) plus standard template with identity header, delegation model, and override mechanism**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-15T23:28:59Z
- **Completed:** 2026-03-15T23:32:29Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- Extracted 66 behavioral rules from all 4 CLAUDE.md files (42 L0 global, 10 L0 toolkit, 6 L1, 8 L2) with source attribution, layer assignment, and overridability flag
- Cross-file consistency validation: zero contradictions, one complementary near-duplicate resolved (BUILD-03/MOD-04)
- Designed standard template with 7 sections: identity header, critical rules, domain sections, build commands, L0 overrides, temporal context, team/agent rules
- Documented delegation model, override mechanism, anti-patterns, and budget constraints

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract canonical rule checklist from all CLAUDE.md files** - `6061d88` (feat)
2. **Task 2: Design CLAUDE.md template reference document** - `d542417` (feat)

## Files Created/Modified

- `docs/guides/canonical-rules.json` - Machine-readable rule inventory (66 rules, 14 categories) for validate-claude-md tool and smoke tests
- `docs/guides/claude-md-template.md` - Standard CLAUDE.md template reference (212 lines) with delegation model and anti-patterns

## Decisions Made

- **Rule ID system:** Category-prefixed IDs (ARCH-01, VM-01, TEST-01, etc.) enable precise override references and validate-claude-md cross-checking
- **Overridability policy:** Core patterns (architecture, ViewModel, error handling, source sets) NOT overridable; technology choices (DI, navigation, build tools, team workflow) overridable for corporate portability
- **Delegation model:** Convention-based using Claude Code's native auto-loading, no @import for cross-project references (GitHub issue #8765 reliability concerns)
- **Developer Context:** Kept in `~/.claude/CLAUDE.md` since it is user-scoped; clearly marked for corporate replacement; project names allowed in user-scoped section but NOT in generic rules sections
- **Near-duplicate resolution:** BUILD-03 (L0: convention plugins pattern) and MOD-04 (L1: convention plugins for module catalog) are complementary, not duplicates -- both retained

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- canonical-rules.json ready for runtime loading by validate-claude-md MCP tool (Plan 02)
- claude-md-template.md ready as blueprint for CLAUDE.md rewrites (Plan 03)
- Both files in docs/guides/ for MCP scanner discoverability

## Self-Check: PASSED

- [x] docs/guides/canonical-rules.json -- FOUND
- [x] docs/guides/claude-md-template.md -- FOUND
- [x] 15-01-SUMMARY.md -- FOUND
- [x] Commit 6061d88 (Task 1) -- FOUND
- [x] Commit d542417 (Task 2) -- FOUND

---
*Phase: 15-claude-md-ecosystem-alignment*
*Completed: 2026-03-16*
