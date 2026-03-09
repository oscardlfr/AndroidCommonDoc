---
phase: 3
slug: distribution-adoption
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-13
updated: 2026-03-13
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash script tests (functional) + Gradle plugin verification |
| **Config file** | None |
| **Quick run command** | `bash scripts/sh/validate-phase03-build-logic.sh && bash scripts/sh/validate-phase03-hooks.sh && bash scripts/sh/validate-phase03-copilot.sh && bash scripts/sh/validate-phase03-setup.sh` |
| **Full suite command** | Same as quick run + `cd build-logic && ./gradlew assemble` (Gradle only, requires daemon) |
| **Estimated runtime** | < 5 seconds (bash scripts only) |

---

## Sampling Rate

- **After every task commit:** Run `bash scripts/sh/validate-phase03-build-logic.sh`
- **After every plan wave:** Run all four phase03 validate scripts
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** < 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | LINT-02 | setup | `bash scripts/sh/validate-phase03-build-logic.sh` | ✅ | ✅ green |
| 03-01-02 | 01 | 1 | LINT-02 | smoke | `cd build-logic && ./gradlew assemble` (plugin compiles) — manual/Gradle | n/a | manual-only |
| 03-01-03 | 01 | 1 | LINT-02 | functional | Apply plugin, set `detektRules.set(false)`, verify opt-out — requires consuming project | n/a | manual-only |
| 03-02-01 | 02 | 1 | TOOL-03 | functional | `bash scripts/sh/validate-phase03-hooks.sh` | ✅ | ✅ green |
| 03-02-02 | 02 | 1 | TOOL-03 | functional | `bash scripts/sh/validate-phase03-hooks.sh` | ✅ | ✅ green |
| 03-02-03 | 02 | 1 | TOOL-03 | unit | `bash scripts/sh/validate-phase03-hooks.sh` | ✅ | ✅ green |
| 03-03-01 | 03 | 2 | TOOL-03 | functional | `bash scripts/sh/validate-phase03-copilot.sh` | ✅ | ✅ green |
| 03-04-01 | 04 | 2 | LINT-02 | smoke | `bash scripts/sh/validate-phase03-setup.sh` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `build-logic/build.gradle.kts` — convention plugin project setup
- [x] `build-logic/settings.gradle.kts` — build-logic settings
- [x] `.claude/hooks/detekt-post-write.sh` — post-write hook script
- [x] `.claude/hooks/detekt-pre-commit.sh` — pre-commit hook script
- [x] Test scripts for hook JSON input (mock PostToolUse/PreToolUse payloads)
- [x] Setup script syntax and help validation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Convention plugin compiles with `./gradlew assemble` | LINT-02 | Requires Gradle daemon | `cd build-logic && ./gradlew assemble` with ANDROID_COMMON_DOC set |
| Plugin opt-out runtime behavior (`detektRules.set(false)`) | LINT-02 | Requires consuming project | Apply plugin in test project, set opt-out, verify Detekt skips |
| testConfig opt-out runtime behavior (`testConfig.set(false)`) | LINT-02 | Requires consuming project with Gradle build | Set opt-out, run `./gradlew test`, verify maxParallelForks not forced |
| Hook fires in live Claude Code session | TOOL-03 | Requires Claude Code runtime | 1. Apply hook settings 2. Open Claude Code in test project 3. Write a .kt file 4. Verify hook output in verbose mode |
| Copilot instructions visible in Copilot | TOOL-03 | Requires GitHub Copilot | 1. Push copilot-instructions.md 2. Open file in VS Code with Copilot 3. Ask Copilot about patterns 4. Verify it references the instructions |

---

## Nyquist Audit — Test Scripts Created

| Script | Tasks Covered | Type | Status |
|--------|---------------|------|--------|
| `scripts/sh/validate-phase03-build-logic.sh` | 03-01-01 | integration (setup) | ✅ green |
| `scripts/sh/validate-phase03-hooks.sh` | 03-02-01, 03-02-02, 03-02-03 | smoke + unit | ✅ green |
| `scripts/sh/validate-phase03-copilot.sh` | 03-03-01 | functional | ✅ green |
| `scripts/sh/validate-phase03-setup.sh` | 03-04-01 | smoke | ✅ green |

---

## Validation Sign-Off

- [x] All tasks have automated verify or documented manual-only rationale
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s (bash scripts)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete (2026-03-13, Nyquist audit)
