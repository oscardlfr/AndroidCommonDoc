# Phase 16: Ecosystem Documentation Completeness & Vault Harmony - Research

**Researched:** 2026-03-16
**Domain:** Documentation authoring, MCP tooling extension, Obsidian vault sync
**Confidence:** HIGH

## Summary

Phase 16 is a documentation completeness and vault harmony phase. It does NOT introduce new technologies or architectural patterns -- it uses the established MCP server toolchain (Node.js/TypeScript/Vitest), existing vault sync pipeline, and documented YAML frontmatter conventions to fill remaining documentation gaps across the L0/L1/L2 ecosystem.

The phase has four workstreams: (1) write 38 new module READMEs and upgrade 14 existing ones in shared-kmp-libs, (2) fix DawSync category alignment and run cross-layer audit, (3) assess and complete DawSync subproject documentation, and (4) perform a full vault resync with MOC improvements, wikilink refresh, and human-verified graph view. All four are documentation and tooling tasks using established patterns from Phases 11-15.

**Primary recommendation:** Execute in waves -- module READMEs first (bulk content creation requiring Kotlin source code reading), then category audit and subproject docs in parallel, then vault harmony as the final gate. The vault-config.json update (adding collectGlobs for module READMEs) must happen before the vault resync.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **All 52 modules get per-module READMEs**: 38 new READMEs created, 14 existing upgraded
- **YAML frontmatter mandatory**: All module READMEs get 10-field YAML frontmatter (scope, sources, targets, slug, status, layer, category, description, version, last_updated) for vault collection and MCP discoverability
- **Source code reading required**: Agents MUST read actual Kotlin source files to produce accurate API surfaces -- real function signatures, not hallucinated from group docs
- **Existing README consistency validation**: Cross-check all 14 existing READMEs against their Phase 14 group docs. Source-code-verified group docs are authoritative when conflicts are found
- **Cross-layer references**: Module READMEs MUST include cross-references -- L1 module READMEs reference L0 patterns (via l0_refs or equivalent), and link to their group doc for pattern context
- **validate-doc-structure extension**: Extend the MCP validation tool to check module READMEs (frontmatter completeness, line limits, cross-references) -- same pipeline as docs/ files
- **Fix all 31 mismatched files**: Complete the category consolidation that Phase 14.3 started -- all DawSync docs aligned to unified categories
- **Full cross-layer audit**: Run category audit across L0, L1, AND L2 -- not just DawSync
- **Architecture diagrams included**: All 62 DawSync diagram docs audited for category accuracy
- **Fix directly**: No separate report artifact -- scan and fix issues directly
- **Same-pass reference updates**: Category fixes and cross-reference/wikilink updates happen in same pass
- **Full resync + quality pass**: Resync after all Phase 16 source changes
- **vault-config.json updated**: Add collectGlobs for shared-kmp-libs core-*/README.md
- **MOC structure improvements**: Evaluate and improve MOC structure to handle 38 new module README entries
- **Full wikilink refresh**: Re-run wikilink injection across ALL vault docs with expanded slug pool
- **Human verification mandatory**: Final quality gate requires Obsidian human verification
- **Subproject documentation**: Full Claude discretion on DawSyncWeb and SessionRecorder-VST3 assessment

### Claude's Discretion
- README content depth per module (adaptive based on API complexity)
- Content duplication vs delegation to group docs
- Vault collection strategy for module READMEs
- Module catalog update approach
- Module README ordering/prioritization
- Usage example style (generic vs real consumer patterns)
- Freshness validation scope
- Category vocabulary adjustments
- Subdirectory structure changes vs frontmatter-only category fixes
- Validator architecture for module READMEs
- Graph view colorGroups for module READMEs
- Canvas file handling in vault root
- Pipeline enhancements for module-aware collection
- Subproject documentation depth and format
- Execution wave ordering and parallelization

