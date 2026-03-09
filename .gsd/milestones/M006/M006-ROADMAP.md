# M006 Roadmap — L2 Full Audit & Harmonization

## Slices

- [ ] **S01: Baseline Audit** `risk:low` `depends:[]`
  Run `l0-coherence-auditor` against DawSync and capture baseline JSON. Identify exact violation counts, which docs need `l0_refs`, which need `monitor_urls`, and whether any hub `## Sub-documents` tables are stale.

- [ ] **S02: Hub Consistency** `risk:low` `depends:[S01]`
  Verify each hub's `## Sub-documents` table matches the actual files in the directory. Fix any stale entries (added or removed docs not reflected in hub). Fix `category: index` and `category: images` outliers.

- [ ] **S03: l0_refs on Tech/Architecture Docs** `risk:medium` `depends:[S02]`
  Add `l0_refs:` frontmatter to all DawSync architecture, guides, and tech docs that build on L0 patterns. Values must resolve to valid L0 slugs. Skip business/legal/product docs — they have no L0 counterpart.

- [ ] **S04: monitor_urls on Tech Docs** `risk:low` `depends:[S03]`
  Add `monitor_urls:` to DawSync architecture, guides, and tech docs that reference versioned dependencies (KMP, Compose, Ktor, Room, etc.). Skip business/product/legal docs — content is internally authored.

- [ ] **S05: claude-code-workflow Deduplication** `risk:low` `depends:[S04]`
  Resolve the `claude-code-workflow.md` duplication between DawSync and L0. DawSync version should either reference L0's or contain only DawSync-specific workflow additions (not re-explain L0 patterns).

- [ ] **S06: DawSync Agent Capability Declaration** `risk:low` `depends:[S05]`
  Audit DawSync `.claude/agents/` for agents that use optional tools without declaring `optional_capabilities`. Add declarations following the L0 pattern from `capability-detection.md`.

- [ ] **S07: Final Validation** `risk:low` `depends:[S06]`
  Re-run `l0-coherence-auditor` against DawSync. Confirm: 0 critical violations, `l0_refs` coverage ≥80% on tech/architecture docs, `monitor_urls` coverage ≥70% on tech docs, all hub tables consistent. npm test 100% green.

## Success Criteria

- `l0-coherence-auditor` on DawSync: 0 critical violations
- `l0_refs` on ≥80% of architecture/guides/tech docs
- `monitor_urls` on ≥70% of architecture/guides/tech docs
- All hub `## Sub-documents` tables match filesystem
- No content duplication between DawSync and L0 (reference pattern in place)
- DawSyncWeb: only `legal/README.md` — no orphan docs
- npm test 100% green throughout

## Risks

- `l0_refs` slug validation — adding wrong slugs will break the test. Must verify against actual L0 slug list.
- Business/legal docs intentionally have no `monitor_urls` — audit script must not flag these as violations.
- Hub table staleness may require adding/removing entries — read each hub before editing.

## Notes

- DawSync category vocabulary (`legal`, `business`, `references`, `tech`) is valid at L2 — do not remap to L0 categories.
- `monitor_urls` tier convention: 1=critical upstream, 2=important reference, 3=informational.
- The `l0-coherence-auditor` Check 5 counts all docs for `monitor_urls` — we'll need to interpret results knowing business/legal are excluded by design.
