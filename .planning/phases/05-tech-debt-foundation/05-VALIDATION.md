---
phase: 5
slug: tech-debt-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual validation (shell script changes, no automated test suite for scripts) |
| **Config file** | None -- scripts are tested by execution |
| **Quick run command** | `bash setup/install-copilot-prompts.sh --dry-run --projects TestProject` |
| **Full suite command** | Run quality-gate-orchestrator agent after all changes |
| **Estimated runtime** | ~30 seconds (smoke tests) |

---

## Sampling Rate

- **After every task commit:** Dry-run the affected scripts
- **After every plan wave:** Run quality-gate-orchestrator to verify no regressions
- **Before `/gsd:verify-work`:** Full quality gate green + manual env var guard smoke tests
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | DEBT-01 | manual+smoke | `unset ANDROID_COMMON_DOC && bash setup/setup-toolkit.sh --project-root /tmp/test 2>&1 \| head -5` | N/A -- behavioral | pending |
| 05-01-02 | 01 | 1 | DEBT-01 | manual+smoke | `ANDROID_COMMON_DOC=/nonexistent bash setup/setup-toolkit.sh --project-root /tmp/test 2>&1 \| head -5` | N/A -- behavioral | pending |
| 05-02-01 | 01 | 1 | DEBT-02 | manual+smoke | `bash setup/install-copilot-prompts.sh --dry-run --projects TestProject 2>&1 \| grep copilot-instructions` | N/A -- behavioral | pending |
| 05-02-02 | 02 | 1 | DEBT-03 | manual | Invoke orchestrator agent, then invoke each individual agent separately, compare findings | N/A -- agent behavior | pending |
| 05-02-03 | 02 | 1 | DEBT-04 | smoke | `ls scripts/sh/validate-phase01-* 2>&1` (should show "No such file") | N/A -- deletion | pending |
| 05-02-04 | 02 | 1 | DEBT-04 | smoke | `grep -r "validate-phase01" --include="*.sh" --include="*.ps1" --include="*.md" . \| grep -v ".planning/"` | N/A -- reference check | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase modifies existing scripts and agent files. No test framework setup needed. Validation is behavioral (smoke tests) and via the existing quality gate agents.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Orchestrator produces identical results to individual agents | DEBT-03 | Agent behavior cannot be automated in a test suite | 1. Run quality-gate-orchestrator 2. Run each individual agent 3. Compare findings |
| install-copilot-prompts.sh standalone delivery in consuming project | DEBT-02 | Requires real consuming project directory | 1. cd to consuming project 2. Run install-copilot-prompts.sh 3. Verify copilot-instructions-generated.md exists |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
