---
phase: 12
slug: ecosystem-vault-expansion
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-14
updated: 2026-03-14
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.0.0 |
| **Config file** | `mcp-server/vitest.config.ts` |
| **Quick run command** | `cd mcp-server && npx vitest run tests/unit/vault/` |
| **Full suite command** | `cd mcp-server && npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-server && npx vitest run tests/unit/vault/`
- **After every plan wave:** Run `cd mcp-server && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-00-01 | 00 | 0 | ALL | scaffold | `cd mcp-server && npx vitest run tests/unit/vault/ --reporter=verbose` | Creates W0 stubs | ⬜ pending |
| 12-00-02 | 00 | 0 | ALL | scaffold | `cd mcp-server && npx vitest run tests/integration/vault-sync.test.ts --reporter=verbose` | Creates W0 stub | ⬜ pending |
| 12-01-01 | 01 | 1 | ECOV-01 | audit | `test -f .planning/phases/12-ecosystem-vault-expansion/12-DOC-AUDIT.md` | N/A | ⬜ pending |
| 12-01-02 | 01 | 1 | ALL | requirements | `grep -c "ECOV-0[1-7]" .planning/REQUIREMENTS.md` | N/A | ⬜ pending |
| 12-02-01 | 02 | 1 | ECOV-05 | compile | `cd mcp-server && npx tsc --noEmit src/vault/types.ts` | ✅ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | ECOV-07 | compile+stub | `cd mcp-server && npx tsc --noEmit src/vault/config.ts && npx vitest run tests/unit/vault/config.test.ts --reporter=verbose` | ✅ W0 | ⬜ pending |
| 12-03-01 | 03 | 2 | ECOV-04,07 | compile+stub | `cd mcp-server && npx tsc --noEmit src/vault/glob-expander.ts src/vault/sub-project-detector.ts && npx vitest run tests/unit/vault/glob-expander.test.ts tests/unit/vault/sub-project-detector.test.ts --reporter=verbose` | ✅ W0 | ⬜ pending |
| 12-03-02 | 03 | 2 | ECOV-01,02,03 | compile+stub | `cd mcp-server && npx tsc --noEmit src/vault/collector.ts && npx vitest run tests/unit/vault/collector.test.ts --reporter=verbose` | ✅ W0 | ⬜ pending |
| 12-03-03 | 03 | 2 | ECOV-07 | compile | `cd mcp-server && npx tsc --noEmit src/vault/version-catalog-parser.ts` | N/A | ⬜ pending |
| 12-04-01 | 04 | 2 | ECOV-05 | compile+stub | `cd mcp-server && npx tsc --noEmit src/vault/transformer.ts && npx vitest run tests/unit/vault/transformer.test.ts --reporter=verbose` | ✅ W0 | ⬜ pending |
| 12-04-02 | 04 | 2 | ECOV-02,05 | compile+stub | `cd mcp-server && npx tsc --noEmit src/vault/tag-generator.ts src/vault/wikilink-generator.ts src/vault/vault-writer.ts && npx vitest run tests/unit/vault/tag-generator.test.ts tests/unit/vault/wikilink-generator.test.ts tests/unit/vault/vault-writer.test.ts --reporter=verbose` | ✅ W0 | ⬜ pending |
| 12-05-01 | 05 | 3 | ECOV-06 | compile+stub | `cd mcp-server && npx tsc --noEmit src/vault/moc-generator.ts && npx vitest run tests/unit/vault/moc-generator.test.ts --reporter=verbose` | ✅ W0 | ⬜ pending |
| 12-05-02 | 05 | 3 | ECOV-05 | compile | `cd mcp-server && npx tsc --noEmit src/vault/sync-engine.ts` | N/A | ⬜ pending |
| 12-06-01 | 06 | 4 | ECOV-06 | compile | `cd mcp-server && npx tsc --noEmit src/tools/sync-vault.ts src/tools/vault-status.ts` | N/A | ⬜ pending |
| 12-06-02 | 06 | 4 | ECOV-06 | compile | `cd mcp-server && npx tsc --noEmit src/tools/find-pattern.ts` | N/A | ⬜ pending |
| 12-07-01 | 07 | 5 | ALL | unit | `cd mcp-server && npx vitest run tests/unit/vault/` | ✅ Full | ⬜ pending |
| 12-07-02 | 07 | 5 | ALL | integration | `cd mcp-server && npx vitest run` | ✅ Full | ⬜ pending |
| 12-07-03 | 07 | 5 | ECOV-05,06 | manual | Obsidian visual verification | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Plan 12-00 creates all 10 test stub files before any implementation begins:

- [ ] `tests/unit/vault/collector.test.ts` — stub with .todo() for layer-aware collection (ECOV-01, ECOV-02, ECOV-03, ECOV-07)
- [ ] `tests/unit/vault/config.test.ts` — stub with .todo() for ProjectConfig schema
- [ ] `tests/unit/vault/transformer.test.ts` — stub with .todo() for layer-first paths
- [ ] `tests/unit/vault/moc-generator.test.ts` — stub with .todo() for ecosystem MOCs + Home.md (ECOV-06)
- [ ] `tests/unit/vault/vault-writer.test.ts` — stub with .todo() for new directory structure (ECOV-05)
- [ ] `tests/unit/vault/tag-generator.test.ts` — stub with .todo() for new tag types
- [ ] `tests/unit/vault/wikilink-generator.test.ts` — stub with .todo() for layer-qualified slugs
- [ ] `tests/unit/vault/sub-project-detector.test.ts` — NEW stub test file (ECOV-04)
- [ ] `tests/unit/vault/glob-expander.test.ts` — NEW stub test file (ECOV-07)
- [ ] `tests/integration/vault-sync.test.ts` — stub with .todo() for layer-first e2e (ECOV-05)

Plan 12-07 replaces all stubs with full test implementations.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Obsidian renders L0/L1/L2 hierarchy correctly | ECOV-05 | Visual vault rendering | Open vault in Obsidian, verify folder tree shows L0/L1/L2 top-level |
| MOC wikilinks navigate to correct pages | ECOV-06 | Obsidian wikilink resolution | Click links in Home.md and MOC pages, verify they open correct docs |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 12-00)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (set, pending execution)

**Approval:** pending execution
