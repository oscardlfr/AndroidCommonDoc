# Phase 13: Audit & Validate -- Executive Summary

**Generated:** 2026-03-14
**Scope:** AndroidCommonDoc (L0) + shared-kmp-libs (L1) + DawSync (L2) + WakeTheCave (L2, read-only)

## Overview

| Metric | Value |
|--------|-------|
| Total files audited | 472 |
| Files by layer | L0: 23, L1: 17, L2: 432 |
| Files by classification | ACTIVE: 219, SUPERSEDED: 116, UNIQUE: 137 |
| Average AI-readiness score | 3.63/5.0 |
| L0 promotion candidates | 48 |
| L2>L1 override candidates | 3 |
| Stale version references | 8 |

### AI-Readiness by Project

| Project | Files | AI-Readiness Avg | Layer |
|---------|-------|-------------------|-------|
| AndroidCommonDoc | 23 | 4.3/5.0 | L0 |
| shared-kmp-libs | 17 | 2.6/5.0 | L1 |
| DawSync | 223 | 3.93/5.0 | L2 |
| WakeTheCave | 209 | 3.69/5.0 | L2 (read-only) |

## L0 Promotion Candidates

48 files across 2 projects identified for L0 promotion. WakeTheCave: 0 candidates (all contain project-specific context; generic patterns already covered at L0). shared-kmp-libs: 1 partial candidate.

### DawSync L0 Candidates (47 files)

| Category | Count | Source | Target | Rationale |
|----------|-------|--------|--------|-----------|
| Web quality skills | 8 | `.agents/skills/` (accessibility, best-practices, core-web-vitals, performance, seo, web-quality-audit) | AndroidCommonDoc `.agents/skills/` | Fully generic Lighthouse-based audit skills with no DawSync-specific content |
| Generic agents | 6 | `.claude/agents/` (beta-readiness, cross-platform-validator, doc-alignment, release-guardian, test-specialist, ui-specialist) | AndroidCommonDoc `.claude/agents/` | Universal agent patterns (pre-release validation, cross-platform parity, doc drift detection). DawSync-specific refs can be parameterized |
| Generic commands | 32 | `.claude/commands/` (test, coverage, build, deploy, sbom, sync-versions, etc.) | AndroidCommonDoc `.claude/commands/` | Generic command patterns applicable to any KMP project. Could be templated with parameterization for project-specific paths |
| Workflow doc | 1 | `docs/CLAUDE_CODE_WORKFLOW.md` | AndroidCommonDoc `docs/` | Claude Code workflow documentation. Mix of generic AI workflow patterns and DawSync-specific skill references. Workflow pattern itself is L0-promotable |

**Priority:** High for skills (8) and agents (6) -- these are production-ready generic patterns. Medium for commands (32) -- need parameterization work. Low for workflow doc (1) -- partial extraction needed.

### shared-kmp-libs L0 Candidate (1 partial)

| Source | Target | Rationale | Priority |
|--------|--------|-----------|----------|
| `docs/API_EXPOSURE_PATTERN.md` | Extract generic rule into `docs/gradle-patterns.md` | The `api()` vs `implementation()` transitive dependency rule is generic Gradle/KMP wisdom. However, doc contains too many shared-kmp-libs specific module examples. Partial extraction recommended. | Medium |

## L2>L1 Override Candidates

3 DawSync files identified where project-specific patterns should override shared-kmp-libs defaults:

| DawSync File | shared-kmp-libs Target | Override Changes | Rationale |
|-------------|----------------------|-----------------|-----------|
| `docs/architecture/PATTERNS.md` | `offline-first-patterns` | DawSync-specific offline-first patterns: processing modes (file vs session), backoff strategies, producer/consumer sync | Contains L2-specific offline-first implementation that is more detailed than generic L0 for DawSync context |
| `docs/guides/TESTING.md` | `testing-patterns` | DawSync-specific testing conventions: test data factories, integration test patterns, DAW-specific mock setup | Contains DawSync-specific testing overrides not applicable generically |
| `.androidcommondoc/docs/dawsync-domain-patterns.md` | General domain patterns | Producer/consumer model, DAW guardian pattern, freemium tier logic, session recording patterns | L1 override doc for DawSync-specific domain patterns. Properly placed in `.androidcommondoc/` |

