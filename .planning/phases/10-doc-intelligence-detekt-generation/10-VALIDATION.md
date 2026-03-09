---
phase: 10
slug: doc-intelligence-detekt-generation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest ^3.0.0 |
| **Framework (Kotlin)** | JUnit Jupiter 5.11.4 + detekt-test 2.0.0-alpha.2 |
| **Config file (TS)** | `mcp-server/vitest.config.ts` (exists) |
| **Config file (Kotlin)** | `detekt-rules/build.gradle.kts` (exists, JUnit Platform configured) |
| **Quick run (TS)** | `cd mcp-server && npm test` |
| **Quick run (Kotlin)** | `.\gradlew :detekt-rules:test` |
| **Full suite** | `cd mcp-server && npm test && cd .. && .\gradlew :detekt-rules:test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** `cd mcp-server && npm test` or `.\gradlew :detekt-rules:test` (whichever is relevant)
- **After every plan wave:** Full suite: `cd mcp-server && npm test && cd .. && .\gradlew :detekt-rules:test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/registry/scanner.test.ts` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/monitoring/` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/monitoring/review-state.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/generation/` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | TBD | unit\integration | `.\gradlew :detekt-rules:test` | ✅ | ⬜ pending |
| 10-03-01 | 03 | 2 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/tools/monitor-sources.test.ts` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 2 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/tools/generate-detekt-rules.test.ts` | ❌ W0 | ⬜ pending |
| 10-03-03 | 03 | 2 | TBD | unit | `cd mcp-server && npx vitest run tests/unit/tools/ingest-content.test.ts` | ❌ W0 | ⬜ pending |
| 10-04-01 | 04 | 3 | TBD | smoke | `yamllint .github/workflows/doc-monitor.yml` | ❌ W0 | ⬜ pending |
| 10-04-02 | 04 | 3 | TBD | integration | `cd mcp-server && npm test && .\gradlew :detekt-rules:test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `mcp-server/tests/unit/monitoring/` directory — monitoring test infrastructure
- [ ] `mcp-server/tests/unit/generation/` directory — generation test infrastructure
- [ ] `mcp-server/tests/unit/tools/monitor-sources.test.ts` — monitoring tool tests
- [ ] `mcp-server/tests/unit/tools/generate-detekt-rules.test.ts` — generation tool tests
- [ ] `mcp-server/tests/unit/tools/ingest-content.test.ts` — ingestion tool tests
- [ ] `mcp-server/src/monitoring/` directory — monitoring source modules
- [ ] `mcp-server/src/generation/` directory — generation source modules
- [ ] `detekt-rules/src/main/kotlin/.../rules/generated/` directory — generated rules output
- [ ] `detekt-rules/src/test/kotlin/.../rules/generated/` directory — generated rule tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI cron schedule fires correctly | TBD | GitHub Actions scheduling requires live environment | Verify via Actions tab after merge to main |
| Content paste UX (paste content when URL unfetchable) | TBD | Requires interactive user session | Use MCP tool, provide pasted content, verify routing to correct docs |
| Consumer project L1 rule generation | TBD | Requires consumer project setup | Set up test consumer, add L1 rules: frontmatter, run generation tool |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
