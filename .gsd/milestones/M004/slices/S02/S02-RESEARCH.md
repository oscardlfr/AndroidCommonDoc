# Phase 14: Doc Structure & Consolidation - Research

**Researched:** 2026-03-14
**Domain:** Documentation engineering -- template design, multi-repo consolidation, AI-optimized doc structure, vault sync
**Confidence:** HIGH

## Summary

Phase 14 is the largest phase in the v1.2 roadmap. It transforms the documentation ecosystem from an audited-but-disorganized state (Phase 13 output) into a structured, template-compliant, AI-optimized documentation corpus across three repositories (AndroidCommonDoc L0, shared-kmp-libs L1, DawSync L2). The phase operates entirely on markdown files, YAML frontmatter, JSON configuration, and the MCP TypeScript infrastructure -- no Kotlin application code is modified.

The audit report from Phase 13 provides a precise, machine-readable manifest of every file's classification, action, and priority. This eliminates guesswork: 47 DawSync files promote to L0, 12 archive, 5 oversized L0 docs split, 38 shared-kmp-libs modules need new documentation, 14 existing modules need template compliance updates, 2 new coverage-gap L0 docs needed (Navigation3, DI patterns), 18 L0 docs need monitor_urls, and the vault re-syncs at the end.

**Primary recommendation:** Execute in dependency order -- template first (everything depends on it), then L0 splits/fixes (foundation), then promotions and new docs (bulk work), then shared-kmp-libs docs (source-reading intensive), then DawSync consolidation (cross-repo), then vault sync (final). Each wave should be independently verifiable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Strict template enforcement** -- mandatory for ALL docs across L0, L1, L2. Same template everywhere for consistent AI consumption
- **YAML frontmatter** -- mandatory fields: scope, sources, targets, slug, status, monitor_urls, description, version, last_updated. New fields: `layer: L0|L1|L2`, `parent: hub-slug` (for sub-docs), `project: project-name` (for L1/L2 docs)
- **Hub+sub-doc pattern** -- oversized docs split into hub (<100 lines, overview + links) + independently loadable sub-docs (each with full frontmatter, self-contained context, loadable without the hub)
- **Hard limit** -- 150 lines per section, 300 lines per standalone doc, 500 lines absolute max per file
- **Code examples** -- platform-split when pattern has platform differences (KMP, Android, iOS, desktop); commonMain-only when no platform divergence
- **All 47 DawSync candidates** promoted to L0 -- Claude determines optimal enterprise approach for the 8 skills (copy as-is), 6 agents (parameterize), and 32 commands (template system)
- **DawSync originals** -- replaced with thin L0 delegates after promotion. Zero content loss
- **12 superseded DawSync docs** -- archive to docs/archive/superseded/
- **Enterprise proposal duplicate** -- archive Spanish version (propuesta-integracion-enterprise.md) to docs/archive/
- **All 5 oversized L0 docs** split into hub+sub-doc format
- **kmp-architecture.md** (341 lines) -- Claude determines optimal split
- **monitor_urls** -- add to all 18 L0 docs that lack them
- **versions-manifest.json** -- fix as Phase 14 prerequisite (kover 0.9.1 -> actual, compose-multiplatform clarification)
- **Full coverage** -- all 52 shared-kmp-libs modules documented (38 new + 14 existing updated)
- **Source code reading** -- agents MUST read actual Kotlin source files for accurate API documentation
- **Security modules** -- full depth documentation for all 7 security-critical modules
- **Storage docs** -- L0 generic KMP storage concepts doc + L1 decision tree
- **Navigation3 patterns** -- new L0 doc
- **DI patterns** -- new L0 doc, framework-agnostic (Koin AND Dagger/Hilt)
- **62 architecture diagrams** -- audit and consolidate
- **Fix version inconsistency** -- Kotlin 2.3.0 -> 2.3.10 in DawSync README.md, APPLE_SETUP.md, TECHNOLOGY_CHEATSHEET.md, ANDROID_2026.md
- **Agent consumption guide** -- new L0 doc explaining layered doc system
- **Vault re-sync** -- vault-config.json updated, full re-sync after all changes
- **Full quality gate** -- run quality-gate-orchestrator after all changes

