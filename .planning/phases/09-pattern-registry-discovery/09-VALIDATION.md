---
phase: 9
slug: pattern-registry-discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.0 |
| **Config file** | mcp-server/vitest.config.ts |
| **Quick run command** | `cd mcp-server && npm test` |
| **Full suite command** | `cd mcp-server && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd mcp-server && npm test`
- **After every plan wave:** Run `cd mcp-server && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | Frontmatter parser + Scanner | unit | `cd mcp-server && npx vitest run tests/unit/registry/frontmatter.test.ts tests/unit/registry/scanner.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | Frontmatter on 9 docs | smoke | Scanner discovers at least 9 docs from docs/ | N/A | ⬜ pending |
| 09-02-01 | 02 | 2 | Freshness audit | smoke | Stale-version grep check (no Kotlin 1.x, Ktor 2.x, AGP 7.x/8.x refs) | N/A | ⬜ pending |
| 09-02-02 | 02 | 2 | Doc splitting | smoke | All 12 sub-docs exist with frontmatter | N/A | ⬜ pending |
| 09-03-01 | 03 | 2 | Resolver | unit | `cd mcp-server && npx vitest run tests/unit/registry/resolver.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-02 | 03 | 2 | Project Discovery | unit | `cd mcp-server && npx vitest run tests/unit/registry/project-discovery.test.ts` | ❌ W0 | ⬜ pending |
| 09-04-01 | 04 | 3 | docs.ts evolution | unit | `cd mcp-server && npx vitest run tests/unit/resources/docs.test.ts` | ✅ update | ⬜ pending |
| 09-04-02 | 04 | 3 | find-pattern tool | unit | `cd mcp-server && npx vitest run tests/unit/tools/find-pattern.test.ts` | ❌ W0 | ⬜ pending |
| 09-05-01 | 05 | 4 | End-to-end registry | integration | `cd mcp-server && npx vitest run tests/integration/` | ❌ new | ⬜ pending |
| 09-06-01 | 06 | 2 | DawSync migration | smoke | DawSync/.androidcommondoc/docs/ exists with L1 patterns | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/registry/frontmatter.test.ts` — parse valid frontmatter, handle missing/invalid/BOM cases
- [ ] `tests/unit/registry/scanner.test.ts` — scan directory, skip files without frontmatter
- [ ] `tests/unit/registry/resolver.test.ts` — L0/L1/L2 resolution priority, full replacement semantics
- [ ] `tests/unit/registry/project-discovery.test.ts` — parse settings.gradle.kts, fallback to projects.yaml
- [ ] `tests/unit/tools/find-pattern.test.ts` — query matching, project filter, excludes
- [ ] `yaml` package installation: `cd mcp-server && npm install yaml`

*Existing infrastructure covers integration tests (update existing docs.test.ts).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Doc freshness | Doc audit | Requires comparing against external official sources | Run check-doc-freshness tool on each doc, verify versions match current releases |
| DawSync migration | L1 setup | Requires cross-repo file operations | Verify DawSync/.androidcommondoc/docs/ created with correct L1 patterns |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
