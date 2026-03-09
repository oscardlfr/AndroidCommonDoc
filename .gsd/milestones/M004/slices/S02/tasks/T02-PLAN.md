# T02: 14-doc-structure-consolidation 02

**Slice:** S02 — **Milestone:** M004

## Description

Split 6 oversized L0 docs into hub+sub-doc format following the established pattern from testing-patterns.md and viewmodel-state-patterns.md.

Purpose: Bring all L0 docs within the 300-line limit for standalone docs and 100-line limit for hubs. Sub-docs become independently loadable units that agents can selectively load based on frontmatter metadata.
Output: 6 hub docs + ~14-18 sub-docs, all with full frontmatter

## Must-Haves

- [ ] "No L0 doc exceeds 300 lines (standalone) or 100 lines (hub)"
- [ ] "Every sub-doc has full frontmatter with parent field and is self-contained"
- [ ] "Hub docs link to all their sub-docs in a Sub-documents section"
- [ ] "Original slugs preserved on hub docs so resolver URIs do not break"
- [ ] "All cross-references to split files updated across the repo"

## Files

- `docs/error-handling-patterns.md`
- `docs/error-handling-result.md`
- `docs/error-handling-exceptions.md`
- `docs/error-handling-ui.md`
- `docs/gradle-patterns.md`
- `docs/gradle-patterns-dependencies.md`
- `docs/gradle-patterns-conventions.md`
- `docs/gradle-patterns-publishing.md`
- `docs/kmp-architecture.md`
- `docs/kmp-architecture-sourceset.md`
- `docs/kmp-architecture-modules.md`
- `docs/resource-management-patterns.md`
- `docs/resource-management-lifecycle.md`
- `docs/resource-management-memory.md`
- `docs/testing-patterns-coroutines.md`
- `docs/testing-patterns-schedulers.md`
- `docs/ui-screen-patterns.md`
- `docs/ui-screen-structure.md`
- `docs/ui-screen-navigation.md`
- `docs/ui-screen-components.md`
