---
phase: 18
slug: gsd-v1-to-gsd-2-migration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-16
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification (migration integrity checks, CLI validation) |
| **Config file** | none — GSD-2 generates .gsd/ structure |
| **Quick run command** | `cd <project> && gsd doctor` |
| **Full suite command** | `gsd doctor && gsd status` per project |
| **Estimated runtime** | ~30 seconds per project |

---

## Sampling Rate

- **After every task commit:** Run `gsd doctor` in migrated project
- **After every plan wave:** Run `gsd doctor && gsd status` across all migrated projects
- **Before `/gsd:verify-work`:** All 4 projects pass `gsd doctor`
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-T1 | 01 | 1 | GSD2-INSTALL | cli | `gsd --version` | N/A | pending |
| 18-01-T2 | 01 | 1 | GSD2-MIGRATE-L0 | cli | `cd <L0> && gsd doctor` | N/A | pending |
| 18-01-T3 | 01 | 1 | GSD2-MIGRATE-L1 | cli | `cd <L1> && gsd doctor` | N/A | pending |
| 18-02-T1 | 02 | 2 | GSD2-MIGRATE-L2 | cli | `cd <DawSync> && gsd doctor` | N/A | pending |
| 18-02-T3 | 02 | 2 | GSD2-MIGRATE-L2 | cli | `cd <DawSyncWeb> && gsd doctor` | N/A | pending |
| 18-03-T1 | 03 | 3 | GSD2-CONFIG, GSD2-VALIDATE | cli | `gsd doctor` across all 4 projects | N/A | pending |
| 18-03-T2 | 03 | 3 | GSD2-CLEANUP | cli+grep | `grep -r '.planning/' CLAUDE.md` returns empty | N/A | pending |
| 18-04-T1 | 04 | 4 | GSD2-VERIFY | cli | `cd <DawSync> && gsd status` | N/A | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] `npm install -g gsd-pi` — GSD-2 CLI installed globally
- [ ] `gsd config` — initial setup wizard completed (LLM provider configured)

*Existing infrastructure covers remaining requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DawSync track mapping | GSD2-MIGRATE-L2 | Parallel tracks have no direct GSD-2 equivalent | Verify each track maps to a milestone/slice correctly |
| Migration completeness | GSD2-VALIDATE | Need to compare .planning/ vs .gsd/ side-by-side | Diff phase count, completion state, plan count |
| Track-E continuation | GSD2-VERIFY | Need to run actual GSD-2 step on DawSync | Execute `/gsd next` and verify plan 06 starts correctly |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
