# M006 Context

## Goal

Full L2 audit and harmonization: DawSync + DawSyncWeb docs aligned with L0/L1 standards, zero duplication, cross-layer references consistent.

## Scope

- **DawSync** (`../DawSync/docs/`): 92 active docs across 8 subdirs
- **DawSyncWeb** (`../DawSyncWeb/docs/`): 1 file remaining (`legal/README.md` — already a reference)
- L0/L1 as the upstream source of truth for patterns, terminology, and cross-refs

## What "harmonized" means for L2

1. **No duplicated content** — L2 docs reference L0 via `l0_refs:`, they do not re-explain L0 patterns
2. **`monitor_urls` where meaningful** — L2 docs about tech stack have upstream sources tracked
3. **`l0_refs` on all tech docs** — every DawSync architecture/guides/tech doc lists the L0 docs it builds on
4. **Category vocabulary** — DawSync uses L2-specific categories (`architecture`, `product`, `guides`, `legal`, `business`, `references`, `tech`) — these are valid at L2 and should not be forced into L0's 9-category vocabulary
5. **No stale cross-project slugs** — `l0_refs` values resolve to actual L0 slugs
6. **`claude-code-workflow.md` deduplication** — DawSync has one, L0 has one; DawSync's should reference L0's or be merged
7. **Hub docs list all sub-docs** — each hub's `## Sub-documents` table matches the actual files in the directory
8. **capability-detection pattern** — DawSync agents that use optional tools declare `optional_capabilities`

## Known Issues (from pre-audit)

| Issue | Scope | Count |
|-------|-------|-------|
| Missing `monitor_urls` | DawSync architecture + business + guides | ~50 docs |
| Missing `l0_refs` | DawSync architecture + guides + tech | ~30 docs |
| Categories outside L0 vocab | Expected — valid at L2 (`legal`, `business`, `references`, `tech`) | — |
| Possible slug duplicate | `claude-code-workflow.md` in both DawSync and L0 | 1 |
| DawSyncWeb | Only `legal/README.md` remains — already a reference | ✓ |

## Out of Scope

- Adding `monitor_urls` to business strategy docs (no upstream tech source to monitor)
- Adding `monitor_urls` to legal docs (content is internally authored)
- Changing DawSync category names to match L0 vocabulary (L2-specific categories are intentional)
- Rewriting content of architecture/product docs

## Constraints

- DawSync docs are project-specific — do not generalize them into L0
- `l0_refs` values must match actual L0 slugs (validated by the existing test)
- Hub docs ≤100 lines, sub-docs ≤300 lines (same rules as L0/L1)
