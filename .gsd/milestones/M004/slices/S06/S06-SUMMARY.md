---
id: S06
parent: M004
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
# S06: Claude Md Ecosystem Alignment

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

# Phase 15 Plan 02: Validate CLAUDE.md MCP Tool Summary

**validate-claude-md MCP tool with 7 validation dimensions (template, coverage, circular refs, overrides, versions, duplicates) plus 26 tests, registered as tool 16 in index**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-15T23:35:06Z
- **Completed:** 2026-03-15T23:40:54Z
- **Tasks:** 2 (Task 1 TDD with 3 commits, Task 2 with 1 commit)
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- Built validate-claude-md MCP tool with 7 validation dimensions: template structure, line count budget, canonical rule coverage, circular reference detection, override validation, version consistency, and cross-file duplicate detection
- Implemented keyword-based heuristic matching for canonical rule coverage (extracts distinctive keywords, requires 50% match threshold)
- Created 26 unit tests via TDD (RED > GREEN) covering all 7 validation dimensions
- Registered tool in MCP index -- full suite passes at 538 tests (26 new + 512 existing), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): Failing tests** - `15ed956` (test)
2. **Task 1 (TDD GREEN): Implementation** - `c69e4e7` (feat)
3. **Task 2: Register in tool index** - `bf9e252` (feat)

## Files Created/Modified

- `mcp-server/src/tools/validate-claude-md.ts` - MCP tool implementation with 7 validation functions + orchestrator + MCP registration (477 lines)
- `mcp-server/tests/unit/tools/validate-claude-md.test.ts` - Unit tests across 7 describe blocks: template structure, line count, canonical coverage, circular references, override validation, version consistency, cross-file duplicates
- `mcp-server/src/tools/index.ts` - Added import and registration call for validate-claude-md, updated tool count to 16

## Decisions Made

- **Keyword heuristic matching:** Canonical rule coverage uses keyword extraction (2-4 distinctive words per rule) with 50% match threshold, avoiding brittle exact string matching that would break on minor rewording
- **Developer Context exemption:** The Developer Context section in L0-global CLAUDE.md is explicitly exempt from circular reference detection since it is user-scoped and legitimately mentions project names
- **L0-global identity header exemption:** ~/.claude/CLAUDE.md does not require Layer/Inherits/Purpose blockquote since it is the hierarchy root with no parent to inherit from
- **Version pattern registry:** Predefined regex patterns for known dependencies (Koin, Kotlin, AGP, etc.) mapped to versions-manifest.json keys, extensible for new dependencies
- **Cross-file duplicate normalization:** Rule lines normalized to lowercase for comparison, minimum 20 chars to filter noise, only flags cross-file (not within-file) duplicates

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- validate-claude-md tool ready for CLAUDE.md rewrite validation (Plan 03)
- Tool can be invoked programmatically during smoke tests (Plan 04)
- All 7 validation dimensions operational and tested
- Canonical rules (66) and versions manifest available for cross-checking

## Self-Check: PASSED

- [x] mcp-server/src/tools/validate-claude-md.ts -- FOUND
- [x] mcp-server/tests/unit/tools/validate-claude-md.test.ts -- FOUND
- [x] 15-02-SUMMARY.md -- FOUND
- [x] Commit 15ed956 (TDD RED) -- FOUND
- [x] Commit c69e4e7 (TDD GREEN) -- FOUND
- [x] Commit bf9e252 (registration) -- FOUND

---
*Phase: 15-claude-md-ecosystem-alignment*
*Completed: 2026-03-16*

# Phase 15 Plan 03: CLAUDE.md Ecosystem Rewrites Summary

