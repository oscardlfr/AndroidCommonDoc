# Roadmap: AndroidCommonDoc

## Milestones

- **v1.0 MVP** -- Phases 1-4 (shipped 2026-03-13)
- **v1.1 Hardening & Intelligence** -- Phases 5-12 (shipped 2026-03-14)
- **v1.2 Documentation Coherence & Context Management** -- Phases 13-15 (in progress, includes inserted sub-phases)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-4) -- SHIPPED 2026-03-13</summary>

- [x] Phase 1: Stabilize Foundation (4/4 plans) -- completed 2026-03-12
- [x] Phase 2: Quality Gates and Enforcement (3/3 plans) -- completed 2026-03-13
- [x] Phase 3: Distribution and Adoption (4/4 plans) -- completed 2026-03-13
- [x] Phase 4: Audit Tech Debt Cleanup (1/1 plan) -- completed 2026-03-13

</details>

<details>
<summary>v1.1 Hardening & Intelligence (Phases 5-12) -- SHIPPED 2026-03-14</summary>

- [x] **Phase 5: Tech Debt Foundation** - Clean v1.0 debt so quality gates, setup scripts, and install pipeline are correct before adding new capabilities (completed 2026-03-13)
- [x] **Phase 6: Konsist Internal Tests** - Validate Konsist classpath isolation and build structural architecture tests for the toolkit itself
- [x] **Phase 7: Consumer Guard Tests** - Distribute parameterized architecture enforcement templates to consuming projects (completed 2026-03-13, gap closure 2026-03-13)
- [x] **Phase 8: MCP Server** - Expose pattern docs, skills, and validation commands as MCP tool endpoints for AI agent access (completed 2026-03-13)
- [x] **Phase 9: Pattern Registry & Discovery** - Layered pattern management (L0/L1/L2), cross-project discovery, scoped loading, MCP integration (completed 2026-03-13)
- [x] **Phase 10: Doc Intelligence & Detekt Generation** - Auto-updating from official sources, Detekt rule generation from verified patterns (completed 2026-03-14)
- [x] **Phase 11: Obsidian Documentation Hub** - Vault sync pipeline with wikilinks, MOC pages, tags (completed 2026-03-14)
- [x] **Phase 12: Ecosystem Vault Expansion** - L0/L1/L2 hierarchy-aware collection, sub-project support, configurable globs (completed 2026-03-14)

</details>

### v1.2 Documentation Coherence & Context Management

**Milestone Goal:** Establish a coherent, navigable documentation structure across the KMP ecosystem with standard templates, consolidated content, and interconnected CLAUDE.md files that enable context delegation between L0/L1/L2 layers. Scope: AndroidCommonDoc + shared-kmp-libs + DawSync (WakeTheCave read-only mining, OmniSound deferred).

- [x] **Phase 13: Audit & Validate** - Mine WakeTheCave, audit DawSync/shared-kmp-libs/AndroidCommonDoc docs, execute monitor-sources to produce evidence-based audit report before any restructuring (completed 2026-03-14)
- [x] **Phase 14: Doc Structure & Consolidation** - Define standard doc template informed by audit, consolidate DawSync docs, promote L0 candidates, write shared-kmp-libs docs, re-sync vault (completed 2026-03-14)
- [x] **Phase 14.1: Docs Subdirectory Reorganization** - Reorganize flat docs/ into domain-based subdirectories, build validation tooling, optimize vault MOC structure (completed 2026-03-15)
- [x] **Phase 14.2: Documentation Content Quality & Cross-Layer References** - Apply sub-document pattern to all hub docs, add cross-layer L0 references in L1/L2 to eliminate duplication, standardize YAML frontmatter (scope/sources/targets/category) across all docs (completed 2026-03-15)
- [x] **Phase 14.3: Skill Materialization & Registry** - Replace path-based delegates with registry + manifest + materialization pattern; sync-l0 skill, validation tooling, adapter simplification, CLAUDE.md layering (INSERTED) (completed 2026-03-15)
- [x] **Phase 15: CLAUDE.md Ecosystem Alignment** - Extract canonical rule checklist, design template, rewrite all 3 CLAUDE.md files with L0/L1/L2 delegation, smoke test, MCP validation tool (completed 2026-03-16)

## Phase Details

<details>
<summary>v1.1 Phase Details (Phases 5-12) -- SHIPPED</summary>

### Phase 5: Tech Debt Foundation
**Goal**: Quality gates, setup scripts, and install pipeline are correct and trustworthy -- no false noise, no silent failures, no drift between orchestrator and individual agents
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04
**Success Criteria** (what must be TRUE):
  1. Running any setup script without ANDROID_COMMON_DOC set produces a clear error message with setup instructions (not a cryptic Gradle crash)
  2. `install-copilot-prompts.sh` run standalone in a consuming project delivers generated Copilot instruction files to the correct location
  3. Quality-gate-orchestrator produces identical validation results to running individual agents separately (no drift)
  4. `validate-phase01-*.sh` orphaned scripts no longer exist in the repository and no quality gate references them
**Plans:** 2 plans
Plans:
- [x] 05-01-PLAN.md -- Env var guards (DEBT-01) + copilot standalone delivery (DEBT-02)
- [x] 05-02-PLAN.md -- Orchestrator delegation (DEBT-03) + orphan cleanup (DEBT-04)

