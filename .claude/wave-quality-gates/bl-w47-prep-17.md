# Quality Gate Report: BL-W47-prep-17

**Verdict**: FAIL
**Timestamp**: 2026-05-26T19:20:00Z
**Branch**: feature/bl-w47-prep-17
**Wave shape**: doc-only (7 MEDIUM findings — KotlinConf'26 L0 doc audit)
**Commits covered**: C1–C7 (C8 wave-close pending)

---

## Project Rules Discovered

From `.commitlintrc.json` and `docs/guides/project-constraints.md` (via context-provider):
1. Valid commit scopes: `core, data, ui, feature, ci, deps, release, docs, detekt, mcp, skills, scripts, agents, archive, di, guides, tests, tools`
2. **Sub-doc hard limit: ≤300 lines** — at 250+ → plan a split. Never compress, always extract.
3. Doc-only wave: no new docs, all inline updates; no Kotlin/Gradle code changes
4. All 7 findings must have content per kickoff deliverables list

---

## Steps

| Step | Result | Detail |
|------|--------|--------|
| 0.5 Toolchain detect | DONE | PROJECT_TYPE=gradle (settings.gradle.kts present) |
| 1. Rule Discovery | DONE | commitlintrc scopes loaded; sub-doc 300-line hard limit confirmed via context-provider |
| 1.5 Architect Deliberation | SKIPPED | 3/3 architects already APPROVED-VERIFY-FINAL per team-lead dispatch |
| 2. validate-doc-structure (frontmatter) | PASS | All 9 touched docs: VALID, 0 issues each |
| 2.5 Warnings / @Suppress | SKIP | No .kt or .gradle.kts files in diff |
| 2.6 Node verify | SKIP | PROJECT_TYPE=gradle — Node-only step |
| 2.7 Bats suite | SKIP | No script changes in diff |
| 3. Tests | SKIP | Doc-only wave — no Kotlin code |
| 4. Coverage | SKIP | No .kt files in diff |
| 5. KDoc | SKIP | No .kt files in diff |
| 6. Prod Files | PASS | Doc-only wave confirmed: 9 .md files modified, 0 .kt/.gradle.kts files |
| 7. docs/api/ freshness | SKIP | No .kt changes |
| 8. Rule Cross-Check | **FAIL** | `testing-patterns-benchmarks.md` is 319 lines — exceeds 300-line sub-doc hard limit by 19 lines |
| 9. UI Tests | SKIP | No Compose/UI code in diff |
| 9.5 Runtime UI | SKIP | No UI baselines; no Compose diff |
| validate-all (setup-check) | PASS | 5/5 setup checks passed |
| validate-all (script-parity) | WARN (pre-existing) | 39/46 scripts — 7 missing .ps1; NOT introduced by this wave |
| Branch hygiene | PASS | 0 modified tracked files, no merge conflicts |
| Commit count | PASS | 7 commits — matches C1–C7 wave shape |
| Commitlint scopes | PASS | All 7 subjects use valid scopes: docs(docs)×5, docs(ui)×1, docs(tests)×1 |
| Atomicity | PASS | Each commit = one finding cluster |
| 10. Stamp | NOT WRITTEN | FAIL verdict — stamp withheld |

---

## Blocking Issues

| Step | Issue | Required Action |
|------|-------|----------------|
| 8. Rule Cross-Check | `docs/testing/testing-patterns-benchmarks.md` is **319 lines** (hard limit: 300). Breaches sub-doc size constraint from `project-constraints.md`. | doc-updater must extract Section 6 "Re-baseline after Kotlin 2.4 / AGP Bump" (lines 292–319, ~28 lines) into a new sub-doc `docs/testing/testing-patterns-benchmarks-rebaseline.md` and replace with a hub pointer. Then re-run QG. |

---

## Finding Verification Detail (for reference — all content correct, size is the only blocker)

| Finding | File | Deliverable | Content Status |
|---------|------|-------------|---------------|
| F1 — Context params Stable | kmp-features-2026.md | Section in Kotlin 2.4 block | PASS — content correct |
| F1 — Context params coroutine alt | kotlinx-coroutines-reference.md | Section "Context Parameters (Kotlin 2.4)" | PASS — content correct |
| F2 — Stdlib 18-month security policy | gradle-patterns-dependencies.md | Callout after kotlin-stdlib entry | PASS — content correct |
| F3 — Amper footgun | gradle-patterns.md | "Amper Compatibility Note" callout | PASS — content correct |
| F3 — Amper first-consumer warning | getting-started.md | Warning paragraph | PASS — content correct |
| F4 — Swift Export Alpha | kmp-features-2026.md | Row in Kotlin 2.4 section | PASS — content correct |
| F4 — Swift Export forward note | viewmodel-state-management-stateflow.md | "Future Path: Swift Export" note | PASS — content correct |
| F5 — K/N CMS GC default | kmp-features-2026.md | CMS GC section with rollback flag | PASS — content correct |
| F5 — K/N rebaseline alert | testing-patterns-benchmarks.md | Section 6 K/N callout | PASS — content correct; SIZE BREACH |
| F6 — R8 coroutine rewrite | agp9-consumer-rules-banned-directives.md | "R8 2.4 Performance" callout | PASS — content correct |
| F6 — R8 Android rebaseline alert | testing-patterns-benchmarks.md | Section 6 R8 callout | PASS — content correct; SIZE BREACH |
| F7 — klibs.io criteria | gradle-patterns-publishing.md | Section 10 klibs.io checklist | PASS — content correct |

---

## Stash: not used