## DawSync Consolidation Manifest Summary

| Category | Count | Action |
|----------|-------|--------|
| Active docs | 97 | Keep |
| Superseded (archive) | 12 | Consolidate/remove in Phase 14 |
| Unique domain docs | 114 | Keep as L2 |
| Promotion candidates | 47 | Promote to L0/L1 |

### Key Consolidation Recommendations (Phase 14)

1. **Promote 8 web-quality skills to L0**: These Lighthouse-based audit skills are fully generic and production-ready. Copy to AndroidCommonDoc `.agents/skills/` with no modifications needed.

2. **Promote 6 generic agents to L0**: Beta-readiness, cross-platform-validator, doc-alignment, release-guardian, test-specialist, and ui-specialist agents. Requires parameterization to replace DawSync-specific file references with template variables.

3. **Template 32 generic commands for L0**: Commands like test, coverage, build, deploy patterns are applicable to any KMP project. Design a command template system with project-specific variables (`${PROJECT_ROOT}`, `${GRADLE_CMD}`, etc.).

4. **Archive 12 superseded docs**: These files have been replaced by newer versions or consolidated into other documents. Safe to remove in Phase 14.

5. **Preserve 21 unique archive docs**: Within `docs/archive/`, 21 files contain irreplaceable business/domain context (architecture plans, design decisions, competitive analysis). Keep as historical reference.

6. **Resolve DawSync CLAUDE.md size**: At 232 lines, exceeds the 150-line target by 55%. Extract wave/track info to separate doc, add L0/L1 delegation via `@import`, consolidate module structure with README.

7. **Fix internal Kotlin version inconsistency**: CLAUDE.md says 2.3.10, but TECHNOLOGY_CHEATSHEET, README, and APPLE_SETUP say 2.3.0. Resolve to correct version.

8. **Establish L2>L1 override convention**: The 3 identified override candidates need a formal mechanism (e.g., `.androidcommondoc/overrides/` directory) for Phase 14.

9. **Consolidate 62 architecture diagrams**: `docs/architecture/diagrams/` contains 62 diagram files. Assess which are current vs historical and consolidate.

10. **Review 38 overlapping docs**: 38 active DawSync docs overlap with AndroidCommonDoc L0 patterns. Verify they add project-specific value beyond what L0 provides, or consolidate.

## shared-kmp-libs Documentation Gaps

| Category | Modules | With README | Without README | Priority |
|----------|---------|-------------|----------------|----------|
| Foundation | 5 | 5 | 0 | High (add convention tables) |
| I/O & Network | 9 | 7 | 2 | High (core-io-kotlinxio, core-io-watcher) |
| Storage | 10 | 1 | 9 | Medium-High (decision guide needed) |
| Security & Auth | 7 | 0 | 7 | High (security-critical, undocumented) |
| Error Mappers | 9 | 0 | 9 | Low (group template) |
| Domain-Specific | 8 | 0 | 8 | Medium (billing-api is high) |
| Others | 4 | 1 | 3 | Low-Medium |

**Total:** 52 modules, 14 with README (26.9%), 38 without README (73.1%)

### Per-Category Documentation Plan

**Security & Auth (CRITICAL -- highest priority):**
- `core-encryption` (27 kt files): Document algorithms, key derivation, platform crypto providers
- `core-security-keys` (8 kt files): Document key management, platform key stores, rotation
- `core-auth-biometric` (13 kt files): Document supported modalities, platform APIs, fallback strategies
- `core-oauth-api` (20 kt files): Document token management, refresh flow, provider configuration
- `core-oauth-browser` (17 kt files): Document redirect handling, PKCE, custom tabs
- `core-oauth-native` (14 kt files): Document platform sign-in (Google, Apple)
- `core-oauth-1a` (8 kt files): Document legacy OAuth 1.0a support

**Storage (decision guide + individual docs):**
- Write a storage decision tree document: when to use MMKV vs DataStore vs Settings vs SQL vs secure storage
- Document: core-storage-datastore, core-storage-mmkv, core-storage-secure, core-storage-sql, core-storage-sql-cipher (medium priority)
- Thin modules (cache, credential, encryption, settings) can use group-level template