### Phase 6: Konsist Internal Tests
**Goal**: Toolkit's own Kotlin sources are structurally validated by Konsist tests that run reliably alongside Kotlin 2.3.10 and Detekt 2.0.0-alpha.2
**Depends on**: Phase 5
**Requirements**: KONS-01, KONS-02, KONS-03, KONS-04, KONS-05
**Success Criteria** (what must be TRUE):
  1. `./gradlew :konsist-tests:test` passes with Konsist 0.17.3 in an isolated JVM module while Detekt runs on other modules in the same build (no classpath conflict)
  2. A Kotlin class violating the 5-layer architecture (e.g., Data layer importing UI) causes a Konsist test failure with a clear message naming the offending file and import
  3. A class named `FooManager` in a package expecting `FooRepository` naming causes a Konsist naming convention test failure
  4. Konsist tests never show UP-TO-DATE -- they re-run on every `./gradlew test` invocation
  5. Cross-file structural checks catch at least 3 violation types that Detekt single-file analysis cannot (layer imports, package placement, cross-module structure)
**Plans:** 4 plans
Plans:
- [x] 06-01-PLAN.md -- Module bootstrap, ScopeFactory, classpath spike (KONS-01, KONS-05)
- [x] 06-02-PLAN.md -- DetektRuleStructure, PackageConvention, NamingConvention tests (KONS-03, KONS-04)
- [x] 06-03-PLAN.md -- Architecture fixtures, module isolation, ScriptParity, SkillStructure tests (KONS-02, KONS-04)
- [x] 06-04-PLAN.md -- Gap closure: wire orphaned fixtures, delete orphaned scripts (KONS-02, KONS-03, KONS-04)

### Phase 7: Consumer Guard Tests
**Goal**: Consuming projects can adopt parameterized architecture enforcement tests with a single install command that configures everything for their package structure
**Depends on**: Phase 6
**Requirements**: GUARD-01, GUARD-02, GUARD-03
**Success Criteria** (what must be TRUE):
  1. Guard test templates accept a consumer's root package (e.g., `com.dawsync`) and enforce the 5-layer architecture rules without hardcoded package names
  2. Running the guard install script in a consuming project copies templates, substitutes the base package, and produces runnable Konsist tests with zero manual editing
  3. Guard tests pass in DawSync (full scan) and OmniSound (canary pass) with canary assertions confirming the scope is non-empty (not vacuously passing)
**Plans:** 3 plans
Plans:
- [x] 07-01-PLAN.md -- Guard test templates + install scripts (GUARD-01, GUARD-02)
- [x] 07-02-PLAN.md -- Consumer validation in DawSync + OmniSound (GUARD-02, GUARD-03)
- [x] 07-03-PLAN.md -- Gap closure: fix __KOTLIN_VERSION__ dead substitution + REQUIREMENTS.md GUARD-03 text (GUARD-03)

### Phase 8: MCP Server
**Goal**: AI agents can programmatically access pattern docs, skill definitions, and validation results through a standards-compliant MCP server running as a Claude Code subprocess
**Depends on**: Phase 5
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
**Success Criteria** (what must be TRUE):
  1. `claude mcp add` registers the server and Claude Code can list available tools, resources, and prompts from it
  2. An MCP client can read any of the 8 pattern docs via `docs://androidcommondoc/{name}` resource URIs and receive the full Markdown content
  3. An MCP client can invoke the top 5 validation commands as tools and receive structured JSON results (not raw script output)
  4. Architecture review prompt templates are available as MCP prompts that an agent can retrieve and use
  5. The MCP server launches and responds correctly on Windows with no stdio corruption (stderr-only logging, clean JSON-RPC on stdout)
**Plans:** 4/4 plans executed
Plans:
- [x] 08-01-PLAN.md -- Project bootstrap, server factory, utilities, stub registration (MCP-01, MCP-05)
- [x] 08-02-PLAN.md -- Resources (docs, skills, changelog) + prompts (architecture-review, pr-review, onboarding) (MCP-02, MCP-04)
- [x] 08-03-PLAN.md -- Validation tools (5 individual + validate-all + setup-check) with script runner and rate limiter (MCP-03)
- [x] 08-04-PLAN.md -- Integration testing, GitHub Actions CI, README, Claude Code registration verification (MCP-05)

### Phase 9: Pattern Registry & Discovery
**Goal**: Pattern docs are organized in a layered registry (L0 base / L1 project / L2 user) with cross-project discovery, scoped loading, and MCP integration -- so agents load only relevant patterns and users can override/extend per project
**Depends on**: Phase 8
**Requirements**: REG-01, REG-02, REG-03, REG-04, REG-05, REG-06, REG-07
**Success Criteria** (what must be TRUE):
  1. All pattern docs have YAML frontmatter with scope, sources, targets fields and are discoverable by scanning
  2. Large docs (>400 lines) are split into focused sub-docs for token-efficient agent loading
  3. Three-layer resolution (L0 > L1 > L2) with full replacement semantics resolves correctly
  4. Consumer projects auto-discovered from settings.gradle.kts includeBuild paths
  5. docs.ts uses dynamic registry scan (KNOWN_DOCS removed) while preserving docs:// URIs
  6. find-pattern MCP tool searches metadata and returns matching entries with optional project filter
  7. All docs validated against current official sources before registry launch
**Plans:** 6 plans

