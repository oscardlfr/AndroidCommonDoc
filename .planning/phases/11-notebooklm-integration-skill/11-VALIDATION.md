---
phase: 11
slug: notebooklm-integration-skill
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.0.0 |
| **Config file** | `mcp-server/vitest.config.ts` (existing) |
| **Quick run command** | `cd mcp-server && npx vitest run tests/unit/vault/` |
| **Full suite command** | `cd mcp-server && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-server && npx vitest run tests/unit/vault/`
- **After every plan wave:** Run `cd mcp-server && npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | VAULT-01 | unit | `npx vitest run tests/unit/vault/collector.test.ts -t "pattern docs"` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | VAULT-02 | unit | `npx vitest run tests/unit/vault/collector.test.ts -t "skills"` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | VAULT-03 | unit | `npx vitest run tests/unit/vault/collector.test.ts -t "projects"` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | VAULT-04 | unit | `npx vitest run tests/unit/vault/transformer.test.ts` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | VAULT-05 | unit | `npx vitest run tests/unit/vault/wikilink-generator.test.ts` | ❌ W0 | ⬜ pending |
| 11-02-03 | 02 | 1 | VAULT-06 | unit | `npx vitest run tests/unit/vault/moc-generator.test.ts` | ❌ W0 | ⬜ pending |
| 11-02-04 | 02 | 1 | VAULT-07 | unit | `npx vitest run tests/unit/vault/tag-generator.test.ts` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 1 | VAULT-08 | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 1 | VAULT-09 | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts -t "obsidian config"` | ❌ W0 | ⬜ pending |
| 11-03-03 | 03 | 1 | VAULT-13 | unit | `npx vitest run tests/unit/vault/config.test.ts` | ❌ W0 | ⬜ pending |
| 11-03-04 | 03 | 1 | VAULT-14 | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts -t "manifest"` | ❌ W0 | ⬜ pending |
| 11-03-05 | 03 | 1 | VAULT-15 | unit | `npx vitest run tests/unit/vault/vault-writer.test.ts -t "orphan"` | ❌ W0 | ⬜ pending |
| 11-04-01 | 04 | 2 | VAULT-10 | unit | `npx vitest run tests/unit/tools/sync-vault.test.ts` | ❌ W0 | ⬜ pending |
| 11-04-02 | 04 | 2 | VAULT-11 | unit | `npx vitest run tests/unit/tools/vault-status.test.ts` | ❌ W0 | ⬜ pending |
| 11-05-01 | 05 | 2 | VAULT-12 | integration | `npx vitest run tests/integration/vault-sync.test.ts` | ❌ W0 | ⬜ pending |
| 11-05-02 | 05 | 2 | VAULT-17 | integration | `npx vitest run tests/integration/vault-sync.test.ts -t "any directory"` | ❌ W0 | ⬜ pending |
| 11-05-03 | 05 | 2 | VAULT-16 | manual-only | Manual review of SKILL.md format | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/vault/collector.test.ts` — stubs for VAULT-01, VAULT-02, VAULT-03
- [ ] `tests/unit/vault/transformer.test.ts` — stubs for VAULT-04
- [ ] `tests/unit/vault/wikilink-generator.test.ts` — stubs for VAULT-05
- [ ] `tests/unit/vault/moc-generator.test.ts` — stubs for VAULT-06
- [ ] `tests/unit/vault/tag-generator.test.ts` — stubs for VAULT-07
- [ ] `tests/unit/vault/vault-writer.test.ts` — stubs for VAULT-08, VAULT-09, VAULT-14, VAULT-15
- [ ] `tests/unit/vault/config.test.ts` — stubs for VAULT-13
- [ ] `tests/unit/tools/sync-vault.test.ts` — stubs for VAULT-10
- [ ] `tests/unit/tools/vault-status.test.ts` — stubs for VAULT-11
- [ ] `tests/integration/vault-sync.test.ts` — stubs for VAULT-12, VAULT-17
- [ ] Framework install: none needed (Vitest already configured)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Skill SKILL.md follows established pattern | VAULT-16 | Format/content review requires human judgment | Compare against existing SKILL.md files in skills/ directory |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
