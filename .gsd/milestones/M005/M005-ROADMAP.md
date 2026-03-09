# M005: L0-L1-L2 Ecosystem Coherence & Token Optimization

**Vision:** Every layer of the ecosystem dogfoods its own rules — hub docs everywhere, zero .planning/ references, 30-40% token reduction, a working auditor that can validate any layer, and capability detection so agents can use optional tools when available.

## Success Criteria

- `l0-coherence-auditor` agent exists and can audit L0, L1, or L2 by path
- `/audit-l0` skill reports 0 critical violations when run against L0
- 13/13 L0 subdirs have hub docs; 9/9 L1 subdirs have hub docs; 8/8 L2a subdirs have hub docs
- >85% of L0 docs have `monitor_urls` (was 44%)
- >15 L0 docs have `detekt_rules` frontmatter (was 0)
- All `.planning/` references replaced with `.gsd/` in L0 and L2a commands
- `gsd://` MCP resources operational (state, requirements, milestone/{id})
- Measurable token reduction ≥25% in L0 (baseline captured in S01, measured in S06)
- Capability detection implemented in ≥3 agents per layer (Context7/Jina optional)
- MCP server npm test 100% green post-changes
- sync-l0 propagates L0 improvements to L1 and L2a without breaking l2_specific exclusions

## Key Risks / Unknowns

- detekt_rules frontmatter field name — may differ from what the audit problem statement implies; need to verify against actual existing docs before adding >15 new ones
- DawSync architecture subdirs (A-D) already exist — hub may just need updating, not creating from scratch
- L1 guides/guides-index.md might already function as a hub with a non-standard name — verify before creating a duplicate
- MCP server resource pattern — need to understand existing `docs://` implementation before adding `gsd://`

## Proof Strategy

- Hub structure risk → retire in S02 by shipping all L0 hub docs and verifying the auditor can parse and count them
- MCP resources risk → retire in S05 by implementing `gsd://` scheme and confirming it returns valid JSON
- Token measurement validity → retire in S01 by capturing baseline token counts per file as a numeric baseline

## Verification Classes

- Contract verification: npm test in mcp-server (TypeScript compile + Jest), bash assertions on hub doc presence
- Integration verification: sync-l0 run from L1 and L2a after L0 changes propagated
- Operational verification: /audit-l0 skill execution against all 3 layers produces machine-readable report
- UAT / human verification: spot-check 3-5 hub docs for content quality; verify capability detection doesn't break existing agent behavior

## Milestone Definition of Done

This milestone is complete only when all are true:

- `/audit-l0` run against L0 reports 0 critical violations
- All 13 L0 hub docs exist and are ≤100 lines
- All 9 L1 hub docs exist
- All 8 L2a subdirs have hub docs (archive + images added)
- monitor_urls coverage ≥85% in L0
- ≥15 L0 docs have detekt_rules frontmatter entries
- No `.planning/` references remain in L0 or L2a commands
- gsd:// MCP resources return valid responses
- npm test passes 100%
- sync-l0 run from L1 and L2a succeeds without overwriting l2_specific files

## Requirement Coverage

- Covers: MCP server tooling, doc structure, skill capability
- Partially covers: Konsist tests (CI integration deferred), vault sync validation
- Leaves for later: Codex/Cursor adapters, SwiftUI patterns
- Orphan risks: DawSyncWeb CLAUDE.md — trivial, addressed in S07

## Slices

- [x] **S01: Audit Infrastructure & Baseline** `risk:high` `depends:[]`
  > After this: l0-coherence-auditor agent and audit-l0 skill exist; baseline reports for L0, L1, L2a are saved; token count baseline is captured; new frontmatter fields (assumes-read, token-budget, detekt_rules) are validated in MCP server.

- [x] **S02: L0 Hub Docs & Archive Fixes** `risk:medium` `depends:[S01]`
  > After this: All 13 L0 subdirs have hub docs (≤100 lines each); both archive docs split to ≤300 lines; archive metadata fixed; sub-docs have assumes-read frontmatter pointing to their hub; auditor confirms 0 hub-structure violations in L0.

- [x] **S03: L0 Token Optimization** `risk:medium` `depends:[S02]`
  > After this: L0 skills no longer inline full scripts (reference path + usage only); CLAUDE.md deduplicated against docs/; sub-docs have redundant intros removed; token-budget frontmatter added; measurable reduction from S01 baseline ≥25%.

