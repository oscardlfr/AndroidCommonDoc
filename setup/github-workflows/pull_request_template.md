## What

<!-- One sentence: what does this PR do? -->

## Why

<!-- Why is this change needed? Link to issue or milestone if applicable. -->

## Scope

<!-- Which modules are touched? Add/remove items as relevant to your project. -->
- [ ] Domain / model layer — blast radius reviewed
- [ ] Data layer — repository contracts respected
- [ ] UI / feature — patterns.md reviewed
- [ ] Tests added or updated

## Quality Checklist

<!-- These run automatically in CI. Verify locally with /pre-pr before pushing. -->
- [ ] `/commit-lint` — all commits conform to Conventional Commits v1.0.0
- [ ] `/lint-resources` — no string key naming violations
- [ ] Architecture guards pass — layer boundaries respected
- [ ] KMP safety — no `GlobalScope`, no `Thread.sleep()`, Dispatchers injected

## Testing

<!-- How was this tested? -->
- [ ] Unit tests pass (`./gradlew check`)
- [ ] Manual smoke test

## Breaking Changes

<!-- Any breaking changes to public APIs, data schemas, or cross-module contracts? -->
None / [describe if any]

---
<!-- See /pre-pr to run all checks locally before pushing -->