### Deferred Ideas (OUT OF SCOPE)
- Coordinated DawSync agent system
- Corporate environment deployment
- Cursor/Windsurf adapters (ADAPT-02)
- API exposure Detekt rule
- WakeTheCave/OmniSound adoption
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 16 has no pre-defined requirement IDs in REQUIREMENTS.md. Requirements are derived from CONTEXT.md decisions:

| ID | Description | Research Support |
|----|-------------|-----------------|
| P16-README | Write 38 new module READMEs with 10-field YAML frontmatter, source-code-verified API surfaces | Module list verified (38 missing), existing README template pattern documented, frontmatter schema known |
| P16-UPGRADE | Upgrade 14 existing READMEs with frontmatter and consistency validation against group docs | 14 existing READMEs identified, group docs cataloged as authoritative source |
| P16-VALIDATE | Extend validate-doc-structure for module README validation | Tool code analyzed, extension points identified |
| P16-CATEGORY | Fix DawSync category alignment (31+ files) and cross-layer audit | Current mismatch state assessed -- SUBDIR_TO_CATEGORIES already handles most, but user wants full alignment |
| P16-SUBPROJ | Complete DawSync subproject documentation (DawSyncWeb, SessionRecorder-VST3) | Subproject file inventory done |
| P16-VAULT | Full vault resync with vault-config.json update, MOC improvements, wikilink refresh | Vault pipeline code analyzed, config update needed for collectGlobs |
| P16-CATALOG | Update module-catalog.md links after new READMEs created | Existing catalog reviewed, link format known |
| P16-HUMAN | Human-verified Obsidian graph view as final quality gate | Established pattern from prior phases |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 20+ | MCP server runtime | Already in use |
| TypeScript | 5.x | MCP server codebase | Already in use |
| Vitest | latest | MCP server test framework | Already in use, 567 tests passing |
| Zod | latest | Input validation for MCP tools | Already registered |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | latest | MCP tool registration | Already in use for all tools |

No new libraries are needed for Phase 16. All work uses existing tools and patterns.

## Architecture Patterns

### Module README Structure (Established Pattern)

Based on analysis of existing high-quality READMEs (core-common, core-result), the established pattern is:

```markdown
---
scope: [relevant-keywords]
layer: L1
project: shared-kmp-libs
slug: {module-name}
status: active
platforms: [android, desktop, ios, macos]
depends_on: [dependencies]
depended_by: [dependents]
description: "One-line description"
version: 1
last_updated: "2026-03"
l0_refs: [l0-slug-refs]
---

# {module-name}

One-line description.

## Overview
[2-3 sentence explanation + architecture decision justification]

## Components
[Table: Component | Description]

## Platform Support
[Table: Platform | Status]

## Usage
[Code examples from real source code]

## Dependencies
[List]

## Testing
[Command + example]

## Related Modules
[Cross-references]
```

**Key constraints:**
- Module README max: 300 lines (sub-doc limit from QUAL-02)
- 10-field YAML frontmatter (scope, sources, targets, slug, status, layer, category, description, version, last_updated) per QUAL-01
- Additional module-specific fields: platforms, depends_on, depended_by
- Must cross-reference L0 patterns via l0_refs field
- Must link to group doc for pattern context

### Module README Content Strategy

**38 modules break into complexity tiers:**

| Tier | Count | Modules | Depth |
|------|-------|---------|-------|
| Full (>100 lines) | 10-12 | oauth-api, oauth-browser, storage-sql, storage-secure, billing-api, gdpr, firebase-api, encryption, security-keys, auth-biometric, io-kotlinxio, io-watcher | Full API surface, usage examples, platform impls |
| Standard (60-100 lines) | 10-15 | storage-datastore, storage-mmkv, storage-settings, storage-cache, subscription, system-api, system, designsystem-foundation, etc. | Components, usage, dependencies |
| Minimal (30-60 lines) | 9 | All 9 error mappers (identical ExceptionMapper pattern) | Template-based, link to error-mappers group doc |
| Skeleton | 1-3 | core-storage-credential (empty skeleton), core-version (minimal) | Note skeleton status, planned API |

### Category-Subdirectory Alignment Model