### Claude's Discretion
- Optimal section ordering in template (rules-first vs context-first) based on agent consumption patterns
- Anti-pattern format (inline vs dedicated section)
- Version reference approach (hardcode+monitor vs placeholders)
- Cross-reference mechanism (explicit section vs vault wikilinks)
- Template file location (docs/ vs .planning/)
- Command template system design for 32 promoted commands
- Promotion wave ordering and parallelization
- L2>L1 override mechanism details
- Error mapper doc format (group template vs individual)
- Execution order across repos
- Feature branch vs direct-on-main strategy
- Module catalog creation for shared-kmp-libs
- DawSync archive frontmatter tagging
- Additional coverage gap docs beyond Navigation3 and DI
- Vault sync timing (one final vs incremental)

### Deferred Ideas (OUT OF SCOPE)
- **API exposure Detekt rule** -- future phase
- **WakeTheCave/OmniSound adoption** -- template designed for reuse, but execution only for DawSync + shared-kmp-libs
- **NotebookLM API integration** -- out of scope
- **Violations found during shared-kmp-libs documentation** -- log for future phases, don't block
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STRUCT-01 | Define standard documentation template with domain sections (architecture, testing, UI, data, cross-cutting) -- informed by audit findings | Model 5/5 docs analyzed (testing-patterns.md, viewmodel-state-patterns.md, compose-resources-patterns.md). Frontmatter schema understood. Template must extend PatternMetadata with `layer`, `parent`, `project` fields. Scanner/types.ts modifications needed. |
| STRUCT-02 | Template optimized for dual consumption: human-readable AND AI agent context-window-aware (<150 lines per section, frontmatter with scope metadata) | Line limits defined (150/section, 300/standalone, 500/absolute max). Hub+sub-doc pattern proven with testing-patterns and compose-resources-patterns hubs. Frontmatter already parsed by scanner.ts and used by vault transformer. |
| STRUCT-03 | Consolidate DawSync docs/ based on audit manifest -- merge/archive/promote per classification, zero content loss | audit-manifest-dawsync.json has full file-by-file classifications (223 files). 12 superseded -> archive, 47 promote to L0, 38 overlapping need assessment, 62 diagrams need consolidation. DawSync version refs need fixing (Kotlin 2.3.0 -> 2.3.10). |
| STRUCT-04 | Promote validated L0 candidates from WakeTheCave and DawSync to AndroidCommonDoc pattern docs | WakeTheCave: 0 candidates (all project-specific). DawSync: 47 candidates (8 skills, 6 agents, 32 commands, 1 workflow). Skills copy as-is, agents need parameterization, commands need template system. |
| STRUCT-05 | Write missing documentation for shared-kmp-libs modules following standard template | 52 modules total: 14 with README, 38 without. Priority: Security (7 undocumented, critical), Storage (9 undocumented, decision guide needed), Error mappers (9, group template), Domain-specific (8), Others (5). Source reading required for accurate API docs. |
| STRUCT-06 | Update vault-config.json and re-sync vault to reflect consolidated structure | vault-config.json at ~/.androidcommondoc/vault-config.json. Current config has 4 projects (shared-kmp-libs, DawSync, WakeTheCave, OmniSound). Need to update collectGlobs for new L0 promoted skills/agents/commands dirs. Run sync-vault after all structural changes. |
</phase_requirements>

## Standard Stack

### Core (no new dependencies -- documentation-only phase)

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| YAML frontmatter | N/A | Metadata in markdown docs | Already used by all 23 L0 docs, parsed by `mcp-server/src/registry/frontmatter.ts` |
| MCP Server (TypeScript) | Existing | Registry scanner, vault sync, monitor-sources | Already built in phases 8-12. Extends `PatternMetadata` type for new fields |
| Node.js | Existing | MCP server runtime, gsd-tools | No new installs needed |
| Obsidian vault | Existing | Knowledge hub output | sync-vault tool already handles L0/L1/L2 hierarchy |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `audit-manifest.json` (Phase 13) | Machine-readable file classifications | Source of truth for all consolidation decisions |
| `audit-report.md` (Phase 13) | Human-readable executive summary | Reference during planning for priority ordering |
| `versions-manifest.json` | Canonical version references | Fix as prerequisite before any doc work |
| `validate-all` MCP tool | Quality gate verification | Run after all changes to verify no regressions |