Plans:
- [x] 09-01-PLAN.md -- Registry core (types, frontmatter parser, scanner) + frontmatter on all 9 docs (REG-01)
- [x] 09-02-PLAN.md -- Doc freshness audit + large doc splitting into sub-docs (REG-02, REG-07)
- [x] 09-03-PLAN.md -- Layer resolver (L0/L1/L2) + project auto-discovery (REG-03, REG-04)
- [x] 09-04-PLAN.md -- MCP integration: dynamic docs.ts + find-pattern tool (REG-05, REG-06)
- [x] 09-05-PLAN.md -- Integration tests + end-to-end verification + human checkpoint (REG-03, REG-05, REG-06)
- [x] 09-06-PLAN.md -- DawSync doc migration: promote generic patterns to L0, create L1 overrides (REG-01)

### Phase 10: Doc Intelligence & Detekt Generation
**Goal**: Pattern docs stay current through automated monitoring of official sources, and verified patterns can generate custom Detekt rules -- so deprecated APIs and new recommendations are caught automatically. Includes v1.1 milestone cleanup/audit pass.
**Depends on**: Phase 9
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, DOC-07, DOC-08, DOC-09
**Success Criteria** (what must be TRUE):
  1. PatternMetadata extended with optional monitor_urls and rules fields; scanner extracts them without breaking existing docs
  2. Source monitoring engine detects version changes and deprecations via content hashing and version comparison
  3. Review state tracking persists findings between runs with TTL re-surfacing
  4. Content ingestion accepts pasted text from arbitrary sources and routes to pattern docs
  5. Detekt rule generator emits AST-only Kotlin rules + tests from frontmatter definitions
  6. Existing 5 hand-written rules linked to pattern docs; system detects drift
  7. MCP tools (monitor-sources, generate-detekt-rules, ingest-content) and skills expose all capabilities
  8. GitHub Actions cron workflow runs tiered monitoring on schedule
  9. v1.1 milestone audit complete: dead code removed, docs accurate, tools consolidated, CHANGELOG.md generated
**Plans:** 7/7 plans complete

Plans:
- [x] 10-01-PLAN.md -- Registry schema extension + monitoring engine core (DOC-01, DOC-02)
- [x] 10-02-PLAN.md -- Rule parser + Kotlin emitters for Detekt rule generation (DOC-05)
- [x] 10-03-PLAN.md -- monitor-sources MCP tool + review state tracking (DOC-03, DOC-07)
- [x] 10-04-PLAN.md -- Detekt generated rules integration + writer pipeline (DOC-05, DOC-06)
- [x] 10-05-PLAN.md -- generate-detekt-rules + ingest-content MCP tools (DOC-04, DOC-07)
- [x] 10-06-PLAN.md -- Skills + CI workflow + CLI entrypoint (DOC-07, DOC-08)
- [x] 10-07-PLAN.md -- v1.1 milestone audit, cleanup, docs accuracy, changelog (DOC-09)

### Phase 11: Obsidian Documentation Hub
**Goal**: Claude Code skill + MCP tools that sync KMP ecosystem documentation (pattern docs, skills, rules, project knowledge, AI instructions) into a unified Obsidian vault with auto-generated wikilinks, MOC pages, and tags -- repos remain source of truth, vault is a read-only enriched view
**Depends on**: Phase 10
**Requirements**: VAULT-01, VAULT-02, VAULT-03, VAULT-04, VAULT-05, VAULT-06, VAULT-07, VAULT-08, VAULT-09, VAULT-10, VAULT-11, VAULT-12, VAULT-13, VAULT-14, VAULT-15, VAULT-16, VAULT-17
**Success Criteria** (what must be TRUE):
  1. Collector gathers pattern docs, skills, and project knowledge from AndroidCommonDoc + consumer repos
  2. Transformer enriches documents with Obsidian-flavored frontmatter (tags, aliases, vault_source, vault_synced)
  3. Wikilinks auto-injected between related docs based on slug references
  4. MOC index pages generated (All Patterns, By Project, By Layer, By Target Platform, All Skills, All Decisions)
  5. Tags auto-generated from scope/targets/layer metadata
  6. Vault writer creates directory structure with .obsidian/ config and Dataview recommendation
  7. Sync manifest tracks file hashes for incremental sync
  8. Orphan detection identifies vault files no longer in source repos
  9. sync-vault MCP tool supports init/sync/clean modes
  10. vault-status MCP tool returns health info
  11. Full e2e sync pipeline works from any project directory
  12. SKILL.md skill definition follows established pattern
  13. Human verifies vault opens correctly in Obsidian with graph view and navigation
**Plans:** 5/5 plans complete

Plans:
- [x] 11-01-PLAN.md -- Vault types, config management, and multi-source collector (VAULT-01, VAULT-02, VAULT-03, VAULT-13)
- [x] 11-02-PLAN.md -- Tag generator, wikilink injector, and source-to-VaultEntry transformer (VAULT-04, VAULT-05, VAULT-07)
- [x] 11-03-PLAN.md -- MOC generator, vault writer, and sync engine orchestration (VAULT-06, VAULT-08, VAULT-09, VAULT-14, VAULT-15)
- [x] 11-04-PLAN.md -- sync-vault and vault-status MCP tools with index registration (VAULT-10, VAULT-11)
- [x] 11-05-PLAN.md -- Skill definition, integration tests, and Obsidian human verification (VAULT-12, VAULT-16, VAULT-17)

