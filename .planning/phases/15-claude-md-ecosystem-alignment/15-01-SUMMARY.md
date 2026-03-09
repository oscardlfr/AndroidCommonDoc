---
phase: 15-claude-md-ecosystem-alignment
plan: 01
subsystem: context-management
tags: [claude-md, rules-inventory, template, json, context-delegation]

requires:
  - phase: 14.3-skill-materialization-registry
    provides: De-duplicated CLAUDE.md files (62-100 lines each) with layering convention
provides:
  - Machine-readable canonical rule checklist (66 rules, 14 categories, 3 layers)
  - Standard CLAUDE.md template reference with identity header, override format, delegation model
affects: [15-02 validate-claude-md MCP tool, 15-03 CLAUDE.md rewrites, 15-04 smoke tests and Copilot adapter]

tech-stack:
  added: []
  patterns: [canonical-rule-id-system, claude-md-layer-delegation, override-mechanism]

key-files:
  created:
    - docs/guides/canonical-rules.json
    - docs/guides/claude-md-template.md
  modified: []

key-decisions:
  - "66 rules extracted across 14 categories with category-prefixed IDs (ARCH-NN, VM-NN, etc.) for override referencing"
  - "Convention-based delegation over @import: L0 auto-loads via Claude Code native mechanism, no cross-project imports"
  - "Overridability flag per rule: core patterns (architecture, ViewModel, error handling) NOT overridable; technology choices (DI, navigation) overridable"
  - "One near-duplicate (BUILD-03/MOD-04 convention plugins) resolved as complementary: L0 states pattern, L1 contextualizes for module catalog"
  - "Template under 212 lines as guide doc; enforces <150 lines per CLAUDE.md, <4000 tokens per project load"

patterns-established:
  - "Canonical Rule ID: CATEGORY-NN format for machine-readable rule referencing across layers"
  - "CLAUDE.md Identity Header: Layer/Inherits/Purpose blockquote at top of every file"
  - "L0 Override Table: Rule ID + Override + Reason format for downstream layer deviations"
  - "Temporal Context Section: Time-bounded project context (Wave 1 tracks) clearly marked for removal"

requirements-completed: [CLAUDE-01, CLAUDE-02]

duration: 4min
completed: 2026-03-16
---

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