### No Alternatives Needed

This phase uses exclusively existing infrastructure. No new libraries, frameworks, or tools need evaluation. All work is markdown authoring, YAML frontmatter, JSON config, and minor TypeScript type extensions.

## Architecture Patterns

### Current Project Structure (L0 -- AndroidCommonDoc)

```
docs/                          # 23 L0 pattern docs (markdown + YAML frontmatter)
skills/                        # 22 skill directories (SKILL.md + rules/)
mcp-server/src/
  registry/
    types.ts                   # PatternMetadata, RegistryEntry, Layer
    scanner.ts                 # Directory scanner for .md with frontmatter
    frontmatter.ts             # YAML parser (BOM, CRLF safe)
    resolver.ts                # L0>L1>L2 layer resolution
  vault/
    types.ts                   # VaultConfig, VaultSource, VaultEntry, SyncManifest
    collector.ts               # Multi-source collector with glob expansion
    transformer.ts             # Obsidian-flavored markdown transformer
    sync-engine.ts             # Incremental sync with SHA-256 hashing
  tools/
    sync-vault.ts              # MCP tool: init/sync/clean modes
    monitor-sources.ts         # Upstream version monitoring
    validate-all.ts            # Quality gate orchestrator
versions-manifest.json         # Canonical version references
```

### Pattern 1: Hub + Sub-doc (PROVEN -- use for all splits)

**What:** Oversized doc becomes a hub (<100 lines) linking to independently-loadable sub-docs (each with full frontmatter). Sub-docs are self-contained and loadable without the hub.

**When to use:** Any doc exceeding 300 lines, or any doc with clearly separable topic clusters.

**Existing exemplars (5/5 AI-readiness, use as template reference):**
- `testing-patterns.md` (105 lines, hub) -> `testing-patterns-coroutines.md`, `testing-patterns-fakes.md`, `testing-patterns-coverage.md`
- `viewmodel-state-patterns.md` (162 lines, hub) -> `viewmodel-state-management.md`, `viewmodel-events.md`, `viewmodel-navigation.md`
- `compose-resources-patterns.md` (95 lines, hub) -> `compose-resources-configuration.md`, `compose-resources-usage.md`, `compose-resources-troubleshooting.md`

**Hub structure:**
```markdown
---
scope: [topic1, topic2]
sources: [lib1, lib2]
targets: [android, desktop, ios, jvm]
version: N
last_updated: "YYYY-MM"
description: "Hub doc: ..."
slug: pattern-name
status: active
layer: L0
monitor_urls:
  - url: "https://..."
    type: github-releases
    tier: 1
---

# Title

## Overview
[2-3 paragraphs, core principles, key rules]

## Sub-documents
- **[sub-doc-name](sub-doc-name.md)**: Description
- **[sub-doc-name](sub-doc-name.md)**: Description

## Quick Reference
[Most critical patterns inline for quick access]

## References
[External links]
```

**Sub-doc structure:**
```markdown
---
scope: [specific-topic]
sources: [lib1]
targets: [android, desktop, ios, jvm]
version: N
last_updated: "YYYY-MM"
description: "Specific topic patterns"
slug: pattern-name-subtopic
status: active
layer: L0
parent: pattern-name
---

# Specific Topic Title

[Self-contained content, loadable independently]
```

### Pattern 2: Group Template (for shared-kmp-libs error mappers)

**What:** Single template document covering a category of identical-structure modules (e.g., 9 error mapper modules all follow `ExceptionMapper` pattern). Hub with overview + per-module table entries.

**When to use:** When multiple modules share identical architecture and differ only in the domain they map.

**Structure:**
```markdown
---
scope: [error-handling, error-mapping]
sources: [core-error]
targets: [android, desktop, ios, jvm]
slug: shared-kmp-libs-error-mappers
status: active
layer: L1
project: shared-kmp-libs
---

# Error Mapper Modules

## Pattern
[ExceptionMapper interface, CompositeExceptionMapper, DI integration]

## Modules

| Module | Source Exception | Target Domain | Key Mappings |
|--------|-----------------|---------------|-------------|
| core-error-network | NetworkException | DomainException.Network | timeout, DNS, SSL |
| core-error-io | IOException | DomainException.IO | read, write, permission |
...
```