### Phase 12: Ecosystem Vault Expansion
**Goal**: Vault collector understands the L0/L1/L2 documentation hierarchy and collects comprehensive project documentation (architecture, conventions, app-specific docs, sub-projects) -- so the Obsidian vault becomes a true cross-project knowledge hub where pattern changes propagate and conventions stay consistent across all apps
**Depends on**: Phase 11
**Requirements**: ECOV-01, ECOV-02, ECOV-03, ECOV-04, ECOV-05, ECOV-06, ECOV-07
**Success Criteria** (what must be TRUE):
  1. shared-kmp-libs conventions/docs collected as L1 ecosystem layer (separate from L0 generic patterns)
  2. App-specific docs (DawSync/docs/, WakeTheCave docs, OmniSound docs) collected as L2 with domain tagging
  3. Architecture docs (.planning/codebase/) collected per project for cross-project reference
  4. Sub-project support: DawSync/SessionRecorder-VST3 docs appear as nested project in vault
  5. Vault structure reflects L0/L1/L2 hierarchy visually (not flat)
  6. MOC pages updated with ecosystem-aware groupings (By Layer shows L0 generic vs L1 ecosystem vs L2 app-specific)
  7. Configurable collection globs per project in vault-config.json (what to collect beyond defaults)
**Plans:** 9 plans (8 complete + 1 gap closure)

Plans:
- [x] 12-00-PLAN.md -- Wave 0 test stubs for Nyquist compliance (all ECOV)
- [x] 12-01-PLAN.md -- Doc layer audit + ECOV requirement definitions (ECOV-01, ECOV-02, ECOV-03)
- [x] 12-02-PLAN.md -- Types rewrite (ProjectConfig, SubProjectConfig, VaultConfig) + config management (ECOV-05, ECOV-07)
- [x] 12-03-PLAN.md -- Collector rewrite with glob expander + sub-project detector + version catalog parser (ECOV-01, ECOV-02, ECOV-03, ECOV-04, ECOV-07)
- [x] 12-04-PLAN.md -- Transformer + tag generator + wikilink generator + vault writer for layer-first (ECOV-05, ECOV-02)
- [x] 12-05-PLAN.md -- MOC generator (Home.md, ecosystem groupings) + sync engine updates (ECOV-05, ECOV-06)
- [x] 12-06-PLAN.md -- MCP tools (sync-vault, vault-status, find-pattern ecosystem queries) (ECOV-06)
- [x] 12-07-PLAN.md -- Full test rewrite + integration test + Obsidian human verification (all ECOV)

</details>

### Phase 13: Audit & Validate
**Goal**: The documentation landscape across all 4 projects is fully mapped -- every markdown file classified, gaps identified, freshness validated -- producing an evidence-based audit report that drives template design and consolidation decisions in subsequent phases
**Depends on**: Phase 12 (v1.1 complete)
**Requirements**: AUDIT-01, AUDIT-02, AUDIT-03, AUDIT-04, AUDIT-05, AUDIT-06
**Success Criteria** (what must be TRUE):
  1. WakeTheCave docs/ and docs2/ mined for reusable KMP patterns; L0 promotion candidate list produced with rationale per candidate, without modifying WakeTheCave
  2. Every one of DawSync's markdown files classified as ACTIVE, SUPERSEDED (with link to replacement), or UNIQUE (irreplaceable context) in a consolidation manifest
  3. shared-kmp-libs module documentation gaps identified; per-module documentation plan states what each module needs written
  4. AndroidCommonDoc 8 pattern docs reviewed for completeness and accuracy gaps against the consolidated corpus from all 4 projects
  5. monitor-sources executed against full consolidated corpus and official URLs; freshness report shows which version references are current vs stale
  6. Structured audit report delivered combining: consolidation manifest, L0 promotion list, gap inventory, and freshness report
**Plans:** 4/4 plans complete
Plans:
- [x] 13-01-PLAN.md -- WakeTheCave mining: enumerate and classify 209 docs for L0 promotion candidates (AUDIT-01)
- [x] 13-02-PLAN.md -- DawSync audit: classify 223 markdown files as ACTIVE/SUPERSEDED/UNIQUE (AUDIT-02)
- [x] 13-03-PLAN.md -- shared-kmp-libs module gap analysis + AndroidCommonDoc pattern doc review (AUDIT-03, AUDIT-04)
- [x] 13-04-PLAN.md -- Freshness validation via monitor-sources + merged audit report assembly (AUDIT-05, AUDIT-06)

### Phase 14: Doc Structure & Consolidation
**Goal**: Documentation across the ecosystem follows a standard structure that serves both human readers and AI agents, with DawSync consolidated, L0 patterns enriched, shared-kmp-libs documented, and the vault reflecting the new structure
**Depends on**: Phase 13
**Requirements**: STRUCT-01, STRUCT-02, STRUCT-03, STRUCT-04, STRUCT-05, STRUCT-06
**Success Criteria** (what must be TRUE):
  1. Standard doc template exists with domain sections (architecture, testing, UI, data, cross-cutting); each section under 150 lines with frontmatter scope metadata for AI agent loading
  2. DawSync docs/ consolidated per audit manifest -- files merged, archived, or promoted per classification with zero content loss; no single document exceeds 500 lines
  3. Validated L0 candidates from WakeTheCave and DawSync promoted to AndroidCommonDoc pattern docs with proper frontmatter
  4. shared-kmp-libs modules have documentation following the standard template; gaps identified in the Phase 13 audit report are addressed
  5. vault-config.json updated and vault re-synced; vault contents match the consolidated structure with no stale or orphaned files
