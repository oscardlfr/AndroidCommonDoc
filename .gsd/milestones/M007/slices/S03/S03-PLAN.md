---
slice: S03
status: complete
completed: "2026-03-17"
---

# S03: Frontmatter + Docs Wiring + generate-rules Skill Update

## Tasks

- [x] **T01: Wire frontmatter for all 8 new rules** `est:45m`
  - viewmodel-state-management-stateflow.md → `mutable-state-flow-exposed`
  - error-handling-exceptions.md → `no-silent-catch`, `no-run-catching-in-coroutine-scope`
  - error-handling-result.md → `no-magic-numbers-in-usecase`
  - navigation-patterns.md + 4 nav docs → `no-channel-for-navigation` updated to `hand_written: true`
  - testing-hub.md → `no-hardcoded-dispatchers`, `no-launch-in-init`
  - viewmodel-state-management.md → `no-hardcoded-strings-in-viewmodel`

- [x] **T02: Create docs/guides/detekt-config.md** `est:30m`
  - L0/L1 hierarchy explanation with `--config` merge semantics
  - Full rule catalog (13 rules, grouped by category)
  - How to add a new rule (step-by-step)
  - AST-only constraint with link to Detekt #8882

- [x] **T03: Update generate-rules SKILL.md** `est:15m`
  - Add L0/L1 Config Hierarchy section documenting `emitBaselineConfig()` and override flow
  - Update Cross-References to include baseline yml and detekt-config guide

- [x] **T04: Update guides-hub.md** `est:5m`
  - Add detekt-config.md to documents table

## Verification

- `./gradlew :detekt-rules:test` — BUILD SUCCESSFUL (76 tests)
- `npm test` — 645/646 PASS (1 preexisting claude-md-validation failure)
- `docs/guides/detekt-config.md` exists at 124 lines (under 300-line sub-doc limit)
- All 8 rules have `hand_written: true` + `source_rule:` in relevant frontmatter
