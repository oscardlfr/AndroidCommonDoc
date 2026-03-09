---
phase: 4
slug: audit-tech-debt-cleanup
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-13
gaps_filled: 2026-03-13
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash shell scripts (file content verification) |
| **Config file** | None -- script is standalone executable |
| **Quick run command** | `bash scripts/sh/validate-phase04-integration.sh` |
| **Full suite command** | `bash scripts/sh/validate-phase04-integration.sh` |
| **Estimated runtime** | < 2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bash scripts/sh/validate-phase04-integration.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** < 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | INT-01 through INT-04 (gap closure) | integration | `bash scripts/sh/validate-phase04-integration.sh` | Yes | green |
| 04-01-02 | 01 | 1 | admin/metadata (ROADMAP + SUMMARY completeness) | smoke | `bash scripts/sh/validate-phase04-integration.sh` | Yes | green |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [x] `validate-phase04-integration.sh` -- single script covering all 6 SCs + LINK checks

---

## Nyquist Audit — Test Scripts Created

| Script | Tasks Covered | Type | Checks | Status |
|--------|---------------|------|--------|--------|
| `scripts/sh/validate-phase04-integration.sh` | 04-01-01, 04-01-02 | integration + smoke | 22 checks (SC-1 through SC-6 + LINK verifications) | green |

---

## Success Criteria Coverage

| SC | Criterion | Checks in Script | Status |
|----|-----------|-----------------|--------|
| SC-1 | settings.json has PostToolUse and PreToolUse hook entries | hooks section present, PostToolUse entry, PreToolUse entry | green |
| SC-2 | template-sync-validator Step 4 references copilot-instructions-generated.md | grep for generated filename, operative read instruction | green |
| SC-3 | install-copilot-prompts.sh has no HAS_COPILOT_INSTRUCTIONS and no copilot-instructions.md handling | bash -n syntax, variable absent, install block absent | green |
| SC-4 | gradle-patterns.md says "Compose Gradle Plugin 1.10.0" | correct label present, stale label absent | green |
| LINK | settings.json references both hook script paths | detekt-post-write.sh reference, detekt-pre-commit.sh reference | green |
| LINK | Both hook scripts exist at .claude/hooks/ | file existence for both hooks | green |
| SC-5 | ROADMAP.md Plan 03-04 checkbox is checked | [x] 03-04-PLAN grep | green |
| SC-6 | All 12 SUMMARY files have requirements-completed field | find count = 12, grep-l count = 12 | green |

---

## Manual-Only Verifications

None. All success criteria are mechanically verifiable with file content checks.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands
- [x] Sampling continuity: both tasks covered by single script
- [x] Wave 0 script present and green
- [x] No watch-mode flags
- [x] Feedback latency < 2s (bash file checks only)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** gaps-filled (2026-03-13, gsd-nyquist-auditor)