**Error Mappers (group template -- 1 template + 9 instantiations):**
- All 9 modules follow identical `ExceptionMapper` pattern from core-error
- Single template covers: overview, source exception, mapping table, DI usage, tests
- Per-module entries list the source exception class and mapping rules

**Domain-Specific:**
- `core-billing-api` (21 kt files): High priority -- substantial API surface
- `core-gdpr` (14 kt files), `core-subscription` (7 kt files): Medium priority
- `core-audit`, `core-backend-api`: Medium priority
- Firebase modules: Low priority (native has 0% coverage, may be inactive)

## AndroidCommonDoc Pattern Doc Health

| Doc | AI-Readiness | Has monitor_urls | Lines | Completeness Gaps | Accuracy Issues |
|-----|-------------|-----------------|-------|-------------------|-----------------|
| compose-resources-patterns | 5/5 | No | 95 | 0 | 0 |
| compose-resources-configuration | 4/5 | No | 276 | 0 | 0 |
| compose-resources-troubleshooting | 5/5 | No | 204 | 0 | 0 |
| compose-resources-usage | 4/5 | No | 208 | 0 | 0 |
| enterprise-integration-proposal | 3/5 | No | 337 | 2 (proposal not pattern, duplicate) | 0 |
| propuesta-integracion-enterprise | 3/5 | No | 341 | 2 (Spanish duplicate) | 0 |
| error-handling-patterns | 5/5 | Yes | 441 | 1 (exceeds line limit) | 0 |
| gradle-patterns | 5/5 | Yes | 398 | 1 (exceeds line limit) | 0 |
| kmp-architecture | 5/5 | Yes | 341 | 1 (exceeds line limit) | 0 |
| offline-first-patterns | 5/5 | No | 94 | 0 | 0 |
| offline-first-architecture | 4/5 | No | 330 | 1 (missing KMP DB patterns) | 1 (Room ref misleading for KMP) |
| offline-first-sync | 4/5 | No | 286 | 0 | 0 |
| offline-first-caching | 4/5 | No | 170 | 0 | 0 |
| resource-management-patterns | 3/5 | No | 462 | 2 (exceeds limit, niche focus) | 0 |
| testing-patterns | 5/5 | Yes | 105 | 0 | 0 |
| testing-patterns-coroutines | 4/5 | No | 497 | 1 (exceeds limit) | 0 |
| testing-patterns-fakes | 5/5 | No | 145 | 0 | 0 |
| testing-patterns-coverage | 5/5 | No | 127 | 0 | 0 |
| ui-screen-patterns | 3/5 | No | 651 | 2 (extreme length, missing Nav3) | 0 |
| viewmodel-state-patterns | 5/5 | Yes | 162 | 0 | 0 |
| viewmodel-state-management | 4/5 | No | 273 | 0 | 0 |
| viewmodel-events | 5/5 | No | 166 | 0 | 0 |
| viewmodel-navigation | 4/5 | No | 89 | 3 (missing Nav3, SwiftUI, short) | 0 |

**Key stats:** 5 docs have `monitor_urls` (error-handling, gradle, kmp-architecture, testing, viewmodel-state). 18 docs need `monitor_urls` added. 7 docs exceed the 300-line guideline and need splitting into hub+sub-doc format.

### Coverage Gap Candidates

Topics that should have L0 pattern docs but currently do not:

| Topic | Priority | Evidence |
|-------|----------|---------|
| Navigation3 patterns (`androidx.navigation3`) | High | CLAUDE.md references Navigation3 with `@Serializable` routes. WakeTheCave has extensive navigation docs. `viewmodel-navigation.md` is only 89 lines missing Navigation3 specifics |
| Dependency injection patterns (Koin 4.1.1) | High | CLAUDE.md mandates Koin with `koinViewModel()`, module declarations in `di/` package. No dedicated L0 doc covers DI patterns |
| Security patterns (encryption, key management, biometric) | Medium | shared-kmp-libs has 7 security/auth modules. No L0 pattern doc covers security architecture or biometric patterns |
| Data layer patterns (Repository, DataSource, DAO) | Medium | CLAUDE.md defines Repository impls and DataSources. No dedicated L0 doc beyond offline-first |
| Build configuration for consuming projects | Medium | Composite build setup, `dependencySubstitution`, version catalog sharing used by DawSync and WakeTheCave. `gradle-patterns.md` covers library perspective only |
| Firebase/backend integration patterns | Low | shared-kmp-libs has firebase-api, firebase-rest, firebase-native. No L0 doc covers KMP Firebase integration |
| Billing and subscription patterns | Low | shared-kmp-libs has billing-api and subscription modules (28 kt files). No L0 doc covers in-app purchases |