**Plans:** 10/10 plans complete
Plans:
- [x] 14-01-PLAN.md -- Prerequisites: versions-manifest fix, PatternMetadata type extension, standard doc template, verification script (STRUCT-01, STRUCT-02)
- [x] 14-02-PLAN.md -- Split 6 oversized L0 docs into hub+sub-doc format (STRUCT-01, STRUCT-02)
- [x] 14-03-PLAN.md -- L0 compliance pass: monitor_urls on 18 docs, archive enterprise proposal, layer/parent fields (STRUCT-02)
- [x] 14-04-PLAN.md -- L0 promotion: DawSync 8 skills + 6 agents + 32 commands + 1 workflow to AndroidCommonDoc (STRUCT-04)
- [x] 14-05-PLAN.md -- New L0 coverage gap docs: Navigation3, DI, Storage patterns, Agent Consumption Guide (STRUCT-04, STRUCT-02)
- [x] 14-06-PLAN.md -- shared-kmp-libs Security & Auth module docs: 7 modules from source reading (STRUCT-05)
- [x] 14-07-PLAN.md -- shared-kmp-libs Storage + Error Mapper docs: decision guide + 10 storage + 9 error mappers (STRUCT-05)
- [x] 14-08-PLAN.md -- shared-kmp-libs Foundation + I/O + Domain + Firebase + Module Catalog (STRUCT-05)
- [x] 14-09-PLAN.md -- DawSync consolidation: archive, version fixes, delegates, L2>L1 overrides, diagrams (STRUCT-03)
- [x] 14-10-PLAN.md -- Vault sync + quality gate + human verification (STRUCT-06)

### Phase 14.1: docs-subdirectory-reorganization (INSERTED)

**Goal:** Reorganize flat docs/ directories across AndroidCommonDoc (L0), shared-kmp-libs (L1), and DawSync (L2) into standard domain-based subdirectories with category frontmatter, build validation tooling (MCP tool + skill), and optimize vault MOC structure for category-grouped navigation
**Requirements**: REORG-01, REORG-02, REORG-03, REORG-04, REORG-05, REORG-06, REORG-07
**Depends on:** Phase 14
**Plans:** 6/6 plans complete

Plans:
- [x] 14.1-01-PLAN.md -- Registry foundation: category in PatternMetadata, recursive scanner, find-pattern --category (REORG-04, REORG-06)
- [x] 14.1-02-PLAN.md -- L0 reorganization: 42 docs into 13 subdirectories + validate-doc-structure MCP tool (REORG-01, REORG-04, REORG-05)
- [x] 14.1-03-PLAN.md -- L1 reorganization: 27 docs into 9 subdirectories, legacy renames and archives (REORG-02, REORG-04)
- [x] 14.1-04-PLAN.md -- L2 reorganization: DawSync flat files to subdirectories, CODEX_AUDITY archived (REORG-03, REORG-04)
- [x] 14.1-05-PLAN.md -- Vault optimization: category routing, category-grouped MOCs, /doc-reorganize skill (REORG-07)
- [x] 14.1-06-PLAN.md -- Verification: cross-project validation, vault re-sync, Obsidian human verification (all REORG)

### Phase 14.2: docs-content-quality (INSERTED)

**Goal:** Apply sub-document pattern to all hub docs, eliminate L1/L2 content duplication by replacing with L0 references, and add standard YAML frontmatter to all docs missing it across AndroidCommonDoc (L0), shared-kmp-libs (L1), and DawSync (L2)
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05, QUAL-06, QUAL-07, QUAL-08
**Depends on:** Phase 14.1
**Success Criteria** (what must be TRUE):
  1. MCP tooling extended with l0_refs field in PatternMetadata, size limit validation (hub <100, sub-doc <300, absolute <500), l0_refs resolution validation, and frontmatter completeness scoring
  2. All oversized L0 docs split into hub+sub-doc format; all hubs under 100 lines, all sub-docs under 300 lines
  3. All oversized L1 docs split; all 24 active L1 docs have complete 10-field frontmatter; l0_refs cross-references added
  4. All 95 active DawSync docs (33 non-diagram + 62 diagram) have full 10-field YAML frontmatter
  5. All 18 oversized L2 docs split into hub+sub-doc format; duplicated L0 content replaced with l0_refs and inline reference blocks
  6. DawSync subproject docs (DawSyncWeb, SessionRecorder-VST3) have domain-appropriate frontmatter with delegation to parent
  7. validate-doc-structure reports 0 errors across all 3 projects; vault re-synced; human-approved Obsidian navigation
**Plans:** 9/9 plans complete

Plans:
- [x] 14.2-01-PLAN.md -- MCP tooling: l0_refs in PatternMetadata, scanner extraction, validate-doc-structure quality checks (QUAL-01)
- [x] 14.2-02-PLAN.md -- L0 splits: 8 oversized standalone/sub-docs into hub+sub-doc format (QUAL-02)
- [x] 14.2-03-PLAN.md -- L1 quality: split 2 oversized, complete frontmatter, add l0_refs cross-references (QUAL-03)
- [x] 14.2-04-PLAN.md -- L2 frontmatter: 33 non-diagram DawSync docs get full 10-field YAML frontmatter (QUAL-04)
- [x] 14.2-05-PLAN.md -- L2 diagram frontmatter: 62 diagram docs get templated 10-field YAML frontmatter (QUAL-05)
- [x] 14.2-06-PLAN.md -- L2 splits part 1: 5 largest DawSync docs (1667, 1619, 868, 648, 656 lines) (QUAL-06)
- [x] 14.2-07-PLAN.md -- L2 splits part 2: 13 remaining oversized docs + l0_refs dedup (QUAL-06)
- [x] 14.2-08-PLAN.md -- Subproject delegation: DawSyncWeb + SessionRecorder-VST3 frontmatter + doc responsibility map (QUAL-07)
- [x] 14.2-09-PLAN.md -- Quality gate: cross-project validation, vault re-sync, human verification (QUAL-08)