The current architecture uses SUBDIR_TO_CATEGORIES to map old subdirectory names to consolidated category values. This is by design from Phase 14.3:

| Subdirectory | Accepted Categories |
|-------------|-------------------|
| architecture | architecture, data, ui |
| business | product |
| legal | product |
| references | product |
| guides | guides, testing, ui |
| tech | build, security |

**The "31 mismatched files" gap** from Phase 14.3-08 refers to DawSync docs where the validator shows mismatches in raw directory-vs-category comparison but the SUBDIR_TO_CATEGORIES mapping already accepts them as valid. The user decision says "fix all 31 mismatched files" which means either:
1. Update frontmatter categories to match subdirectory names exactly, OR
2. Move files to subdirectories matching their categories

**Recommendation:** Frontmatter-only fixes (option 1) where the mapping is clear and reasonable (e.g., `legal/` stays as `legal/` but gets `category: legal`). For cases where the current category is semantically more correct (e.g., `business/` docs truly being `product`), keep the SUBDIR_TO_CATEGORIES mapping. The cross-layer audit should focus on ensuring all three layers use the same 9-category vocabulary consistently.

### Vault Config Update Pattern

Current vault-config.json for shared-kmp-libs uses default globs:
```json
{
  "name": "shared-kmp-libs",
  "path": "C:\\Users\\34645\\AndroidStudioProjects\\shared-kmp-libs",
  "layer": "L1"
}
```

Default globs from `getDefaultGlobs("L1")` collect: `CLAUDE.md, AGENTS.md, README.md, docs/**/*.md, .planning/PROJECT.md, .planning/STATE.md, .planning/codebase/**/*.md`

This does NOT collect per-module READMEs (`core-*/README.md`). Must add explicit collectGlobs:
```json
{
  "name": "shared-kmp-libs",
  "path": "C:\\Users\\34645\\AndroidStudioProjects\\shared-kmp-libs",
  "layer": "L1",
  "collectGlobs": [
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
    "docs/**/*.md",
    "core-*/README.md",
    ".planning/PROJECT.md",
    ".planning/STATE.md",
    ".planning/codebase/**/*.md"
  ]
}
```

### MOC Enhancement Pattern

Current MOC generator produces 4 pages (Home, All Patterns, All Skills, All Decisions). The 38+ new module READMEs will appear as `sourceType: "docs"` entries in the vault. Current MOC pages do NOT index `docs` type entries -- only `pattern` and `skill`.

**Options:**
1. **Classify module READMEs as `pattern` sourceType** -- they would appear in "All Patterns" MOC
2. **Add a new "All Modules" MOC page** -- dedicated index for L1 module READMEs
3. **Add module entries to "By Project" MOC** -- they already appear there via category grouping

**Recommendation:** Option 2 (new "All Modules" MOC) plus module READMEs appearing in "By Project" and "By Layer" MOCs via their project association. This avoids polluting the All Patterns page with 52 module-specific docs while giving them first-class discovery.

### Wikilink Expansion

Current wikilink slug pool comes from all vault entry slugs. Adding 38+ new module slugs (e.g., `core-encryption`, `core-oauth-api`) will cause the wikilink injector to link any mention of these module names across ALL vault docs. This is desirable but needs care:
- Module names like `core-common` are common enough to appear in many docs
- The existing longest-first matching strategy (in `replaceSlugsSafe`) handles `core-storage-sql-cipher` before `core-storage-sql`
- Hyphenated boundary matching prevents `core-error` from matching inside `core-error-network`

**No code changes needed** -- the existing wikilink generator handles this correctly via the regex boundary matching at `(?<![\\w-])slug(?![\\w-])`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Module README generation | Custom template engine | Read source code + write markdown files | 38 modules with real Kotlin APIs -- must be source-verified, no abstraction layer |
| Vault collection of module READMEs | Custom collector | Update vault-config.json collectGlobs | Existing glob expander handles `core-*/README.md` natively |
| Category audit | Manual file-by-file review | validate-doc-structure tool across all 3 projects | Tool already validates category-subdir alignment, vocabulary, frontmatter completeness |
| MOC generation | Manual vault editing | Extend generateAllMOCs() in moc-generator.ts | Existing generator handles new entries automatically when sourceType/category are correct |
| Wikilink injection | Manual cross-linking | Run full vault sync (wikilink generator processes all slugs) | Existing wikilink injector handles slug expansion automatically |