### Docs Needing Structural Attention (Phase 14)

| Doc | Issue | Recommended Action |
|-----|-------|--------------------|
| `ui-screen-patterns.md` (651 lines) | Urgently exceeds limit | Split into hub + sub-docs (screen structure, navigation integration, component patterns) |
| `testing-patterns-coroutines.md` (497 lines) | Exceeds limit | Split scheduler testing into own sub-doc |
| `resource-management-patterns.md` (462 lines) | Exceeds limit, niche focus | Reframe as general lifecycle/memory management or split |
| `error-handling-patterns.md` (441 lines) | Exceeds limit | Convert to hub + sub-docs pattern |
| `gradle-patterns.md` (398 lines) | Exceeds limit | Convert to hub + sub-docs pattern |
| `kmp-architecture.md` (341 lines) | Exceeds limit | Convert to hub + sub-docs pattern |
| `enterprise-integration-proposal.md` + `propuesta-integracion-enterprise.md` | Duplicate (EN/ES) | Consolidate to one language version, archive the other |

## Freshness Report

### monitor-sources Results

monitor-sources was executed against the 5 AndroidCommonDoc pattern docs that have `monitor_urls` configured. 8 upstream sources were checked.

| Result | Count |
|--------|-------|
| Sources checked | 8 |
| Errors | 2 (Maven Central HTML response instead of JSON) |
| Findings (total) | 5 |
| HIGH severity | 0 |
| MEDIUM severity | 5 |
| LOW severity | 0 |

**Findings:**

| Slug | Source | Finding | Severity |
|------|--------|---------|----------|
| error-handling-patterns | kotlinx.coroutines/releases | Version drift: coroutines latest is 1.10.2 (correct in docs) -- tool mis-mapped to kotlin key | MEDIUM |
| testing-patterns | kotlinx.coroutines/releases | Version drift: coroutines latest is 1.10.2 (correct in docs) -- tool mis-mapped to kotlin key | MEDIUM |
| testing-patterns | kotlinx-kover/releases | Version drift: kover 0.9.1 -> 0.9.7 (manifest stale) | MEDIUM |
| testing-patterns | kotlinx-kover/releases | Tool reported 0.9.7 as kotlin drift -- mapping error | MEDIUM |
| viewmodel-state-patterns | kotlinx.coroutines/releases | Version drift: coroutines latest is 1.10.2 (correct in docs) -- tool mis-mapped to kotlin key | MEDIUM |

**Note:** 3 of 5 findings are false positives from the monitor-sources tool mapping kotlinx-coroutines release versions to the `kotlin` manifest key. The genuine finding is kover: upstream is 0.9.7 while `versions-manifest.json` lists 0.9.1. The tool's version-to-technology mapping needs improvement.

### Version Reference Freshness

| Severity | Count | Examples |
|----------|-------|---------|
| HIGH | 7 | kotlin: found 2.3.0 in DawSync (README, APPLE_SETUP, TECHNOLOGY_CHEATSHEET), current is 2.3.10; compose-multiplatform: found 1.10.0 in DawSync CLAUDE.md, manifest says 1.7.x; kotlin: found 1.7.20 in DawSync ANDROID_2026.md (very stale) |
| MEDIUM | 1 | kover: found 0.9.4 in DawSync CLAUDE.md, manifest says 0.9.1 |
| LOW | 0 | -- |

**Total:** 16 version references found across all projects. 8 current (50%), 8 stale (50%).

All 8 stale references are in DawSync. No stale references found in WakeTheCave (no prose version refs detected), shared-kmp-libs (kover 0.9.4 marked as not stale since manifest itself may be outdated), or AndroidCommonDoc (coroutines 1.10.2 is current).