### Phase 14.2.1: Ecosystem Skills Audit & DawSync Integration Harmony (INSERTED)

**Goal:** Audit and modernize all skills, agents, and commands across L0 (AndroidCommonDoc), L1 (shared-kmp-libs), and L2 (DawSync) for structural consistency, correct delegation, and current Claude Code 2026 best practices -- consolidate dual skill locations, fix broken delegates, establish DawSyncWeb connectivity, uniformize sub-document patterns, and run full ecosystem quality gate with vault re-sync
**Requirements**: SKILL-01, SKILL-02, SKILL-03, SKILL-04, SKILL-05, SKILL-06, SKILL-07, SKILL-08, SKILL-09, SKILL-10, SKILL-11
**Depends on:** Phase 14.2
**Plans:** 7/7 plans complete

Plans:
- [x] 14.2.1-01-PLAN.md -- Ecosystem inventory + consolidate .agents/skills/ into skills/ (SKILL-01, SKILL-02)
- [x] 14.2.1-02-PLAN.md -- L0 skills modernization: rewrite 27 skills to Claude Code 2026 frontmatter (SKILL-03)
- [x] 14.2.1-03-PLAN.md -- L0 agents modernization + command-skill alignment analysis (SKILL-04, SKILL-05)
- [x] 14.2.1-04-PLAN.md -- Sub-document pattern uniformity: extend validator + fix cross-project violations (SKILL-10)
- [x] 14.2.1-05-PLAN.md -- L1/L2 delegate fixes: shared-kmp-libs delegates, DawSync path fixes, DawSyncWeb setup (SKILL-06, SKILL-07, SKILL-08)
- [x] 14.2.1-06-PLAN.md -- GSD workflow integration verification across all projects (SKILL-09)
- [x] 14.2.1-07-PLAN.md -- Quality gate: all validators, vault re-sync, human verification (SKILL-11)

### Phase 14.3: Skill Materialization & Registry -- Enterprise-Grade Distribution (INSERTED)

**Goal:** Replace fragile path-based delegates with a registry + manifest + materialization pattern. Each downstream project declares what L0 skills/agents it adopts via a manifest, and a sync command materializes copies with version tracking and integrity checksums.
**Requirements**: MATL-01, MATL-02, MATL-03, MATL-04, MATL-05, MATL-06, MATL-07, MATL-08
**Depends on:** Phase 14.2.1
**Success Criteria** (what must be TRUE):
  1. `skills/registry.json` catalogs all L0 skills and agents with paths, categories, and tiers -- discovery no longer requires filesystem scanning
  2. `l0-manifest.json` schema defined and validated; L1/L2 projects declare L0 source, version, included/excluded skills, integrity checksums
  3. `/sync-l0` skill reads manifest, resolves against registry, materializes selected skills/agents with version headers and checksums -- replaces `install-claude-skills.sh`
  4. Claude Code adapter path simplified: SKILL.md materializes directly without intermediate generated commands; Copilot adapter retained for enterprise Microsoft support
  5. All current path-based delegate stubs in shared-kmp-libs (9 commands) and DawSync (40+ commands, 6 skills, 6 agents) converted to materialized copies with manifests -- nothing breaks
  6. Validation tool parses all SKILL.md files, verifies frontmatter completeness, checks referenced scripts exist, validates registry is in sync
  7. Clean CLAUDE.md layering: `~/.claude/CLAUDE.md` = developer preferences, `{project}/CLAUDE.md` = project rules referencing/inheriting L0 patterns -- no full duplication
  8. All vault files use `lowercase-kebab-case` naming (no UPPERCASE_UNDERSCORE or numeric prefixes); category tags consolidated from 23 to ~8; graph view is readable at a glance
**Plans:** 9/9 plans complete

Plans:
- [x] 14.3-01-PLAN.md -- Registry generator: skill-registry.ts + registry.json generation (MATL-01)
- [x] 14.3-02-PLAN.md -- Manifest schema: l0-manifest.json Zod validation + example manifests (MATL-02)
- [x] 14.3-03-PLAN.md -- Sync engine: resolution, diff, materialization + /sync-l0 skill (MATL-03)
- [x] 14.3-04-PLAN.md -- Adapter simplification + validate-skills MCP tool (MATL-04, MATL-06)
- [x] 14.3-05-PLAN.md -- Big bang migration: shared-kmp-libs + DawSync delegates to materialized copies (MATL-05)
- [x] 14.3-06-PLAN.md -- CLAUDE.md layering: de-duplicate across ecosystem (MATL-07)
- [x] 14.3-07-PLAN.md -- DawSync doc rename to lowercase-kebab-case + category consolidation (MATL-08)
- [x] 14.3-08-PLAN.md -- Final ecosystem validation + vault re-sync + human verification (all MATL)
- [x] 14.3-09-PLAN.md -- Gap closure: DawSync category re-alignment (MATL-08 gap)