**Key insight:** Phase 16 is a content creation phase, not an architecture phase. The tooling already exists -- the work is in writing accurate module READMEs from source code and ensuring vault config captures them.

## Common Pitfalls

### Pitfall 1: Hallucinated API Surfaces
**What goes wrong:** AI generates plausible-looking Kotlin APIs that don't exist in the actual module source code.
**Why it happens:** Model training data includes similar patterns. Without reading actual source, the README documents a fictional API.
**How to avoid:** MUST read actual Kotlin source files for every module before writing README. Verify function signatures, class names, and package paths against source.
**Warning signs:** Usage examples that don't compile, class names not found in source, wrong parameter types.

### Pitfall 2: Module README Duplication with Group Docs
**What goes wrong:** Module README repeats 80% of the group doc content, creating maintenance burden and staleness.
**Why it happens:** Natural tendency to be comprehensive in every doc.
**How to avoid:** Module READMEs focus on: what this specific module does, its API surface, its dependencies, how to test it. Delegate pattern context, architectural decisions, and cross-module comparisons to the group doc. Include a prominent "Group doc: [link]" reference.
**Warning signs:** Module README exceeding 200 lines, content that starts with "this pattern..." rather than "this module provides...".

### Pitfall 3: vault-config.json collectGlobs Override Losing Default Globs
**What goes wrong:** Setting explicit collectGlobs for shared-kmp-libs without including the default globs (docs/**/*.md, CLAUDE.md, etc.) causes existing L1 docs to disappear from the vault.
**Why it happens:** The collector uses `project.collectGlobs ?? getDefaultGlobs(project.layer)` -- explicit globs completely replace defaults.
**How to avoid:** When adding `core-*/README.md` to collectGlobs, include ALL the default globs too.
**Warning signs:** Vault sync shows dramatically fewer L1 files than expected.

### Pitfall 4: Category Audit Breaking Wikilinks
**What goes wrong:** Changing a file's category or moving it to a different subdirectory orphans wikilinks and cross-references that used the old path.
**Why it happens:** Category fixes change the vault path, which changes the slug, which breaks existing [[wikilinks]] in other docs.
**How to avoid:** The CONTEXT.md explicitly says "same-pass reference updates" -- fix categories AND update references in one atomic operation. Run full wikilink refresh after all changes.
**Warning signs:** Vault orphan count increases after sync.

### Pitfall 5: Error Mapper READMEs Being Too Verbose
**What goes wrong:** 9 nearly identical error mapper modules each get a verbose 150-line README, adding 1350 lines of repetitive content.
**Why it happens:** Treating each module as independent when they all follow the same ExceptionMapper pattern.
**How to avoid:** Use a minimal template for error mappers: module name, what exceptions it maps, link to error-mappers group doc, test command. Target 30-40 lines each.
**Warning signs:** Copy-paste between error mapper READMEs, identical architecture sections.

### Pitfall 6: Collector classifyFile() Not Handling Module READMEs
**What goes wrong:** Module READMEs collected via `core-*/README.md` glob get classified as generic `docs` type and routed to wrong vault path.
**Why it happens:** The `classifyFile()` function in collector.ts routes by path patterns. `core-common/README.md` doesn't match any special pattern -- it falls through to the default `docs` classification with `docs` subdivision.
**How to avoid:** Verify that module READMEs get reasonable vault paths. The current collector routes them to `L1-ecosystem/shared-kmp-libs/docs/README.md` which would collide. May need special handling or the globs might need to be more specific (e.g., `core-*/README.md` relative paths need proper routing).
**Warning signs:** Multiple files trying to write to the same vault path, or module READMEs not appearing in vault.