### Cross-Project Version Inconsistencies

| Technology | Manifest Version | Versions Found | Projects Affected | Severity |
|-----------|-----------------|----------------|-------------------|----------|
| kotlin | 2.3.10 | 2.3.10, 2.3.0, 1.7.20 | DawSync (2.3.0 in 4 files, 1.7.20 in 1 file), shared-kmp-libs (2.3.10) | HIGH |

**DawSync internal inconsistency:** CLAUDE.md correctly states kotlin 2.3.10, but README.md, APPLE_SETUP.md, TECHNOLOGY_CHEATSHEET.md, and ANDROID_2026.md still reference 2.3.0 or older. This is a documentation drift issue, not a build configuration issue.

### versions-manifest.json Staleness

The `versions-manifest.json` file itself shows signs of staleness:

| Technology | Manifest Value | Evidence of Newer Version | Source |
|-----------|---------------|---------------------------|--------|
| kover | 0.9.1 | 0.9.4 used by shared-kmp-libs and DawSync; upstream at 0.9.7 | DawSync CLAUDE.md, shared-kmp-libs TESTING_STRATEGY.md, kotlinx-kover/releases |
| compose-multiplatform | 1.7.x | 1.10.0 referenced in DawSync CLAUDE.md (may be compose-gradle-plugin confusion) | DawSync CLAUDE.md |

**Recommendation:** Update `versions-manifest.json` to reflect actual versions used in the ecosystem (kover 0.9.4 or 0.9.7, clarify compose-multiplatform vs compose-gradle-plugin distinction). This should happen before Phase 14 template design.

## CLAUDE.md Assessment Summary (Phase 15 Input)

| Project | Lines | AI-Readiness | Key Gaps |
|---------|-------|-------------|----------|
| DawSync | 232 | 3/5 | No YAML frontmatter; exceeds 150-line budget by 55%; missing L0/L1 delegation references; stale coverage data (2026-02-27); missing skills/commands inventory; internal Kotlin version inconsistency (2.3.10 vs 2.3.0); module structure duplicates README |
| shared-kmp-libs | 57 | 4/5 | No YAML frontmatter; module catalog incomplete (omits Domain-specific, Firebase, Others categories); no L0 cross-references to AndroidCommonDoc patterns; no mention of .claude/agents or commands tooling; test coverage claims inaccurate; missing version catalog location and platform support matrix |
| AndroidCommonDoc | N/A | N/A | Not assessed (L0 root project; CLAUDE.md located at `~/.claude/CLAUDE.md` rather than project root) |

### Phase 15 Rewrite Notes

**DawSync CLAUDE.md:**
1. Add YAML frontmatter with scope/layer metadata
2. Extract wave/track info to separate doc
3. Add L0/L1 delegation via `@import` directives
4. Consolidate module structure section with README
5. Add `.agents/skills` and `.claude/commands` inventory
6. Fix version references (compose-multiplatform, kotlin internal inconsistency)
7. Compress coverage data (reference auto-generated report instead of inline table)
8. Target: under 150 lines with delegation

**shared-kmp-libs CLAUDE.md:**
1. Add YAML frontmatter with scope/layer metadata
2. Complete module catalog covering all 52 modules (currently omits Domain-specific, Firebase, Others)
3. Add L0 `@import` references for generic patterns (testing, error handling, KMP architecture)
4. Add `.claude/agents` and `.claude/commands` inventory
5. Fix coverage claims to match actual state (core-logging 99.1%, core-network-api 98.9%)
6. Add version catalog reference (`libs.versions.toml`)
7. Add context delegation: "For generic KMP patterns, see AndroidCommonDoc L0 patterns"
8. Keep under 150 lines -- use category grouping with doc_plan links

## Recommendations for Phase 14

1. **Split 5 oversized L0 docs into hub+sub-doc format** -- `ui-screen-patterns.md` (651 lines), `testing-patterns-coroutines.md` (497 lines), `resource-management-patterns.md` (462 lines), `error-handling-patterns.md` (441 lines), `gradle-patterns.md` (398 lines). Follow the established hub pattern from `testing-patterns.md` and `viewmodel-state-patterns.md`.