**All 4 CLAUDE.md files rewritten with identity headers, delegation chain, zero circular references, zero cross-file duplicates -- L0 (110 lines), L0 toolkit (67 lines), L1 (66 lines), L2 (90 lines)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-15T23:48:41Z
- **Completed:** 2026-03-15T23:53:17Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Rewritten all 4 CLAUDE.md files with mandatory identity headers (Layer, Inherits, Purpose blockquote)
- L0 global fully generic: zero project-name references in generic sections (DawSync, OmniTrack, shared-kmp-libs removed/rephrased)
- L1 zero upward references: removed DawSync/WakeTheCave/OmniTrack from consumer list
- DawSync Wave 1 parallel tracks preserved intact; all existing content sections retained across all files
- Full validation suite: 538 MCP tests passing, comprehensive cross-file checks (identity headers, circular refs, duplicates, line counts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite L0 global and L0 toolkit CLAUDE.md** - `4b87b19` (feat, AndroidCommonDoc repo) + non-repo write (~/.claude/CLAUDE.md)
2. **Task 2: Rewrite L1 and L2 CLAUDE.md** - `809a3ec` (feat, shared-kmp-libs repo), `0a82e8e8` (feat, DawSync repo)

## Files Created/Modified

- `~/.claude/CLAUDE.md` - L0 global: added identity header (Layer L0, Inherits None), Developer Context marked User-Specific, Build Patterns rephrased generically (110 lines)
- `CLAUDE.md` - L0 toolkit: added identity header (Layer L0 Pattern Toolkit, Inherits L0 Generic), added validate-claude-md to tools list (67 lines)
- `shared-kmp-libs/CLAUDE.md` - L1: added identity header (Layer L1 Ecosystem Library, Inherits L0 Generic), removed L2 project name references (66 lines)
- `DawSync/CLAUDE.md` - L2: added identity header (Layer L2 Application, Inherits L0+L1), all content preserved including Wave 1 tracks (90 lines)

## Decisions Made

- **Build Patterns generic phrasing:** Changed `includeBuild("../shared-kmp-libs")` to `includeBuild("../shared-library")` and "Version catalog from shared-kmp-libs" to "Version catalog from the shared library project" in L0 global to eliminate project-name references from generic sections
- **L1 consumer list removed:** The line "consumed by DawSync, WakeTheCave, and OmniTrack" was removed from L1 because it constitutes an upward reference (L1 referencing L2 projects), which the validate-claude-md circular reference detector would flag
- **No Turbine is not an override:** DawSync's "No Turbine" rule is an L2-specific testing addition, not a contradiction of L0 (which says "subscribe in backgroundScope" but doesn't mandate Turbine). No L0 Overrides table needed
- **L0-global identity header added:** Even though the validate-claude-md tool exempts L0-global from the identity header requirement, the header was added for template consistency and clarity (Layer: L0, Inherits: None)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed shared-kmp-libs references in L0 Build Patterns section**
- **Found during:** Task 1 (L0 global rewrite)
- **Issue:** Build Patterns section contained "shared-kmp-libs" (a project name) in two lines, which the circular reference validator would flag
- **Fix:** Rephrased to generic form: "shared-library" and "the shared library project"
- **Files modified:** ~/.claude/CLAUDE.md
- **Verification:** Cross-file validation confirms zero project-name references outside Developer Context

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for L0 generic purity. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 CLAUDE.md files validate cleanly against template structure, canonical coverage, circular references, and cross-file duplicate checks
- Ready for Plan 04 (smoke tests and Copilot adapter generation)
- validate-claude-md tool operational for ongoing validation

## Self-Check: PASSED

- [x] ~/.claude/CLAUDE.md -- FOUND
- [x] CLAUDE.md -- FOUND
- [x] shared-kmp-libs/CLAUDE.md -- FOUND
- [x] DawSync/CLAUDE.md -- FOUND
- [x] 15-03-SUMMARY.md -- FOUND
- [x] Commit 4b87b19 (L0 toolkit, AndroidCommonDoc repo) -- FOUND
- [x] Commit 809a3ec (L1, shared-kmp-libs repo) -- FOUND
- [x] Commit 0a82e8e8 (L2, DawSync repo) -- FOUND

---
*Phase: 15-claude-md-ecosystem-alignment*
*Completed: 2026-03-16*

# Phase 15 Plan 04: Smoke Test, Copilot Adapter & Human Verification Summary

**Copilot adapter generating instructions from CLAUDE.md as SSOT, integration tests validating all 4 CLAUDE.md files on disk with canonical coverage smoke test, human-approved ecosystem alignment**

## Performance

