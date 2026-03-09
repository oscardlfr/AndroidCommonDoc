---
id: S01
parent: M005
milestone: M005
provides:
  - l0-coherence-auditor agent (.claude/agents/)
  - audit-l0 skill (skills/audit-l0/SKILL.md)
  - PatternMetadata extended with assumes_read, token_budget, optional_capabilities
  - Baseline reports for L0, L1, L2a in .gsd/audits/
requires: []
affects:
  - mcp-server/src/registry/types.ts
key_files:
  - .claude/agents/l0-coherence-auditor.md
  - skills/audit-l0/SKILL.md
  - mcp-server/src/registry/types.ts
  - .gsd/audits/baseline-L0.json
  - .gsd/audits/baseline-L1.json
  - .gsd/audits/baseline-L2a.json
key_decisions:
  - Hub doc archive subdirectory excluded from line-limit violations (archive docs may be oversized intentionally)
  - Severity: critical=hub missing + .planning/ refs; warning=line limit + frontmatter gaps; info=monitor_urls missing
patterns_established:
  - Auditor agent is read-only (Read/Grep/Glob only) and outputs structured JSON
  - Skill delegates to agent, never re-implements check logic inline
observability_surfaces:
  - .gsd/audits/baseline-*.json — numeric baselines for token reduction measurement in S06
  - .gsd/audits/audit-*.json — per-run audit reports saved by the skill
duration: ~45m
verification_result: passed
completed_at: 2026-03-17
blocker_discovered: false
---

# S01: Audit Infrastructure & Baseline

**l0-coherence-auditor agent, audit-l0 skill, PatternMetadata extension, and numeric baselines for L0/L1/L2a — all verification checks pass, 621 MCP tests green.**

## What Happened

Created the audit infrastructure needed for M005's compliance tracking:

**T01 — l0-coherence-auditor agent:** Read-only agent (tools: Read, Grep, Glob) with 7 check categories: hub doc presence per subdir, doc line limits (hub ≤100, sub-doc ≤300), frontmatter completeness (9 fields), `.planning/` detection in command files, `monitor_urls` coverage, archive metadata validity, and `detekt_rules` coverage (L0 only). Output is structured JSON with violation severity classification (critical/warning/info).

**T02 — audit-l0 skill:** Delegates to l0-coherence-auditor by name. Accepts `target` and `layer` parameters with sensible defaults. Saves reports to `{target_root}/.gsd/audits/audit-{YYYY-MM-DD}.json` and prints a human-readable PASS/FAIL summary.

**T03 — types.ts extension:** Added `assumes_read?: string`, `token_budget?: number`, and `optional_capabilities?: string[]` to `PatternMetadata`. TypeScript compiles clean (`tsc --noEmit` exits 0).

**T04 — Baseline reports:** Captured numeric baselines for all three layers:

| Metric | L0 | L1 | L2a |
|--------|----|----|-----|
| Hub docs | 0/13 (0%) | 0/9 (0%) | 7/9 (78%) |
| monitor_urls | 26/56 (46%) | 0/33 (0%) | 0/150 (0%) |
| detekt_rules | 4/56 (7%) | — | — |
| .planning/ refs | 3 files | 1 file | 5 files |
| Total chars | 247,503 | 159,265 | 877,486 |
| Est. tokens | ~61,876 | ~39,816 | ~219,372 |

**T05 — npm test:** 621/621 tests passing after types.ts changes.

## Baseline Details

**L0 .planning/ refs** (3 violations in `.claude/commands/`):
- `doc-check.md`, `merge-track.md`, `sync-roadmap.md`

**L1 .planning/ refs** (1 violation):
- TBD (grep hit in shared-kmp-libs/.claude/commands/)

**L2a .planning/ refs** (5 violations in `.claude/commands/`):
- doc-check.md, merge-track.md, roadmap.md, start-track.md, sync-roadmap.md

## Self-Check: PASSED

- `.claude/agents/l0-coherence-auditor.md` — FOUND, tools: Read, Grep, Glob
- `skills/audit-l0/SKILL.md` — FOUND, references l0-coherence-auditor
- `mcp-server/src/registry/types.ts` — FOUND, assumes_read + token_budget + optional_capabilities present
- `.gsd/audits/baseline-L0.json` — FOUND, valid JSON with hub_docs + estimated_tokens
- `.gsd/audits/baseline-L1.json` — FOUND, valid JSON
- `.gsd/audits/baseline-L2a.json` — FOUND, valid JSON
- `cd mcp-server && npm test` — 621/621 PASS