## Code Examples

### Existing Module README Frontmatter (Verified Pattern)

```yaml
# Source: C:/Users/34645/AndroidStudioProjects/shared-kmp-libs/core-common/README.md
---
scope: [utilities, id-generation, datetime, base64]
layer: L1
project: shared-kmp-libs
slug: core-common
status: active
platforms: [android, desktop, ios, macos]
depends_on: [kotlinx-datetime]
depended_by: [most shared-kmp-libs modules]
---
```

Note: This frontmatter has 8 fields but is missing the full 10-field set (no `sources`, `targets`, `category`, `description`, `version`, `last_updated`). Phase 16 must upgrade to full 10-field format.

### Error Mapper README Template (Recommended)

```markdown
---
scope: [error-handling, {domain}]
category: data
layer: L1
project: shared-kmp-libs
slug: core-error-{domain}
status: active
sources: [core-error]
targets: [all-consumers]
platforms: [android, desktop, ios, macos]
depends_on: [core-error]
depended_by: []
description: "Maps {Domain}Exception to DomainException via ExceptionMapper chain"
version: 1
last_updated: "2026-03"
l0_refs: [error-handling-patterns]
---

# core-error-{domain}

Maps {Domain}Exception hierarchy to DomainException via the ExceptionMapper chain.

## Overview

Provides a single `{Domain}ExceptionMapper` implementing `ExceptionMapper` interface from core-error. Converts {domain}-specific exceptions to typed DomainException subtypes for uniform error handling.

## Mapper

| Exception In | DomainException Out | Code |
|-------------|-------------------|------|
| {specific exceptions from source code} |

## Usage

Registered in the ExceptionMapper chain via DI:
[code from actual source]

## Testing

\`\`\`bash
./gradlew :core-error-{domain}:test
\`\`\`

## Related

- **Group doc:** [error-mappers.md](../docs/io/error-mappers.md)
- **L0 pattern:** error-handling-patterns
```

### vault-config.json Update (Required)

