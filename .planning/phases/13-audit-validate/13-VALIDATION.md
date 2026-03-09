---
phase: 13
slug: audit-validate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.0 |
| **Config file** | mcp-server/package.json (scripts.test = "vitest run") |
| **Quick run command** | `cd mcp-server && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd mcp-server && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Verify output files exist and have expected structure
- **After every plan wave:** Verify audit-manifest.json is valid JSON with all 4 project sections
- **Before `/gsd:verify-work`:** Full suite must be green; audit-manifest.json + audit-report.md present with all 4 projects represented
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | AUDIT-01 | manual-only | Manual review of audit-manifest.json WakeTheCave section | N/A | ⬜ pending |
| 13-01-02 | 01 | 1 | AUDIT-02 | manual-only | Manual review of audit-manifest.json DawSync section | N/A | ⬜ pending |
| 13-02-01 | 02 | 1 | AUDIT-03 | manual-only | Manual review of audit-manifest.json shared-kmp-libs section | N/A | ⬜ pending |
| 13-02-02 | 02 | 1 | AUDIT-04 | manual-only | Manual review of audit-manifest.json AndroidCommonDoc section | N/A | ⬜ pending |
| 13-03-01 | 03 | 2 | AUDIT-05 | smoke | `cd mcp-server && node build/cli/monitor-sources.js --tier all --output ../reports/test-report.json` | N/A | ⬜ pending |
| 13-04-01 | 04 | 2 | AUDIT-06 | manual-only | Verify audit-manifest.json + audit-report.md exist and contain required sections | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase produces documentation artifacts (JSON manifest + markdown report), not code. Existing MCP server test infrastructure is already in place. Audit scripts are one-off analysis tools whose correctness is validated by reviewing their output.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WakeTheCave mining produces L0 candidates list | AUDIT-01 | Output is a curated list requiring human judgment on promotion rationale | Review WakeTheCave section in audit-manifest.json; verify each candidate has rationale |
| DawSync files classified as ACTIVE/SUPERSEDED/UNIQUE | AUDIT-02 | Classification requires understanding of document relationships and supersession chains | Review DawSync section; verify every .md file has a classification with links for SUPERSEDED entries |
| shared-kmp-libs module gaps identified | AUDIT-03 | Gap analysis requires understanding module purpose vs documentation completeness | Review shared-kmp-libs section; verify per-module documentation plan |
| AndroidCommonDoc pattern docs reviewed for gaps | AUDIT-04 | Accuracy assessment requires cross-referencing against consolidated corpus | Review AndroidCommonDoc section; verify 8 pattern docs assessed |
| Structured audit report with all sub-deliverables | AUDIT-06 | Final report coherence requires human review of combined findings | Verify audit-report.md contains: consolidation manifest, L0 promotion list, gap inventory, freshness report |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
