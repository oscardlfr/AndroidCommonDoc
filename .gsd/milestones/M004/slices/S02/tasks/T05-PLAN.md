# T05: 14-doc-structure-consolidation 05

**Slice:** S02 — **Milestone:** M004

## Description

Create 4 new L0 docs for the highest-priority coverage gaps: Navigation3 patterns, DI patterns (framework-agnostic), an Agent Consumption Guide, and generic KMP storage patterns.

Purpose: Fill the 3 most critical coverage gaps identified in the Phase 13 audit (Navigation3, DI, storage concepts), plus create the essential meta-doc that explains how the L0/L1/L2 documentation system works for AI spec-driven development. The storage patterns L0 doc provides the generic conceptual foundation that Plan 14-07's L1 storage-guide.md maps to specific shared-kmp-libs modules.
Output: 4 new L0 pattern docs, all under 300 lines, with full frontmatter

## Must-Haves

- [ ] "Navigation3 patterns doc covers @Serializable routes, Android+Desktop Compose, iOS/macOS native NavigationStack"
- [ ] "DI patterns doc is framework-agnostic covering both Koin and Dagger/Hilt"
- [ ] "Agent consumption guide explains L0/L1/L2 layering, when to load which layer, frontmatter fields"
- [ ] "Storage patterns L0 doc covers generic KMP storage concepts independent of shared-kmp-libs modules"
- [ ] "All 4 docs follow the standard template from Plan 01"

## Files

- `docs/navigation3-patterns.md`
- `docs/di-patterns.md`
- `docs/agent-consumption-guide.md`
- `docs/storage-patterns.md`
