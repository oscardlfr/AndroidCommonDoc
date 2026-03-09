---
phase: 14
slug: doc-structure-consolidation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (for MCP TypeScript) + manual verification scripts |
| **Config file** | `mcp-server/tsconfig.json` (TypeScript compilation) |
| **Quick run command** | `cd mcp-server && npm run build && npm test` |
| **Full suite command** | `cd mcp-server && npm run build && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Verify line counts on modified docs (`wc -l`), verify frontmatter validity
- **After every plan wave:** Run `cd mcp-server && npm run build && npm test` if types/scanner modified
- **Before `/gsd:verify-work`:** Full quality gate via `validate-all` MCP tool, vault sync clean mode
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | STRUCT-01 | manual + smoke | Grep all docs for required frontmatter fields | N/A — template is a document | ⬜ pending |
| 14-02-01 | 02 | 1 | STRUCT-02 | smoke | `wc -l docs/*.md` + grep for frontmatter fields | N/A — Wave 0 script | ⬜ pending |
| 14-03-01 | 03 | 2 | STRUCT-03 | manual | Diff DawSync file count against manifest expectations | N/A — verification script | ⬜ pending |
| 14-04-01 | 04 | 2 | STRUCT-04 | smoke | `ls .agents/skills/ .claude/agents/ .claude/commands/` | N/A — Wave 0 script | ⬜ pending |
| 14-05-01 | 05 | 3 | STRUCT-05 | smoke | Count README.md files, verify frontmatter | N/A — Wave 0 script | ⬜ pending |
| 14-06-01 | 06 | 4 | STRUCT-06 | integration | `npx tsx mcp-server/src/tools/sync-vault.ts` | Existing tool | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Verification script to count docs per line-limit threshold (150/300/500)
- [ ] Verification script to check all docs have required frontmatter fields
- [ ] Verification script to validate zero content loss (compare manifest actions vs actual file state)
- [ ] MCP server build must pass after `PatternMetadata` type extension

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Template structure quality | STRUCT-01 | Subjective quality — section ordering, clarity | Review template doc against 5/5 exemplars |
| Zero content loss in DawSync consolidation | STRUCT-03 | Section-level comparison needed | Diff each archived/promoted file against target |
| shared-kmp-libs API doc accuracy | STRUCT-05 | Requires domain knowledge | Verify documented APIs match actual Kotlin source |
| Vault navigation coherence | STRUCT-06 | UX quality check | Browse vault in Obsidian, verify link graph |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