2. **Consolidate enterprise integration proposals** -- Archive `propuesta-integracion-enterprise.md` (Spanish duplicate), keep English version. Both are 337-341 lines of business proposal content that is not an actionable coding pattern.

3. **Create standard doc template** -- Define a template with mandatory sections (frontmatter, rules, examples, platform notes, anti-patterns) informed by the 5/5 AI-readiness docs that serve as models: `testing-patterns.md`, `viewmodel-state-patterns.md`, `compose-resources-patterns.md`.

4. **Write shared-kmp-libs module docs (priority order)** -- Security & Auth modules first (7 modules, all undocumented, security-critical), then Storage decision guide + individual docs (10 modules, 9 undocumented), then Domain-Specific (billing-api is high priority). Use error mapper group template for 9 error mapper modules.

5. **Promote 8 DawSync web-quality skills to L0** -- These are production-ready generic patterns requiring zero modification. Copy directly to AndroidCommonDoc.

6. **Add `monitor_urls` to 18 L0 docs** -- Currently only 5 of 23 docs have upstream monitoring configured. The AndroidCommonDoc audit identified suggested URLs for each doc.

7. **Design L0 pattern docs for 2 high-priority coverage gaps** -- Navigation3 patterns and DI/Koin patterns are referenced in CLAUDE.md but have no dedicated L0 coverage. Medium-priority gaps (security, data layer, consumer builds) can follow.

8. **Update `versions-manifest.json`** -- Correct kover from 0.9.1 to actual version (0.9.4 or 0.9.7), clarify compose-multiplatform vs compose-gradle-plugin versioning.

9. **Archive 12 superseded DawSync docs** -- Safe removal; content has been superseded by newer documents.

10. **Re-sync vault after consolidation** -- Run `sync-vault` after all structural changes to update the Obsidian vault with the new hierarchy.

## Recommendations for Phase 15

1. **Extract canonical rule checklist first** -- Before any rewrite, inventory every behavioral rule across all CLAUDE.md files. The audit found: DawSync has 232 lines of rules, shared-kmp-libs has 57 lines, root has project-wide rules in `~/.claude/CLAUDE.md`. No rule should be lost in the rewrite.

2. **Design CLAUDE.md template with `@import` delegation** -- L2 (DawSync) imports L1 (shared-kmp-libs) which imports L0 (AndroidCommonDoc). Each file adds only project-specific rules; generic rules live at L0.

3. **Fix DawSync CLAUDE.md size** -- Compress from 232 to under 150 lines by: extracting wave/track info, replacing inline coverage table with doc reference, adding L0/L1 delegation imports, removing README-duplicate module structure.

4. **Complete shared-kmp-libs CLAUDE.md module catalog** -- Current catalog omits 20+ modules across Domain-specific, Firebase, and Others categories. Use category grouping with links to module READMEs instead of inline descriptions.

5. **Add L0 cross-references** -- Both DawSync and shared-kmp-libs CLAUDE.md files should reference AndroidCommonDoc L0 patterns for generic KMP rules (testing, error handling, architecture, Gradle). This avoids duplication and ensures consistency.

6. **Fix all version inconsistencies before rewrite** -- DawSync has 4 files referencing Kotlin 2.3.0 when current is 2.3.10. Resolve all stale references before the CLAUDE.md rewrite to avoid propagating stale data.

7. **Add `validate-claude-md` MCP tool** -- Build a tool that checks CLAUDE.md structure against the template, detects missing rules vs canonical checklist, and validates that `@import` references resolve.

8. **Smoke test with code generation** -- After rewrite, generate a ViewModel, UseCase, and test in each project. Verify the generated code follows all rules from the original CLAUDE.md files (sealed interface UiState, rethrow CancellationException, flat module naming, fakes over mocks).

## Data Reference

Full machine-readable data: `audit-manifest.json` (same directory)

Per-project manifests:
- `audit-manifest-wakethecave.json` (209 files, Plan 01)
- `audit-manifest-dawsync.json` (223 files, Plan 02)
- `audit-manifest-shared-kmp-libs.json` (17 files + 52 module gap analysis, Plan 03)
- `audit-manifest-androidcommondoc.json` (23 pattern docs, Plan 03)

Monitor-sources report: `reports/monitoring-report.json`
