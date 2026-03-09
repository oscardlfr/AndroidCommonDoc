---
phase: 15
slug: claude-md-ecosystem-alignment
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (via project npm config) |
| **Config file** | `mcp-server/vitest.config.ts` |
| **Quick run command** | `cd mcp-server && npx vitest run tests/unit/tools/validate-claude-md.test.ts` |
| **Full suite command** | `cd mcp-server && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-server && npx vitest run tests/unit/tools/validate-claude-md.test.ts`
- **After every plan wave:** Run `cd mcp-server && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | CLAUDE-01 | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts -t "canonical"` | Wave 0 | pending |
| 15-01-02 | 01 | 1 | CLAUDE-02 | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts -t "template"` | Wave 0 | pending |
| 15-02-01 | 02 | 1 | CLAUDE-06 | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts -t "delegation"` | Wave 0 | pending |
| 15-03-01 | 03 | 2 | CLAUDE-03 | integration | `npx vitest run tests/integration/claude-md-validation.test.ts -t "L0"` | Wave 0 | pending |
| 15-03-02 | 03 | 2 | CLAUDE-04 | integration | `npx vitest run tests/integration/claude-md-validation.test.ts -t "L1"` | Wave 0 | pending |
| 15-03-03 | 03 | 2 | CLAUDE-05 | integration | `npx vitest run tests/integration/claude-md-validation.test.ts -t "L2"` | Wave 0 | pending |
| 15-04-01 | 04 | 3 | CLAUDE-07 | manual-only | Checklist-based verification against canonical rule inventory | N/A | pending |
| 15-04-02 | 04 | 3 | CLAUDE-08 | unit | `npx vitest run tests/unit/tools/validate-claude-md.test.ts` | Wave 0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `mcp-server/tests/unit/tools/validate-claude-md.test.ts` -- stubs for CLAUDE-01, CLAUDE-02, CLAUDE-06, CLAUDE-08
- [ ] `mcp-server/tests/integration/claude-md-validation.test.ts` -- stubs for CLAUDE-03, CLAUDE-04, CLAUDE-05
- [ ] `mcp-server/src/tools/validate-claude-md.ts` -- the tool itself (source, not test)

*Existing Vitest infrastructure covers framework installation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Smoke test: behavioral rules preserved after rewrite | CLAUDE-07 | Requires human judgment to verify AI agent follows rules correctly | Run checklist against canonical rule inventory; verify each rule category produces expected behavior in ViewModel, UseCase, and test generation scenarios |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
