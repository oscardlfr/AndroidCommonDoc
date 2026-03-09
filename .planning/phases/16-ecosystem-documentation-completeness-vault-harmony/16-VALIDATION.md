---
phase: 16
slug: ecosystem-documentation-completeness-vault-harmony
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (latest) |
| **Config file** | mcp-server/vitest.config.ts |
| **Quick run command** | `cd mcp-server && npx vitest run` |
| **Full suite command** | `cd mcp-server && npx vitest run` |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-server && npx vitest run`
- **After every plan wave:** Run `cd mcp-server && npx vitest run` + validate-doc-structure across all 3 projects
- **Before `/gsd:verify-work`:** Full suite must be green + vault-status healthy
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-xx | 01 | 1 | P16-README | manual | validate-doc-structure on shared-kmp-libs | N/A | ⬜ pending |
| 16-02-xx | 02 | 1 | P16-UPGRADE | manual | validate-doc-structure on shared-kmp-libs | N/A | ⬜ pending |
| 16-03-xx | 03 | 1 | P16-VALIDATE | unit | `cd mcp-server && npx vitest run tests/unit/tools/validate-doc-structure.test.ts` | ✅ extend | ⬜ pending |
| 16-04-xx | 04 | 2 | P16-CATEGORY | manual | validate-doc-structure on DawSync | N/A | ⬜ pending |
| 16-05-xx | 05 | 2 | P16-SUBPROJ | manual | validate-doc-structure on DawSync subprojects | N/A | ⬜ pending |
| 16-06-xx | 06 | 3 | P16-VAULT | unit | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts` | ✅ extend | ⬜ pending |
| 16-06-xx | 06 | 3 | P16-VAULT | unit | `cd mcp-server && npx vitest run tests/unit/vault/moc-generator.test.ts` | ✅ extend | ⬜ pending |
| 16-06-xx | 06 | 3 | P16-VAULT | integration | `cd mcp-server && npx vitest run tests/integration/vault-sync.test.ts` | ✅ extend | ⬜ pending |
| 16-07-xx | 07 | 3 | P16-CATALOG | manual | Review module-catalog.md links | N/A | ⬜ pending |
| 16-08-xx | 08 | 4 | P16-HUMAN | manual-only | Human opens Obsidian vault | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. Tests will be extended in existing files, not created from scratch.*

- 567 MCP tests already passing
- validate-doc-structure tool operational
- Vault sync pipeline operational
- All quality gates pass

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Module READMEs contain accurate API surfaces from source code | P16-README | Source code accuracy requires human review of Kotlin APIs | Spot-check 5+ module READMEs against their Kotlin source files |
| DawSync category alignment correct | P16-CATEGORY | Category semantic correctness requires human judgment | Run validate-doc-structure, review reclassified files |
| Obsidian graph view navigation works | P16-HUMAN | Visual/UX verification in Obsidian app | Open vault, navigate graph, verify MOC links, check wikilinks |
| Subproject documentation adequate | P16-SUBPROJ | Adequacy judgment for DawSyncWeb/SessionRecorder-VST3 | Review generated/upgraded docs for completeness |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
