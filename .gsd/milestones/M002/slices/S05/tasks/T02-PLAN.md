# T02: 09-pattern-registry-discovery 02

**Slice:** S05 — **Milestone:** M002

## Description

Audit all 9 pattern docs for freshness against current official sources, fix stale references, and split the 4 largest docs (>400 lines) into focused, independently-loadable sub-docs for token-efficient agent consumption.

Purpose: Agents should load only the specific pattern slice they need (e.g., "coroutine testing" not "all testing"), and the registry launches with verified, current content. This directly serves the project's core value of token-efficiency.

Output: Audited pattern docs with current version references, plus 12 focused sub-docs split from the 4 largest originals.

## Must-Haves

- [ ] "All 9 pattern docs are validated against current official sources and any stale version refs or deprecated APIs are fixed"
- [ ] "Large docs (>400 lines) are split into focused sub-docs with independent YAML frontmatter"
- [ ] "Original slugs remain as composite entry points that reference sub-docs"
- [ ] "Each sub-doc is independently loadable and has complete frontmatter metadata"

## Files

- `docs/testing-patterns.md`
- `docs/compose-resources-patterns.md`
- `docs/offline-first-patterns.md`
- `docs/viewmodel-state-patterns.md`
- `docs/testing-patterns-coroutines.md`
- `docs/testing-patterns-fakes.md`
- `docs/testing-patterns-coverage.md`
- `docs/compose-resources-configuration.md`
- `docs/compose-resources-usage.md`
- `docs/compose-resources-troubleshooting.md`
- `docs/offline-first-architecture.md`
- `docs/offline-first-sync.md`
- `docs/offline-first-caching.md`
- `docs/viewmodel-state-management.md`
- `docs/viewmodel-navigation.md`
- `docs/viewmodel-events.md`
