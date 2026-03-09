# T02: 14.2-docs-content-quality 02

**Slice:** S04 — **Milestone:** M004

## Description

Split 8 oversized L0 standalone and sub-docs into hub+sub-doc format following the established pattern from Phase 14 Plan 02.

Purpose: Establish stable, size-compliant L0 reference targets that L1/L2 docs will reference via l0_refs. L0 must be split FIRST so l0_refs in L1/L2 point to stable slugs.
Output: 8 formerly-oversized L0 docs converted to hub+sub-doc format. All hubs under 100 lines, all sub-docs under 300 lines.

## Must-Haves

- [ ] "All L0 hub docs are under 100 lines"
- [ ] "All L0 sub-docs are under 300 lines"
- [ ] "No active L0 doc exceeds 500 lines"
- [ ] "All new sub-docs have parent frontmatter field pointing to hub slug"
- [ ] "All cross-references updated to point to correct sub-docs"
- [ ] "doc-template.md (267 lines) kept as-is -- it is a reference template, splitting would fragment the example"

## Files

- `docs/offline-first/offline-first-architecture.md`
- `docs/offline-first/offline-first-architecture-layers.md`
- `docs/offline-first/offline-first-architecture-conflict.md`
- `docs/offline-first/offline-first-sync.md`
- `docs/offline-first/offline-first-sync-queue.md`
- `docs/ui/viewmodel-state-management.md`
- `docs/ui/viewmodel-state-management-sealed.md`
- `docs/ui/viewmodel-state-management-stateflow.md`
- `docs/ui/viewmodel-events.md`
- `docs/ui/viewmodel-events-consumption.md`
- `docs/di/di-patterns.md`
- `docs/di/di-patterns-modules.md`
- `docs/di/di-patterns-testing.md`
- `docs/compose/compose-resources-configuration.md`
- `docs/compose/compose-resources-configuration-setup.md`
- `docs/storage/storage-patterns.md`
- `docs/storage/storage-patterns-implementation.md`