```json
{
  "name": "shared-kmp-libs",
  "path": "C:\\Users\\34645\\AndroidStudioProjects\\shared-kmp-libs",
  "layer": "L1",
  "collectGlobs": [
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
    "docs/**/*.md",
    "core-*/README.md",
    ".planning/PROJECT.md",
    ".planning/STATE.md",
    ".planning/codebase/**/*.md"
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No module READMEs | Group docs per category | Phase 14 | Module-level docs delegated to group |
| Flat docs structure | Subdirectory by category | Phase 14.1 | docs/security/, docs/storage/, etc. |
| 23 category tags | 9 unified categories | Phase 14.3 | testing, guides, domain, ui, architecture, build, security, data, product |
| Install scripts | Sync engine + manifests | Phase 14.3 | /sync-l0 replaces install-claude-skills.sh |
| 4 MOC pages | 4 MOC pages | Phase 14.2 | Reduced from 7 to 4 (removed noisy pages) |

**Current state from Phase 15:**
- 567 MCP tests passing
- 55 registry entries (28 skills + 11 agents + 16 commands)
- All quality gates pass
- Vault last synced 2026-03-15
- 9 unified categories in use

## Module Inventory

### 38 Modules Missing READMEs

**Error Mappers (9):** core-error-audit, core-error-backend, core-error-billing, core-error-encryption, core-error-gdpr, core-error-io, core-error-json, core-error-network, core-error-oauth

**Storage (8):** core-storage-cache, core-storage-credential, core-storage-datastore, core-storage-encryption, core-storage-mmkv, core-storage-secure, core-storage-settings, core-storage-sql, core-storage-sql-cipher (note: 9 total but core-storage-api has README)

**OAuth (4):** core-oauth-1a, core-oauth-api, core-oauth-browser, core-oauth-native

**Firebase (3):** core-firebase-api, core-firebase-native, core-firebase-rest

**Security (2):** core-encryption, core-security-keys

**Domain (4):** core-audit, core-billing-api, core-gdpr, core-subscription

**System (3):** core-system, core-system-api, core-version

**I/O (2):** core-io-kotlinxio, core-io-watcher

**Auth (1):** core-auth-biometric

**Design System (1):** core-designsystem-foundation

### 14 Modules with Existing READMEs (Need Upgrade)

core-common, core-designsystem-foundation (duplicate?), core-domain, core-error, core-io-api, core-io-okio, core-json-api, core-json-kotlinx, core-logging, core-network-api, core-network-ktor, core-network-retrofit, core-result, core-storage-api

**Upgrade needed:** Add missing frontmatter fields (sources, targets, category, description, version, last_updated), add l0_refs, validate consistency against group docs.

### Group Docs (Authoritative Reference)

| Group Doc | Modules Covered | Location |
|-----------|----------------|----------|
| foundation-modules.md | core-common, core-result, core-error, core-logging, core-domain | docs/foundation/ |
| io-network-modules.md | core-io-*, core-network-* | docs/io/ |
| error-mappers.md | All 9 core-error-* modules | docs/io/ |
| storage-guide.md | core-storage-api, core-storage-cache, core-storage-credential, core-storage-settings | docs/storage/ |
| storage-thin-modules.md | core-storage-cache, core-storage-credential, core-storage-encryption, core-storage-settings | docs/storage/ |
| storage-*.md | Individual storage docs | docs/storage/ |
| firebase-modules.md | All 3 core-firebase-* modules | docs/firebase/ |
| oauth-*.md | All 4 core-oauth-* modules | docs/oauth/ |
| security-encryption.md | core-encryption, core-security-keys | docs/security/ |
| auth-biometric.md | core-auth-biometric | docs/security/ |
| domain-billing.md | core-billing-api | docs/domain/ |
| domain-gdpr.md | core-gdpr | docs/domain/ |
| domain-misc.md | core-subscription, core-audit, core-backend-api, core-designsystem-foundation, core-system-*, core-version | docs/domain/ |

## DawSync Subprojects

### SessionRecorder-VST3
- **Location:** C:/Users/34645/AndroidStudioProjects/DawSync/SessionRecorder-VST3/
- **Own docs (excluding build deps):** README.md, CHANGELOG.md, EULA.md, MACOS_BUILD_INSTRUCTIONS.md, TESTING.md, src/README.md, installer/macos/README.md, installer/windows/README.md
- **Domain:** C++/JUCE VST3 plugin, not KMP
- **Phase 14.2 noted:** SessionRecorder-VST3 frontmatter uses C++/JUCE domain scope
- **Assessment:** 8 docs exist, may need frontmatter upgrade check

### DawSyncWeb
- **Location:** C:/Users/34645/AndroidStudioProjects/DawSyncWeb/ (external sibling, not nested)
- **Own docs:** Mostly skill/agent files in .agents/ directory, marketing/product context
- **Configured in vault-config.json:** Yes, as DawSync subProject with external path
- **Phase 14.2 noted:** DawSyncWeb README disk-only (gitignored in DawSync), minimal .claude/ setup
- **Assessment:** Minimal additional documentation likely needed -- Astro web project

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (latest) |
| Config file | mcp-server/vitest.config.ts |
| Quick run command | `cd mcp-server && npx vitest run` |
| Full suite command | `cd mcp-server && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P16-VALIDATE | validate-doc-structure handles module READMEs | unit | `cd mcp-server && npx vitest run tests/unit/tools/validate-doc-structure.test.ts` | Exists (extend) |
| P16-VAULT | Collector picks up core-*/README.md globs | unit | `cd mcp-server && npx vitest run tests/unit/vault/collector.test.ts` | Exists (extend) |
| P16-VAULT | MOC includes module entries | unit | `cd mcp-server && npx vitest run tests/unit/vault/moc-generator.test.ts` | Exists (extend) |
| P16-VAULT | Wikilinks injected for module slugs | unit | `cd mcp-server && npx vitest run tests/unit/vault/wikilink-generator.test.ts` | Exists (no changes needed) |
| P16-VAULT | Full vault sync produces expected output | integration | `cd mcp-server && npx vitest run tests/integration/vault-sync.test.ts` | Exists (extend) |
| P16-README | Module READMEs have valid frontmatter | manual | Run validate-doc-structure on shared-kmp-libs | Manual via MCP tool |
| P16-CATEGORY | DawSync category audit passes | manual | Run validate-doc-structure on DawSync | Manual via MCP tool |
| P16-HUMAN | Obsidian graph view verified | manual-only | Human opens Obsidian vault | N/A |

