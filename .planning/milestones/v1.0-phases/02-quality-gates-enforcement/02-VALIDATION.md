---
phase: 2
slug: quality-gates-enforcement
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-13
validated: 2026-03-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | JUnit 5 + detekt-test 2.0.0-alpha.2 (for custom Detekt rules); Agent invocation (for quality gate agents) |
| **Config file** | `detekt-rules/build.gradle.kts` (new module — Wave 0 creates) |
| **Quick run command** | `./gradlew :detekt-rules:test` |
| **Full suite command** | `./gradlew :detekt-rules:test` + manual agent invocation |
| **Estimated runtime** | ~15 seconds (Detekt rule unit tests); agent invocations vary |

---

## Sampling Rate

- **After every task commit:** Run `./gradlew :detekt-rules:test` (for Detekt rule tasks)
- **After every plan wave:** Run `./gradlew :detekt-rules:test` + manual agent spot-checks
- **Before `/gsd:verify-work`:** Full suite must be green + all agent invocations produce expected output format
- **Max feedback latency:** 15 seconds (Detekt tests); agent latency varies

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | LINT-01a | unit | `./gradlew :detekt-rules:test --tests "*SealedUiState*"` | ✅ | ✅ green |
| 02-01-02 | 01 | 1 | LINT-01b | unit | `./gradlew :detekt-rules:test --tests "*CancellationException*"` | ✅ | ✅ green |
| 02-01-03 | 01 | 1 | LINT-01c | unit | `./gradlew :detekt-rules:test --tests "*NoPlatformDeps*"` | ✅ | ✅ green |
| 02-01-04 | 01 | 1 | LINT-01d | unit | `./gradlew :detekt-rules:test --tests "*WhileSubscribed*"` | ✅ | ✅ green |
| 02-01-05 | 01 | 1 | LINT-01e | unit | `./gradlew :detekt-rules:test --tests "*NoChannel*"` | ✅ | ✅ green |
| 02-01-06 | 01 | 1 | LINT-03 | integration | `./gradlew dependencies --configuration detektPlugins \| grep "io.nlopez"` | ✅ | ✅ green |
| 02-02-01 | 02 | 1 | PTRN-03 | smoke | `test -f versions-manifest.json && python3 -c "import json; ..."` | ✅ | ✅ green |
| 02-02-02 | 02 | 1 | PTRN-03 | smoke | `bash scripts/sh/check-doc-freshness.sh` | ✅ | ✅ green |
| 02-03-01 | 03 | 2 | SCRP-03 | smoke | Invoke script-parity-validator agent; verify parity output | ✅ Manual | ✅ manual-verified |
| 02-03-02 | 03 | 2 | QUAL-01 | smoke | Invoke quality-gate-orchestrator; verify unified report format | ✅ Manual | ✅ manual-verified |
| 02-03-03 | 03 | 2 | QUAL-02 | smoke | Invoke template-sync-validator; verify cross-surface checks | ✅ Manual | ✅ manual-verified |
| 02-03-04 | 03 | 2 | QUAL-03 | smoke | Invoke quality-gate-orchestrator; verify token cost section for 18 skills | ✅ Manual | ✅ manual-verified |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `detekt-rules/build.gradle.kts` — Kotlin JVM module with detekt-api 2.0.0-alpha.2 compileOnly + detekt-test testImplementation + JUnit 5
- [x] `detekt-rules/settings.gradle.kts` — standalone module settings (or integrated into project settings)
- [x] 5 rule test files — one per architecture rule, each with positive and negative test cases (26 tests total)
- [x] `versions-manifest.json` — version manifest for freshness tracking (10 library entries)
- [x] `.claude/agents/quality-gate-orchestrator.md` — unified orchestrator agent spec with all 5 sections

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| compose-rules alongside custom rules | LINT-03 | Requires consuming project setup with both `detektPlugins` dependencies | Add both JARs to a test KMP project, run `./gradlew detekt`, verify both rulesets produce findings |
| Freshness tracking flags stale versions | PTRN-03 | Agent invocation; no automated harness | Invoke doc-code-drift-detector agent, verify output contains `[DRIFT]` for known stale version |
| Script parity validation | SCRP-03 | Agent invocation; no automated harness | Invoke script-parity-validator agent, verify no false negatives on known parity |
| Unified quality gate report | QUAL-01 | Agent invocation; output format validation | Invoke quality-gate-orchestrator, verify report contains all 5 sections with pass/fail status |
| Cross-surface drift detection | QUAL-02 | Agent invocation; semantic comparison | Invoke template-sync-validator, verify cross-surface parameter checks included |
| Token cost per skill | QUAL-03 | Agent invocation; data presence check | Invoke quality-gate-orchestrator, verify token cost section lists all 18 skills |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s (measured: ~1s for Detekt tests)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated

---

## Validation Audit 2026-03-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 8 automated tasks verified green. 4 agent-based tasks confirmed as correctly classified Manual-Only with implementation bodies present.