### Pattern 3: L0 Delegate (for DawSync post-promotion)

**What:** After promoting a skill/agent/command to L0, the DawSync original is replaced with a thin delegate that points to the L0 canonical version. Zero content loss -- original content lives at L0.

**Considerations for implementation:**
- Symlinks are fragile on Windows (require developer mode or admin privileges)
- A thin markdown file with redirect frontmatter is more robust
- The delegate should contain: a reference to the L0 location, any DawSync-specific overrides, and a note that the canonical version lives at L0

### Pattern 4: New Frontmatter Fields

**What:** Extend the existing frontmatter schema with `layer`, `parent`, and `project` fields.

**Impact on MCP server:**
- `types.ts`: Add `layer`, `parent`, `project` as optional fields on `PatternMetadata`
- `scanner.ts`: Extract new fields from parsed YAML (already handles arbitrary YAML, just needs to map new fields)
- `resolver.ts`: No changes needed (already uses Layer type from entry, not frontmatter)
- `vault/transformer.ts`: May need to pass through new fields to vault frontmatter

**Current `PatternMetadata` fields:** scope, sources, targets, version, last_updated, description, slug, status, excludable_sources, monitor_urls, rules

**New fields to add:** layer (L0/L1/L2), parent (hub slug for sub-docs), project (project name for L1/L2)

### Anti-Patterns to Avoid

- **Content loss during consolidation:** NEVER delete a file without verifying its content exists elsewhere. Archive policy: move to `docs/archive/superseded/`, never delete
- **Breaking frontmatter contracts:** New fields MUST be optional to avoid breaking existing docs that don't have them yet. Scanner validation only requires scope, sources, targets
- **Oversized sub-docs:** When splitting, ensure each sub-doc stays under 300 lines. If a sub-doc would exceed this, split further
- **Stale cross-references:** When splitting or moving files, update all internal links. Search for the old filename across all docs
- **Template-before-content:** Don't design the template in isolation -- it must be informed by the 5/5 model docs and audit findings

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom parser | `mcp-server/src/registry/frontmatter.ts` (uses `yaml` npm package) | Handles BOM, CRLF, edge cases already tested |
| File classification | Manual file-by-file decisions | `audit-manifest-dawsync.json` and `audit-manifest.json` | Phase 13 already classified 472 files with actions |
| Vault structure | Manual file copying | `sync-vault` MCP tool with `vault-config.json` | Handles L0/L1/L2 hierarchy, incremental sync, orphan detection |
| Version reference tracking | Manual grep | `versions-manifest.json` + `monitor-sources` tool | Automated version comparison with upstream sources |
| Module documentation API surface | Guessing from module names | Read actual `.kt` source files in each module | Locked decision: "agents MUST read actual Kotlin source files" |

**Key insight:** Phase 13's audit manifest is the single source of truth for consolidation decisions. Every file has a machine-readable classification (ACTIVE/SUPERSEDED/UNIQUE), recommended action (promote_L0/archive/keep), and priority. The planner should reference the manifest for every consolidation action rather than re-auditing.

## Common Pitfalls

### Pitfall 1: Exceeding Context Window During shared-kmp-libs Documentation

**What goes wrong:** Attempting to document all 52 modules in a single session exhausts agent context, leading to degraded quality in later modules.

**Why it happens:** Each module requires reading 8-27 Kotlin source files for accurate API documentation (locked decision). Security modules alone have 107 Kotlin files across 7 modules.

**How to avoid:** Batch modules by category with clear boundaries between batches. Priority order: Security (7), Storage (10), Error mappers (9), Foundation (5), I/O (9), Domain (8), Others (4). Each batch is a separate plan/wave.

**Warning signs:** Copy-paste documentation patterns, missing platform-specific details, generic descriptions that don't match actual API surface.

### Pitfall 2: Link Rot During Splits

**What goes wrong:** Splitting 5+ oversized docs creates new filenames. Any existing references to the old single-file doc break or point to wrong content.

**Why it happens:** Docs cross-reference each other, CLAUDE.md references specific docs, vault wikilinks reference slugs, and the resolver uses filenames as slugs.

**How to avoid:** After each split, grep the entire repo (and DawSync, shared-kmp-libs) for the old filename. Update all references. The hub doc keeps the original slug so the resolver URI doesn't break.