- **Duration:** 6 min (across checkpoint boundary)
- **Started:** 2026-03-16T00:00:00Z
- **Completed:** 2026-03-16T05:59:36Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- Built Copilot adapter that flattens L0 global + project CLAUDE.md into Copilot instructions format, integrated into generate-all.sh pipeline
- Created integration test suite validating all 4 CLAUDE.md files (L0 global, L0 toolkit, L1, L2) for template structure, line count budget, canonical rule coverage, and cross-file consistency
- Canonical smoke test confirms 90%+ rule coverage across all layers via keyword heuristic matching
- Human verified and approved the complete CLAUDE.md ecosystem alignment (identity headers, delegation chain, rule preservation, Copilot output)
- Post-approval fix: restored `../shared-kmp-libs` path in Build Patterns since it is a concrete Gradle filesystem path, not a genericizable project name

## Task Commits

Each task was committed atomically:

1. **Task 1: Build Copilot adapter and integration tests** - `388dde8` (feat)
2. **Task 2: Human verification** - checkpoint approved, no commit needed
3. **Post-checkpoint fix: Restore shared-kmp-libs path** - `5789ebd` (fix)

## Files Created/Modified

- `adapters/claude-md-copilot-adapter.sh` - Python3 inline script that reads L0 global + project CLAUDE.md, extracts sections and rules, outputs flattened Copilot-format markdown
- `adapters/generate-all.sh` - Updated to include claude-md-copilot-adapter in the adapter pipeline
- `mcp-server/tests/integration/claude-md-validation.test.ts` - Integration tests: L0 global validation, L0 toolkit validation, L1 validation, L2 validation, cross-file validation, canonical coverage smoke test
- `setup/copilot-templates/copilot-instructions-from-claude-md.md` - Generated Copilot instructions from CLAUDE.md files (auto-generated output)
- `~/.claude/CLAUDE.md` - Restored `../shared-kmp-libs` path in Build Patterns section (fix commit)

## Decisions Made

- **Copilot adapter pattern:** Uses Python3 inline script matching the existing `copilot-instructions-adapter.sh` pattern; keeps both adapters (docs-based and CLAUDE.md-based) as separate sources for different purposes
- **Integration tests as smoke test:** The integration tests implement CLAUDE-07 by validating canonical rule coverage programmatically rather than through code generation, satisfying the requirement via checklist-based verification
- **Post-approval path restoration:** The `../shared-kmp-libs` path in Build Patterns is a real Gradle `includeBuild()` filesystem path that must remain concrete; the genericization in Plan 03 was overly aggressive for this specific line

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored ../shared-kmp-libs path in Build Patterns**
- **Found during:** Post-checkpoint review
- **Issue:** Plan 03 genericized `includeBuild("../shared-kmp-libs")` to `includeBuild("../shared-library")` in L0 global CLAUDE.md, but this is a real filesystem path used by Gradle composite builds
- **Fix:** Restored the concrete path in both `~/.claude/CLAUDE.md` and the generated Copilot output
- **Files modified:** ~/.claude/CLAUDE.md, setup/copilot-templates/copilot-instructions-from-claude-md.md
- **Committed in:** `5789ebd`

---

**Total deviations:** 1 auto-fixed (1 bug from prior plan)
**Impact on plan:** Necessary for correctness of Gradle composite build configuration. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 15 is the final phase of v1.2 milestone -- all 4 plans complete
- CLAUDE.md ecosystem fully aligned: canonical rules inventoried, template designed, files rewritten, validated, and human-approved
- Copilot adapter pipeline extended to generate from CLAUDE.md as SSOT
- validate-claude-md MCP tool operational for ongoing maintenance
- All 88 plans across 15 phases complete

## Self-Check: PASSED

- [x] adapters/claude-md-copilot-adapter.sh -- FOUND
- [x] adapters/generate-all.sh -- FOUND
- [x] mcp-server/tests/integration/claude-md-validation.test.ts -- FOUND
- [x] setup/copilot-templates/copilot-instructions-from-claude-md.md -- FOUND
- [x] ~/.claude/CLAUDE.md -- FOUND
- [x] 15-04-SUMMARY.md -- FOUND
- [x] Commit 388dde8 (Task 1) -- FOUND
- [x] Commit 5789ebd (fix) -- FOUND

---
*Phase: 15-claude-md-ecosystem-alignment*
*Completed: 2026-03-16*