### Phase 15: CLAUDE.md Ecosystem Alignment
**Goal**: Every CLAUDE.md file in the ecosystem is rewritten to a standard template with context delegation, so an AI agent working in any project gets correct behavioral rules without redundancy or stale cross-references
**Depends on**: Phase 14.3
**Requirements**: CLAUDE-01, CLAUDE-02, CLAUDE-03, CLAUDE-04, CLAUDE-05, CLAUDE-06, CLAUDE-07, CLAUDE-08
**Success Criteria** (what must be TRUE):
  1. Canonical rule checklist extracted from all existing CLAUDE.md files (root, AndroidCommonDoc, shared-kmp-libs, DawSync); every behavioral rule inventoried with source file attribution before any rewrite begins
  2. CLAUDE.md template defined with standard sections; each file stays under 150 lines and under 4000 tokens initial context load
  3. Rewritten CLAUDE.md files for AndroidCommonDoc (L0), shared-kmp-libs (L1), and DawSync (L2) follow the template and contain every rule from the canonical checklist -- no rule dropped without explicit justification
  4. L0->L1->L2 context delegation implemented via @import directives; L2 loads L1 conventions, L1 loads L0 patterns, no circular references, and L0 never references L1/L2 projects by name
  5. Smoke test passes in each project: generating a ViewModel, UseCase, and test produces code that follows all behavioral rules from the original CLAUDE.md files (sealed interface UiState, rethrow CancellationException, flat module naming, etc.)
  6. MCP tool validate-claude-md checks CLAUDE.md structure against template, detects missing rules vs canonical checklist, and validates that @import references resolve to existing files
**Plans:** 4/4 plans complete

Plans:
- [x] 15-01-PLAN.md -- Canonical rule checklist + template design (CLAUDE-01, CLAUDE-02)
- [x] 15-02-PLAN.md -- validate-claude-md MCP tool (CLAUDE-08, CLAUDE-06)
- [x] 15-03-PLAN.md -- Rewrite all CLAUDE.md files with identity headers and delegation (CLAUDE-03, CLAUDE-04, CLAUDE-05, CLAUDE-06)
- [x] 15-04-PLAN.md -- Smoke test + Copilot adapter + human verification (CLAUDE-07)

### Phase 16: Ecosystem Documentation Completeness & Vault Harmony

**Goal:** Complete remaining documentation gaps across the L0/L1/L2 ecosystem: write 38 new per-module READMEs for shared-kmp-libs by reading actual Kotlin source code, upgrade 14 existing READMEs with full frontmatter, fix DawSync category alignment (31+ mismatched files), complete cross-layer category audit, assess DawSync subproject documentation, update module catalog, and achieve full vault harmony with resync, MOC improvements, wikilink refresh, and human-verified Obsidian graph view
**Requirements**: P16-README, P16-UPGRADE, P16-VALIDATE, P16-CATEGORY, P16-SUBPROJ, P16-VAULT, P16-CATALOG, P16-HUMAN
**Depends on:** Phase 15
**Success Criteria** (what must be TRUE):
  1. All 52 shared-kmp-libs modules have per-module READMEs with 10-field YAML frontmatter, source-code-verified API surfaces, and l0_refs cross-references
  2. validate-doc-structure extended to validate module READMEs (frontmatter completeness, 300-line limit, l0_refs)
  3. All DawSync docs use categories from the 9-category unified vocabulary; cross-layer audit passes for L0, L1, L2
  4. DawSync subproject docs (DawSyncWeb, SessionRecorder-VST3) assessed and gaps addressed
  5. module-catalog.md updated with links to all 52 module READMEs
  6. vault-config.json updated with collectGlobs for module READMEs; vault re-synced with MOC improvements and wikilink refresh
  7. Human-verified Obsidian graph view, MOC navigation, and wikilink coverage
**Plans:** 6/6 plans complete (completed 2026-03-16)

Plans:
- [x] 16-01-PLAN.md -- Validation tooling extension + vault-config.json update (P16-VALIDATE, P16-VAULT)
- [x] 16-02-PLAN.md -- DawSync category alignment + cross-layer audit + subproject docs (P16-CATEGORY, P16-SUBPROJ)
- [x] 16-03-PLAN.md -- New module READMEs: Error Mappers (9) + Storage (9) from source code (P16-README)
- [x] 16-04-PLAN.md -- New module READMEs: OAuth + Firebase + Security + Auth + Domain + System + I/O (20) from source code (P16-README)
- [x] 16-05-PLAN.md -- Upgrade 14 existing READMEs + update module-catalog.md (P16-UPGRADE, P16-CATALOG)
- [x] 16-06-PLAN.md -- Vault harmony: MOC enhancement, full resync, wikilink refresh + human verification (P16-VAULT, P16-HUMAN) -- checkpoint not approved, systemic vault quality issues deferred to phase 17

## Progress