- [x] **S04: L0 Dogfooding — monitor_urls & detekt_rules** `risk:medium` `depends:[S02]`
  > After this: ≥85% L0 docs have monitor_urls; ≥15 L0 docs have detekt_rules frontmatter; .planning/ references replaced with .gsd/ in L0 commands; verify-kmp CI config updated for L0 modules.

- [x] **S05: MCP gsd:// Resources & Capability Detection** `risk:medium` `depends:[S04]`
  > After this: gsd:// MCP resources operational (state, requirements, milestone/{id}); capability detection pattern doc exists in L0; ≥3 L0 agents (test-specialist, cross-platform-validator, l0-coherence-auditor) have optional-capabilities frontmatter; registry.json schema updated; npm test 100% green.

- [x] **S06: L1 Coherence (shared-kmp-libs)** `risk:low` `depends:[S05]`
  > After this: All 9 L1 subdirs have hub docs; L1 docs have assumes-read and token-budget; api-contract-guardian updated with capability detection; sync-l0 run from L1 pulls in all L0 improvements; /audit-l0 against L1 shows 0 critical violations.

- [x] **S07: L2a/L2b Coherence (DawSync + DawSyncWeb)** `risk:low` `depends:[S06]`
  > After this: DawSync archive and images subdirs get hub docs; .planning/ references fixed in all 5 L2a commands; ≥5 L2a agents updated with capability detection; DawSyncWeb evaluated and l0-manifest.json created if warranted; sync-l0 from L2a succeeds; /audit-l0 against L2a shows 0 critical violations.

- [x] **S08: Final Cascade Validation** `risk:low` `depends:[S07]`
  > After this: All three layers pass /audit-l0 with 0 critical violations; token reduction measured and confirmed ≥25% in L0; npm test 100%; sync-l0 propagation verified checksums match; STATE.md and REQUIREMENTS.md updated.

## Boundary Map

### S01 → S02

Produces:
- `l0-coherence-auditor` agent spec (knows how to detect: hub absence, line limits, frontmatter gaps, .planning/ refs, monitor_urls coverage, detekt_rules coverage)
- `audit-l0` skill that runs the auditor against any layer path
- Baseline report JSON for L0, L1, L2a (token counts, violation lists, coverage percentages)
- New frontmatter fields validated: `assumes-read`, `token-budget`, `detekt_rules`
- MCP server `validate-doc-structure` updated to check new fields

Consumes:
- nothing (first slice)

### S01,S02 → S03

Produces:
- Hub docs for all 13 L0 subdirs (authoritative, ≤100 lines)
- Mapping: which sub-docs belong to which hub (needed for assumes-read population)
- Archive docs split (≤300 lines each), metadata fixed

Consumes:
- Auditor baseline from S01 (know what token counts to beat)
- Hub structure definition from S01 (what makes a valid hub doc)

### S02,S03 → S04

Produces:
- Token-optimized L0 doc set (scripts referenced not inlined, intros removed)
- CLAUDE.md rewritten to reference, not duplicate
- token-budget and assumes-read populated in all L0 docs

Consumes:
- Hub docs from S02 (sub-docs need to reference them via assumes-read)

### S02,S04 → S05

Produces:
- monitor_urls in ≥85% of L0 docs
- detekt_rules in ≥15 L0 docs
- .gsd/ paths in all L0 commands
- verify-kmp CI updated

Consumes:
- Hub docs from S02 (hub docs also need monitor_urls)

### S04 → S05

Produces:
- gsd:// MCP resource handlers (state, requirements, milestone/{id})
- capability-detection.md pattern doc
- optional_capabilities field in registry.json schema
- ≥3 L0 agents updated with optional-capabilities

Consumes:
- All L0 docs completed (S02, S03, S04) — MCP changes should reflect final doc state

### S05 → S06

Produces:
- L1 hub docs (9 subdirs)
- L1 docs updated with assumes-read, token-budget
- api-contract-guardian with capability detection
- sync-l0 from L1 verified

Consumes:
- L0 improvements stable (S05 complete) — sync-l0 must pull stable L0

### S06 → S07

Produces:
- L2a archive-hub.md and images-hub.md (or images excluded as non-doc)
- .planning/ → .gsd/ in L2a commands
- L2a agents updated
- DawSyncWeb l0-manifest.json decision made + implemented

Consumes:
- L0 and L1 stable for cascade sync

### S07 → S08

Produces:
- /audit-l0 reports for all three layers (0 critical violations)
- Token reduction measurement (L0 baseline vs final)
- npm test results
- Updated STATE.md, REQUIREMENTS.md

Consumes:
- All previous slices complete