**Warning signs:** 404s in vault wikilinks, stale references in CLAUDE.md files, broken `docs://androidcommondoc/{slug}` URIs.

### Pitfall 3: Breaking Scanner Validation

**What goes wrong:** Adding new mandatory frontmatter fields causes the scanner to reject existing valid docs that don't have the new fields yet.

**Why it happens:** The scanner (`scanner.ts` line 63-69) validates `scope`, `sources`, `targets` as required arrays. If new fields are added as required, existing docs fail.

**How to avoid:** New fields (`layer`, `parent`, `project`) MUST be optional in `PatternMetadata`. Add them to the type as `layer?: Layer`, `parent?: string`, `project?: string`. Scanner extracts them when present, ignores when absent.

**Warning signs:** MCP server fails to load docs after type changes, registry returns 0 entries.

### Pitfall 4: Windows Path Issues in Cross-Repo Operations

**What goes wrong:** Copying files between AndroidCommonDoc, DawSync, and shared-kmp-libs with Windows backslash paths causes vault sync issues or broken references.

**Why it happens:** The vault collector normalizes paths to forward slashes (`normalizePath` in `collector.ts`), but file operations outside the MCP server may not.

**How to avoid:** Always use forward slashes in frontmatter references. Use `path.resolve()` and `path.join()` for filesystem operations. The sync engine handles this correctly -- don't bypass it.

### Pitfall 5: Zero Content Loss Violation

**What goes wrong:** During DawSync consolidation, a superseded or overlapping file is deleted/archived but contained unique context not present elsewhere.

**Why it happens:** The audit manifest classifies files based on overall content overlap, but individual sections within a file may contain unique context.

**How to avoid:** Before archiving or replacing any file, verify the specific content exists in the target location. For the 38 overlapping DawSync docs, compare section-by-section, not just file-level. Archive rather than delete -- the archive path is `docs/archive/superseded/`.

### Pitfall 6: Vault Config Drift

**What goes wrong:** New L0 directories (`.agents/skills/`, `.claude/agents/`, `.claude/commands/`) created for promoted content are not collected by vault sync because vault-config.json doesn't have globs for them.

**Why it happens:** The L0 collector (AndroidCommonDoc) currently collects from `docs/` and `skills/`. Promoted agents and commands need new collection globs or the default glob set needs updating.

**How to avoid:** Update the `getDefaultGlobs()` function in `vault/config.ts` if the L0 toolkit now includes `.agents/` and `.claude/` directories. Alternatively, add explicit globs to vault-config.json.

## Code Examples

### Frontmatter Schema Extension (types.ts)

```typescript
// Source: mcp-server/src/registry/types.ts -- extend PatternMetadata
export interface PatternMetadata {
  scope: string[];
  sources: string[];
  targets: string[];
  version?: number;
  last_updated?: string;
  description?: string;
  slug?: string;
  status?: string;
  excludable_sources?: string[];
  monitor_urls?: MonitorUrl[];
  rules?: RuleDefinition[];
  // NEW fields for Phase 14
  layer?: "L0" | "L1" | "L2";
  parent?: string;       // hub slug for sub-docs
  project?: string;      // project name for L1/L2 docs
}
```

### Scanner Field Extraction (scanner.ts)

```typescript
// Source: mcp-server/src/registry/scanner.ts -- add after existing field extraction
const metadata: PatternMetadata = {
  // ... existing fields ...
  layer: typeof data.layer === "string" ? (data.layer as Layer) : undefined,
  parent: typeof data.parent === "string" ? data.parent : undefined,
  project: typeof data.project === "string" ? data.project : undefined,
};
```

### Hub Doc Example (after splitting error-handling-patterns.md)

