---
milestone: M005
title: L0-L1-L2 Ecosystem Coherence & Token Optimization
status: complete
completed: "2026-03"
---

## What Was Built

M005 brought coherence across all three layers of the AndroidCommonDoc ecosystem (L0, L1/shared-kmp-libs, L2a/DawSync) and extended the MCP server with project state resources.

### S01 — Audit Infrastructure
- `l0-coherence-auditor` agent with 7 structural checks
- `audit-l0` skill for multi-layer auditing
- Baseline JSON files in `.gsd/audits/`
- `PatternMetadata` schema extended: `assumes_read`, `token_budget`, `optional_capabilities`, `rules`

### S02 — L0 Hub Docs
- 13/13 L0 subdirs with hub docs (≤100 lines each)
- `enterprise-integration-proposal.md` archived
- Archive metadata fixed

### S03 — L0 Token Optimization
- `assumes_read` + `token_budget` frontmatter on all 55 sub-docs

### S04 — L0 Dogfooding
- `monitor_urls` on 99% of L0 docs (69/70), 98% of L1 (41/42)
- `rules:` frontmatter on 63/70 L0 docs (91%) — all 5 hand-written Detekt rules linked + documented rules for 11 categories
- Zero `.planning/` refs in L0 and L2a commands

### S05 — MCP gsd:// Resources
- `gsd://state`, `gsd://requirements`, `gsd://decisions` static resources
- `gsd://milestone/{id}` and `gsd://milestone/{id}/summary` dynamic resources per discovered milestone
- `capability-detection.md` pattern doc in L0 guides
- 3 L0 agents with `optional_capabilities`: `l0-coherence-auditor` (mcp-gsd, jina), `test-specialist` (context7, mcp-monitor), `cross-platform-validator` (context7, jina)
- 8 new tests in `tests/unit/resources/gsd.test.ts`

### S06 — L1 Coherence
- 8/8 L1 subdirs with hub docs: security, oauth, storage, domain, firebase, foundation, io, guides

### S07 — L2a/L2b Coherence
- 9/9 DawSync subdirs with hub docs (including archive and images)
- `images-hub.md` and `archive-hub.md` created
- DawSyncWeb legal docs consolidated: DawSync is now the single source of truth for legal docs covering all platforms (web, Android, desktop); DawSyncWeb `docs/legal/` replaced by README with reference

### S08 — Final Cascade Validation
- npm test: 629/629 green
- All success criteria met

## Success Criteria — Final Status

| Criterion | Status |
|-----------|--------|
| l0-coherence-auditor agent exists | ✓ |
| /audit-l0 skill exists | ✓ |
| 13/13 L0 hub docs ≤100 lines | ✓ |
| 8/8 L1 hub docs | ✓ |
| 9/9 L2a hub docs | ✓ |
| >85% L0 monitor_urls (was 44%) | ✓ 99% |
| >15 L0 detekt_rules docs (was 0) | ✓ 63 docs |
| Zero .planning/ refs L0 + L2a | ✓ |
| gsd:// MCP resources operational | ✓ |
| Capability detection ≥3 agents | ✓ 3 agents |
| npm test 100% green | ✓ 629/629 |
| DawSyncWeb legal consolidated | ✓ |

## Key Decisions

- Hub docs named `{category}-hub.md`, content ≤100 lines, with `## Sub-documents` section
- Sub-docs inherit hub's `monitor_urls` category — own monitoring inherits upstream category URL
- `rules:` frontmatter links Detekt rules to the doc that documents the pattern; `hand_written: true` for existing `.kt` rules
- `optional_capabilities` uses lowercase slugs: `context7`, `jina`, `mcp-gsd`, `mcp-monitor`, `bash`
- DawSync is the canonical source for cross-platform legal docs; DawSyncWeb is a publisher, not an owner
