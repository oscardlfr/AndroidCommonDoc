---
phase: 1
slug: stabilize-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-12
gaps_filled: 2026-03-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash shell scripts + quality gate agents (`.claude/agents/*.md`) |
| **Config file** | None -- scripts are standalone executables |
| **Quick run command** | `bash scripts/sh/validate-phase01-pattern-docs.sh` |
| **Full suite command** | `for s in scripts/sh/validate-phase01-*.sh; do bash "$s"; done` |
| **Estimated runtime** | ~5 seconds per script, ~25 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run relevant quality gate agent for the task's domain
- **After every plan wave:** Run all 4 quality gate agents
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | PTRN-01 | smoke | `bash scripts/sh/validate-phase01-pattern-docs.sh` | Yes | green |
| 01-01-02 | 01 | 1 | PTRN-02 | smoke | `bash scripts/sh/check-doc-freshness.sh` | Yes | green |
| 01-02-01 | 02 | 1 | SCRP-01 | smoke | `bash scripts/sh/validate-phase01-param-drift.sh` | Yes | green |
| 01-02-02 | 02 | 1 | SCRP-02 | smoke | `bash scripts/sh/validate-phase01-param-manifest.sh` | Yes | green |
| 01-03-01 | 03 | 2 | TOOL-01 | smoke | `bash scripts/sh/validate-phase01-skill-pipeline.sh` | Yes | green |
| 01-03-02 | 03 | 2 | TOOL-02 | smoke | `bash scripts/sh/validate-phase01-agents-md.sh` | Yes | green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `skills/params.json` -- parameter manifest (SCRP-02) -- COMPLETE
- [x] `AGENTS.md` -- universal AI tool entry point (TOOL-02) -- COMPLETE
- [x] `skills/test/SKILL.md` -- first canonical skill definition (TOOL-01) -- COMPLETE (all 16 exist)
- [x] Quality gate scripts created for all 5 gaps -- COMPLETE

*All Wave 0 scaffolding present. Validation scripts verify ongoing compliance.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pattern doc code samples compile | PTRN-02 | Requires Kotlin compiler | Copy samples from viewmodel-state-patterns.md + testing-patterns.md into a KMP project and compile |
| Adapter idempotency on live system | TOOL-01 | Path resolution varies on Windows | Run `bash adapters/generate-all.sh` twice, then `git diff` -- expect no changes |
| AGENTS.md guidance quality | TOOL-02 | Token efficiency requires judgment | Open AGENTS.md as fresh AI context; attempt to write a ViewModel with sealed UiState |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (scripts run in ~5s each)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** gaps-filled (2026-03-13, gsd-nyquist-auditor)