```markdown
---
scope: [error-handling, architecture, data, domain]
sources: [core-result, kotlinx-coroutines, core-error]
targets: [android, desktop, ios, jvm]
version: 2
last_updated: "2026-03"
description: "Hub doc: Error handling patterns using Result type, DomainException hierarchy, and CancellationException safety"
slug: error-handling-patterns
status: active
layer: L0
monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 1
rules:
  - id: cancellation-exception-rethrow
    type: required-rethrow
    message: "CancellationException must be rethrown in catch blocks"
    detect:
      catch_type: CancellationException
      required_action: rethrow
    hand_written: true
    source_rule: CancellationExceptionRethrowRule.kt
---

# Error Handling Patterns

## Overview
[Core principle, key rules -- condensed]

## Sub-documents
- **[error-handling-result](error-handling-result.md)**: Result<T> type, fold/map/getOrNull, Flow integration
- **[error-handling-exceptions](error-handling-exceptions.md)**: DomainException hierarchy, CancellationException safety, layer boundary mapping
- **[error-handling-ui](error-handling-ui.md)**: ViewModel error states, UiText error messages, retry patterns

## Quick Reference
[Most critical patterns]

## References
[External links]
```

### Thin L0 Delegate (DawSync post-promotion)

```markdown
---
delegate: true
canonical: "AndroidCommonDoc/.agents/skills/accessibility/SKILL.md"
note: "Canonical version promoted to L0. This file is a delegate."
---

# Accessibility Audit Skill

This skill has been promoted to the L0 generic toolkit (AndroidCommonDoc).

**Canonical location:** `AndroidCommonDoc/.agents/skills/accessibility/`

For DawSync-specific overrides, add them below the delegate marker.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat docs (single file per topic) | Hub+sub-doc pattern | Phase 9 (REG-02) | Token-efficient loading -- agents load only needed sub-docs |
| Hardcoded doc list | Dynamic registry scan | Phase 9 (REG-05) | New docs auto-discovered, no code changes needed |
| Manual vault sync | Automated sync-vault MCP tool | Phase 11/12 | Incremental sync with SHA-256 hashing and orphan detection |
| L0-only patterns | L0>L1>L2 resolution | Phase 9 (REG-03) | Project-specific overrides with full replacement semantics |
| No version tracking | versions-manifest.json + monitor-sources | Phase 10 | Automated upstream version drift detection |

**Current state:** 23 L0 docs, 5 have monitor_urls, avg AI-readiness 4.3/5. 52 shared-kmp-libs modules, 14 have READMEs (26.9%). DawSync has 223 audited files with clear classifications.

## Open Questions

1. **Command template system design for 32 promoted commands**
   - What we know: 32 DawSync commands are generic KMP patterns (test, coverage, build, deploy, etc.). They reference `$ANDROID_COMMON_DOC` and project-specific paths.
   - What's unclear: The exact parameterization approach. Options: (a) mustache-style `{{PROJECT_ROOT}}` variables resolved at copy time, (b) environment-variable-based `$PROJECT_ROOT` resolved at runtime, (c) Claude Code's native `$ARGUMENTS` parameter expansion.
   - Recommendation: Since commands use Claude Code's `$ARGUMENTS` natively, keep that pattern. Replace DawSync-specific hardcoded paths with `$ANDROID_COMMON_DOC` (already used) and make module paths relative. The `/test` command already uses this pattern well -- use it as the exemplar.

2. **L2>L1 override mechanism for 3 DawSync overrides**
   - What we know: DawSync has `.androidcommondoc/docs/dawsync-domain-patterns.md` already. The resolver looks in `getL1DocsDir(project)` which returns `{project}/.androidcommondoc/docs/`.
   - What's unclear: Whether the 3 identified overrides (PATTERNS.md, TESTING.md, dawsync-domain-patterns.md) should use the same `.androidcommondoc/docs/` mechanism or a different one.
   - Recommendation: Use the existing `.androidcommondoc/docs/` directory with slug-matching. This is already how the resolver works. The 3 override files get appropriate slugs (e.g., `offline-first-patterns`, `testing-patterns`) and placed in `.androidcommondoc/docs/`.

3. **Firebase modules (3) -- active or dead code?**
   - What we know: core-firebase-api, core-firebase-native, core-firebase-rest exist. Audit noted "native has 0% coverage, may be inactive."
   - What's unclear: Whether any consumer project actually uses these modules.
   - Recommendation: Check DawSync's and WakeTheCave's `build.gradle.kts` for firebase module dependencies during execution. Document with `status: deprecated` or `status: active` accordingly.

4. **shared-kmp-libs module catalog**
   - What we know: User asked Claude to determine whether a single `shared-kmp-libs-catalog.md` with all 52 modules adds value.
   - What's unclear: Whether the README.md (316 lines, already has module listing) serves this purpose.
   - Recommendation: Create the catalog as a hub doc at L1 that is more structured than README.md -- categorized by functional area, with links to individual module docs, dependency relationships, and platform support. README.md gets slimmed to installation/getting-started focus.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (for MCP TypeScript) + manual verification scripts |
| Config file | `mcp-server/tsconfig.json` (TypeScript compilation) |
| Quick run command | `cd mcp-server && npm run build && npm test` |
| Full suite command | `cd mcp-server && npm run build && npm test` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STRUCT-01 | Template exists with required sections and frontmatter fields | manual + smoke | Grep all docs for required frontmatter fields | N/A -- template is a document, verified by inspection |
| STRUCT-02 | No doc exceeds line limits; frontmatter has scope metadata | smoke | `wc -l docs/*.md` + grep for frontmatter fields | N/A -- Wave 0 script |
| STRUCT-03 | DawSync docs consolidated per manifest; zero content loss | manual | Diff DawSync file count against manifest expectations | N/A -- verification script |
| STRUCT-04 | L0 promoted files exist in AndroidCommonDoc | smoke | `ls .agents/skills/ .claude/agents/ .claude/commands/` | N/A -- Wave 0 script |
| STRUCT-05 | shared-kmp-libs modules have docs following template | smoke | Count README.md files, verify frontmatter | N/A -- Wave 0 script |
| STRUCT-06 | vault-config.json updated, sync succeeds with no errors | integration | `npx tsx mcp-server/src/tools/sync-vault.ts` (or via MCP tool) | Existing tool |

### Sampling Rate

- **Per task commit:** Verify line counts on modified docs (`wc -l`), verify frontmatter validity
- **Per wave merge:** Run `npm run build && npm test` in mcp-server if types/scanner modified
- **Phase gate:** Full quality gate via `validate-all` MCP tool, vault sync clean mode

### Wave 0 Gaps

- [ ] Verification script to count docs per line-limit threshold (150/300/500)
- [ ] Verification script to check all docs have required frontmatter fields
- [ ] Verification script to validate zero content loss (compare manifest actions vs actual file state)
- [ ] MCP server build must pass after `PatternMetadata` type extension

## Sources

### Primary (HIGH confidence)
- Phase 13 audit report: `.planning/phases/13-audit-validate/audit-report.md` -- complete ecosystem audit
- Phase 13 manifests: `audit-manifest-dawsync.json`, `audit-manifest-shared-kmp-libs.json`, `audit-manifest-androidcommondoc.json` -- file-level classifications
- Model 5/5 docs: `docs/testing-patterns.md` (105 lines), `docs/viewmodel-state-patterns.md` (162 lines), `docs/compose-resources-patterns.md` (95 lines) -- template reference
- MCP server source: `mcp-server/src/registry/types.ts`, `scanner.ts`, `frontmatter.ts`, `resolver.ts` -- current infrastructure
- Vault infrastructure: `mcp-server/src/vault/types.ts`, `collector.ts`, `sync-engine.ts` -- sync pipeline
- Vault config: `~/.androidcommondoc/vault-config.json` -- current project configuration
- Version manifest: `versions-manifest.json` -- version tracking baseline

### Secondary (MEDIUM confidence)
- DawSync file structure: Direct filesystem inspection of `.agents/skills/`, `.claude/agents/`, `.claude/commands/`, `docs/` directories
- shared-kmp-libs module list: Direct inspection of 52 `core-*/` directories and their README.md presence

### Tertiary (LOW confidence)
- Firebase module activity status: Needs runtime verification during execution (check consumer build files)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all infrastructure exists from Phases 8-12
- Architecture: HIGH -- hub+sub-doc pattern proven with 3 exemplars, frontmatter schema understood, scanner/resolver code inspected
- Pitfalls: HIGH -- based on direct code inspection of scanner validation, vault collector, and cross-repo path handling
- shared-kmp-libs documentation scope: MEDIUM -- module count confirmed (52), but source file complexity varies and documentation time per module is hard to estimate
- DawSync consolidation: HIGH -- audit manifest provides exact file-by-file instructions

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable -- documentation infrastructure, not fast-moving libraries)