### Sampling Rate
- **Per task commit:** `cd mcp-server && npx vitest run` (full suite, ~7s)
- **Per wave merge:** Full suite + validate-doc-structure across all 3 projects
- **Phase gate:** Full suite green + vault-status healthy + human Obsidian verification

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. Tests will be extended in existing files, not created from scratch.

## Open Questions

1. **Collector routing for module READMEs**
   - What we know: `core-*/README.md` files collected via glob get classified as `docs` sourceType. The `collectProjectSources()` function derives vault path from the classification subdivision prefix.
   - What's unclear: Will multiple README.md files from different modules create vault path collisions? The collector uses `match.relativePath` which would be `core-common/README.md`, `core-result/README.md` etc. -- the path includes the module directory, so paths should be unique.
   - Recommendation: Verify with a test run during implementation. If collisions occur, add module-aware routing in the collector.

2. **Category alignment strategy depth**
   - What we know: The SUBDIR_TO_CATEGORIES mapping already makes the validator pass for all current DawSync docs. The "31 mismatched files" from Phase 14.3-08 are accepted by the mapping.
   - What's unclear: Does the user want to (a) tighten the mapping so directories MUST match categories exactly, or (b) keep the current flexible mapping but ensure all files have correct unified-vocabulary categories?
   - Recommendation: Approach (b) -- keep the flexible mapping, audit that all categories are from the 9-vocabulary set, and fix any files that don't have category fields or have non-vocabulary categories. Diagram docs should be audited per CONTEXT.md decision on whether some should be `data` or `ui` instead of blanket `architecture`.

3. **Module README slug uniqueness**
   - What we know: Vault slugs are derived from filenames. All module READMEs are named `README.md`.
   - What's unclear: How the transformer derives slugs for `core-common/README.md` vs `core-result/README.md` -- both basenames are `README.md`.
   - Recommendation: The transformer uses the vault relativePath to derive slugs. Since collector preserves the module directory in the path (`L1-ecosystem/shared-kmp-libs/docs/core-common/README.md`), the slug should include the module name. Verify during implementation.

## Sources

### Primary (HIGH confidence)
- Existing module READMEs in shared-kmp-libs (core-common/README.md, core-result/README.md) -- pattern template
- validate-doc-structure.ts source code -- extension points for module validation
- collector.ts source code -- glob expansion and file classification
- moc-generator.ts source code -- current MOC generation (4 pages)
- wikilink-generator.ts source code -- slug matching strategy
- vault-config.json (at ~/.androidcommondoc/) -- current project configuration
- config.ts source code -- default globs and excludes
- types.ts source code -- VaultSource, VaultEntry, ProjectConfig interfaces
- module-catalog.md -- complete 52-module inventory with categories and doc links

### Secondary (MEDIUM confidence)
- Phase 14.3-08 STATE.md notes about "31/84 DawSync category gap" -- gap may be resolved by SUBDIR_TO_CATEGORIES mapping
- Phase 14.2 decisions about frontmatter fields and size limits

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new technologies, all existing
- Architecture: HIGH -- all patterns established in prior phases, code verified
- Pitfalls: HIGH -- identified from actual code analysis (collector routing, vault-config override, wikilink expansion)
- Module inventory: HIGH -- verified by file system scan (38 missing, 14 existing)
- Category gap: MEDIUM -- the "31 files" may be partially resolved already, needs runtime validation

**Research date:** 2026-03-16
**Valid until:** 2026-04-15 (stable -- documentation phase, no external dependencies)
