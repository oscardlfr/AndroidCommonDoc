---
phase: 10-doc-intelligence-detekt-generation
plan: 02
subsystem: generation
tags: [detekt, kotlin, code-generation, ast, psi, vitest, typescript]

requires:
  - phase: 09-pattern-registry-discovery
    provides: Registry types, frontmatter parser, scanner infrastructure
provides:
  - Rule parser extracting RuleDefinition arrays from YAML frontmatter
  - Kotlin emitter generating AST-only Detekt rules for 3 rule types
  - Test emitter generating JUnit 5 companion tests matching hand-written patterns
  - Config emitter generating detekt config.yml entries
affects: [10-04-detekt-integration, 10-05-mcp-tools]

tech-stack:
  added: []
  patterns: [template-based-kotlin-emission, tdd-red-green, rule-type-dispatch]

key-files:
  created:
    - mcp-server/src/generation/rule-parser.ts
    - mcp-server/src/generation/kotlin-emitter.ts
    - mcp-server/src/generation/test-emitter.ts
    - mcp-server/src/generation/config-emitter.ts
    - mcp-server/tests/unit/generation/rule-parser.test.ts
    - mcp-server/tests/unit/generation/kotlin-emitter.test.ts
    - mcp-server/tests/unit/generation/test-emitter.test.ts
  modified:
    - mcp-server/src/registry/types.ts

key-decisions:
  - "RuleType and RuleDefinition types added to types.ts inline (Plan 01 dependency not yet executed)"
  - "Template-based Kotlin emission over string concatenation for maintainability and debuggability"
  - "Generated rules use com.androidcommondoc.detekt.rules.generated package to separate from hand-written"
  - "Hand-written rules (hand_written: true) return null from all emitters -- never overwrite existing code"

patterns-established:
  - "Rule type dispatch: switch on rule.type to select emission template"
  - "toPascalCase helper: converts kebab-case rule IDs to PascalCase class names"
  - "AST-only rule templates: visitImportDirective, visitClass, property text matching"
  - "Test emission mirrors existing hand-written test patterns: Config.empty + rule.lint(code) + assertThat"

requirements-completed: [DOC-05]

duration: 5min
completed: 2026-03-14
---

# Phase 10 Plan 02: Rule Parser + Kotlin Emitters Summary

**Detekt rule generation engine: parser extracts RuleDefinition from frontmatter, emitters produce AST-only Kotlin rules + JUnit tests + config entries for 3 rule types (banned-import, prefer-construct, banned-usage)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-13T23:38:23Z
- **Completed:** 2026-03-13T23:43:59Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Rule parser validates and extracts RuleDefinition arrays from YAML frontmatter with full field validation
- Kotlin emitter generates AST-only Detekt rule source code for 3 rule types matching existing hand-written patterns
- Test emitter generates companion JUnit 5 test classes with violating and compliant code samples
- Config emitter generates detekt config.yml entries for both hand-written and generated rules
- 41 tests covering parsing, emission, validation, and edge cases -- all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Build rule parser and Kotlin emitter for 3 core rule types** - `2dc6dd0` (feat)
2. **Task 2: Build test emitter and config emitter for generated rules** - `b981411` (feat)

_TDD workflow: tests written first (RED), then implementation (GREEN). No refactor phase needed._

## Files Created/Modified
- `mcp-server/src/generation/rule-parser.ts` - Parses rules: frontmatter into validated RuleDefinition arrays
- `mcp-server/src/generation/kotlin-emitter.ts` - Emits Kotlin Detekt rule source for 3 rule types
- `mcp-server/src/generation/test-emitter.ts` - Emits companion JUnit 5 test classes
- `mcp-server/src/generation/config-emitter.ts` - Emits detekt config.yml entries
- `mcp-server/src/registry/types.ts` - Extended with RuleType, RuleDefinition, and monitoring types
- `mcp-server/tests/unit/generation/rule-parser.test.ts` - 8 tests for rule parsing
- `mcp-server/tests/unit/generation/kotlin-emitter.test.ts` - 17 tests for Kotlin emission
- `mcp-server/tests/unit/generation/test-emitter.test.ts` - 16 tests for test emission and config

## Decisions Made
- **RuleType/RuleDefinition in types.ts:** Added these types directly since Plan 01 (which was supposed to add them) hasn't been executed yet. This unblocks Plan 02 without requiring Plan 01 to complete first (Rule 3 - blocking issue).
- **Template-based emission:** Each rule type has a dedicated emitter function that fills in a Kotlin template. Simpler and more debuggable than building an AST programmatically.
- **Generated package separation:** All generated rules use `com.androidcommondoc.detekt.rules.generated` package. This cleanly separates generated from hand-written rules without requiring a separate module.
- **AST-only enforcement:** All emitted rules use PSI visitors (visitImportDirective, visitClass) with string matching only. No bindingContext, requiresTypeResolution, or RequiresAnalysisApi (avoids Detekt #8882).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added RuleType and RuleDefinition types to types.ts**
- **Found during:** Task 1 (rule parser implementation)
- **Issue:** Plan 01 was supposed to add RuleType and RuleDefinition to types.ts, but Plan 01 hasn't been executed yet. Plan 02 cannot import these types without them existing.
- **Fix:** Added the types directly to types.ts as specified in Plan 02's interface section. Also added monitoring types (MonitorUrl, MonitoringFinding, etc.) and optional monitor_urls/rules fields to PatternMetadata as the linter/formatter auto-applied the full Plan 01 type extensions.
- **Files modified:** mcp-server/src/registry/types.ts
- **Verification:** All 160+ existing tests pass, no regressions
- **Committed in:** 2dc6dd0 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix was necessary to unblock Plan 02 execution. The types added match exactly what Plan 01 specifies, so when Plan 01 executes it will find these types already in place.

## Issues Encountered
- Pre-existing `change-detector.test.ts` fails because `change-detector.ts` source doesn't exist (incomplete Plan 01 work). Logged to `deferred-items.md`. Not in scope for Plan 02.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Generation engine complete: rule-parser, kotlin-emitter, test-emitter, config-emitter
- Ready for Plan 04 (Detekt generated rules integration + writer pipeline) which will use these emitters to write actual .kt files
- Ready for Plan 05 (generate-detekt-rules MCP tool) which will wire the generation engine into an MCP tool

## Self-Check: PASSED

All 7 created files verified on disk. Both task commits (2dc6dd0, b981411) verified in git log.

---
*Phase: 10-doc-intelligence-detekt-generation*
*Completed: 2026-03-14*
