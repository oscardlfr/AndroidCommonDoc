---
milestone: M007
status: complete
completed: "2026-03-17"
slices: [S01, S02, S03]
commit: b6f027c
---

# M007: Detekt Rule Expansion & L0/L1 Config Flexibility — Complete

## What Was Built

### S01: Config Hierarchy
- `detekt-l0-base.yml` — distributable baseline, all 13 rules `active: true`
- `config.yml` converted to documented L1 override example
- `config-emitter.ts` `emitBaselineConfig()` — generates baseline from frontmatter
- Merge semantics confirmed: `--config base.yml,l1.yml` → l1.yml wins per leaf key via `CompositeConfig`
- 16 tests for config-emitter (all passing)

### S02: 8 New Hand-Written Rules
All AST-only (no type resolution), all tested:

| Rule | Category | Tests |
|------|----------|-------|
| `MutableStateFlowExposedRule` | State | 5 |
| `NoRunCatchingInCoroutineScopeRule` | Coroutine Safety | 4 |
| `NoHardcodedDispatchersRule` | ViewModel Boundaries | 6 |
| `NoHardcodedStringsInViewModelRule` | ViewModel Boundaries | 6 |
| `NoMagicNumbersInUseCaseRule` | Architecture | 5 |
| `NoLaunchInInitRule` | Coroutine Safety | 4 |
| `NoSilentCatchRule` | Error Handling | 5 |
| `NoChannelForNavigationRule` | Architecture | 4 |

### S03: Frontmatter + Docs
- 8 rules wired to pattern docs with `hand_written: true` + `source_rule:`
- `docs/guides/detekt-config.md` — full L0/L1 hierarchy guide + 13-rule catalog
- `guides-hub.md` updated
- `generate-rules/SKILL.md` updated with L0/L1 section

### Bonus (extracted from DawSync PR)
- 4 reusable `workflow_call` CI workflows (commit-lint, lint-resources, kmp-safety-check, architecture-guards)
- `setup/github-workflows/ci-template.yml` + `pull_request_template.md`
- 4 new skills: `commit-lint`, `lint-resources`, `pre-pr`, `git-flow`
- Vault improvements: README→parent naming, sub-project slug dedup, relative link stripping, MOC aliases

## Verification Results

- `./gradlew :detekt-rules:test` → BUILD SUCCESSFUL, 76 tests, 0 failed
- `npm test` → 645/646 (1 preexisting `claude-md-validation` identity header)
- All success criteria met

## Key Decisions

- Companion objects in PSI are `KtObjectDeclaration` not `KtClass` — `getParentOfType<KtClass>` skips them silently; fixed to `getParentOfType<KtObjectDeclaration>` with `hasModifier(KtTokens.COMPANION_KEYWORD)`
- `MutableStateFlow<Event?>(null)` initializer text doesn't match `contains("MutableStateFlow(")` — fixed to `startsWith("MutableStateFlow")`
- Config merge: `CompositeConfig(lookFirst=LAST_CONFIG)` — last file in `--config` list wins per key