**Execution Order:**
Phases 13 through 16 in strict sequence. Phase 13 (audit) must complete before Phase 14 (template design depends on audit evidence). Phase 14 must complete before Phase 15 (CLAUDE.md rewrite references consolidated docs). Phase 15 must complete before Phase 16 (documentation completeness builds on aligned CLAUDE.md and validated tooling).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Stabilize Foundation | v1.0 | 4/4 | Complete | 2026-03-12 |
| 2. Quality Gates and Enforcement | v1.0 | 3/3 | Complete | 2026-03-13 |
| 3. Distribution and Adoption | v1.0 | 4/4 | Complete | 2026-03-13 |
| 4. Audit Tech Debt Cleanup | v1.0 | 1/1 | Complete | 2026-03-13 |
| 5. Tech Debt Foundation | v1.1 | 2/2 | Complete | 2026-03-13 |
| 6. Konsist Internal Tests | v1.1 | 4/4 | Complete | 2026-03-13 |
| 7. Consumer Guard Tests | v1.1 | 3/3 | Complete | 2026-03-13 |
| 8. MCP Server | v1.1 | 4/4 | Complete | 2026-03-13 |
| 9. Pattern Registry & Discovery | v1.1 | 6/6 | Complete | 2026-03-13 |
| 10. Doc Intelligence & Detekt Generation | v1.1 | 7/7 | Complete | 2026-03-14 |
| 11. Obsidian Documentation Hub | v1.1 | 5/5 | Complete | 2026-03-14 |
| 12. Ecosystem Vault Expansion | v1.1 | 8/8 | Complete | 2026-03-14 |
| 13. Audit & Validate | v1.2 | 4/4 | Complete | 2026-03-14 |
| 14. Doc Structure & Consolidation | v1.2 | 10/10 | Complete | 2026-03-14 |
| 14.1. Docs Subdirectory Reorganization | v1.2 | 6/6 | Complete | 2026-03-15 |
| 14.2. Docs Content Quality | v1.2 | 9/9 | Complete | 2026-03-15 |
| 14.2.1. Ecosystem Skills Audit | v1.2 | 7/7 | Complete | 2026-03-15 |
| 14.3. Skill Materialization & Registry | v1.2 | 9/9 | Complete | 2026-03-15 |
| 15. CLAUDE.md Ecosystem Alignment | v1.2 | 4/4 | Complete | 2026-03-16 |
| 16. Ecosystem Doc Completeness | v1.2 | 6/6 | Complete | 2026-03-16 |
| 17. Documentation Structural Homogeneity | v1.2 | 5/7 | In Progress | -- |
| 18. GSD v1 → GSD-2 Migration | v1.2 | 4/4 | Complete | 2026-03-17 |

### Phase 17: Documentation Structural Homogeneity

**Goal:** Fix vault sync bugs (64 duplicates), build cross-layer validation tooling, restructure ALL source docs across L0/L1/L2 for hub->sub-doc homogeneity, align CLAUDE.md to Boris Cherny style, homogenize project READMEs, and perform final validated vault resync.
**Requirements:** P17-BUG, P17-DEDUP, P17-EXCLUDE, P17-NAMING, P17-VALIDATE, P17-L0HUB, P17-L0STRUCT, P17-L1HUB, P17-L1STRUCT, P17-L2HUB, P17-L2STRUCT, P17-L2CLEAN, P17-CLAUDEMD, P17-SYNC, P17-AUDIT, P17-README, P17-HUMAN
**Depends on:** Phase 16
**Plans:** 5/7 plans executed

Plans:
- [x] 17-01: Fix vault sync bugs (collector double-write, excludeGlobs, naming normalization, dedup gate) [wave 1]
- [x] 17-02: Build validate-vault MCP tool (duplicates, structural homogeneity, reference integrity, wikilinks) [wave 1]
- [ ] 17-03: L0 source restructuring (missing hubs for compose/navigation/resources/guides, audit existing hubs) [wave 2]
- [ ] 17-04: L1 source restructuring (hub files for all shared-kmp-libs docs/ subdirectories) [wave 2]
- [ ] 17-05: L2 source restructuring (DawSync hubs, archive cleanup, subproject normalization) [wave 2]
- [ ] 17-06: CLAUDE.md Boris Cherny alignment + vault resync with validation gate [wave 3]
- [ ] 17-07: Final ecosystem audit (all validators, README homogeneity, vault resync, human checkpoint) [wave 4]

### Phase 18: GSD v1 → GSD-2 Migration

**Goal:** Migrate all ecosystem projects from GSD v1 (.planning/ prompt framework) to GSD-2 (.gsd/ standalone CLI on Pi SDK) — install gsd-pi, run `/gsd migrate` on L0 (AndroidCommonDoc), L1 (shared-kmp-libs), L2 (DawSync + DawSyncWeb), configure per-project preferences.md (models, budget, timeouts), validate migration integrity (phases→slices, plans→tasks, completion state preserved), remove GSD v1 infrastructure, and verify GSD-2 workflow by continuing DawSync track-E execution (50% complete, plans 06-12 pending).
**Requirements**: GSD2-INSTALL, GSD2-MIGRATE-L0, GSD2-MIGRATE-L1, GSD2-MIGRATE-L2, GSD2-CONFIG, GSD2-VALIDATE, GSD2-CLEANUP, GSD2-VERIFY
**Depends on:** Phase 17
**Plans:** 4/4 plans complete (completed 2026-03-17)

Plans:
- [x] 18-01-PLAN.md -- Install gsd-pi + migrate L0 (AndroidCommonDoc) + L1 (shared-kmp-libs) [wave 1] (GSD2-INSTALL, GSD2-MIGRATE-L0, GSD2-MIGRATE-L1)
- [x] 18-02-PLAN.md -- Migrate DawSync + DawSyncWeb with track mapping + human checkpoint [wave 2] (GSD2-MIGRATE-L2)
- [x] 18-03-PLAN.md -- Configure preferences + validate migrations + cleanup v1 + update CLAUDE.md [wave 3] (GSD2-CONFIG, GSD2-VALIDATE, GSD2-CLEANUP)
- [x] 18-04-PLAN.md -- Verify DawSync track-E continuation + final human checkpoint [wave 4] (GSD2-VERIFY)

---
*Roadmap created: 2026-03-13*
*v1.0 details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)*
*v1.2 phases added: 2026-03-14*
*Phase 14.3 (Skill Materialization & Registry) inserted: 2026-03-15*
*Phase 16 planned: 2026-03-16*
*Phase 17 planned: 2026-03-16*
*Phase 18 planned: 2026-03-16*
